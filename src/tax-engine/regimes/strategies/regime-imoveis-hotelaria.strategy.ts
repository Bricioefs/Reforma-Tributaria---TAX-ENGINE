import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { codigoFiscalEstaEm } from '../../util/normalizador-classificacao-fiscal';
import { aliquotasParaData } from '../cronograma-transicao';
import { NBS_BENS_IMOVEIS, NBS_HOTELARIA, NBS_BENS_IMOVEIS_LOCACAO_70, NBS_BENS_IMOVEIS_OPERACOES_50 } from '../codigos-nbs-reais';

/**
 * Regime de Bens Imóveis (LC 214/2025, art. 251 e seguintes).
 *
 * Percentuais REAIS extraídos do Anexo VIII (gov.br/nfse, correlação
 * NBS x cClassTrib): 70% para locação/cessão onerosa/arrendamento
 * (cClassTrib 200027, 8 NBS) e 50% para as demais operações com bens
 * imóveis (cClassTrib 200046, 63 NBS) — substituem o "0% pendente"
 * usado anteriormente. Para os NBS da lista mais ampla do Conformidade
 * Fácil que NÃO aparecem no Anexo VIII (13 códigos), mantém 0% (alíquota
 * de referência cheia) até haver confirmação — mais conservador que
 * assumir um dos dois percentuais por engano.
 */
export class RegimeBensImoveisStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_BENS_IMOVEIS';
  readonly baseLegal = 'LC 214/2025, art. 251 a 265 (Anexo VIII, cClassTrib 200027/200046)';

  private readonly PERCENTUAL_POR_NBS = this.montarMapaDePercentuais();

  private montarMapaDePercentuais(): Map<string, Decimal> {
    const mapa = new Map<string, Decimal>();
    for (const nbs of NBS_BENS_IMOVEIS_LOCACAO_70) mapa.set(nbs.replace(/\D/g, ''), new Decimal(70));
    for (const nbs of NBS_BENS_IMOVEIS_OPERACOES_50) mapa.set(nbs.replace(/\D/g, ''), new Decimal(50));
    return mapa;
  }

  private percentualPara(nbs: string | undefined): Decimal {
    if (!nbs) return new Decimal(0);
    const normalizado = nbs.replace(/\D/g, '');
    return this.PERCENTUAL_POR_NBS.get(normalizado) ?? new Decimal(0); // sem confirmação no Anexo VIII — conservador
  }

  aplicavel(dados: DadosOperacao): boolean {
    return codigoFiscalEstaEm(dados.nbs, NBS_BENS_IMOVEIS);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    const aliquotas = aliquotasParaData(dados.dataOperacao);
    const percentual = this.percentualPara(dados.nbs);
    const fator = new Decimal(1).minus(percentual.dividedBy(100));

    const beneficio: BeneficioResolvido = {
      codigo: 'BENS_IMOVEIS_REDUCAO_SETORIAL',
      tipo: 'REDUCAO_PERCENTUAL',
      percentualReducao: percentual,
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseIbs.baseCalculo, aliquotas.ibsEstadual.times(fator), beneficio),
      this.montar('IBS_MUNICIPAL', baseIbs.baseCalculo, aliquotas.ibsMunicipal.times(fator), beneficio),
      this.montar('CBS', baseCbs.baseCalculo, aliquotas.cbs.times(fator), beneficio),
    ];
  }

  private montar(
    tributo: ResultadoDebito['tributo'],
    base: Decimal,
    aliquotaEfetiva: Decimal,
    beneficio: BeneficioResolvido,
  ): ResultadoDebito {
    const valor = base.times(aliquotaEfetiva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: aliquotaEfetiva,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeBensImoveisStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), percentualReducao: beneficio.percentualReducao?.toString() },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: aliquotaEfetiva,
        baseCalculo: base,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.2.0',
      },
    };
  }
}

/**
 * Regime de Hotelaria, Parques de Diversão e Temáticos (LC 214/2025, art.
 * 261 e seguintes) — 40% de redução, confirmado pelo Anexo VIII
 * (gov.br/nfse) tanto para hotelaria/parques (cClassTrib 200048) quanto
 * para agências de turismo (cClassTrib 200051) — os dois cClassTrib
 * coincidem no mesmo percentual, por isso uma única Strategy cobre ambos.
 *
 * Reconhece por NBS (lista unificada de hotelaria + agências de turismo,
 * combinando a base do Conformidade Fácil e o Anexo VIII da LC 214/2025 —
 * ver `codigos-nbs-reais.ts`) OU por CNAE (lista ilustrativa).
 */
export class RegimeHotelariaBaresRestaurantesStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_HOTELARIA_BARES_RESTAURANTES';
  readonly baseLegal = 'LC 214/2025, art. 261 (Anexo VIII, cClassTrib 200048/200051 — hotelaria e turismo, 40%)';

  private readonly CNAES_SETOR = new Set(['5510-8/01', '5611-2/01']); // hotéis, restaurantes (exemplos)
  private readonly PERCENTUAL_REDUCAO = new Decimal(40);

  aplicavel(dados: DadosOperacao): boolean {
    if (codigoFiscalEstaEm(dados.cnae, [...this.CNAES_SETOR])) return true;
    return codigoFiscalEstaEm(dados.nbs, NBS_HOTELARIA);
  }

  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;
    const aliquotas = aliquotasParaData(dados.dataOperacao);
    const fator = new Decimal(1).minus(this.PERCENTUAL_REDUCAO.dividedBy(100));

    const beneficio: BeneficioResolvido = {
      codigo: 'HOTELARIA_BARES_RESTAURANTES_REDUCAO_SETORIAL',
      tipo: 'REDUCAO_PERCENTUAL',
      percentualReducao: this.PERCENTUAL_REDUCAO,
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.montar('IBS_ESTADUAL', baseIbs.baseCalculo, aliquotas.ibsEstadual.times(fator), beneficio),
      this.montar('IBS_MUNICIPAL', baseIbs.baseCalculo, aliquotas.ibsMunicipal.times(fator), beneficio),
      this.montar('CBS', baseCbs.baseCalculo, aliquotas.cbs.times(fator), beneficio),
    ];
  }

  private montar(
    tributo: ResultadoDebito['tributo'],
    base: Decimal,
    aliquotaEfetiva: Decimal,
    beneficio: BeneficioResolvido,
  ): ResultadoDebito {
    const valor = base.times(aliquotaEfetiva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: aliquotaEfetiva,
      aliquotaEfetiva,
      valor,
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeHotelariaBaresRestaurantesStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), percentualReducao: '40' },
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
