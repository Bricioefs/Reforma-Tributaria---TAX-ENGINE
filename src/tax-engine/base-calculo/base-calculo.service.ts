import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DadosOperacao, ResultadoBaseCalculo } from '../interfaces/tax-engine.interfaces';

/**
 * Motor de Base de Cálculo.
 *
 * Regra geral da LC 214/2025: IBS e CBS são calculados "por fora" (não
 * integram sua própria base — art. 12), diferente do sistema anterior de
 * ICMS/ISS/PIS/COFINS que era majoritariamente "por dentro". O IS (Imposto
 * Seletivo) tem regra própria conforme o produto.
 *
 * Toda regra de composição de base é parametrizável por tipo de operação —
 * nenhuma fórmula fica fixa no código além desta orquestração.
 */
@Injectable()
export class BaseCalculoService {
  /**
   * Calcula a base de cálculo de IBS/CBS para uma operação.
   * Fórmula (regra geral, "por fora"):
   *   base = valorBruto + frete + seguro + despesasAcessorias - descontoIncondicional
   */
  calcularBaseIbsCbs(dados: DadosOperacao): ResultadoBaseCalculo[] {
    const frete = dados.frete ?? new Decimal(0);
    const seguro = dados.seguro ?? new Decimal(0);
    const despesas = dados.despesasAcessorias ?? new Decimal(0);
    const desconto = dados.descontoIncondicional ?? new Decimal(0);

    const base = new Decimal(dados.valorBruto)
      .plus(frete)
      .plus(seguro)
      .plus(despesas)
      .minus(desconto);

    const baseArredondada = this.arredondar(base);

    const memoriaBase = {
      regraAplicada: 'BaseCalculoService.calcularBaseIbsCbs',
      baseLegal: 'LC 214/2025, art. 12 (base de cálculo "por fora")',
      parametrosUsados: {
        valorBruto: dados.valorBruto.toString(),
        frete: frete.toString(),
        seguro: seguro.toString(),
        despesasAcessorias: despesas.toString(),
        descontoIncondicional: desconto.toString(),
      },
      aliquotaUtilizada: new Decimal(0), // não se aplica neste estágio
      baseCalculo: baseArredondada,
      valorApurado: new Decimal(0), // não se aplica neste estágio
      dataVigenciaRegra: new Date('2026-01-01'),
      versaoRegra: '1.0.0',
    };

    return [
      { tributo: 'IBS', baseCalculo: baseArredondada, memoria: { ...memoriaBase } },
      { tributo: 'CBS', baseCalculo: baseArredondada, memoria: { ...memoriaBase } },
    ];
  }

  /**
   * Base do Imposto Seletivo — regra própria por produto (ex: "por fora"
   * sobre o valor da operação, sem inclusão de IBS/CBS). Delegado a um
   * módulo dedicado (ver imposto-seletivo) porque a regulamentação de
   * cada produto sujeito ao IS ainda está sendo publicada por decreto.
   */
  calcularBaseImpostoSeletivo(dados: DadosOperacao): ResultadoBaseCalculo {
    const base = new Decimal(dados.valorBruto);
    return {
      tributo: 'IS',
      baseCalculo: this.arredondar(base),
      memoria: {
        regraAplicada: 'BaseCalculoService.calcularBaseImpostoSeletivo',
        baseLegal: 'LC 214/2025, art. 195 e seguintes (Imposto Seletivo)',
        parametrosUsados: { valorBruto: dados.valorBruto.toString() },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: base,
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }

  /** Arredondamento monetário padrão: 2 casas decimais, ROUND_HALF_UP. */
  private arredondar(valor: Decimal): Decimal {
    return valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}
