import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { codigoFiscalEstaEm } from '../../util/normalizador-classificacao-fiscal';

/**
 * Regime de Combustíveis (LC 214/2025, art. 169 e seguintes) — tributação
 * MONOFÁSICA: IBS e CBS incidem uma única vez na cadeia, concentrados no
 * produtor/importador, com alíquotas específicas (ad rem — por unidade de
 * medida, ex: R$/litro — não um percentual sobre o valor). As etapas
 * seguintes (distribuidor, revenda/varejo) NÃO sofrem nova incidência.
 *
 * Mecânica estruturalmente diferente do regime padrão: a base de cálculo é
 * a QUANTIDADE (volume), não o valor monetário da operação — por isso esta
 * Strategy usa `valorBruto` apenas como referência auxiliar e depende de um
 * campo de quantidade que, nesta fase, é PENDÊNCIA REGULAMENTAR (as
 * alíquotas específicas por tipo de combustível ainda dependem de ato do
 * Poder Executivo, LC 214/2025 art. 172).
 */
export class RegimeCombustiveisStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_COMBUSTIVEIS_MONOFASICO';
  readonly baseLegal = 'LC 214/2025, art. 169 a 175 (tributação monofásica de combustíveis)';

  private readonly NCMS_COMBUSTIVEIS = new Set(['2710.12.59', '2711.19.10']); // exemplos (gasolina, GLP)

  aplicavel(dados: DadosOperacao): boolean {
    return codigoFiscalEstaEm(dados.ncm, [...this.NCMS_COMBUSTIVEIS]);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const incideNestaEtapa = dados.etapaCadeiaCombustivel === 'PRODUTOR_IMPORTADOR';

    const beneficio: BeneficioResolvido = {
      codigo: incideNestaEtapa ? 'COMBUSTIVEL_INCIDENCIA_MONOFASICA_UNICA' : 'COMBUSTIVEL_NAO_INCIDENCIA_ETAPA_POSTERIOR',
      tipo: incideNestaEtapa ? 'DIFERIMENTO' : 'SUSPENSAO',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    // PENDÊNCIA REGULAMENTAR: alíquota específica ad rem por tipo de
    // combustível (art. 172) ainda não fixada — mantida em 0 nesta fase.
    // Quando incideNestaEtapa=true, o valor deveria ser `quantidade *
    // aliquotaEspecifica`, não um percentual sobre `valorBruto`.
    return [
      this.montar('IBS_ESTADUAL', baseIbs.baseCalculo, beneficio),
      this.montar('IBS_MUNICIPAL', baseIbs.baseCalculo, beneficio),
      this.montar('CBS', baseCbs.baseCalculo, beneficio),
    ];
  }

  private montar(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0), // ver PENDÊNCIA REGULAMENTAR acima
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeCombustiveisStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), etapa: beneficio.codigo },
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
