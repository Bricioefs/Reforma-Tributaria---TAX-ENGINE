import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { lerJson, escreverJson } from '../persistencia/armazenamento-arquivo.util';

const ARQUIVO = 'usuario.json';

interface UsuarioPersistido {
  usuario: string;
  hash: string; // scrypt, hex
  salt: string; // hex
}

/**
 * Login local — usuário e senha únicos POR INSTALAÇÃO (não é um sistema
 * multiusuário com papéis/permissões — é uma segunda trava de acesso ao
 * mesmo computador, além da ativação por chave). Senha nunca é salva em
 * texto puro: `crypto.scryptSync` (função de derivação de chave lenta de
 * propósito, resistente a força bruta — já embutida no Node, sem
 * precisar de `bcrypt` como dependência externa) com um salt aleatório
 * próprio por usuário.
 *
 * "Estar logado" é um estado EM MEMÓRIA (não persistido) — cada vez que
 * o programa é aberto, é preciso fazer login de novo, do mesmo jeito que
 * uma tela de bloqueio do Windows não fica "destravada" depois de
 * reiniciar. Isso é intencional: sem isso, a trava de login não
 * protegeria nada depois da primeira vez.
 */
@Injectable()
export class AuthService {
  private logado = false;

  temUsuarioCadastrado(): boolean {
    return lerJson<UsuarioPersistido | null>(ARQUIVO, null) !== null;
  }

  estaLogado(): boolean {
    return this.logado;
  }

  cadastrar(usuario: string, senha: string): { sucesso: boolean; mensagem: string } {
    if (this.temUsuarioCadastrado()) {
      return { sucesso: false, mensagem: 'Já existe um usuário cadastrado nesta instalação — faça login em vez de cadastrar de novo.' };
    }
    const usuarioLimpo = (usuario ?? '').trim();
    if (usuarioLimpo.length < 3) {
      return { sucesso: false, mensagem: 'O nome de usuário precisa ter pelo menos 3 caracteres.' };
    }
    if (!senha || senha.length < 6) {
      return { sucesso: false, mensagem: 'A senha precisa ter pelo menos 6 caracteres.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
    escreverJson(ARQUIVO, { usuario: usuarioLimpo, hash, salt });
    this.logado = true;
    return { sucesso: true, mensagem: 'Usuário cadastrado e conectado.' };
  }

  login(usuario: string, senha: string): { sucesso: boolean; mensagem: string } {
    const salvo = lerJson<UsuarioPersistido | null>(ARQUIVO, null);
    if (!salvo) {
      return { sucesso: false, mensagem: 'Nenhum usuário cadastrado ainda nesta instalação.' };
    }
    if ((usuario ?? '').trim() !== salvo.usuario) {
      return { sucesso: false, mensagem: 'Usuário ou senha incorretos.' };
    }

    const hashTentativa = crypto.scryptSync(senha ?? '', salvo.salt, 64);
    const hashSalvo = Buffer.from(salvo.hash, 'hex');
    const confere = hashTentativa.length === hashSalvo.length && crypto.timingSafeEqual(hashTentativa, hashSalvo);
    if (!confere) {
      return { sucesso: false, mensagem: 'Usuário ou senha incorretos.' };
    }

    this.logado = true;
    return { sucesso: true, mensagem: 'Login realizado.' };
  }

  logout(): void {
    this.logado = false;
  }
}
