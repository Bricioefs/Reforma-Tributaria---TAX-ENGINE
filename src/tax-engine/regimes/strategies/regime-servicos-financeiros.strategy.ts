import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { codigoFiscalEstaEm } from '../../util/normalizador-classificacao-fiscal';
import { NBS_SERVICOS_FINANCEIROS } from '../codigos-nbs-reais';

/**
 * Regime de Serviços Financeiros (LC 214/2025, art. 182 e seguintes).
 *
 * Diferença estrutural chave: a base de cálculo NÃO é o valor bruto da
 * operação, mas sim a MARGEM/SPREAD (receita líquida de intermediação
 * financeira) — método distinto do "por fora" padrão. Esta Strategy
 * IGNORA deliberadamente a `ResultadoBaseCalculo` recebida (calculada pelo
 * `BaseCalculoService` genérico) e recalcula sua própria base.
 *
 * Reconhece a operação por NBS (lista real de 87 códigos extraída do
 * Conformidade Fácil, Anexos 92331/92231 — `codigos-nbs-reais.ts`) OU por
 * CNAE (lista ilustrativa) — mesmo reconhecendo corretamente a operação,
 * o VALOR calculado permanece pendente (ver abaixo), porque a
 * metodologia de apuração da margem ainda não foi publicada. Reconhecer
 * a operação já é útil por si só: evita que ela caia incorretamente no
 * regime padrão (alíquota de referência cheia sobre o valor bruto, que
 * não é a base correta para serviço financeiro).
 *
 * PENDÊNCIA REGULAMENTAR: a metodologia exata de apuração da margem
 * (regime de caixa vs. competência, dedução de PDD, tratamento de
 * derivativos etc.) depende de regulamentação específica do Comitê Gestor
 * e do CMN/BCB, ainda não publicada em sua totalidade — ponto de extensão
 * sinalizado abaixo.
 */
export class RegimeServicosFinanceirosStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_SERVICOS_FINANCEIROS';
  readonly baseLegal = 'LC 214/2025, art. 182 a 189 (base de cálculo por margem)';

  private readonly CNAES_SERVICOS_FINANCEIROS = new Set(['6422-1/00', '6421-2/00']); // bancos, exemplo

  aplicavel(dados: DadosOperacao): boolean {
    if (codigoFiscalEstaEm(dados.cnae, [...this.CNAES_SERVICOS_FINANCEIROS])) return true;
    return codigoFiscalEstaEm(dados.nbs, NBS_SERVICOS_FINANCEIROS);
  }

  calcular(
    dados: DadosOperacao,
    _baseCalculoGenerica: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    // A base "por margem" não é `valorBruto` — em produção viria de um
    // serviço dedicado (ex: `MargemFinanceiraService`) que cruza receitas e
    // custos de captação do período. Nesta fase, mantemos o ponto de
    // extensão explícito em vez de aproximar incorretamente pelo valor bruto.
    const baseMargemPendente = new Decimal(0); // PENDÊNCIA REGULAMENTAR — ver docstring

    const beneficio: BeneficioResolvido = {
      codigo: 'SERVICOS_FINANCEIROS_BASE_MARGEM',
      tipo: 'REDUCAO_PERCENTUAL', // marcador — base diferenciada, não uma redução de fato
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseMargemPendente, beneficio),
      this.montar('IBS_MUNICIPAL', baseMargemPendente, beneficio),
      this.montar('CBS', baseMargemPendente, beneficio),
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
        regraAplicada: `RegimeServicosFinanceirosStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { baseMargemPendenteRegulamentacao: true },
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
