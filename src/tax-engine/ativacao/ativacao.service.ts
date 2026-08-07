import { Injectable, Logger } from '@nestjs/common';
import { lerJson, escreverJson } from '../persistencia/armazenamento-arquivo.util';
import { validarFormatoEChecksumDaChave, normalizarChave, obterFingerprintMaquina } from './chave-ativacao.util';
import { ConfigServidorService } from './config-servidor.service';

const ARQUIVO = 'ativacao.json';
const TIMEOUT_SERVIDOR_MS = 5000;

interface EstadoAtivacao {
  chave: string;
  fingerprintMaquina: string;
  dataAtivacao: string;
  /** Só preenchido quando há servidor de licenças configurado — última vez que o servidor CONFIRMOU esta ativação como válida. */
  ultimaVerificacaoOnline?: string;
}

export interface StatusAtivacao {
  ativado: boolean;
  /** Preenchido quando existe uma ativação salva, mas para OUTRA máquina (pasta "dados" copiada de outro computador), OU quando o servidor de licenças rejeitou a ativação numa revalidação online. */
  motivoBloqueio?: string;
  dataAtivacao?: string;
}

/**
 * Ativação por chave de produto — formato "AAAAA-BBBBB-CCCCC-DDDDD" (ver
 * `chave-ativacao.util.ts` para o algoritmo de geração/validação).
 *
 * MODO OFFLINE (padrão, sem nenhuma configuração extra): vínculo com a
 * máquina só localmente — `fingerprintMaquina` salvo no momento da
 * ativação, comparado em toda inicialização. Copiar a pasta "dados" para
 * outro computador quebra a ativação lá, mas nada impede a MESMA chave
 * de ser usada em duas instalações completamente independentes (cada
 * uma só enxerga a si mesma).
 *
 * MODO ONLINE (opcional — configure `ConfigServidorService`, ver
 * `servidor-licencas/`): a ativação INICIAL exige confirmação de um
 * servidor central (`POST {servidor}/ativar`), que mantém o registro de
 * qual computador cada chave já usou — a mesma chave numa SEGUNDA
 * máquina é recusada de verdade, não só localmente. `revalidarOnline()`
 * (chamada separada, não em toda requisição — ver `AtivacaoController`)
 * confirma periodicamente que a ativação ainda é válida; se o servidor
 * disser que não é mais (ex: revogada manualmente), desativa localmente.
 * Servidor inalcançável numa revalidação (sem internet no momento) NÃO
 * derruba a ativação — usa o estado local em cache, com tolerância a
 * ficar temporariamente offline.
 */
@Injectable()
export class AtivacaoService {
  private readonly logger = new Logger(AtivacaoService.name);

  constructor(private readonly configServidorService: ConfigServidorService) {}

  obterStatus(): StatusAtivacao {
    const salvo = lerJson<EstadoAtivacao | null>(ARQUIVO, null);
    if (!salvo) return { ativado: false };

    const fingerprintAtual = obterFingerprintMaquina();
    if (salvo.fingerprintMaquina !== fingerprintAtual) {
      return {
        ativado: false,
        motivoBloqueio: 'Esta ativação pertence a outro computador (a pasta de dados parece ter sido copiada de outra máquina). Insira uma chave de ativação própria para este computador.',
      };
    }

    return { ativado: true, dataAtivacao: salvo.dataAtivacao };
  }

  async ativar(chaveBruta: string): Promise<{ sucesso: boolean; mensagem: string }> {
    const chave = normalizarChave(chaveBruta);

    if (!validarFormatoEChecksumDaChave(chave)) {
      return { sucesso: false, mensagem: 'Chave de ativação inválida — confira se digitou certo (formato AAAAA-BBBBB-CCCCC-DDDDD).' };
    }

    const fingerprintMaquina = obterFingerprintMaquina();
    const urlServidor = this.configServidorService.obterUrlServidorLicencas();

    let ultimaVerificacaoOnline: string | undefined;
    if (urlServidor) {
      // Servidor de licenças configurado: a ativação PRECISA da confirmação
      // dele (é o único jeito de garantir de verdade que a chave não está
      // em uso noutra máquina) — sem conexão, a ativação inicial falha,
      // com uma mensagem clara em vez de deixar ativar "no escuro".
      const resultadoOnline = await this.chamarServidor(urlServidor, '/ativar', { chave, fingerprint: fingerprintMaquina });
      if (!resultadoOnline.alcancado) {
        return { sucesso: false, mensagem: 'Não foi possível conectar ao servidor de licenças para confirmar a ativação. Verifique sua conexão com a internet e tente novamente.' };
      }
      if (!resultadoOnline.corpo?.sucesso) {
        return { sucesso: false, mensagem: resultadoOnline.corpo?.mensagem || 'O servidor de licenças recusou esta chave.' };
      }
      ultimaVerificacaoOnline = new Date().toISOString();
    }

    const estado: EstadoAtivacao = {
      chave,
      fingerprintMaquina,
      dataAtivacao: new Date().toISOString(),
      ultimaVerificacaoOnline,
    };
    escreverJson(ARQUIVO, estado);
    return { sucesso: true, mensagem: 'Ativado com sucesso.' };
  }

  /**
   * Revalida a ativação atual com o servidor de licenças, se um estiver
   * configurado — chamada separadamente do `obterStatus()` (que precisa
   * ser rápido e síncrono, pois roda em TODA requisição via `AcessoGuard`),
   * pensada para ser chamada uma vez por sessão (ver `AtivacaoController`).
   * Sem servidor configurado, ou servidor inalcançável, não faz nada (a
   * ativação local em cache continua valendo).
   */
  async revalidarOnline(): Promise<void> {
    const urlServidor = this.configServidorService.obterUrlServidorLicencas();
    if (!urlServidor) return;

    const salvo = lerJson<EstadoAtivacao | null>(ARQUIVO, null);
    if (!salvo) return;

    const resultado = await this.chamarServidor(urlServidor, '/ativar', { chave: salvo.chave, fingerprint: salvo.fingerprintMaquina });
    if (!resultado.alcancado) {
      this.logger.warn('Servidor de licenças inalcançável na revalidação periódica — mantendo a ativação local em cache.');
      return;
    }
    if (!resultado.corpo?.sucesso) {
      this.logger.warn(`Servidor de licenças recusou a revalidação: ${resultado.corpo?.mensagem} — desativando localmente.`);
      this.desativar();
      return;
    }
    escreverJson(ARQUIVO, { ...salvo, ultimaVerificacaoOnline: new Date().toISOString() });
  }

  /** Usado só para suporte/testes manuais — remove a ativação salva, exigindo uma chave nova na próxima inicialização. */
  desativar(): void {
    escreverJson(ARQUIVO, null);
  }

  private async chamarServidor(urlBase: string, caminho: string, corpo: unknown): Promise<{ alcancado: boolean; corpo?: { sucesso: boolean; mensagem: string } }> {
    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_SERVIDOR_MS);
    try {
      const resposta = await fetch(urlBase + caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
      const json = (await resposta.json()) as { sucesso: boolean; mensagem: string };
      return { alcancado: true, corpo: json };
    } catch (erro) {
      this.logger.warn(`Falha ao contatar o servidor de licenças (${urlBase}${caminho}): ${(erro as Error).message}`);
      return { alcancado: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
