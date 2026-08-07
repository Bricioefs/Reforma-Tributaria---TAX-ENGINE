import Decimal from 'decimal.js';
import { DadosOperacao } from '../interfaces/tax-engine.interfaces';

/**
 * Corpo de requisição para cálculo/simulação de operação — mesma forma de
 * `DadosOperacao`, mas com valores monetários como `string` (JSON não tem
 * tipo decimal nativo; strings evitam perda de precisão de `number`) e
 * datas como `string` ISO 8601.
 */
export interface CalcularOperacaoDto {
  operacaoId: string;
  tipo: DadosOperacao['tipo'];
  ambito: DadosOperacao['ambito'];
  ncm?: string;
  nbs?: string;
  cest?: string;
  cfop: string;
  cst: string;
  cnae?: string;
  ufOrigem?: string;
  ufDestino?: string;
  municipioOrigemIbge?: string;
  municipioDestinoIbge?: string;
  valorBruto: string;
  frete?: string;
  seguro?: string;
  despesasAcessorias?: string;
  descontoIncondicional?: string;
  destinacao?: string;
  finalidade?: string;
  dataOperacao: string;

  faturamentoAnualProdutorRural?: string;
  atoCooperativoInterno?: boolean;
  etapaCadeiaCombustivel?: DadosOperacao['etapaCadeiaCombustivel'];
  destinatarioAdministracaoPublica?: boolean;
  operacaoZfmOuAlc?: boolean;
  optanteSimplesNacional?: boolean;
  regimeSimplesEscolhido?: DadosOperacao['regimeSimplesEscolhido'];
  viaMarketplace?: boolean;
  marketplaceCnpjResponsavel?: string;
  operacaoTriangular?: boolean;
  remetenteFisicoDiferenteDoVendedor?: string;
  valorAduaneiro?: string;
  impostoImportacao?: string;
  despesasDesembaracoAduaneiro?: string;
  valorAgregadoIndustrializacao?: string;
}

/** Converte o corpo de requisição (strings) para o tipo interno do motor (Decimal/Date). */
export function converterParaDadosOperacao(dto: CalcularOperacaoDto): DadosOperacao {
  const dec = (v?: string) => (v !== undefined ? new Decimal(v) : undefined);

  return {
    operacaoId: dto.operacaoId,
    tipo: dto.tipo,
    ambito: dto.ambito,
    ncm: dto.ncm,
    nbs: dto.nbs,
    cest: dto.cest,
    cfop: dto.cfop,
    cst: dto.cst,
    cnae: dto.cnae,
    ufOrigem: dto.ufOrigem,
    ufDestino: dto.ufDestino,
    municipioOrigemIbge: dto.municipioOrigemIbge,
    municipioDestinoIbge: dto.municipioDestinoIbge,
    valorBruto: new Decimal(dto.valorBruto),
    frete: dec(dto.frete),
    seguro: dec(dto.seguro),
    despesasAcessorias: dec(dto.despesasAcessorias),
    descontoIncondicional: dec(dto.descontoIncondicional),
    destinacao: dto.destinacao,
    finalidade: dto.finalidade,
    dataOperacao: new Date(dto.dataOperacao),
    faturamentoAnualProdutorRural: dec(dto.faturamentoAnualProdutorRural),
    atoCooperativoInterno: dto.atoCooperativoInterno,
    etapaCadeiaCombustivel: dto.etapaCadeiaCombustivel,
    destinatarioAdministracaoPublica: dto.destinatarioAdministracaoPublica,
    operacaoZfmOuAlc: dto.operacaoZfmOuAlc,
    optanteSimplesNacional: dto.optanteSimplesNacional,
    regimeSimplesEscolhido: dto.regimeSimplesEscolhido,
    viaMarketplace: dto.viaMarketplace,
    marketplaceCnpjResponsavel: dto.marketplaceCnpjResponsavel,
    operacaoTriangular: dto.operacaoTriangular,
    remetenteFisicoDiferenteDoVendedor: dto.remetenteFisicoDiferenteDoVendedor,
    valorAduaneiro: dec(dto.valorAduaneiro),
    impostoImportacao: dec(dto.impostoImportacao),
    despesasDesembaracoAduaneiro: dec(dto.despesasDesembaracoAduaneiro),
    valorAgregadoIndustrializacao: dec(dto.valorAgregadoIndustrializacao),
  };
}

// Nota: instâncias de `Decimal` já possuem `toJSON()` nativo (retornam a
// string do valor), então os resultados do motor podem ser retornados
// diretamente pelos controllers — o `JSON.stringify` do Express/Nest already
// serializa os campos Decimal como string, sem necessidade de mapeamento manual.
