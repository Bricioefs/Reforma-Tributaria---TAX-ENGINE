import { Injectable, Logger } from '@nestjs/common';
import { ConfigServidorService } from '../ativacao/config-servidor.service';
import { VERSAO_APP } from '../../versao';

export interface ResultadoVerificacaoAtualizacao {
  versaoAtual: string;
  disponivel: boolean;
  versaoMaisRecente?: string;
  notas?: string;
  urlDownload?: string;
}

const TIMEOUT_SERVIDOR_MS = 5000;

/**
 * Verifica se há uma versão nova publicada no servidor de licenças
 * (`GET {servidor}/versao`) — usado para mostrar um aviso na tela
 * quando alguém abre o sistema numa versão desatualizada.
 *
 * Comparação de versão simples (formato "X.Y.Z", maior número em cada
 * posição vence) — suficiente para "existe uma versão mais nova?", sem
 * precisar de uma biblioteca de versionamento semântico completo.
 */
@Injectable()
export class AtualizacaoService {
  private readonly logger = new Logger(AtualizacaoService.name);

  constructor(private readonly configServidorService: ConfigServidorService) {}

  async verificar(): Promise<ResultadoVerificacaoAtualizacao> {
    const urlServidor = this.configServidorService.obterUrlServidorLicencas();
    if (!urlServidor) {
      return { versaoAtual: VERSAO_APP, disponivel: false };
    }

    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_SERVIDOR_MS);
    try {
      const resposta = await fetch(`${urlServidor}/versao`, { signal: controlador.signal });
      const dados = (await resposta.json()) as { versao?: string; notas?: string; urlDownload?: string };
      const disponivel = typeof dados.versao === 'string' && this.versaoEhMaisNova(dados.versao, VERSAO_APP);
      return {
        versaoAtual: VERSAO_APP,
        disponivel,
        versaoMaisRecente: dados.versao,
        notas: dados.notas,
        urlDownload: dados.urlDownload,
      };
    } catch (erro) {
      this.logger.warn(`Falha ao verificar atualização (${urlServidor}/versao): ${(erro as Error).message}`);
      return { versaoAtual: VERSAO_APP, disponivel: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private versaoEhMaisNova(candidata: string, atual: string): boolean {
    const partesCandidata = candidata.split('.').map(Number);
    const partesAtual = atual.split('.').map(Number);
    for (let i = 0; i < Math.max(partesCandidata.length, partesAtual.length); i++) {
      const c = partesCandidata[i] ?? 0;
      const a = partesAtual[i] ?? 0;
      if (c > a) return true;
      if (c < a) return false;
    }
    return false;
  }
}
