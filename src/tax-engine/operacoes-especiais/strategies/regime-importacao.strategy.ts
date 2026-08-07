import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { aliquotasParaData } from '../../regimes/cronograma-transicao';
import { cfopComecaCom } from '../../util/classificacao-cfop';

/**
 * Importação (LC 214/2025, art. 21 e seguintes) — mecânica estruturalmente
 * diferente da operação padrão:
 *   - Sujeito passivo é o IMPORTADOR (pessoa física ou jurídica), inclusive
 *     não contribuinte habitual, e não o vendedor estrangeiro;
 *   - Incidência ocorre no DESEMBARAÇO ADUANEIRO, não na emissão de um
 *     documento fiscal de venda;
 *   - Base de cálculo é a BASE ADUANEIRA (valor aduaneiro + Imposto de
 *     Importação + despesas de desembaraço), não o `valorBruto` "por fora"
 *     usado nas operações internas — por isso esta Strategy IGNORA
 *     deliberadamente a base genérica recebida e recalcula a sua própria.
 *   - O IBS/CBS pago na importação gera crédito integral ao importador
 *     contribuinte regular (`CreditoService`, tipo `IMPORTACAO`).
 *   - Por isonomia com o bem/serviço nacional equivalente (art. 22), usa a
 *     MESMA alíquota de referência do ano da operação
 *     (`cronograma-transicao.ts`) sobre a base aduaneira.
 *
 * Reconhece EXCLUSIVAMENTE pelo CFOP de entrada — pedido explícito do
 * usuário: "na entrada apenas quando o CFOP começar com 3". Se o CFOP
 * não começar com 3, a operação NÃO é tratada como importação — cai
 * para o regime padrão, que busca o benefício pelo NCM/NBS normalmente
 * (o grupo "3.xxx" é o reservado na Tabela CFOP oficial justamente para
 * "entrada de mercadoria ou serviço do exterior").
 */
export class RegimeImportacaoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_IMPORTACAO';
  readonly baseLegal = 'LC 214/2025, art. 21 a 27 (incidência na importação — base aduaneira)';

  aplicavel(dados: DadosOperacao): boolean {
    return cfopComecaCom(dados.cfop, '3');
  }

  calcular(
    dados: DadosOperacao,
    _baseCalculoGenerica: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const valorAduaneiro = dados.valorAduaneiro ?? dados.valorBruto;
    const ii = dados.impostoImportacao ?? new Decimal(0);
    const despesas = dados.despesasDesembaracoAduaneiro ?? new Decimal(0);

    const baseAduaneira = new Decimal(valorAduaneiro)
      .plus(ii)
      .plus(despesas)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const aliquotas = aliquotasParaData(dados.dataOperacao);

    const beneficio: BeneficioResolvido = {
      codigo: 'IMPORTACAO_BASE_ADUANEIRA',
      tipo: 'REDUCAO_PERCENTUAL', // marcador — não é redução, é base diferenciada
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseAduaneira, aliquotas.ibsEstadual, beneficio),
      this.montar('IBS_MUNICIPAL', baseAduaneira, aliquotas.ibsMunicipal, beneficio),
      this.montar('CBS', baseAduaneira, aliquotas.cbs, beneficio),
    ];
  }

  private montar(tributo: ResultadoDebito['tributo'], base: Decimal, aliquotaEfetiva: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    const valor = base.times(aliquotaEfetiva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: aliquotaEfetiva,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeImportacaoStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { baseAduaneira: base.toString(), sujeitoPassivo: 'IMPORTADOR' },
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
