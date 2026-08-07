import Decimal from 'decimal.js';

/**
 * Dados de entrada de uma operação a ser tributada.
 * Representa o que viria de uma NF-e/NFS-e/NFCom já parseada.
 */
export interface DadosOperacao {
  operacaoId: string;
  tipo:
    | 'VENDA'
    | 'COMPRA'
    | 'REMESSA'
    | 'RETORNO'
    | 'BONIFICACAO'
    | 'DEVOLUCAO'
    | 'IMPORTACAO'
    | 'EXPORTACAO'
    | 'CONSIGNACAO'
    | 'INDUSTRIALIZACAO_ENCOMENDA'
    | 'DEMONSTRACAO'
    | 'AMOSTRA_GRATIS';
  ambito: 'INTERNA' | 'INTERESTADUAL' | 'INTERNACIONAL';
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
  valorBruto: Decimal;
  frete?: Decimal;
  seguro?: Decimal;
  despesasAcessorias?: Decimal;
  descontoIncondicional?: Decimal;
  destinacao?: string; // "CONSUMO" | "REVENDA" | "ATIVO_IMOBILIZADO" | "USO_CONSUMO"
  finalidade?: string;
  dataOperacao: Date;

  // --- Campos usados por regimes diferenciados específicos (Fase 2) ---
  /** Faturamento anual acumulado do produtor rural (para o limite de imunidade/opção). */
  faturamentoAnualProdutorRural?: Decimal;
  /** Ato cooperativo interno (entre cooperado e cooperativa) vs. operação com terceiros. */
  atoCooperativoInterno?: boolean;
  /** Etapa da cadeia de combustíveis — define onde incide a tributação monofásica. */
  etapaCadeiaCombustivel?: 'PRODUTOR_IMPORTADOR' | 'DISTRIBUIDOR' | 'REVENDA_VAREJO';
  /** Se a pessoa jurídica destinatária é órgão da administração pública direta. */
  destinatarioAdministracaoPublica?: boolean;
  /** Operação com origem ou destino na Zona Franca de Manaus / Área de Livre Comércio. */
  operacaoZfmOuAlc?: boolean;
  /** Fornecedor optante pelo Simples Nacional e o regime de IBS/CBS escolhido por ele. */
  optanteSimplesNacional?: boolean;
  regimeSimplesEscolhido?: 'HIBRIDO_REGULAR' | 'RECOLHIMENTO_UNIFICADO';
  /**
   * Valor TOTAL de crédito de IBS/CBS efetivamente transferível ao
   * adquirente numa compra de fornecedor optante pelo Simples Nacional —
   * conforme documento fiscal do próprio fornecedor (a LC 214/2025 exige
   * essa informação discriminada, já que o crédito não é necessariamente
   * igual ao valor "por fora" de uma operação regular: depende do Anexo/
   * faixa de faturamento do fornecedor no Simples). Sem esse valor
   * informado, o sistema NÃO assume crédito integral automaticamente —
   * ver `RegimeSimplesNacionalStrategy`.
   */
  creditoTransferidoInformado?: Decimal;

  // --- Campos usados por operações especiais (Fase 3) ---
  /** Operação intermediada por plataforma de marketplace (define responsável pela retenção). */
  viaMarketplace?: boolean;
  marketplaceCnpjResponsavel?: string;
  /** Operação triangular: remetente físico da mercadoria é diferente do vendedor/emitente da NF. */
  operacaoTriangular?: boolean;
  remetenteFisicoDiferenteDoVendedor?: string;
  /** Importação — valores da base aduaneira (diferente da base padrão "por fora"). */
  valorAduaneiro?: Decimal;
  impostoImportacao?: Decimal;
  despesasDesembaracoAduaneiro?: Decimal;
  /** Industrialização por encomenda — valor agregado pelo industrializador (mão de obra + insumos próprios). */
  valorAgregadoIndustrializacao?: Decimal;
  /** Referência à operação original, para eventos de devolução/cancelamento/complemento (Motor de Ajustes). */
  operacaoOriginalId?: string;
  percentualDevolvido?: Decimal; // devolução parcial
}

/** Um registro de auditoria/memória de cálculo — obrigatório em toda regra aplicada. */
export interface RegistroMemoriaCalculo {
  regraAplicada: string;
  baseLegal: string; // ex: "LC 214/2025, art. 12, §2º, inciso III"
  parametrosUsados: Record<string, unknown>;
  beneficioAplicadoCodigo?: string;
  aliquotaUtilizada: Decimal;
  baseCalculo: Decimal;
  valorApurado: Decimal;
  dataVigenciaRegra: Date;
  versaoRegra: string;
  /**
   * Data da OPERAÇÃO (não confundir com `dataVigenciaRegra`, que é a data
   * de vigência da regra em si) — preenchida centralmente por
   * `DebitoService.calcularOperacao()` a partir de `DadosOperacao.dataOperacao`,
   * não por cada Strategy individualmente. Usada pelo dashboard para
   * calcular a alíquota de referência do ano correto (`cronograma-transicao.ts`)
   * e assim estimar a economia gerada por benefícios fiscais em R$.
   */
  dataOperacao?: Date;
}

/** Resultado da resolução da base de cálculo de um tributo para uma operação. */
export interface ResultadoBaseCalculo {
  tributo: 'IBS' | 'CBS' | 'IS';
  baseCalculo: Decimal;
  memoria: RegistroMemoriaCalculo;
}

/** Um benefício fiscal já localizado e resolvido para a operação. */
export interface BeneficioResolvido {
  codigo: string;
  tipo: 'ALIQUOTA_ZERO' | 'REDUCAO_PERCENTUAL' | 'ISENCAO' | 'IMUNIDADE' | 'SUSPENSAO' | 'DIFERIMENTO';
  percentualReducao?: Decimal;
  baseLegal: string;
  cumulativo: boolean;
  /** Condição de aplicação do benefício, quando houver (ex: "DESTINADOS À ALIMENTAÇÃO HUMANA"). */
  condicao?: string;
}

/** Resultado final de débito de um tributo. */
export interface ResultadoDebito {
  tributo: 'IBS_ESTADUAL' | 'IBS_MUNICIPAL' | 'CBS' | 'IS';
  baseCalculo: Decimal;
  aliquotaNominal: Decimal;
  aliquotaEfetiva: Decimal; // após benefícios
  valor: Decimal;
  beneficiosAplicados: BeneficioResolvido[];
  memoria: RegistroMemoriaCalculo;
}

/**
 * Contrato do Strategy Pattern para regimes tributários.
 * Cada regime diferenciado/específico (educação, saúde, ZFM, Simples Nacional,
 * cesta básica, etc.) implementa esta interface com sua própria lógica de
 * cálculo, mantendo o núcleo do motor imutável (Open/Closed Principle).
 */
export interface RegimeTributarioStrategy {
  readonly codigo: string;
  readonly baseLegal: string;

  /** Indica se esta estratégia se aplica à operação recebida. */
  aplicavel(dados: DadosOperacao): boolean;

  /** Calcula os débitos de IBS/CBS/IS para a operação segundo o regime. */
  calcular(
    dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    beneficios: BeneficioResolvido[],
  ): ResultadoDebito[];
}

/** Ponto de extensão para regras que dependem de regulamentação ainda não publicada. */
export interface PendenciaRegulamentar {
  descricao: string;
  baseLegalPrevista: string;
  status: 'AGUARDANDO_REGULAMENTACAO';
}
