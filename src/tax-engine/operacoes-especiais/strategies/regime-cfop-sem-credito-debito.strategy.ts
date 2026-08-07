import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { cfopGeraCreditoOuDebito } from '../../util/classificacao-cfop';

/**
 * Pedido explícito do usuário: "calcular o crédito e débito também
 * apenas para as operações cujo CFOP de entrada e saída geram crédito
 * [e débito]".
 *
 * Existe uma diferença entre `RegimeRemessaStrategy`/`RegimeRetornoStrategy`
 * (que já zeram o débito, mas só quando o usuário escolhe manualmente
 * `tipo=REMESSA`/`tipo=RETORNO` no formulário) e este regime aqui: numa
 * importação de planilha em massa, cada linha de entrada/saída é
 * classificada genericamente como `COMPRA`/`VENDA` (não há um campo
 * "tipo de operação" próprio por linha na planilha) — então uma remessa
 * ou devolução que aparece na planilha real, com seu CFOP verdadeiro,
 * acabava sendo calculada como uma compra/venda comum, com crédito ou
 * débito integral, mesmo o CFOP indicando que não deveria gerar nenhum
 * dos dois.
 *
 * Este regime cobre esse caso: reconhece PELO CFOP em si (não pelo campo
 * `tipo`), então funciona tanto no lançamento manual quanto na
 * importação em massa. Lista de CFOPs considerados "sem crédito/débito"
 * em `util/classificacao-cfop.ts` — remessa/retorno para conserto,
 * industrialização por encomenda, demonstração, depósito e consignação.
 *
 * Precedência: verificado ANTES de tudo, inclusive de Exportação/Importação
 * — um dos CFOPs desta lista ("3901") começa com o mesmo prefixo "3"
 * usado para reconhecer importação; sem checar isso primeiro, uma remessa
 * do exterior para industrialização (CFOP 3901) seria classificada por
 * engano como importação de verdade. Também precede os regimes setoriais
 * genéricos — um CFOP de remessa não deveria "ganhar" nenhum benefício
 * setorial por engano, já que o valor é zerado de qualquer forma.
 */
export class RegimeCfopSemCreditoDebitoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_CFOP_SEM_CREDITO_DEBITO';
  readonly baseLegal = 'CFOP de mera movimentação (remessa/retorno sem transferência de propriedade) — LC 214/2025, art. 19';

  aplicavel(dados: DadosOperacao): boolean {
    if (!dados.cfop) return false;
    return !cfopGeraCreditoOuDebito(dados.cfop);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const beneficio: BeneficioResolvido = {
      codigo: 'CFOP_SEM_CREDITO_DEBITO',
      tipo: 'SUSPENSAO',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, beneficio, dados.cfop),
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, beneficio, dados.cfop),
      this.zero('CBS', baseCbs.baseCalculo, beneficio, dados.cfop),
    ];
  }

  private zero(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido, cfop?: string): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeCfopSemCreditoDebitoStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), cfop: cfop ?? '' },
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
