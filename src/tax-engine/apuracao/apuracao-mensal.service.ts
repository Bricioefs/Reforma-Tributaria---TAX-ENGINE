import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ResultadoDebito } from '../interfaces/tax-engine.interfaces';
import { CreditoApurado } from '../credito/credito.service';

export interface ApuracaoMensalResultado {
  estabelecimentoId: string;
  competencia: string; // "AAAA" (ano) — a apuração agora é por ano, não mais por mês
  totalDebitoIbs: Decimal;
  totalDebitoCbs: Decimal;
  totalCreditoIbs: Decimal;
  totalCreditoCbs: Decimal;
  saldoCredorTransportadoAnterior: Decimal;
  saldoIbs: Decimal; // positivo = a pagar; negativo = saldo credor a transportar
  saldoCbs: Decimal;
  status: 'ABERTA' | 'FECHADA';
  fechadaEm?: Date;
}

/**
 * Motor de Apuração Mensal / Fechamento (LC 214/2025, art. 51 e seguintes).
 *
 * Consolida, por estabelecimento e competência, todos os débitos (Motor de
 * Débito + Motor de Ajustes) e créditos (Motor de Crédito) do período,
 * arrastando o saldo credor não compensado do mês anterior
 * (`saldoCredorTransportado`). O resultado pode ser:
 *   - Saldo POSITIVO (débito líquido) → valor a recolher no período;
 *   - Saldo NEGATIVO (crédito líquido) → saldo credor, transportado para o
 *     próximo período ou sujeito a pedido de ressarcimento/compensação
 *     (Fase 5 — camada de aplicação/API).
 *
 * Uma apuração `FECHADA` é imutável — qualquer ajuste posterior (devolução,
 * complemento de preço) deve ser reconhecido em uma NOVA apuração, nunca
 * reabrindo o período fechado (rastreabilidade/auditoria).
 */
@Injectable()
export class ApuracaoMensalService {
  apurar(
    estabelecimentoId: string,
    competencia: string,
    debitos: ResultadoDebito[],
    creditos: CreditoApurado[],
    saldoCredorTransportadoAnterior: Decimal = new Decimal(0),
  ): ApuracaoMensalResultado {
    const totalDebitoIbs = this.somarDebitos(debitos, ['IBS_ESTADUAL', 'IBS_MUNICIPAL']);
    const totalDebitoCbs = this.somarDebitos(debitos, ['CBS']);
    const totalCreditoIbs = this.somarCreditos(creditos, 'IBS');
    const totalCreditoCbs = this.somarCreditos(creditos, 'CBS');

    // Saldo credor transportado do mês anterior é aplicado sobre o IBS
    // (mantendo o mesmo tratamento em ambos os tributos, na ausência de
    // regra que os trate separadamente nesta fase).
    const saldoIbs = totalDebitoIbs
      .minus(totalCreditoIbs)
      .minus(saldoCredorTransportadoAnterior)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const saldoCbs = totalDebitoCbs.minus(totalCreditoCbs).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      estabelecimentoId,
      competencia,
      totalDebitoIbs,
      totalDebitoCbs,
      totalCreditoIbs,
      totalCreditoCbs,
      saldoCredorTransportadoAnterior,
      saldoIbs,
      saldoCbs,
      status: 'ABERTA',
    };
  }

  /** Fecha o período — a partir daqui a apuração é imutável. */
  fechar(apuracao: ApuracaoMensalResultado): ApuracaoMensalResultado {
    if (apuracao.status === 'FECHADA') {
      throw new Error(`Apuração ${apuracao.competencia} já está fechada — ajustes devem ser feitos em nova apuração.`);
    }
    return { ...apuracao, status: 'FECHADA', fechadaEm: new Date() };
  }

  /** Saldo credor a transportar para o próximo período (só existe se o saldo for negativo). */
  saldoCredorParaProximoPeriodo(apuracao: ApuracaoMensalResultado): Decimal {
    return apuracao.saldoIbs.isNegative() ? apuracao.saldoIbs.abs() : new Decimal(0);
  }

  private somarDebitos(debitos: ResultadoDebito[], tributos: ResultadoDebito['tributo'][]): Decimal {
    return debitos
      .filter((d) => tributos.includes(d.tributo))
      .reduce((acc, d) => acc.plus(d.valor), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  private somarCreditos(creditos: CreditoApurado[], tributo: 'IBS' | 'CBS'): Decimal {
    return creditos
      .filter((c) => c.tributo === tributo && !c.vedado)
      .reduce((acc, c) => acc.plus(c.valorAproveitado), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}
