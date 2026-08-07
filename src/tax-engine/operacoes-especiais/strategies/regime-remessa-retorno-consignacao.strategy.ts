import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';

function debitoSuspenso(
  regra: string,
  baseLegal: string,
  codigoBeneficio: string,
  tributo: ResultadoDebito['tributo'],
  base: Decimal,
): ResultadoDebito {
  const beneficio: BeneficioResolvido = {
    codigo: codigoBeneficio,
    tipo: 'SUSPENSAO',
    baseLegal,
    cumulativo: false,
  };
  return {
    tributo,
    baseCalculo: base,
    aliquotaNominal: new Decimal(0),
    aliquotaEfetiva: new Decimal(0),
    valor: new Decimal(0),
    beneficiosAplicados: [beneficio],
    memoria: {
      regraAplicada: `${regra} (${tributo})`,
      baseLegal,
      parametrosUsados: { base: base.toString(), exigibilidadeSuspensaAteEventoFuturo: true },
      beneficioAplicadoCodigo: codigoBeneficio,
      aliquotaUtilizada: new Decimal(0),
      baseCalculo: base,
      valorApurado: new Decimal(0),
      dataVigenciaRegra: new Date('2026-01-01'),
      versaoRegra: '1.0.0',
    },
  };
}

/**
 * Remessa (para armazenagem, demonstração, industrialização por encomenda
 * etc., sem transferência definitiva de propriedade) — LC 214/2025, art.
 * 19. A remessa em si NÃO gera débito: a exigibilidade fica SUSPENSA até
 * o evento definitivo (venda efetiva, retorno, ou prazo limite sem retorno,
 * que converte a remessa em fato gerador — ponto de extensão para a Fase 4,
 * Motor de Eventos).
 */
export class RegimeRemessaStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_REMESSA';
  readonly baseLegal = 'LC 214/2025, art. 19 (remessa sem transferência de propriedade — suspensão)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.tipo === 'REMESSA';
  }

  calcular(_dados: DadosOperacao, baseCalculo: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    return [
      debitoSuspenso('RegimeRemessaStrategy', this.baseLegal, 'REMESSA_SUSPENSAO', 'IBS_ESTADUAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeRemessaStrategy', this.baseLegal, 'REMESSA_SUSPENSAO', 'IBS_MUNICIPAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeRemessaStrategy', this.baseLegal, 'REMESSA_SUSPENSAO', 'CBS', baseCbs.baseCalculo),
    ];
  }
}

/**
 * Retorno (da mercadoria remetida sem venda) — não é uma nova operação
 * tributável, pois não há nova transferência econômica de propriedade:
 * simplesmente encerra a suspensão aberta na remessa, sem gerar débito.
 */
export class RegimeRetornoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_RETORNO';
  readonly baseLegal = 'LC 214/2025, art. 19, §2º (retorno — encerramento da suspensão, sem incidência)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.tipo === 'RETORNO';
  }

  calcular(_dados: DadosOperacao, baseCalculo: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    return [
      debitoSuspenso('RegimeRetornoStrategy', this.baseLegal, 'RETORNO_NAO_INCIDENCIA', 'IBS_ESTADUAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeRetornoStrategy', this.baseLegal, 'RETORNO_NAO_INCIDENCIA', 'IBS_MUNICIPAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeRetornoStrategy', this.baseLegal, 'RETORNO_NAO_INCIDENCIA', 'CBS', baseCbs.baseCalculo),
    ];
  }
}

/**
 * Consignação Mercantil — remessa ao consignatário com exigibilidade
 * suspensa; o fato gerador só ocorre quando o consignatário efetivamente
 * vende a mercadoria a terceiro (evento tratado como uma nova operação
 * `VENDA` separada, fora do escopo desta remessa).
 */
export class RegimeConsignacaoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_CONSIGNACAO';
  readonly baseLegal = 'LC 214/2025, art. 19, §3º (consignação mercantil — suspensão até a venda)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.tipo === 'CONSIGNACAO';
  }

  calcular(_dados: DadosOperacao, baseCalculo: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    return [
      debitoSuspenso('RegimeConsignacaoStrategy', this.baseLegal, 'CONSIGNACAO_SUSPENSAO', 'IBS_ESTADUAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeConsignacaoStrategy', this.baseLegal, 'CONSIGNACAO_SUSPENSAO', 'IBS_MUNICIPAL', baseIbs.baseCalculo),
      debitoSuspenso('RegimeConsignacaoStrategy', this.baseLegal, 'CONSIGNACAO_SUSPENSAO', 'CBS', baseCbs.baseCalculo),
    ];
  }
}
