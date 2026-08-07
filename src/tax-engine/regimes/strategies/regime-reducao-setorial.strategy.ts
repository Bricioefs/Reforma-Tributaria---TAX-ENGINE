import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { aliquotasParaData } from '../cronograma-transicao';
import { codigoFiscalEstaEm } from '../../util/normalizador-classificacao-fiscal';
import {
  NBS_TRANSPORTE_COLETIVO,
  NBS_PLANOS_SAUDE,
  NBS_EDUCACAO,
  NBS_SAUDE,
  NBS_PRODUCOES_CULTURAIS,
  NBS_SEGURANCA_CIBERNETICA,
  NBS_INSUMOS_AGROPECUARIOS_SERVICOS,
  NBS_PROFISSOES_INTELECTUAIS,
} from '../codigos-nbs-reais';

export interface CriteriosSetoriais {
  nbs?: string[];
  ncm?: string[];
  cnae?: string[];
}

/**
 * Regime genérico de redução percentual setorial (LC 214/2025, art. 136 a 139:
 * serviços de educação, saúde, transporte público coletivo, planos de
 * assistência à saúde). Todos compartilham a mesma mecânica — redução fixa
 * de alíquota sobre a alíquota de referência do ano (`cronograma-transicao.ts`)
 * — variando apenas o percentual, a base legal e o critério de classificação
 * (NBS/NCM/CNAE). Por isso uma única classe parametrizável, em vez de 4
 * classes quase idênticas.
 *
 * Regimes verdadeiramente distintos em MECÂNICA (não só percentual) — como
 * combustíveis, serviços financeiros, produtor rural, Simples Nacional,
 * ZFM e administração pública — têm cada um sua própria Strategy (ver
 * demais arquivos deste diretório).
 */
export class RegimeReducaoSetorialStrategy implements RegimeTributarioStrategy {
  constructor(
    readonly codigo: string,
    readonly baseLegal: string,
    private readonly percentualReducao: Decimal,
    private readonly criterios: CriteriosSetoriais,
  ) {}

  aplicavel(dados: DadosOperacao): boolean {
    if (this.criterios.nbs && codigoFiscalEstaEm(dados.nbs, this.criterios.nbs)) return true;
    if (this.criterios.ncm && codigoFiscalEstaEm(dados.ncm, this.criterios.ncm)) return true;
    if (this.criterios.cnae && codigoFiscalEstaEm(dados.cnae, this.criterios.cnae)) return true;
    return false;
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    const aliquotas = aliquotasParaData(dados.dataOperacao);

    const beneficio: BeneficioResolvido = {
      codigo: this.codigo,
      tipo: 'REDUCAO_PERCENTUAL',
      percentualReducao: this.percentualReducao,
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseIbs.baseCalculo, aliquotas.ibsEstadual, beneficio),
      this.montar('IBS_MUNICIPAL', baseIbs.baseCalculo, aliquotas.ibsMunicipal, beneficio),
      this.montar('CBS', baseCbs.baseCalculo, aliquotas.cbs, beneficio),
    ];
  }

  private montar(
    tributo: ResultadoDebito['tributo'],
    base: Decimal,
    aliquotaNominal: Decimal,
    beneficio: BeneficioResolvido,
  ): ResultadoDebito {
    const fatorReducao = new Decimal(1).minus(this.percentualReducao.dividedBy(100));
    const aliquotaEfetiva = aliquotaNominal.times(fatorReducao).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const valor = base.times(aliquotaEfetiva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeReducaoSetorialStrategy[${this.codigo}] (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), percentualReducao: this.percentualReducao.toString() },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: aliquotaEfetiva,
        baseCalculo: base,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.1.0',
      },
    };
  }
}

/**
 * Instâncias prontas dos regimes setoriais de redução — registradas na
 * factory. Todas usam listas REAIS de NBS agora — extraídas da base do
 * Conformidade Fácil e/ou do Anexo VIII da LC 214/2025 (tabela oficial de
 * correlação item-NBS/cClassTrib, `gov.br/nfse`) — ver `codigos-nbs-reais.ts`
 * para a origem de cada lista e o histórico de como cada uma foi ampliada.
 */
export function criarRegimesSetoriais(): RegimeReducaoSetorialStrategy[] {
  return [
    new RegimeReducaoSetorialStrategy(
      'REGIME_EDUCACAO',
      'LC 214/2025, art. 136, Anexo II (Serviços de educação)',
      new Decimal(60),
      { nbs: NBS_EDUCACAO },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_SAUDE',
      'LC 214/2025, art. 136, Anexo III (Serviços de saúde)',
      new Decimal(60),
      { nbs: NBS_SAUDE },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_TRANSPORTE_COLETIVO',
      'LC 214/2025, art. 138 (Transporte público coletivo de passageiros)',
      new Decimal(100), // alíquota zero no transporte público coletivo urbano
      { nbs: NBS_TRANSPORTE_COLETIVO },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_PLANOS_SAUDE',
      'LC 214/2025, art. 136 (Planos de assistência à saúde)',
      new Decimal(60),
      { nbs: NBS_PLANOS_SAUDE },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_PRODUCOES_CULTURAIS',
      'LC 214/2025, art. 144, Anexo X (Produções artísticas, culturais e audiovisuais)',
      new Decimal(60),
      { nbs: NBS_PRODUCOES_CULTURAIS },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_SEGURANCA_CIBERNETICA',
      'LC 214/2025, art. 144, Anexo XI (Segurança da informação e segurança cibernética)',
      new Decimal(60),
      { nbs: NBS_SEGURANCA_CIBERNETICA },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_INSUMOS_AGROPECUARIOS_SERVICOS',
      'LC 214/2025, art. 143, Anexo IX (Insumos agropecuários e aquícolas — serviços)',
      new Decimal(60),
      { nbs: NBS_INSUMOS_AGROPECUARIOS_SERVICOS },
    ),
    new RegimeReducaoSetorialStrategy(
      'REGIME_PROFISSOES_INTELECTUAIS',
      'LC 214/2025 (Anexo VIII, cClassTrib 200052 — Prestação de serviços de profissões intelectuais)',
      new Decimal(30),
      { nbs: NBS_PROFISSOES_INTELECTUAIS },
    ),
  ];
}
