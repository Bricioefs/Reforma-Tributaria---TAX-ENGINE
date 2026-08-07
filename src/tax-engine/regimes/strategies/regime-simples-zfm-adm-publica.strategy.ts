import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { ehLancamentoDeEntrada } from '../../lancamentos/classificacao-lancamento';
import { aliquotasParaData } from '../../regimes/cronograma-transicao';

/**
 * Regime do Simples Nacional (LC 214/2025, art. 12-A da LC 123/2006, na
 * redação dada pela reforma) — trata dois cenários bem diferentes:
 *
 * 1. VENDA feita por uma empresa optante (a operação corrente É a
 *    empresa do Simples vendendo) — tratamento HÍBRIDO, escolhido pelo
 *    CONTRIBUINTE (não uma característica intrínseca do produto/serviço):
 *      - `RECOLHIMENTO_UNIFICADO`: continua recolhendo IBS/CBS por dentro
 *        do DAS, sem destaque na nota e sem gerar crédito ao adquirente;
 *      - `HIBRIDO_REGULAR`: apura IBS/CBS "por fora", destacando na nota
 *        e gerando crédito ao adquirente — em troca, sai do tratamento
 *        unificado para esses tributos.
 *
 * 2. COMPRA de um fornecedor optante (a operação corrente é OUTRA
 *    empresa comprando dele) — aqui o adquirente NÃO PODE assumir
 *    crédito integral automaticamente: as regras de transferência de
 *    crédito de fornecedor do Simples (LC 214/2025) dependem do
 *    Anexo/faixa de faturamento do fornecedor, que este motor não tem
 *    como calcular sozinho. Por isso:
 *      - se `creditoTransferidoInformado` foi informado (valor que o
 *        PRÓPRIO fornecedor do Simples deve discriminar no documento
 *        fiscal, conforme a lei exige) — usa esse valor, dividido entre
 *        CBS/IBS Estadual/IBS Municipal na mesma proporção da alíquota
 *        de referência do ano;
 *      - se NÃO foi informado — o crédito fica ZERADO, com um marcador
 *        explicando o motivo, em vez de assumir o valor integral "por
 *        fora" como se fosse uma compra de empresa em regime normal.
 */
export class RegimeSimplesNacionalStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_SIMPLES_NACIONAL';
  readonly baseLegal = 'LC 214/2025 c/c LC 123/2006, art. 12-A (opção híbrida do Simples Nacional e transferência de créditos)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.optanteSimplesNacional === true;
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    if (ehLancamentoDeEntrada(dados.tipo)) {
      return this.calcularCompraDeFornecedorSimples(dados, baseCalculo);
    }
    return this.calcularVendaPorOptanteDoSimples(dados, baseCalculo);
  }

  /** Compra de um fornecedor optante pelo Simples — nunca assume crédito integral automaticamente. */
  private calcularCompraDeFornecedorSimples(dados: DadosOperacao, baseCalculo: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    if (dados.creditoTransferidoInformado && dados.creditoTransferidoInformado.greaterThan(0)) {
      // Divide o valor informado (um total único, como vem discriminado no
      // documento fiscal do fornecedor) entre os 3 tributos, na mesma
      // proporção da alíquota de referência do ano — mesma lógica usada
      // em todo o resto do sistema para repartir CBS/IBS Estadual/IBS
      // Municipal a partir de um total combinado.
      const aliquotas = aliquotasParaData(dados.dataOperacao);
      const somaAliquotas = aliquotas.cbs.plus(aliquotas.ibsEstadual).plus(aliquotas.ibsMunicipal);
      const proporcao = (parte: Decimal) => (somaAliquotas.isZero() ? new Decimal(0) : parte.dividedBy(somaAliquotas));

      const beneficio: BeneficioResolvido = {
        codigo: 'SIMPLES_NACIONAL_CREDITO_TRANSFERIDO_INFORMADO',
        tipo: 'REDUCAO_PERCENTUAL',
        baseLegal: this.baseLegal,
        cumulativo: false,
      };

      const valorCbs = dados.creditoTransferidoInformado.times(proporcao(aliquotas.cbs)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const valorIbsEstadual = dados.creditoTransferidoInformado.times(proporcao(aliquotas.ibsEstadual)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const valorIbsMunicipal = dados.creditoTransferidoInformado.minus(valorCbs).minus(valorIbsEstadual).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      return [
        this.montar('IBS_ESTADUAL', baseIbs.baseCalculo, valorIbsEstadual, beneficio),
        this.montar('IBS_MUNICIPAL', baseIbs.baseCalculo, valorIbsMunicipal, beneficio),
        this.montar('CBS', baseCbs.baseCalculo, valorCbs, beneficio),
      ];
    }

    // Sem o valor de crédito transferido informado — NÃO assume crédito
    // integral por precaução (pedido explícito: "não considerar
    // automaticamente o crédito integral de IBS e CBS").
    const semCreditoInformado: BeneficioResolvido = {
      codigo: 'SIMPLES_NACIONAL_CREDITO_NAO_INFORMADO_ZERADO_POR_PRECAUCAO',
      tipo: 'SUSPENSAO',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };
    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, semCreditoInformado),
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, semCreditoInformado),
      this.zero('CBS', baseCbs.baseCalculo, semCreditoInformado),
    ];
  }

  /** Venda feita pela própria empresa optante — mantém o tratamento híbrido já existente. */
  private calcularVendaPorOptanteDoSimples(dados: DadosOperacao, baseCalculo: ResultadoBaseCalculo[]): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    const optouRegular = dados.regimeSimplesEscolhido === 'HIBRIDO_REGULAR';

    if (!optouRegular) {
      const semDestaque: BeneficioResolvido = {
        codigo: 'SIMPLES_NACIONAL_RECOLHIMENTO_UNIFICADO',
        tipo: 'SUSPENSAO',
        baseLegal: this.baseLegal,
        cumulativo: false,
      };
      return [
        this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, semDestaque),
        this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, semDestaque),
        this.zero('CBS', baseCbs.baseCalculo, semDestaque),
      ];
    }

    const marcador: BeneficioResolvido = {
      codigo: 'SIMPLES_NACIONAL_OPCAO_HIBRIDA_REGULAR',
      tipo: 'REDUCAO_PERCENTUAL',
      percentualReducao: new Decimal(0),
      baseLegal: this.baseLegal,
      cumulativo: true,
    };
    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, marcador), // alíquota nominal pendente — ver factory
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, marcador),
      this.zero('CBS', baseCbs.baseCalculo, marcador),
    ];
  }

  private montar(tributo: ResultadoDebito['tributo'], base: Decimal, valor: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    const aliquotaEfetiva = base.isZero() ? new Decimal(0) : valor.dividedBy(base).times(100);
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: aliquotaEfetiva,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeSimplesNacionalStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), creditoTransferidoInformado: true },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: aliquotaEfetiva,
        baseCalculo: base,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '2.0.0',
      },
    };
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
        regraAplicada: `RegimeSimplesNacionalStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), modoEscolhido: beneficio.codigo },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: base,
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '2.0.0',
      },
    };
  }
}

/**
 * Regime da Zona Franca de Manaus e Áreas de Livre Comércio (LC 214/2025,
 * art. 444 e seguintes) — manutenção dos incentivos equivalentes aos hoje
 * vigentes (ex: PIS/COFINS/IPI reduzidos ou isentos na ZFM), transpostos
 * para IBS/CBS. Aplica-se quando a operação tem origem OU destino na ZFM/ALC.
 */
export class RegimeZfmAlcStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_ZFM_ALC';
  readonly baseLegal = 'LC 214/2025, art. 444 a 452 (Zona Franca de Manaus e Áreas de Livre Comércio)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.operacaoZfmOuAlc === true;
  }

  calcular(
    _dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const beneficio: BeneficioResolvido = {
      codigo: 'ZFM_ALC_MANUTENCAO_INCENTIVO',
      tipo: 'REDUCAO_PERCENTUAL',
      // PENDÊNCIA REGULAMENTAR: percentual de equivalência ao incentivo
      // histórico (calculado por decreto para preservar a competitividade
      // da ZFM) ainda não fixado nesta fase.
      percentualReducao: new Decimal(0),
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

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
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeZfmAlcStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), incentivoPendenteRegulamentacao: true },
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

/**
 * Regime da Administração Pública (LC 214/2025, art. 9º, III c/c CF, art.
 * 150, VI, "a") — imunidade recíproca. Operações em que o destinatário é
 * órgão da administração pública direta (União, Estados, DF, Municípios,
 * autarquias e fundações públicas, em relação ao patrimônio/renda/serviços
 * vinculados às finalidades essenciais) não sofrem incidência de IBS/CBS.
 */
export class RegimeAdministracaoPublicaStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_ADMINISTRACAO_PUBLICA';
  readonly baseLegal = 'CF, art. 150, VI, "a" c/c LC 214/2025, art. 9º, III (imunidade recíproca)';

  aplicavel(dados: DadosOperacao): boolean {
    return dados.destinatarioAdministracaoPublica === true;
  }

  calcular(
    _dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const imunidade: BeneficioResolvido = {
      codigo: 'IMUNIDADE_RECIPROCA_ADMINISTRACAO_PUBLICA',
      tipo: 'IMUNIDADE',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, imunidade),
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, imunidade),
      this.zero('CBS', baseCbs.baseCalculo, imunidade),
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
        regraAplicada: `RegimeAdministracaoPublicaStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString() },
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
