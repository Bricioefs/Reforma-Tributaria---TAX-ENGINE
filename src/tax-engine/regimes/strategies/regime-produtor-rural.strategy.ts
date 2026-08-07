import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';

/**
 * Regime do Produtor Rural (LC 214/2025, art. 164 e seguintes).
 *
 * Produtor rural pessoa física/produtor rural não inscrito como contribuinte
 * regular, com faturamento anual abaixo do limite legal, é NÃO CONTRIBUINTE
 * do IBS/CBS nas suas vendas — mas o adquirente (contribuinte regular) tem
 * direito a CRÉDITO PRESUMIDO sobre a aquisição, para preservar a não
 * cumulatividade da cadeia.
 *
 * PENDÊNCIA REGULAMENTAR: o valor exato do limite de faturamento anual
 * (indexado por normas infralegais) não está fixado nesta fase — ver
 * `LIMITE_FATURAMENTO_ANUAL_PENDENTE`, parâmetro a ser lido de
 * `Parametrizacao` em produção.
 */
export class RegimeProdutorRuralStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_PRODUTOR_RURAL';
  readonly baseLegal = 'LC 214/2025, art. 164 e seguintes (Produtor Rural)';

  // Valor de referência ilustrativo — PENDÊNCIA REGULAMENTAR (ver docstring).
  private readonly LIMITE_FATURAMENTO_ANUAL_PENDENTE = new Decimal(3600000);
  private readonly PERCENTUAL_CREDITO_PRESUMIDO = new Decimal(60); // parametrizável

  aplicavel(dados: DadosOperacao): boolean {
    if (dados.faturamentoAnualProdutorRural === undefined) return false;
    return dados.faturamentoAnualProdutorRural.lessThanOrEqualTo(this.LIMITE_FATURAMENTO_ANUAL_PENDENTE);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const imunidade: BeneficioResolvido = {
      codigo: 'PRODUTOR_RURAL_NAO_CONTRIBUINTE',
      tipo: 'IMUNIDADE',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    // Não há débito de IBS/CBS na venda do produtor rural não contribuinte.
    // O crédito presumido concedido ao adquirente é registrado separadamente
    // pelo CreditoService (ver `CreditoService.apurarCredito` com tipo
    // 'PRESUMIDO') no fluxo de entrada do comprador — este motor apenas
    // sinaliza, na memória de cálculo, o percentual de referência para essa
    // apuração futura.
    return [
      this.debitoImune('IBS_ESTADUAL', baseIbs.baseCalculo, imunidade),
      this.debitoImune('IBS_MUNICIPAL', baseIbs.baseCalculo, imunidade),
      this.debitoImune('CBS', baseCbs.baseCalculo, imunidade),
    ];
  }

  private debitoImune(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeProdutorRuralStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: {
          base: base.toString(),
          percentualCreditoPresumidoAoAdquirente: this.PERCENTUAL_CREDITO_PRESUMIDO.toString(),
        },
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
