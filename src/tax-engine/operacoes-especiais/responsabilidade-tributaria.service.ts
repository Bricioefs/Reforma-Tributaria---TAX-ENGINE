import { Injectable } from '@nestjs/common';
import { DadosOperacao } from '../interfaces/tax-engine.interfaces';

export interface ResponsabilidadeTributaria {
  responsavelPeloRecolhimento: 'VENDEDOR' | 'MARKETPLACE' | 'REMETENTE_FISICO';
  baseLegal: string;
  detalhe: string;
}

/**
 * Resolve a responsabilidade pelo recolhimento/retenção de IBS/CBS em
 * arranjos que envolvem mais de um agente econômico na mesma operação:
 * marketplace (plataforma digital intermediando venda de terceiro) e
 * operações triangulares (remetente físico da mercadoria diferente do
 * vendedor/emitente da nota fiscal).
 *
 * Este serviço NÃO recalcula o valor do tributo — apenas determina QUEM é
 * responsável por recolher, informação registrada na auditoria e usada
 * pelo Motor de Split Payment (Fase 4) para direcionar a retenção
 * automática ao agente correto.
 */
@Injectable()
export class ResponsabilidadeTributariaService {
  resolver(dados: DadosOperacao): ResponsabilidadeTributaria | null {
    if (dados.viaMarketplace) {
      return {
        responsavelPeloRecolhimento: 'MARKETPLACE',
        baseLegal: 'LC 214/2025, art. 22-A (responsabilidade solidária/substituição das plataformas digitais)',
        detalhe: dados.marketplaceCnpjResponsavel
          ? `Retenção e recolhimento pela plataforma CNPJ ${dados.marketplaceCnpjResponsavel}`
          : 'Retenção e recolhimento pela plataforma de marketplace — CNPJ não informado',
      };
    }

    if (dados.operacaoTriangular) {
      return {
        responsavelPeloRecolhimento: 'VENDEDOR',
        baseLegal: 'LC 214/2025, art. 18 (operação triangular — emitente da nota fiscal permanece contribuinte)',
        detalhe: dados.remetenteFisicoDiferenteDoVendedor
          ? `Mercadoria remetida fisicamente por ${dados.remetenteFisicoDiferenteDoVendedor}, mas o vendedor/emitente da NF continua responsável pelo recolhimento`
          : 'Operação triangular — vendedor/emitente da NF permanece responsável pelo recolhimento',
      };
    }

    return null; // operação comum — responsabilidade padrão do vendedor, sem particularidade a registrar
  }
}
