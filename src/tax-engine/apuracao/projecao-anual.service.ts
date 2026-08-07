import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ResultadoDebito } from '../interfaces/tax-engine.interfaces';
import { LancamentoPersistido } from '../lancamentos/lancamentos.service';
import { ehLancamentoDeEntrada } from '../lancamentos/classificacao-lancamento';
import { aliquotasParaAno, AliquotasDoAno } from '../regimes/cronograma-transicao';
import { percentuaisTributosExtintosParaAno } from '../regimes/cronograma-tributos-extintos';

/** Projeção ano a ano de um tributo substituído (PIS, COFINS, ICMS, ISS ou IPI) — débito (saídas), crédito (entradas) e saldo, aplicando o cronograma de extinção sobre o valor ORIGINAL informado em cada lançamento. */
export interface ProjecaoTributoExtinto {
  ano: number;
  debito: Decimal;
  credito: Decimal;
  saldo: Decimal;
}

export interface CargaTributariaTotalAnual {
  ano: number;
  pis: ProjecaoTributoExtinto;
  cofins: ProjecaoTributoExtinto;
  icms: ProjecaoTributoExtinto;
  iss: ProjecaoTributoExtinto;
  ipi: ProjecaoTributoExtinto;
  /** Soma do saldo dos 5 tributos substituídos (PIS+COFINS+ICMS+ISS+IPI) daquele ano. */
  saldoTotalTributosSubstituidos: Decimal;
  /** Saldo de IBS+CBS daquele ano (mesmo valor de `ProjecaoAnual.saldoTotal`). */
  saldoTotalIbsCbs: Decimal;
  /** A carga tributária total prevista para o ano: tributos substituídos (ainda remanescentes) + IBS/CBS (já vigente). */
  saldoTotalGeral: Decimal;
}

export interface ProjecaoAnual {
  ano: number;
  totalDebitoCbs: Decimal;
  totalCreditoCbs: Decimal;
  totalDebitoIbsEstadual: Decimal;
  totalCreditoIbsEstadual: Decimal;
  totalDebitoIbsMunicipal: Decimal;
  totalCreditoIbsMunicipal: Decimal;
  saldoCbs: Decimal;
  saldoIbsEstadual: Decimal;
  saldoIbsMunicipal: Decimal;
  /** Soma dos 3 saldos — negativo significa saldo credor (o contribuinte tem mais crédito que débito), positivo é saldo devedor. */
  saldoTotal: Decimal;
  /** "DEVEDOR" quando saldoTotal > 0, "CREDOR" quando < 0, "NEUTRO" quando exatamente 0. */
  situacao: 'DEVEDOR' | 'CREDOR' | 'NEUTRO';
}

/**
 * Projeta o total de IBS/CBS de um conjunto de lançamentos JÁ CALCULADOS
 * para outros anos do cronograma de transição — sem precisar relançar
 * nada. Útil para responder "lancei o ano inteiro de 2026, quanto essas
 * mesmas operações custariam em 2027? E em 2033, no regime pleno?".
 *
 * MECÂNICA: como `aliquotaEfetiva = alíquotaDeReferênciaDoAno ×
 * fatorDoBenefício` (o fator do benefício — redução, isenção etc. — não
 * muda com o ano), a alíquota efetiva projetada para outro ano é:
 *
 *   aliquotaEfetiva[anoAlvo] = aliquotaEfetiva[anoOrigem] ×
 *     (referência[anoAlvo] / referência[anoOrigem])
 *
 * Isso permite recalcular o valor projetado (`base × aliquotaEfetiva
 * projetada`) sem precisar dos dados originais da operação (NCM, valor
 * bruto etc.) — só do resultado já apurado. Funciona corretamente para
 * imunidades e isenções (efetiva = 0, projeta 0 em qualquer ano) e para
 * regimes ainda com alíquota pendente de regulamentação (também 0 em
 * qualquer ano, sem gerar valores fictícios).
 *
 * Cada lançamento usa como "ano de origem" o ano da SUA PRÓPRIA
 * competência (não um ano único global) — então um conjunto de
 * lançamentos que já misture anos diferentes ainda projeta corretamente.
 *
 * BUG CORRIGIDO: lançamentos de ENTRADA (compra/importação — ver
 * `classificacao-lancamento.ts`) geram CRÉDITO, não débito — antes esta
 * projeção somava tudo junto como se fosse débito, inflando o total
 * projetado (uma compra virava "mais imposto devido" em vez de abater).
 * Agora projeta débito e crédito separadamente e calcula o saldo real
 * por ano, do mesmo jeito que `ApuracaoController` já faz para a
 * apuração de uma competência específica — os dois nunca mais divergem.
 */
export interface ProjecaoLancamento {
  operacaoId: string;
  tipo: string;
  entrada: boolean;
  competencia: string;
  /** Valor total (CBS + IBS estadual + IBS municipal) projetado, por ano — chave é o ano como string. */
  totalPorAno: Record<string, Decimal>;
}

export interface ValoresPorTributo {
  ibsEstadual: Decimal;
  ibsMunicipal: Decimal;
  cbs: Decimal;
}

export interface ProjecaoLancamentoDetalhada {
  operacaoId: string;
  tipo: string;
  entrada: boolean;
  competencia: string;
  /** IBS Estadual, IBS Municipal e CBS projetados SEPARADAMENTE, por ano — chave é o ano como string. */
  porAno: Record<string, ValoresPorTributo>;
}

@Injectable()
export class ProjecaoAnualService {
  projetar(lancamentos: LancamentoPersistido[], anoInicio = 2026, anoFim = 2033): ProjecaoAnual[] {
    const anos: number[] = [];
    for (let ano = anoInicio; ano <= anoFim; ano++) anos.push(ano);

    return anos.map((anoAlvo) => this.projetarAno(lancamentos, anoAlvo));
  }

  /**
   * Projeta a CARGA TRIBUTÁRIA TOTAL ano a ano — os 5 tributos
   * substituídos pela reforma (PIS, COFINS, ICMS, ISS, IPI), aplicando o
   * cronograma de extinção/redução (`cronograma-tributos-extintos.ts`)
   * sobre o valor ORIGINAL informado em cada lançamento, somados ao
   * IBS/CBS já projetado (`projetar()`) — dá para a empresa uma previsão
   * de TUDO que ainda seria devido em cada ano da transição até 2033, não
   * só do que a reforma introduz.
   *
   * Lançamentos sem nenhum dos 5 valores informados (`valorPis` etc.) não
   * contribuem em nada aqui — é normal e esperado que apareçam zerados
   * se o usuário não informou os tributos do sistema atual para eles
   * (lançamentos criados só para testar IBS/CBS, por exemplo).
   */
  projetarCargaTributariaTotal(lancamentos: LancamentoPersistido[], anoInicio = 2026, anoFim = 2033): CargaTributariaTotalAnual[] {
    const anos: number[] = [];
    for (let ano = anoInicio; ano <= anoFim; ano++) anos.push(ano);

    const projecaoIbsCbs = this.projetar(lancamentos, anoInicio, anoFim);

    return anos.map((anoAlvo, i) => {
      const acumulador: Record<'pis' | 'cofins' | 'icms' | 'iss' | 'ipi', { debito: Decimal; credito: Decimal }> = {
        pis: { debito: new Decimal(0), credito: new Decimal(0) },
        cofins: { debito: new Decimal(0), credito: new Decimal(0) },
        icms: { debito: new Decimal(0), credito: new Decimal(0) },
        iss: { debito: new Decimal(0), credito: new Decimal(0) },
        ipi: { debito: new Decimal(0), credito: new Decimal(0) },
      };

      for (const lancamento of lancamentos) {
        const percentuais = percentuaisTributosExtintosParaAno(anoAlvo, lancamento.zfmOuAlc);
        const entrada = ehLancamentoDeEntrada(lancamento.tipo);
        const chave = entrada ? 'credito' : 'debito';

        const somar = (campo: 'pis' | 'cofins' | 'icms' | 'iss' | 'ipi', valorOriginal: string | undefined) => {
          if (!valorOriginal) return;
          const projetado = new Decimal(valorOriginal).times(percentuais[campo]).dividedBy(100);
          acumulador[campo][chave] = acumulador[campo][chave].plus(projetado);
        };

        somar('pis', lancamento.valorPis);
        somar('cofins', lancamento.valorCofins);
        somar('icms', lancamento.valorIcms);
        somar('iss', lancamento.valorIss);
        somar('ipi', lancamento.valorIpi);
      }

      const arredondar = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const montarProjecao = (campo: 'pis' | 'cofins' | 'icms' | 'iss' | 'ipi'): ProjecaoTributoExtinto => {
        const { debito, credito } = acumulador[campo];
        return { ano: anoAlvo, debito: arredondar(debito), credito: arredondar(credito), saldo: arredondar(debito.minus(credito)) };
      };

      const pis = montarProjecao('pis');
      const cofins = montarProjecao('cofins');
      const icms = montarProjecao('icms');
      const iss = montarProjecao('iss');
      const ipi = montarProjecao('ipi');
      const saldoTotalTributosSubstituidos = pis.saldo.plus(cofins.saldo).plus(icms.saldo).plus(iss.saldo).plus(ipi.saldo);
      const saldoTotalIbsCbs = projecaoIbsCbs[i].saldoTotal;

      return {
        ano: anoAlvo,
        pis,
        cofins,
        icms,
        iss,
        ipi,
        saldoTotalTributosSubstituidos: arredondar(saldoTotalTributosSubstituidos),
        saldoTotalIbsCbs,
        saldoTotalGeral: arredondar(saldoTotalTributosSubstituidos.plus(saldoTotalIbsCbs)),
      };
    });
  }

  /**
   * Projeta CADA lançamento individualmente (não agregado) para os anos do
   * intervalo — usado pela exportação Excel, aba "Lançamentos", que mostra
   * o valor total projetado de cada lançamento ano a ano.
   */
  projetarPorLancamento(lancamentos: LancamentoPersistido[], anoInicio = 2026, anoFim = 2033): ProjecaoLancamento[] {
    const anos: number[] = [];
    for (let ano = anoInicio; ano <= anoFim; ano++) anos.push(ano);

    return lancamentos.map((lancamento) => {
      const anoOrigem = this.anoDaCompetencia(lancamento.competencia);
      const referenciaOrigem = aliquotasParaAno(anoOrigem);
      const totalPorAno: Record<string, Decimal> = {};

      for (const anoAlvo of anos) {
        const referenciaAlvo = aliquotasParaAno(anoAlvo);
        let total = new Decimal(0);
        for (const resultado of lancamento.resultados) {
          total = total.plus(this.projetarValor(resultado, referenciaOrigem, referenciaAlvo));
        }
        totalPorAno[String(anoAlvo)] = total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      }

      return {
        operacaoId: lancamento.operacaoId,
        tipo: lancamento.tipo,
        entrada: ehLancamentoDeEntrada(lancamento.tipo),
        competencia: lancamento.competencia,
        totalPorAno,
      };
    });
  }

  /**
   * Igual a `projetarPorLancamento()`, mas SEM somar CBS + IBS Estadual +
   * IBS Municipal num único total — devolve os 3 separados, por ano.
   * Usado pela exportação Excel (pedido: "individualizada pelo IBS e
   * CBS"), que precisa de uma coluna própria para cada tributo em vez de
   * um total combinado por ano.
   */
  projetarPorLancamentoDetalhado(lancamentos: LancamentoPersistido[], anoInicio = 2026, anoFim = 2033): ProjecaoLancamentoDetalhada[] {
    const anos: number[] = [];
    for (let ano = anoInicio; ano <= anoFim; ano++) anos.push(ano);

    return lancamentos.map((lancamento) => {
      const anoOrigem = this.anoDaCompetencia(lancamento.competencia);
      const referenciaOrigem = aliquotasParaAno(anoOrigem);
      const porAno: Record<string, ValoresPorTributo> = {};

      for (const anoAlvo of anos) {
        const referenciaAlvo = aliquotasParaAno(anoAlvo);
        let ibsEstadual = new Decimal(0);
        let ibsMunicipal = new Decimal(0);
        let cbs = new Decimal(0);

        for (const resultado of lancamento.resultados) {
          const valorProjetado = this.projetarValor(resultado, referenciaOrigem, referenciaAlvo);
          if (resultado.tributo === 'IBS_ESTADUAL') ibsEstadual = ibsEstadual.plus(valorProjetado);
          else if (resultado.tributo === 'IBS_MUNICIPAL') ibsMunicipal = ibsMunicipal.plus(valorProjetado);
          else if (resultado.tributo === 'CBS') cbs = cbs.plus(valorProjetado);
        }

        porAno[String(anoAlvo)] = {
          ibsEstadual: ibsEstadual.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          ibsMunicipal: ibsMunicipal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          cbs: cbs.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        };
      }

      return {
        operacaoId: lancamento.operacaoId,
        tipo: lancamento.tipo,
        entrada: ehLancamentoDeEntrada(lancamento.tipo),
        competencia: lancamento.competencia,
        porAno,
      };
    });
  }

  private projetarAno(lancamentos: LancamentoPersistido[], anoAlvo: number): ProjecaoAnual {
    const referenciaAlvo = aliquotasParaAno(anoAlvo);
    let totalDebitoCbs = new Decimal(0);
    let totalCreditoCbs = new Decimal(0);
    let totalDebitoIbsEstadual = new Decimal(0);
    let totalCreditoIbsEstadual = new Decimal(0);
    let totalDebitoIbsMunicipal = new Decimal(0);
    let totalCreditoIbsMunicipal = new Decimal(0);

    for (const lancamento of lancamentos) {
      const entrada = ehLancamentoDeEntrada(lancamento.tipo);
      const anoOrigem = this.anoDaCompetencia(lancamento.competencia);
      const referenciaOrigem = aliquotasParaAno(anoOrigem);

      for (const resultado of lancamento.resultados) {
        const valorProjetado = this.projetarValor(resultado, referenciaOrigem, referenciaAlvo);

        if (resultado.tributo === 'CBS') {
          if (entrada) totalCreditoCbs = totalCreditoCbs.plus(valorProjetado);
          else totalDebitoCbs = totalDebitoCbs.plus(valorProjetado);
        } else if (resultado.tributo === 'IBS_ESTADUAL') {
          if (entrada) totalCreditoIbsEstadual = totalCreditoIbsEstadual.plus(valorProjetado);
          else totalDebitoIbsEstadual = totalDebitoIbsEstadual.plus(valorProjetado);
        } else if (resultado.tributo === 'IBS_MUNICIPAL') {
          if (entrada) totalCreditoIbsMunicipal = totalCreditoIbsMunicipal.plus(valorProjetado);
          else totalDebitoIbsMunicipal = totalDebitoIbsMunicipal.plus(valorProjetado);
        }
      }
    }

    const saldoCbs = totalDebitoCbs.minus(totalCreditoCbs);
    const saldoIbsEstadual = totalDebitoIbsEstadual.minus(totalCreditoIbsEstadual);
    const saldoIbsMunicipal = totalDebitoIbsMunicipal.minus(totalCreditoIbsMunicipal);
    const saldoTotal = saldoCbs.plus(saldoIbsEstadual).plus(saldoIbsMunicipal);

    const arredondar = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      ano: anoAlvo,
      totalDebitoCbs: arredondar(totalDebitoCbs),
      totalCreditoCbs: arredondar(totalCreditoCbs),
      totalDebitoIbsEstadual: arredondar(totalDebitoIbsEstadual),
      totalCreditoIbsEstadual: arredondar(totalCreditoIbsEstadual),
      totalDebitoIbsMunicipal: arredondar(totalDebitoIbsMunicipal),
      totalCreditoIbsMunicipal: arredondar(totalCreditoIbsMunicipal),
      saldoCbs: arredondar(saldoCbs),
      saldoIbsEstadual: arredondar(saldoIbsEstadual),
      saldoIbsMunicipal: arredondar(saldoIbsMunicipal),
      saldoTotal: arredondar(saldoTotal),
      situacao: saldoTotal.greaterThan(0) ? 'DEVEDOR' : saldoTotal.lessThan(0) ? 'CREDOR' : 'NEUTRO',
    };
  }

  private projetarValor(resultado: ResultadoDebito, referenciaOrigem: AliquotasDoAno, referenciaAlvo: AliquotasDoAno): Decimal {
    const base = new Decimal(resultado.baseCalculo);
    const aliquotaEfetivaOrigem = new Decimal(resultado.aliquotaEfetiva);

    const [refOrigemTributo, refAlvoTributo] =
      resultado.tributo === 'CBS'
        ? [referenciaOrigem.cbs, referenciaAlvo.cbs]
        : resultado.tributo === 'IBS_ESTADUAL'
          ? [referenciaOrigem.ibsEstadual, referenciaAlvo.ibsEstadual]
          : [referenciaOrigem.ibsMunicipal, referenciaAlvo.ibsMunicipal];

    if (refOrigemTributo.isZero()) {
      // Referência do ano de origem zerada (não deveria ocorrer no
      // cronograma atual, mas evita divisão por zero em qualquer ajuste
      // futuro) — mantém a alíquota efetiva original sem escalar.
      return base.times(aliquotaEfetivaOrigem).dividedBy(100);
    }

    const aliquotaEfetivaAlvo = aliquotaEfetivaOrigem.times(refAlvoTributo).dividedBy(refOrigemTributo);
    return base.times(aliquotaEfetivaAlvo).dividedBy(100);
  }

  private anoDaCompetencia(competencia: string): number {
    const ano = Number(competencia?.slice(0, 4));
    return Number.isFinite(ano) && ano > 0 ? ano : new Date().getFullYear();
  }
}
