import { Injectable, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';

export interface ProdutoSujeitoIS {
  ncm: string;
  descricao: string;
  aliquota: Decimal; // percentual sobre a base própria do IS
  baseLegal: string;
  permiteCredito: boolean; // regra geral: IS NÃO gera crédito, salvo exceção expressa
}

export interface ResultadoImpostoSeletivo {
  incide: boolean;
  ncm?: string;
  baseCalculo: Decimal;
  aliquota: Decimal;
  valor: Decimal;
  permiteCredito: boolean;
  /** Valor que deve ser SOMADO à base de cálculo do IBS/CBS (o IS integra a base desses tributos). */
  valorParaIntegrarBaseIbsCbs: Decimal;
  memoria: RegistroMemoriaCalculo;
}

/**
 * Motor de Imposto Seletivo — IS (LC 214/2025, art. 409 e seguintes).
 *
 * Incide sobre produção, extração, comercialização ou importação de bens e
 * serviços prejudiciais à saúde ou ao meio ambiente (ex: cigarros, bebidas
 * alcoólicas, veículos poluentes, bens minerais). Regras estruturais:
 *   - Regra geral: NÃO gera crédito para o adquirente (é um tributo
 *     "regulatório", não sobre valor agregado) — salvo exceção expressa.
 *   - O valor do IS APURADO INTEGRA a base de cálculo do IBS e da CBS
 *     (diferente do próprio IBS/CBS, que não se incluem em sua própria
 *     base) — por isso este motor expõe `valorParaIntegrarBaseIbsCbs`,
 *     consumido pelo `BaseCalculoService`/`DebitoService` antes de apurar
 *     IBS/CBS da mesma operação.
 *
 * PENDÊNCIA REGULAMENTAR: a lista definitiva de produtos sujeitos e as
 * alíquotas específicas por NCM dependem de lei ordinária complementar
 * (LC 214/2025, art. 410 fixa só os princípios gerais) — o cadastro abaixo
 * é um SEED ilustrativo, substituível por `ProdutoSujeitoISRepository` em
 * produção.
 */
@Injectable()
export class ImpostoSeletivoService {
  constructor(@Optional() private readonly cadastro: ProdutoSujeitoIS[] = SEED_PRODUTOS_IS) {}

  calcular(ncm: string | undefined, valorBruto: Decimal): ResultadoImpostoSeletivo {
    const produto = ncm ? this.cadastro.find((p) => p.ncm === ncm) : undefined;

    if (!produto) {
      return this.naoIncide(ncm, valorBruto);
    }

    const base = new Decimal(valorBruto).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const valor = base.times(produto.aliquota).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      incide: true,
      ncm,
      baseCalculo: base,
      aliquota: produto.aliquota,
      valor,
      permiteCredito: produto.permiteCredito,
      valorParaIntegrarBaseIbsCbs: valor,
      memoria: {
        regraAplicada: 'ImpostoSeletivoService.calcular',
        baseLegal: produto.baseLegal,
        parametrosUsados: { ncm, base: base.toString(), aliquota: produto.aliquota.toString() },
        aliquotaUtilizada: produto.aliquota,
        baseCalculo: base,
        valorApurado: valor,
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }

  private naoIncide(ncm: string | undefined, valorBruto: Decimal): ResultadoImpostoSeletivo {
    return {
      incide: false,
      ncm,
      baseCalculo: new Decimal(0),
      aliquota: new Decimal(0),
      valor: new Decimal(0),
      permiteCredito: false,
      valorParaIntegrarBaseIbsCbs: new Decimal(0),
      memoria: {
        regraAplicada: 'ImpostoSeletivoService.calcular (não incide)',
        baseLegal: 'LC 214/2025, art. 409 (produto não listado como sujeito ao IS)',
        parametrosUsados: { ncm, valorBruto: valorBruto.toString() },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: new Decimal(0),
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }
}

/** Seed ilustrativo — substituir por cadastro oficial em produção. */
export const SEED_PRODUTOS_IS: ProdutoSujeitoIS[] = [
  {
    ncm: '2402.20.00', // cigarros
    descricao: 'Cigarros contendo tabaco',
    aliquota: new Decimal(0), // PENDÊNCIA REGULAMENTAR — alíquota específica não fixada nesta fase
    baseLegal: 'LC 214/2025, art. 410, I (produtos fumígenos)',
    permiteCredito: false,
  },
  {
    ncm: '2203.00.00', // cervejas
    descricao: 'Cervejas de malte',
    aliquota: new Decimal(0), // PENDÊNCIA REGULAMENTAR
    baseLegal: 'LC 214/2025, art. 410, II (bebidas alcoólicas)',
    permiteCredito: false,
  },
  {
    ncm: '8703.23.10', // veículo exemplo
    descricao: 'Veículos automotores (critério de emissão de poluentes)',
    aliquota: new Decimal(0), // PENDÊNCIA REGULAMENTAR
    baseLegal: 'LC 214/2025, art. 410, IV (veículos poluentes)',
    permiteCredito: false,
  },
];
