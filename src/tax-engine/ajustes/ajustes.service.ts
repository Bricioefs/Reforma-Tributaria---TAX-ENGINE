import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ResultadoDebito, RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';

export interface AjusteApurado {
  operacaoOriginalId: string;
  tipo: 'POSITIVO' | 'NEGATIVO';
  motivo: 'DEVOLUCAO' | 'CANCELAMENTO' | 'COMPLEMENTO_PRECO' | 'DESCONTO_CONDICIONAL';
  tributo: ResultadoDebito['tributo'];
  valor: Decimal;
  memoria: RegistroMemoriaCalculo;
}

/**
 * Motor de Ajustes (LC 214/2025, art. 40 e seguintes) — trata eventos
 * POSTERIORES a uma operação já apurada, que alteram o débito
 * originalmente reconhecido. Diferente do Motor de Débito (que calcula uma
 * operação nova), este motor sempre referencia a operação original.
 *
 * Cobre:
 *   - Devolução (total ou parcial) — ajuste NEGATIVO proporcional.
 *   - Cancelamento — ajuste NEGATIVO total, zera o débito original.
 *   - Complemento de preço — ajuste POSITIVO sobre a base adicional, usando
 *     a MESMA alíquota efetiva da operação original (preserva o benefício
 *     fiscal, se houver, que se aplicava à operação).
 *   - Desconto condicional — diferente do desconto incondicional (que já
 *     reduz a base no `BaseCalculoService` no momento da operação), o
 *     condicional só é reconhecido quando a condição se implementa
 *     (ex: meta de compras atingida) — ajuste NEGATIVO reconhecido no
 *     período em que a condição se confirma, não retroativamente.
 */
@Injectable()
export class AjustesService {
  registrarDevolucao(
    operacaoOriginalId: string,
    debitosOriginais: ResultadoDebito[],
    percentualDevolvido: Decimal,
  ): AjusteApurado[] {
    const fator = percentualDevolvido.dividedBy(100);
    return debitosOriginais.map((d) => {
      const valorAjuste = d.valor.times(fator).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return this.montarAjuste(operacaoOriginalId, 'NEGATIVO', 'DEVOLUCAO', d.tributo, valorAjuste, {
        percentualDevolvido: percentualDevolvido.toString(),
        valorDebitoOriginal: d.valor.toString(),
      });
    });
  }

  registrarCancelamento(operacaoOriginalId: string, debitosOriginais: ResultadoDebito[]): AjusteApurado[] {
    return debitosOriginais.map((d) =>
      this.montarAjuste(operacaoOriginalId, 'NEGATIVO', 'CANCELAMENTO', d.tributo, d.valor, {
        valorDebitoOriginal: d.valor.toString(),
        cancelamentoTotal: true,
      }),
    );
  }

  registrarComplementoPreco(
    operacaoOriginalId: string,
    debitosOriginais: ResultadoDebito[],
    baseAdicional: Decimal,
  ): AjusteApurado[] {
    return debitosOriginais.map((d) => {
      // Preserva a alíquota efetiva da operação original — se havia
      // benefício fiscal aplicado, o complemento de preço segue a mesma
      // condição tributária da operação a que se refere.
      const valorAjuste = new Decimal(baseAdicional)
        .times(d.aliquotaEfetiva)
        .dividedBy(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return this.montarAjuste(operacaoOriginalId, 'POSITIVO', 'COMPLEMENTO_PRECO', d.tributo, valorAjuste, {
        baseAdicional: baseAdicional.toString(),
        aliquotaEfetivaOriginalPreservada: d.aliquotaEfetiva.toString(),
      });
    });
  }

  registrarDescontoCondicional(
    operacaoOriginalId: string,
    debitosOriginais: ResultadoDebito[],
    valorDesconto: Decimal,
    condicaoConfirmada: boolean,
  ): AjusteApurado[] {
    if (!condicaoConfirmada) return [];
    return debitosOriginais.map((d) => {
      const valorAjuste = new Decimal(valorDesconto)
        .times(d.aliquotaEfetiva)
        .dividedBy(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return this.montarAjuste(operacaoOriginalId, 'NEGATIVO', 'DESCONTO_CONDICIONAL', d.tributo, valorAjuste, {
        valorDesconto: valorDesconto.toString(),
        reconhecidoNoPeriodoDaCondicao: true,
      });
    });
  }

  private montarAjuste(
    operacaoOriginalId: string,
    tipo: AjusteApurado['tipo'],
    motivo: AjusteApurado['motivo'],
    tributo: ResultadoDebito['tributo'],
    valor: Decimal,
    parametrosExtra: Record<string, unknown>,
  ): AjusteApurado {
    const baseLegalPorMotivo: Record<AjusteApurado['motivo'], string> = {
      DEVOLUCAO: 'LC 214/2025, art. 40 (devolução de mercadoria)',
      CANCELAMENTO: 'LC 214/2025, art. 41 (cancelamento de documento fiscal)',
      COMPLEMENTO_PRECO: 'LC 214/2025, art. 42 (complemento de preço)',
      DESCONTO_CONDICIONAL: 'LC 214/2025, art. 43 (desconto condicional — reconhecimento pela condição)',
    };
    const baseLegal = baseLegalPorMotivo[motivo];

    return {
      operacaoOriginalId,
      tipo,
      motivo,
      tributo,
      valor,
      memoria: {
        regraAplicada: `AjustesService.${motivo} (${tributo})`,
        baseLegal,
        parametrosUsados: { operacaoOriginalId, ...parametrosExtra },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: valor,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }
}
