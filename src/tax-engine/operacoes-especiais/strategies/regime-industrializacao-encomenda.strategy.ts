import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';

/**
 * Industrialização por Encomenda (LC 214/2025, art. 20) — mecânica em duas
 * pernas:
 *   1. Remessa do insumo pelo encomendante ao industrializador: suspensão
 *      (tratada por `RegimeRemessaStrategy`, tipo `REMESSA`).
 *   2. Retorno do produto industrializado: incidência ocorre APENAS sobre o
 *      VALOR AGREGADO pelo industrializador (mão de obra + insumos
 *      próprios) — não sobre o valor total do produto retornado, o que
 *      evitaria dupla tributação do insumo já de propriedade do
 *      encomendante.
 *
 * Esta Strategy cobre a segunda perna: reconhecida quando
 * `tipo === 'INDUSTRIALIZACAO_ENCOMENDA'` e `valorAgregadoIndustrializacao`
 * está informado (o retorno em si, sem agregação de valor, cai no
 * `RegimeRetornoStrategy`).
 */
export class RegimeIndustrializacaoEncomendaStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_INDUSTRIALIZACAO_ENCOMENDA';
  readonly baseLegal = 'LC 214/2025, art. 20 (industrialização por encomenda — incidência sobre o valor agregado)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.tipo === 'INDUSTRIALIZACAO_ENCOMENDA' && dados.valorAgregadoIndustrializacao !== undefined;
  }

  calcular(dados: DadosOperacao, _baseCalculoGenerica: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseValorAgregado = new Decimal(dados.valorAgregadoIndustrializacao!).toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP,
    );

    const beneficio: BeneficioResolvido = {
      codigo: 'INDUSTRIALIZACAO_ENCOMENDA_BASE_VALOR_AGREGADO',
      tipo: 'REDUCAO_PERCENTUAL', // marcador — base diferenciada, não redução de alíquota
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseValorAgregado, beneficio),
      this.montar('IBS_MUNICIPAL', baseValorAgregado, beneficio),
      this.montar('CBS', baseValorAgregado, beneficio),
    ];
  }

  private montar(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0), // PENDÊNCIA: alíquota de referência (ver factory)
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeIndustrializacaoEncomendaStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { baseValorAgregado: base.toString() },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: base,
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }
}
