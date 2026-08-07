import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ResultadoDebito, RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';

export interface ResultadoSplitPayment {
  aplicado: boolean;
  valorBrutoOperacao: Decimal;
  valorIbsRetido: Decimal;
  valorCbsRetido: Decimal;
  valorTotalRetido: Decimal;
  valorLiquidoFornecedor: Decimal;
  memoria: RegistroMemoriaCalculo;
}

/**
 * Motor de Split Payment (LC 214/2025, art. 33 e seguintes — pagamento
 * segregado).
 *
 * Separa automaticamente, no momento do pagamento da operação, o valor de
 * IBS/CBS devido (recolhido diretamente ao fisco pelo agente financeiro/
 * arranjo de pagamento) do valor líquido que efetivamente chega ao
 * fornecedor. Não recalcula tributo — consome os `ResultadoDebito[]` já
 * apurados pelo `DebitoService` e apenas particiona o fluxo financeiro.
 *
 * Operações SEM split payment (ex: pagamento em espécie fora do sistema
 * financeiro regulado, ou fluxo legalmente dispensado) são sinalizadas com
 * `aplicado: false` para fins de conciliação — o débito tributário
 * continua existindo e sendo exigível pelas vias normais de apuração, mas
 * sem a retenção automática no pagamento.
 */
@Injectable()
export class SplitPaymentService {
  calcular(valorBrutoOperacao: Decimal, debitos: ResultadoDebito[], aplicaSplitPayment: boolean): ResultadoSplitPayment {
    const valorIbsRetido = this.somarTributo(debitos, ['IBS_ESTADUAL', 'IBS_MUNICIPAL']);
    const valorCbsRetido = this.somarTributo(debitos, ['CBS']);
    const valorTotalRetido = aplicaSplitPayment ? valorIbsRetido.plus(valorCbsRetido) : new Decimal(0);
    const valorLiquidoFornecedor = aplicaSplitPayment
      ? new Decimal(valorBrutoOperacao).minus(valorTotalRetido).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(valorBrutoOperacao);

    return {
      aplicado: aplicaSplitPayment,
      valorBrutoOperacao: new Decimal(valorBrutoOperacao),
      valorIbsRetido: aplicaSplitPayment ? valorIbsRetido : new Decimal(0),
      valorCbsRetido: aplicaSplitPayment ? valorCbsRetido : new Decimal(0),
      valorTotalRetido,
      valorLiquidoFornecedor,
      memoria: {
        regraAplicada: 'SplitPaymentService.calcular',
        baseLegal: 'LC 214/2025, art. 33 a 39 (pagamento segregado — split payment)',
        parametrosUsados: {
          valorBrutoOperacao: new Decimal(valorBrutoOperacao).toString(),
          aplicaSplitPayment,
          valorIbsRetido: valorIbsRetido.toString(),
          valorCbsRetido: valorCbsRetido.toString(),
        },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: new Decimal(valorBrutoOperacao),
        valorApurado: valorTotalRetido,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }

  private somarTributo(debitos: ResultadoDebito[], tributos: ResultadoDebito['tributo'][]): Decimal {
    return debitos
      .filter((d) => tributos.includes(d.tributo))
      .reduce((acc, d) => acc.plus(d.valor), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}
