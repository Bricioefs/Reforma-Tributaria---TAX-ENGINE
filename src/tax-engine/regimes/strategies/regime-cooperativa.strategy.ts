import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';

/**
 * Regime das Cooperativas (LC 214/2025, art. 168 e seguintes).
 *
 * Atos cooperativos TÍPICOS (entre a cooperativa e seus cooperados, no
 * exercício do objeto social) não sofrem incidência de IBS/CBS — é a
 * mecânica clássica de "ato cooperativo" preservada da jurisprudência
 * anterior. Operações da cooperativa COM TERCEIROS (não cooperados) seguem
 * a regra geral normalmente — por isso esta Strategy só se aplica quando
 * `atoCooperativoInterno === true`; caso contrário, o motor cai no regime
 * padrão (fallback da factory).
 */
export class RegimeCooperativaStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_COOPERATIVA_ATO_INTERNO';
  readonly baseLegal = 'LC 214/2025, art. 168 (não incidência sobre atos cooperativos típicos)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.atoCooperativoInterno === true;
  }

  calcular(
    _dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const naoIncidencia: BeneficioResolvido = {
      codigo: 'ATO_COOPERATIVO_NAO_INCIDENCIA',
      tipo: 'ISENCAO',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, naoIncidencia),
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, naoIncidencia),
      this.zero('CBS', baseCbs.baseCalculo, naoIncidencia),
    ];
  }

  private zero(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeCooperativaStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), atoCooperativoInterno: true },
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
