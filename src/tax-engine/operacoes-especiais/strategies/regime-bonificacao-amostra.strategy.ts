import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';

/**
 * Bonificação, Brinde, Demonstração e Amostra Grátis (LC 214/2025, art. 19,
 * §4º) — operações sem intuito comercial, sem contraprestação financeira.
 * Não há base de cálculo (valor da operação é zero para fins tributários),
 * mas a operação PRECISA ser documentada e rastreada (nota fiscal própria,
 * limite de valor/quantidade por período no caso de amostra grátis) para
 * não se converter em mecanismo de evasão via "doações" fictícias.
 *
 * PENDÊNCIA REGULAMENTAR: limite quantitativo/valor de amostra grátis por
 * período (equivalente ao histórico de IPI/ICMS) ainda não fixado por norma
 * específica da reforma — `LIMITE_AMOSTRA_GRATIS_PENDENTE` é o ponto de
 * extensão.
 */
export class RegimeBonificacaoAmostraStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_BONIFICACAO_AMOSTRA_DEMONSTRACAO';
  readonly baseLegal = 'LC 214/2025, art. 19, §4º (bonificação, brinde, demonstração e amostra grátis)';

  private readonly TIPOS_SEM_VALOR_COMERCIAL = new Set(['BONIFICACAO', 'DEMONSTRACAO', 'AMOSTRA_GRATIS']);
  // PENDÊNCIA REGULAMENTAR — ver docstring.
  private readonly LIMITE_AMOSTRA_GRATIS_PENDENTE: Decimal | null = null;

  aplicavel(dados: DadosOperacao): boolean {
    return this.TIPOS_SEM_VALOR_COMERCIAL.has(dados.tipo);
  }

  calcular(dados: DadosOperacao, _baseCalculoGenerica: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const excedeLimite =
      dados.tipo === 'AMOSTRA_GRATIS' &&
      this.LIMITE_AMOSTRA_GRATIS_PENDENTE !== null &&
      dados.valorBruto.greaterThan(this.LIMITE_AMOSTRA_GRATIS_PENDENTE);

    const beneficio: BeneficioResolvido = {
      codigo: excedeLimite ? 'AMOSTRA_GRATIS_EXCEDE_LIMITE_TRIBUTA_NORMALMENTE' : `${dados.tipo}_SEM_VALOR_COMERCIAL`,
      tipo: excedeLimite ? 'REDUCAO_PERCENTUAL' : 'ISENCAO',
      percentualReducao: excedeLimite ? new Decimal(0) : undefined,
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    // Se exceder o limite (quando fixado por norma), o excedente segue a
    // regra padrão — aqui apenas sinalizamos, sem recalcular (delegado ao
    // regime padrão em uma nova chamada, fora do escopo desta Strategy).
    const base = excedeLimite ? dados.valorBruto : new Decimal(0);

    return [
      this.montar('IBS_ESTADUAL', base, beneficio),
      this.montar('IBS_MUNICIPAL', base, beneficio),
      this.montar('CBS', base, beneficio),
    ];
  }

  private montar(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeBonificacaoAmostraStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), limiteAmostraGratisPendente: this.LIMITE_AMOSTRA_GRATIS_PENDENTE === null },
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
