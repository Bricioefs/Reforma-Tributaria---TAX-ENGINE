import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { aliquotasParaData } from '../cronograma-transicao';

/**
 * Regime padrão (regra geral) — aplicável a qualquer operação que não se
 * enquadre em nenhum regime diferenciado/específico.
 *
 * As alíquotas nominais são resolvidas por `aliquotasParaData()`
 * (`cronograma-transicao.ts`), a partir da DATA DA OPERAÇÃO — cada ano da
 * transição da LC 214/2025 (2026 a 2033+) usa percentuais diferentes,
 * conforme o cronograma legal. Isso substitui os parâmetros fixos usados
 * nas fases anteriores (que ficavam sempre em zero, pendentes de
 * regulamentação). PENDÊNCIA REGULAMENTAR: a alíquota-padrão de
 * referência PLENA (a partir de 2033) ainda não foi fixada por Resolução
 * do Senado — ver `cronograma-transicao.ts` para o parâmetro ajustável.
 */
export class RegimePadraoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_PADRAO';
  readonly baseLegal = 'LC 214/2025, art. 8º (regra geral de incidência) c/c art. 343 e segs. (cronograma de transição)';

  aplicavel(_dados: DadosOperacao): boolean {
    // Regime padrão é sempre "aplicável" — deve ser o último da cadeia de
    // resolução na factory (fallback), nunca o primeiro a ser testado.
    return true;
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    const aliquotas = aliquotasParaData(dados.dataOperacao);

    return [
      this.montarDebito('IBS_ESTADUAL', baseIbs.baseCalculo, aliquotas.ibsEstadual, beneficios),
      this.montarDebito('IBS_MUNICIPAL', baseIbs.baseCalculo, aliquotas.ibsMunicipal, beneficios),
      this.montarDebito('CBS', baseCbs.baseCalculo, aliquotas.cbs, beneficios),
    ];
  }

  private montarDebito(
    tributo: ResultadoDebito['tributo'],
    base: Decimal,
    aliquotaNominal: Decimal,
    beneficios: BeneficioResolvido[],
  ): ResultadoDebito {
    const aliquotaEfetiva = this.aplicarBeneficios(aliquotaNominal, beneficios);
    const valor = base.times(aliquotaEfetiva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: beneficios,
      memoria: {
        regraAplicada: `RegimePadraoStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: {
          base: base.toString(),
          aliquotaNominal: aliquotaNominal.toString(),
          beneficios: beneficios.map((b) => b.codigo),
        },
        beneficioAplicadoCodigo: beneficios[0]?.codigo,
        aliquotaUtilizada: aliquotaEfetiva,
        baseCalculo: base,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.1.0',
      },
    };
  }

  private aplicarBeneficios(aliquotaNominal: Decimal, beneficios: BeneficioResolvido[]): Decimal {
    let aliquota = new Decimal(aliquotaNominal);
    for (const b of beneficios) {
      if (['ALIQUOTA_ZERO', 'ISENCAO', 'IMUNIDADE', 'SUSPENSAO', 'DIFERIMENTO'].includes(b.tipo)) {
        aliquota = new Decimal(0);
      } else if (b.tipo === 'REDUCAO_PERCENTUAL' && b.percentualReducao) {
        aliquota = aliquota.times(new Decimal(1).minus(b.percentualReducao.dividedBy(100)));
      }
    }
    return aliquota.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }
}
