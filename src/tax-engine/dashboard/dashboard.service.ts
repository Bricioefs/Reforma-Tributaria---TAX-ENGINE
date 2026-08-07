import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';
import { ApuracaoMensalResultado } from '../apuracao/apuracao-mensal.service';
import { CreditoApurado } from '../credito/credito.service';
import { aliquotasParaData } from '../regimes/cronograma-transicao';
import { LancamentoPersistido } from '../lancamentos/lancamentos.service';
import { ehLancamentoDeEntrada } from '../lancamentos/classificacao-lancamento';

export interface SerieTemporal {
  labels: string[];
  datasets: { label: string; data: number[] }[];
}

export interface DistribuicaoCategorica {
  labels: string[];
  data: number[];
}

/**
 * Gera payloads JSON já no formato consumido diretamente por Chart.js,
 * Recharts, ApexCharts e ECharts (todos aceitam a forma `{ labels, datasets
 * }` ou `{ labels, data }` com pequenas adaptações no front-end — a
 * responsabilidade deste serviço é entregar os NÚMEROS corretos, agregados
 * a partir dos motores já apurados; a escolha da lib de gráfico é do
 * front-end consumidor da API).
 *
 * Valores monetários são convertidos de `Decimal` para `number` apenas
 * aqui, na borda de saída para visualização — o motor de cálculo em si
 * nunca usa `number` para dinheiro (ver `base-calculo.service.ts`).
 */
@Injectable()
export class DashboardService {
  /** Evolução mensal do IBS e da CBS ao longo das apurações de um estabelecimento. */
  evolucaoMensalIbsCbs(apuracoes: ApuracaoMensalResultado[]): SerieTemporal {
    const ordenadas = [...apuracoes].sort((a, b) => a.competencia.localeCompare(b.competencia));
    return {
      labels: ordenadas.map((a) => a.competencia),
      datasets: [
        { label: 'IBS', data: ordenadas.map((a) => a.saldoIbs.toNumber()) },
        { label: 'CBS', data: ordenadas.map((a) => a.saldoCbs.toNumber()) },
      ],
    };
  }

  /** Créditos gerados (total apurado) vs. efetivamente utilizados (não vedados/estornados), por competência. */
  creditosGeradosVsUtilizados(creditosPorCompetencia: Array<{ competencia: string; creditos: CreditoApurado[] }>): SerieTemporal {
    const ordenadas = [...creditosPorCompetencia].sort((a, b) => a.competencia.localeCompare(b.competencia));
    return {
      labels: ordenadas.map((c) => c.competencia),
      datasets: [
        {
          label: 'Créditos Gerados',
          data: ordenadas.map((c) => this.somar(c.creditos.map((cr) => cr.valorOriginal)).toNumber()),
        },
        {
          label: 'Créditos Utilizados',
          data: ordenadas.map((c) =>
            this.somar(c.creditos.filter((cr) => !cr.vedado).map((cr) => cr.valorAproveitado)).toNumber(),
          ),
        },
      ],
    };
  }

  /**
   * Base total afetada por benefício fiscal aplicado — proxy de "economia
   * obtida por benefícios fiscais" pedido no prompt original. O valor
   * monetário exato da economia depende da alíquota de referência
   * definitiva (PENDÊNCIA REGULAMENTAR — ver `regime-strategy.factory.ts`);
   * enquanto isso, o indicador disponível é a base de cálculo total que
   * recebeu tratamento diferenciado, por código de benefício.
   */
  baseAfetadaPorBeneficio(memorias: RegistroMemoriaCalculo[]): DistribuicaoCategorica {
    const porCodigo = new Map<string, Decimal>();
    for (const m of memorias) {
      if (!m.beneficioAplicadoCodigo) continue;
      const atual = porCodigo.get(m.beneficioAplicadoCodigo) ?? new Decimal(0);
      porCodigo.set(m.beneficioAplicadoCodigo, atual.plus(m.baseCalculo));
    }
    const entradas = [...porCodigo.entries()];
    return {
      labels: entradas.map(([codigo]) => codigo),
      data: entradas.map(([, valor]) => valor.toNumber()),
    };
  }

  /** Quantidade de operações apuradas por regime/regra aplicada — indicador por regime tributário. */
  indicadoresPorRegime(memorias: RegistroMemoriaCalculo[]): DistribuicaoCategorica {
    const porRegra = new Map<string, number>();
    for (const m of memorias) {
      // regraAplicada vem como "NomeDaStrategy (TRIBUTO)" — agrupamos pelo nome da strategy.
      const regra = m.regraAplicada.split(' (')[0];
      porRegra.set(regra, (porRegra.get(regra) ?? 0) + 1);
    }
    const entradas = [...porRegra.entries()].sort((a, b) => b[1] - a[1]);
    return {
      labels: entradas.map(([regra]) => regra),
      data: entradas.map(([, contagem]) => contagem),
    };
  }

  /** Comparação de saldo total (IBS+CBS) entre dois exercícios/anos. */
  comparacaoEntreExercicios(apuracoesAnoA: ApuracaoMensalResultado[], anoA: string, apuracoesAnoB: ApuracaoMensalResultado[], anoB: string): SerieTemporal {
    const totalAno = (apuracoes: ApuracaoMensalResultado[]) =>
      this.somar(apuracoes.map((a) => a.saldoIbs.plus(a.saldoCbs))).toNumber();
    return {
      labels: [anoA, anoB],
      datasets: [{ label: 'Saldo total apurado (IBS+CBS)', data: [totalAno(apuracoesAnoA), totalAno(apuracoesAnoB)] }],
    };
  }

  /**
   * ECONOMIA GERADA POR BENEFÍCIOS FISCAIS, em R$ — não só a base afetada
   * (o que já existia), mas o valor efetivamente economizado: compara o
   * que seria devido na alíquota de referência do ANO da operação
   * (`cronograma-transicao.ts`) contra o que foi realmente apurado com o
   * benefício aplicado. Esta é a métrica mais direta para decisão do
   * negócio ("quanto o benefício X está economizando de fato").
   *
   * Requer `dataOperacao` no registro (preenchido centralmente por
   * `DebitoService.calcularOperacao()` desde a correção deste dashboard —
   * registros antigos, gravados antes dessa mudança, não têm esse campo e
   * são ignorados aqui, silenciosamente, para não estimar errado).
   */
  economiaGeradaPorBeneficios(memorias: RegistroMemoriaCalculo[]): DistribuicaoCategorica {
    const porCodigo = new Map<string, Decimal>();

    for (const m of memorias) {
      if (!m.beneficioAplicadoCodigo || !m.dataOperacao) continue;

      const tributo = this.extrairTributo(m.regraAplicada);
      if (!tributo) continue;

      const referencia = aliquotasParaData(new Date(m.dataOperacao));
      const aliquotaReferencia =
        tributo === 'CBS' ? referencia.cbs : tributo === 'IBS_ESTADUAL' ? referencia.ibsEstadual : referencia.ibsMunicipal;

      const aliquotaEfetiva = new Decimal(m.aliquotaUtilizada);
      const diferenca = aliquotaReferencia.minus(aliquotaEfetiva);
      if (diferenca.lessThanOrEqualTo(0)) continue; // sem economia real (ou dado inconsistente) — não conta

      const economia = new Decimal(m.baseCalculo).times(diferenca).dividedBy(100);
      const atual = porCodigo.get(m.beneficioAplicadoCodigo) ?? new Decimal(0);
      porCodigo.set(m.beneficioAplicadoCodigo, atual.plus(economia));
    }

    const entradas = [...porCodigo.entries()].sort((a, b) => b[1].comparedTo(a[1]));
    return {
      labels: entradas.map(([codigo]) => codigo),
      data: entradas.map(([, valor]) => valor.toDecimalPlaces(2).toNumber()),
    };
  }

  /** Total apurado (valorApurado) por tributo — IBS (estadual+municipal somados) vs CBS — visão rápida da composição da carga tributária. */
  totalPorTributo(memorias: RegistroMemoriaCalculo[]): DistribuicaoCategorica {
    let totalIbs = new Decimal(0);
    let totalCbs = new Decimal(0);
    for (const m of memorias) {
      const tributo = this.extrairTributo(m.regraAplicada);
      if (tributo === 'CBS') totalCbs = totalCbs.plus(m.valorApurado);
      else if (tributo === 'IBS_ESTADUAL' || tributo === 'IBS_MUNICIPAL') totalIbs = totalIbs.plus(m.valorApurado);
    }
    return {
      labels: ['IBS', 'CBS'],
      data: [totalIbs.toDecimalPlaces(2).toNumber(), totalCbs.toDecimalPlaces(2).toNumber()],
    };
  }

  /**
   * Total apurado (valorApurado, todos os tributos somados) por ANO da
   * operação — dá visão de tendência quando o usuário testa/projeta
   * vários anos do cronograma de transição (2026 a 2033). Registros sem
   * `dataOperacao` (gravados antes desta correção) são ignorados.
   */
  evolucaoAnualTotalApurado(memorias: RegistroMemoriaCalculo[]): DistribuicaoCategorica {
    const porAno = new Map<string, Decimal>();
    for (const m of memorias) {
      if (!m.dataOperacao) continue;
      const ano = String(new Date(m.dataOperacao).getUTCFullYear());
      const atual = porAno.get(ano) ?? new Decimal(0);
      porAno.set(ano, atual.plus(m.valorApurado));
    }
    const entradas = [...porAno.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      labels: entradas.map(([ano]) => ano),
      data: entradas.map(([, valor]) => valor.toDecimalPlaces(2).toNumber()),
    };
  }

  /**
   * Compara, entre os lançamentos de ENTRADA (compras/importações), o
   * quanto veio de fornecedores optantes pelo Simples Nacional versus os
   * demais — em percentual do VALOR total comprado (não só a contagem de
   * lançamentos, que poderia distorcer a leitura se houver muitos
   * lançamentos pequenos de um lado). Usa `LancamentoPersistido.contraparteOptanteSimplesNacional`
   * — preenchido no lançamento manual (reaproveita o campo já existente
   * do formulário) ou na importação de planilha (campo "contraparte
   * desta planilha é optante do Simples Nacional?", aplicado a todo o
   * lote — a planilha não traz o regime do fornecedor linha a linha).
   *
   * Lançamentos sem essa informação preenchida (mais comuns em
   * importações onde o usuário não marcou o campo) entram como "Não
   * informado" — uma terceira fatia, em vez de forçar uma suposição.
   */
  comparativoEntradasSimplesNacional(lancamentos: LancamentoPersistido[]): DistribuicaoCategorica {
    const entradas = lancamentos.filter((l) => ehLancamentoDeEntrada(l.tipo));

    let valorSimples = new Decimal(0);
    let valorDemais = new Decimal(0);
    let valorNaoInformado = new Decimal(0);

    for (const l of entradas) {
      const valor = new Decimal(l.valorBruto ?? 0);
      if (l.contraparteOptanteSimplesNacional === true) valorSimples = valorSimples.plus(valor);
      else if (l.contraparteOptanteSimplesNacional === false) valorDemais = valorDemais.plus(valor);
      else valorNaoInformado = valorNaoInformado.plus(valor);
    }

    const total = valorSimples.plus(valorDemais).plus(valorNaoInformado);
    if (total.isZero()) return { labels: [], data: [] };

    const percentual = (v: Decimal) => v.dividedBy(total).times(100).toDecimalPlaces(1).toNumber();

    const labels = ['Simples Nacional', 'Demais empresas'];
    const data = [percentual(valorSimples), percentual(valorDemais)];
    if (valorNaoInformado.greaterThan(0)) {
      labels.push('Não informado');
      data.push(percentual(valorNaoInformado));
    }
    return { labels, data };
  }

  /** Extrai o tributo (ex: "CBS", "IBS_ESTADUAL") do formato "NomeDaStrategy (TRIBUTO)" usado em `regraAplicada`. */
  private extrairTributo(regraAplicada: string): string | undefined {
    return regraAplicada.match(/\(([^)]+)\)/)?.[1];
  }

  private somar(valores: Decimal[]): Decimal {
    return valores.reduce((acc, v) => acc.plus(v), new Decimal(0));
  }
}
