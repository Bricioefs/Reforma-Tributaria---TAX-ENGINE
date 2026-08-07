import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

export type TipoCredito =
  | 'INTEGRAL'
  | 'PARCIAL'
  | 'VEDADO'
  | 'PRESUMIDO'
  | 'CONDICIONADO'
  | 'PROPORCIONAL'
  | 'ATIVO_IMOBILIZADO'
  | 'USO_E_CONSUMO'
  | 'ENERGIA'
  | 'COMUNICACAO'
  | 'IMPORTACAO'
  | 'EXTEMPORANEO';

export interface EntradaCredito {
  tipo: TipoCredito;
  tributo: 'IBS' | 'CBS';
  valorDestacadoDocumento: Decimal;
  origemDocumento: string; // chave de acesso NF-e/NFS-e/NF-ABI
  percentualApropriacao?: Decimal; // default 100
  condicaoAtendida?: boolean; // para CONDICIONADO
}

export interface CreditoApurado {
  tipo: TipoCredito;
  tributo: 'IBS' | 'CBS';
  valorOriginal: Decimal;
  valorAproveitado: Decimal;
  percentualApropriacao: Decimal;
  origemDocumento: string;
  vedado: boolean;
  motivoVedacao?: string;
  baseLegal: string;
}

export interface EstornoCredito {
  creditoId: string;
  tipo: 'TOTAL' | 'PARCIAL';
  valor: Decimal;
  motivo: string;
}

/**
 * Motor de Crédito — Não Cumulatividade Plena (LC 214/2025, art. 28 e seguintes).
 *
 * A regra geral do IBS/CBS é o crédito financeiro amplo: em princípio, todo
 * IBS/CBS destacado em documento fiscal de aquisição gera direito a crédito,
 * ressalvadas as vedações expressas em lei (ex: uso e consumo pessoal,
 * operações com benefício sem previsão de manutenção de crédito, etc.).
 *
 * Toda concessão de crédito gera rastreabilidade obrigatória até o
 * documento fiscal de origem (`origemDocumento`), atendendo ao requisito de
 * auditoria da LC 214/2025.
 */
@Injectable()
export class CreditoService {
  private readonly VEDACOES_CONHECIDAS: Partial<Record<TipoCredito, string>> = {
    // Uso e consumo pessoal (não relacionado à atividade) permanece vedado
    // por regra geral; bens de uso e consumo da atividade têm crédito
    // integral a partir de 2027, conforme cronograma de transição.
  };

  apurarCredito(entrada: EntradaCredito): CreditoApurado {
    const percentual = entrada.percentualApropriacao ?? new Decimal(100);

    if (entrada.tipo === 'CONDICIONADO' && entrada.condicaoAtendida === false) {
      return this.creditoVedado(entrada, 'Condição legal para apropriação do crédito não atendida.');
    }

    const valorAproveitado = entrada.valorDestacadoDocumento
      .times(percentual)
      .dividedBy(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      tipo: entrada.tipo,
      tributo: entrada.tributo,
      valorOriginal: entrada.valorDestacadoDocumento,
      valorAproveitado,
      percentualApropriacao: percentual,
      origemDocumento: entrada.origemDocumento,
      vedado: false,
      baseLegal: this.baseLegalPara(entrada.tipo),
    };
  }

  /** Estorno obrigatório (ex: mudança de destinação) ou parcial (ex: perda/sinistro). */
  aplicarEstorno(creditoApurado: CreditoApurado, estorno: EstornoCredito): CreditoApurado {
    const valorEstornado =
      estorno.tipo === 'TOTAL' ? creditoApurado.valorAproveitado : estorno.valor;

    return {
      ...creditoApurado,
      valorAproveitado: creditoApurado.valorAproveitado.minus(valorEstornado),
    };
  }

  /** Crédito extemporâneo — aproveitado fora do período de apuração original. */
  registrarCreditoExtemporaneo(entrada: EntradaCredito, competenciaOriginal: Date): CreditoApurado {
    const apurado = this.apurarCredito({ ...entrada, tipo: 'EXTEMPORANEO' });
    return {
      ...apurado,
      baseLegal: `${apurado.baseLegal} (extemporâneo, competência original: ${competenciaOriginal.toISOString().slice(0, 7)})`,
    };
  }

  private creditoVedado(entrada: EntradaCredito, motivo: string): CreditoApurado {
    return {
      tipo: entrada.tipo,
      tributo: entrada.tributo,
      valorOriginal: entrada.valorDestacadoDocumento,
      valorAproveitado: new Decimal(0),
      percentualApropriacao: new Decimal(0),
      origemDocumento: entrada.origemDocumento,
      vedado: true,
      motivoVedacao: motivo,
      baseLegal: this.baseLegalPara(entrada.tipo),
    };
  }

  private baseLegalPara(tipo: TipoCredito): string {
    const mapa: Record<TipoCredito, string> = {
      INTEGRAL: 'LC 214/2025, art. 28, caput',
      PARCIAL: 'LC 214/2025, art. 28, §1º',
      VEDADO: 'LC 214/2025, art. 31',
      PRESUMIDO: 'LC 214/2025, art. 33 e regimes específicos (Anexo)',
      CONDICIONADO: 'LC 214/2025, art. 30 (crédito condicionado a evento futuro)',
      PROPORCIONAL: 'LC 214/2025, art. 29 (apropriação proporcional — rateio)',
      ATIVO_IMOBILIZADO: 'LC 214/2025, art. 47 (bens do ativo imobilizado)',
      USO_E_CONSUMO: 'LC 214/2025, art. 48 c/c cronograma de transição (ADCT)',
      ENERGIA: 'LC 214/2025, art. 49 (energia elétrica)',
      COMUNICACAO: 'LC 214/2025, art. 49 (serviços de comunicação)',
      IMPORTACAO: 'LC 214/2025, art. 50 (crédito na importação)',
      EXTEMPORANEO: 'LC 214/2025, art. 45 (aproveitamento extemporâneo)',
    };
    return mapa[tipo];
  }
}
