import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { itensCestaBasicaComoCriteriosNcm } from '../../beneficios/itens-cesta-basica';
import { codigoFiscalEstaEm } from '../../util/normalizador-classificacao-fiscal';

/**
 * Regime da Cesta Básica Nacional de Alimentos — alíquota zero de IBS e CBS
 * (LC 214/2025, art. 141, Anexo I). Estratégia dedicada porque a regra tem
 * particularidade própria: ainda que exista benefício de alíquota zero, o
 * direito ao crédito das etapas anteriores é MANTIDO (não é isenção — que
 * anularia o crédito), diferença relevante para o Motor de Crédito.
 *
 * Usa a MESMA lista de NCMs de `BeneficiosService` (`itens-cesta-basica.ts`)
 * — antes desta unificação, esta classe tinha sua própria lista hardcoded
 * separada da usada pelo endpoint de consulta de benefícios, e as duas
 * podiam divergir (um NCM aparecer na consulta mas não ser aplicado no
 * cálculo, ou vice-versa).
 */
export class RegimeCestaBasicaStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_CESTA_BASICA';
  readonly baseLegal = 'LC 214/2025, art. 141, Anexo I';

  private readonly NCMS_CESTA_BASICA = itensCestaBasicaComoCriteriosNcm();

  aplicavel(dados: DadosOperacao): boolean {
    return codigoFiscalEstaEm(dados.ncm, this.NCMS_CESTA_BASICA);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const beneficioZero: BeneficioResolvido = {
      codigo: 'CESTA_BASICA_ALIQUOTA_ZERO',
      tipo: 'ALIQUOTA_ZERO',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.debitoZerado('IBS_ESTADUAL', baseIbs.baseCalculo, beneficioZero),
      this.debitoZerado('IBS_MUNICIPAL', baseIbs.baseCalculo, beneficioZero),
      this.debitoZerado('CBS', baseCbs.baseCalculo, beneficioZero),
    ];
  }

  private debitoZerado(
    tributo: ResultadoDebito['tributo'],
    base: Decimal,
    beneficio: BeneficioResolvido,
  ): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0), // referência: alíquota padrão zerada pelo benefício
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeCestaBasicaStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), beneficio: beneficio.codigo },
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
