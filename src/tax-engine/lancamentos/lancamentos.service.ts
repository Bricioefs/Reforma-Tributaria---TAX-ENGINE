import { Injectable, Optional } from '@nestjs/common';
import { ResultadoDebito } from '../interfaces/tax-engine.interfaces';
import { lerJson, escreverJson, escreverJsonAsync, OpcoesPersistencia } from '../persistencia/armazenamento-arquivo.util';

export interface LancamentoPersistido {
  operacaoId: string;
  tipo: string;
  competencia: string; // "AAAA" (ano) — derivado da data da operação, usado para alimentar a apuração automaticamente
  resultados: ResultadoDebito[];
  criadoEm: string;
  /** Metadados opcionais do produto/serviço de origem — preenchidos principalmente pela importação de planilha, mas também disponíveis no lançamento manual — usados para exibir a descrição/classificação na tela de análise, em vez de só o identificador da operação. */
  descricao?: string;
  ncm?: string;
  nbs?: string;
  valorBruto?: string;
  cfop?: string;
  /**
   * Valor ORIGINAL dos tributos substituídos pela reforma (PIS, COFINS,
   * ICMS, ISS, IPI), tal como apurado no sistema tributário atual —
   * informado pelo usuário (manual ou por planilha), NÃO calculado por
   * este motor: as alíquotas de ICMS/ISS variam por estado/município/
   * produto/serviço e não há uma tabela única equivalente à da reforma
   * para derivá-las automaticamente. A partir desse valor original, a
   * projeção ano a ano aplica o cronograma de extinção/redução
   * (`cronograma-tributos-extintos.ts`) para prever quanto ainda seria
   * devido de cada um em cada ano da transição, somado ao IBS/CBS já
   * projetado — dando a carga tributária TOTAL prevista até 2033.
   */
  valorPis?: string;
  valorCofins?: string;
  valorIcms?: string;
  valorIss?: string;
  valorIpi?: string;
  /** Operação com origem/destino na Zona Franca de Manaus ou Área de Livre Comércio — mantém o IPI mesmo após 2027 (ver `cronograma-tributos-extintos.ts`). */
  zfmOuAlc?: boolean;
  /** Metadados adicionais da nota fiscal de origem — só para referência/rastreio, preenchidos pela importação de planilha quando a coluna existir. */
  numeroNota?: string;
  chaveAcesso?: string;
  quantidade?: string;
  nomeContraparte?: string;
  /** CNPJ (14 dígitos) do cliente/fornecedor, quando a planilha trouxer a coluna "CNPJ/CPF" — usado para a consulta automática de Simples Nacional (ver `ImportacaoPlanilhaController.consultarSimplesNacionalPorCnpjs()`) e guardado aqui só para rastreio/conferência. */
  cnpjContraparte?: string;
  /**
   * A CONTRAPARTE desta operação (fornecedor, numa compra; cliente, numa
   * venda) é optante pelo Simples Nacional — usado tanto no cálculo
   * (ver `RegimeSimplesNacionalStrategy`) quanto no indicador do
   * dashboard "% de entradas de empresas do Simples Nacional".
   */
  contraparteOptanteSimplesNacional?: boolean;
}

/** Repositório em disco: chave = CNPJ (só dígitos) da empresa, ou o balde "sem-empresa" quando nenhum CNPJ foi buscado ainda. */
type RepositorioPorEmpresa = Record<string, LancamentoPersistido[]>;

const ARQUIVO = 'lancamentos.json';
const CHAVE_SEM_EMPRESA = 'sem-empresa';

/**
 * Persiste os "lançamentos" feitos na aba "Calcular Operação" da
 * interface web (`src/public/index.html`), SEGMENTADOS POR EMPRESA
 * (CNPJ) — cada empresa tem sua própria lista, independente das outras.
 * Isso permite buscar uma empresa diferente (ou reiniciar o programa) sem
 * perder ou misturar os lançamentos já feitos para uma empresa anterior:
 * ao buscar de novo o mesmo CNPJ, os lançamentos daquela empresa voltam a
 * aparecer exatamente como estavam.
 *
 * Enquanto nenhuma empresa foi buscada na tela, os lançamentos ficam no
 * balde `sem-empresa` (mesmo comportamento de antes, para não quebrar o
 * uso sem CNPJ).
 *
 * Migra automaticamente o formato antigo (lista única, sem segmentação
 * por empresa) para o novo formato na primeira leitura, para não perder
 * lançamentos já salvos por versões anteriores deste programa.
 */
@Injectable()
export class LancamentosService {
  private repositorio: RepositorioPorEmpresa;

  constructor(@Optional() private readonly opcoes?: OpcoesPersistencia) {
    const bruto = lerJson<unknown>(ARQUIVO, {}, this.opcoes);
    if (Array.isArray(bruto)) {
      // formato antigo (lista única, sem campo "competencia") — migra para
      // o balde "sem-empresa" e deriva a competência do carimbo de criação,
      // já que a data original da operação não era guardada nessa versão.
      const lista = (bruto as any[]).map((l) => ({
        ...l,
        competencia: l.competencia ?? (String(l.criadoEm ?? '').slice(0, 4) || 'sem-competencia'),
      })) as LancamentoPersistido[];
      this.repositorio = { [CHAVE_SEM_EMPRESA]: lista };
    } else {
      this.repositorio = (bruto as RepositorioPorEmpresa) ?? {};
    }
  }

  listar(cnpj?: string): LancamentoPersistido[] {
    return [...(this.repositorio[this.chave(cnpj)] ?? [])];
  }

  /**
   * Lançamentos de uma empresa filtrados por ANO (competência) — alimenta a
   * apuração automaticamente. Compara só os 4 primeiros dígitos, então
   * funciona tanto com o formato atual ("2026") quanto com registros
   * antigos salvos no formato mensal ("2026-08") de versões anteriores —
   * ambos caem no mesmo ano "2026" sem precisar migrar dados existentes.
   */
  listarPorCompetencia(cnpj: string | undefined, competencia: string): LancamentoPersistido[] {
    const ano = competencia.slice(0, 4);
    return this.listar(cnpj).filter((l) => l.competencia.slice(0, 4) === ano);
  }

  /** Anos com lançamentos salvos para uma empresa, do mais recente para o mais antigo — usado para escolher a apuração automática a exibir quando a tela abre. */
  listarAnosComLancamentos(cnpj?: string): string[] {
    const anos = new Set(this.listar(cnpj).map((l) => l.competencia.slice(0, 4)));
    return [...anos].sort().reverse();
  }

  private escritaAutomaticaSuspensa = false;

  adicionar(cnpj: string | undefined, lancamento: Omit<LancamentoPersistido, 'criadoEm'>): LancamentoPersistido {
    const chave = this.chave(cnpj);
    const novo: LancamentoPersistido = { ...lancamento, criadoEm: new Date().toISOString() };
    if (!this.repositorio[chave]) this.repositorio[chave] = [];
    this.repositorio[chave].push(novo);
    if (!this.escritaAutomaticaSuspensa) escreverJson(ARQUIVO, this.repositorio, this.opcoes);
    return novo;
  }

  /**
   * Suspende a gravação em disco a cada `adicionar()` — usado pela
   * importação de planilha, que chama `adicionar()` uma vez por linha.
   * Sem isso, uma planilha de milhares de linhas reescreve o arquivo
   * inteiro (cada vez maior) a cada linha — gravação O(n²), lenta o
   * bastante para planilhas grandes que o usuário percebe como "travado".
   * Chame `persistir()` periodicamente durante o lote (para não perder
   * tudo se o processo cair no meio) e `retomarEscritaAutomatica()`
   * (que já persiste) ao final — sempre dentro de um `finally`, para não
   * deixar a gravação automática desligada permanentemente se algo falhar
   * no meio do lote.
   */
  suspenderEscritaAutomatica(): void {
    this.escritaAutomaticaSuspensa = true;
  }

  retomarEscritaAutomatica(): void {
    this.escritaAutomaticaSuspensa = false;
    this.persistir();
  }

  persistir(): void {
    escreverJson(ARQUIVO, this.repositorio, this.opcoes);
  }

  /** Ver `escreverJsonAsync()` — usada pela importação de planilha para não bloquear o envio dos eventos SSE de progresso durante uma gravação grande. */
  async persistirAsync(): Promise<void> {
    await escreverJsonAsync(ARQUIVO, this.repositorio, this.opcoes);
  }

  limpar(cnpj?: string): void {
    this.repositorio[this.chave(cnpj)] = [];
    escreverJson(ARQUIVO, this.repositorio, this.opcoes);
  }

  /** Lista os CNPJs que já têm lançamentos salvos (para telas futuras de "trocar de empresa"). */
  listarEmpresasComLancamentos(): string[] {
    return Object.keys(this.repositorio).filter((chave) => chave !== CHAVE_SEM_EMPRESA && this.repositorio[chave].length > 0);
  }

  private chave(cnpj?: string): string {
    const limpo = cnpj?.replace(/\D/g, '');
    return limpo || CHAVE_SEM_EMPRESA;
  }
}
