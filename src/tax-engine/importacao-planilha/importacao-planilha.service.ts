import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { DadosOperacao } from '../interfaces/tax-engine.interfaces';

export type TipoLotePlanilha = 'ENTRADA' | 'SAIDA';

export interface LinhaIgnorada {
  linha: number;
  motivo: string;
}

export interface LinhaMapeada {
  linha: number;
  dados: DadosOperacao;
  origem: {
    codigoProduto: string;
    descricao: string;
    /**
     * Valor ORIGINAL de cada tributo substituído (PIS, COFINS, ICMS, ISS,
     * IPI), lido diretamente da planilha quando a coluna existir — comum
     * em planilhas de exportação fiscal reais, que já trazem esses
     * valores apurados no sistema atual. Usado pela projeção de carga
     * tributária total (`ProjecaoAnualService.projetarCargaTributariaTotal()`),
     * não pelo cálculo de IBS/CBS em si.
     */
    valorPis?: Decimal;
    valorCofins?: Decimal;
    valorIcms?: Decimal;
    valorIss?: Decimal;
    valorIpi?: Decimal;
    /** Metadados adicionais da nota — só para referência/rastreio no relatório, não usados no cálculo. */
    numeroNota?: string;
    chaveAcesso?: string;
    quantidade?: Decimal;
    /** Nome do cliente (venda) ou fornecedor (compra) daquela linha. */
    nomeContraparte?: string;
    /** CNPJ (14 dígitos, só números) do cliente/fornecedor daquela linha — usado para consultar automaticamente se é optante do Simples Nacional. CPF (11 dígitos) não é armazenado aqui — pessoa física não é "optante pelo Simples Nacional" no sentido de empresa. */
    cnpjContraparte?: string;
  };
}

export interface ResultadoMapeamentoPlanilha {
  mapeadas: LinhaMapeada[];
  ignoradas: LinhaIgnorada[];
  totalLinhas: number;
}

/**
 * Importa planilhas Excel de entrada/saída (formato de exportação fiscal
 * comum — colunas como "NCM/NBS", "CFOP", "Total Produto", "Descrição")
 * e converte cada linha num `DadosOperacao`, pronto para
 * `DebitoService.calcularOperacao()`.
 *
 * Formato esperado (colunas por NOME — a ordem pode variar, a posição
 * exata não importa): `Descrição`, `NCM/NBS`, `CFOP`, `Total Produto`
 * (ou `Valor Contábil` como alternativa), `CST` (opcional), `Codigo
 * produto`/`Codigo Produto` (opcional, só para referência no relatório).
 * `PIS`, `COFINS`, `ICMS`, `ISS`, `IPI` (opcionais — se a planilha já
 * trouxer o valor apurado desses tributos no sistema atual, o importador
 * reconhece e guarda no lançamento, para alimentar a projeção de carga
 * tributária total ano a ano; sem essas colunas, o lançamento é salvo
 * normalmente, só sem esses valores).
 *
 * Linhas sem `Descrição` são ignoradas — nas planilhas reais usadas para
 * desenvolver este importador (exportação de um sistema de apuração
 * fiscal), a única linha sem descrição em cada arquivo era uma linha de
 * totalização/agrupamento (ex: frete agregado sob um CFOP de serviço),
 * não uma operação individual real.
 *
 * A planilha não traz uma data por linha — por isso o chamador informa
 * uma ÚNICA data de referência para o lote inteiro (`dataOperacao`),
 * aplicada a todas as linhas. O NCM/NBS vem sem zeros à esquerda quando
 * o Excel guarda a coluna como número (`4015029` em vez de `04015029`)
 * — corrigido automaticamente completando para múltiplos de 2 dígitos
 * até o tamanho padrão de 8 (NCM).
 */
export interface CodigoExtraido {
  linha: number;
  descricao: string;
  codigoOriginal: string;
  ncm?: string;
  nbs?: string;
}

@Injectable()
export class ImportacaoPlanilhaService {
  /**
   * Sessões de importação em memória — o UPLOAD/parse do arquivo (rápido)
   * fica separado do PROCESSAMENTO linha a linha (que pode demorar em
   * planilhas grandes, já que cada linha passa pelo motor de cálculo
   * completo e grava em disco). Isso permite reportar o progresso real
   * via Server-Sent Events (`/importacao/planilha/progresso/:importId`):
   * o front-end sobe o arquivo primeiro (`iniciarSessao`), recebe um id,
   * e então abre uma conexão SSE que consome a sessão e emite um evento
   * por linha processada.
   *
   * Sessões não consumidas em até 10 minutos são descartadas (evita
   * vazamento de memória se o usuário fechar a aba no meio do processo).
   */
  private readonly sessoes = new Map<string, { linhasBrutas: Record<string, unknown>[]; criadoEm: number }>();
  private readonly TTL_SESSAO_MS = 10 * 60 * 1000;

  iniciarSessao(linhasBrutas: Record<string, unknown>[]): string {
    this.limparSessoesExpiradas();
    const importId = randomUUID();
    this.sessoes.set(importId, { linhasBrutas, criadoEm: Date.now() });
    return importId;
  }

  obterSessao(importId: string): Record<string, unknown>[] | undefined {
    return this.sessoes.get(importId)?.linhasBrutas;
  }

  removerSessao(importId: string): void {
    this.sessoes.delete(importId);
  }

  private limparSessoesExpiradas(): void {
    const agora = Date.now();
    for (const [id, sessao] of this.sessoes.entries()) {
      if (agora - sessao.criadoEm > this.TTL_SESSAO_MS) this.sessoes.delete(id);
    }
  }

  /**
   * Extrai apenas os códigos NCM/NBS (+ descrição, quando houver) de cada
   * linha da planilha — não monta uma operação completa nem calcula
   * tributo. Usado pela consulta de benefícios em lote (`/beneficios/consulta-planilha`),
   * onde só interessa saber "este código tem benefício?", sem precisar
   * de valor, CFOP ou data de operação.
   */
  /**
   * Extrai os CNPJs ÚNICOS (14 dígitos) da coluna "CNPJ/CPF" da planilha —
   * usado para consultar UMA VEZ POR FORNECEDOR/CLIENTE (não uma vez por
   * linha) se cada um é optante pelo Simples Nacional. Planilhas reais de
   * uma empresa média têm dezenas de contrapartes únicas para milhares de
   * linhas (ex: 62 fornecedores para 11 mil linhas de entrada, na
   * planilha usada para desenvolver isso) — consultar por CNPJ único, não
   * por linha, é o que torna viável fazer a consulta de verdade na
   * Receita Federal durante a importação, sem virar centenas/milhares de
   * chamadas de rede. CPFs (11 dígitos, pessoa física) são ignorados —
   * "optante pelo Simples Nacional" é uma característica de CNPJ.
   */
  extrairCnpjsUnicos(linhasBrutas: Record<string, unknown>[]): string[] {
    const cnpjs = new Set<string>();
    for (const linha of linhasBrutas) {
      const idx = this.indiceNormalizado(linha);
      const bruto = this.texto(idx, ['CNPJ/CPF', 'CNPJ', 'CNPJ Fornecedor', 'CNPJ Cliente']);
      if (!bruto) continue;
      const somenteDigitos = bruto.replace(/\D/g, '');
      if (somenteDigitos.length === 14) cnpjs.add(somenteDigitos);
    }
    return [...cnpjs];
  }

  extrairCodigos(linhasBrutas: Record<string, unknown>[]): CodigoExtraido[] {
    const extraidos: CodigoExtraido[] = [];
    linhasBrutas.forEach((linha, indice) => {
      const numeroLinha = indice + 2;
      const idx = this.indiceNormalizado(linha);
      const codigo = this.texto(idx, ['NCM/NBS', 'NCM', 'NBS']);
      if (!codigo) return;
      const descricao = this.texto(idx, ['Descrição', 'Descricao']) ?? '';
      extraidos.push({
        linha: numeroLinha,
        descricao,
        codigoOriginal: codigo,
        ...this.classificarNcmOuNbs(codigo),
      });
    });
    return extraidos;
  }

  parse(buffer: Buffer): Record<string, unknown>[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const primeiraAba = workbook.SheetNames[0];
    const planilha = workbook.Sheets[primeiraAba];
    return XLSX.utils.sheet_to_json(planilha, { defval: null, raw: true });
  }

  mapearParaOperacoes(
    linhasBrutas: Record<string, unknown>[],
    tipoLote: TipoLotePlanilha,
    dataOperacao: Date,
    cfopPadrao?: string,
    aliquotaIss?: string,
    contraparteSimplesNacional?: boolean,
    mapaSimplesNacionalPorCnpj?: Map<string, boolean | null>,
  ): ResultadoMapeamentoPlanilha {
    const mapeadas: LinhaMapeada[] = [];
    const ignoradas: LinhaIgnorada[] = [];
    const aliquotaIssDecimal = aliquotaIss ? new Decimal(aliquotaIss.replace(',', '.')) : null;

    linhasBrutas.forEach((linha, indice) => {
      const numeroLinha = indice + 2; // +1 pelo índice 0-based, +1 pela linha de cabeçalho do Excel
      const idx = this.indiceNormalizado(linha);
      const descricao = this.texto(idx, ['Descrição', 'Descricao']);

      if (!descricao) {
        ignoradas.push({ linha: numeroLinha, motivo: 'Sem descrição — provável linha de totalização/agrupamento, não uma operação individual.' });
        return;
      }

      const valorBrutoBruto = this.numero(idx, ['Total Produto', 'Valor Total Produto', 'Valor Contábil', 'Valor Contabil']);
      if (valorBrutoBruto === null || valorBrutoBruto.isZero()) {
        ignoradas.push({ linha: numeroLinha, motivo: 'Sem valor (Total Produto/Valor Contábil zerado ou ausente).' });
        return;
      }

      const codigoNcmNbs = this.texto(idx, ['NCM/NBS', 'NCM', 'NBS']);
      const cfop = this.texto(idx, ['CFOP']) ?? cfopPadrao;
      if (!cfop) {
        ignoradas.push({ linha: numeroLinha, motivo: 'Sem CFOP e nenhum CFOP padrão informado.' });
        return;
      }

      const codigoProduto = this.texto(idx, ['Codigo produto', 'Codigo Produto', 'Código produto', 'Código Produto']) ?? '';
      const cst = this.texto(idx, ['CST']) ?? '000';
      const frete = this.numero(idx, ['Frete']);
      const seguro = this.numero(idx, ['Seguro']);
      const desconto = this.numero(idx, ['Desconto', 'Desconto Incondicional']);
      const valorPis = this.numero(idx, ['PIS', 'Valor PIS', 'Vl PIS', 'Valor do PIS']);
      const valorCofins = this.numero(idx, ['COFINS', 'Cofins', 'Valor COFINS', 'Vl COFINS', 'Valor do COFINS']);
      const valorIcms = this.numero(idx, ['ICMS', 'Valor ICMS', 'Vl ICMS', 'Valor do ICMS']);
      const valorIpi = this.numero(idx, ['IPI', 'Valor IPI', 'Vl IPI', 'Valor do IPI']);

      // ISS: por padrão, lê da coluna se existir (planilhas de empresa
      // que já apuram ISS). Para CFOP 5933/6933 especificamente (serviço
      // tributado pelo ISSQN), calcula com base na alíquota informada
      // pelo usuário no formulário de importação — não existe tabela
      // nacional de alíquota de ISS (cada município fixa a própria), por
      // isso é sempre informada manualmente, nunca adivinhada; SUBSTITUI
      // (não soma) um eventual valor já lido da coluna, já que o cálculo
      // pedido é a fonte de verdade para esses CFOPs específicos.
      const cfopNormalizado = String(cfop).replace(/\D/g, '');
      const ehCfopServicoIss = cfopNormalizado === '5933' || cfopNormalizado === '6933';
      const valorIssDaColuna = this.numero(idx, ['ISS', 'Valor ISS', 'Vl ISS', 'Valor do ISS']);
      const valorIss =
        ehCfopServicoIss && aliquotaIssDecimal && aliquotaIssDecimal.greaterThan(0)
          ? valorBrutoBruto.times(aliquotaIssDecimal).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : valorIssDaColuna;
      const numeroNota = this.texto(idx, ['Nro Nota', 'Numero Nota', 'Número Nota', 'Nro. Nota']) ?? undefined;
      const chaveAcesso = this.texto(idx, ['Chave', 'Chave de Acesso', 'Chave Acesso']) ?? undefined;
      const quantidade = this.numero(idx, ['Quantidade', 'Qtde', 'Qtd']);
      const nomeContraparte = this.texto(idx, ['Nome', 'Razao Social', 'Razão Social']) ?? undefined;
      const cnpjBrutoContraparte = this.texto(idx, ['CNPJ/CPF', 'CNPJ', 'CNPJ Fornecedor', 'CNPJ Cliente']);
      const cnpjContraparte = cnpjBrutoContraparte?.replace(/\D/g, '');
      const cnpjEhValido = cnpjContraparte?.length === 14;

      // Simples Nacional: se a consulta automática por CNPJ (`mapaSimplesNacionalPorCnpj`)
      // tem um resultado para o CNPJ desta linha, usa ELE — mais preciso,
      // já que reflete a Receita Federal de VERDADE por fornecedor/cliente
      // individual. Sem resultado (CPF, lookup falhou, ou consulta
      // automática desligada), cai para o flag genérico do lote inteiro
      // (`contraparteSimplesNacional`, marcado manualmente no formulário)
      // como reserva — ou fica sem informar, se nenhum dos dois existir.
      const simplesNacionalDoCnpj = cnpjEhValido ? mapaSimplesNacionalPorCnpj?.get(cnpjContraparte!) : undefined;
      const optanteSimplesNacionalDaLinha =
        simplesNacionalDoCnpj !== undefined && simplesNacionalDoCnpj !== null
          ? simplesNacionalDoCnpj
          : contraparteSimplesNacional;

      const dados: DadosOperacao = {
        operacaoId: `${tipoLote === 'ENTRADA' ? 'entrada' : 'saida'}-${numeroLinha}-${codigoProduto || 'item'}`,
        tipo: tipoLote === 'ENTRADA' ? 'COMPRA' : 'VENDA',
        ambito: 'INTERNA',
        cfop: String(cfop),
        cst: String(cst),
        valorBruto: valorBrutoBruto,
        frete: frete ?? undefined,
        seguro: seguro ?? undefined,
        descontoIncondicional: desconto ?? undefined,
        dataOperacao,
        optanteSimplesNacional: optanteSimplesNacionalDaLinha,
        ...this.classificarNcmOuNbs(codigoNcmNbs),
      };

      mapeadas.push({
        linha: numeroLinha,
        dados,
        origem: {
          codigoProduto,
          descricao,
          valorPis: valorPis ?? undefined,
          valorCofins: valorCofins ?? undefined,
          valorIcms: valorIcms ?? undefined,
          valorIss: valorIss ?? undefined,
          valorIpi: valorIpi ?? undefined,
          numeroNota,
          chaveAcesso,
          quantidade: quantidade ?? undefined,
          nomeContraparte,
          cnpjContraparte: cnpjEhValido ? cnpjContraparte : undefined,
        },
      });
    });

    return { mapeadas, ignoradas, totalLinhas: linhasBrutas.length };
  }

  /**
   * A coluna "NCM/NBS" da planilha mistura os dois — NCM (8 dígitos
   * numéricos, mercadorias) e NBS (serviços). Como o motor já normaliza
   * pontuação/zeros à esquerda na comparação (`codigoFiscalEstaEm`), o
   * critério aqui é só o formato: puramente numérico com até 8 dígitos
   * vira NCM (completando zeros à esquerda, já que o Excel costuma
   * guardar como número e perder o zero inicial); qualquer outra coisa
   * (contém ponto, letra, ou mais de 8 dígitos) vira NBS.
   */
  classificarNcmOuNbs(codigo: string | null): { ncm?: string; nbs?: string } {
    if (!codigo) return {};
    const limpo = codigo.trim();
    const somenteDigitos = /^\d+$/.test(limpo);
    if (somenteDigitos && limpo.length <= 8) {
      return { ncm: limpo.padStart(8, '0') };
    }
    return { nbs: limpo };
  }

  /**
   * Índice normalizado (chave em minúsculas) das colunas da linha —
   * construído uma vez por linha para achar a coluna certa mesmo quando
   * a caixa não bate exatamente com o que o código espera. Confirmado
   * necessário com planilhas reais: a coluna vem como "Valor Icms" (só a
   * primeira letra maiúscula), não "Valor ICMS" como seria de se esperar
   * — buscar só pelo nome exato deixaria a coluna passar batido.
   */
  private indiceNormalizado(linha: Record<string, unknown>): Map<string, unknown> {
    const indice = new Map<string, unknown>();
    for (const chave of Object.keys(linha)) {
      indice.set(chave.trim().toLowerCase(), linha[chave]);
    }
    return indice;
  }

  private texto(indice: Map<string, unknown>, chavesPossiveis: string[]): string | null {
    for (const chave of chavesPossiveis) {
      const valor = indice.get(chave.trim().toLowerCase());
      if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
        return String(valor).trim();
      }
    }
    return null;
  }

  private numero(indice: Map<string, unknown>, chavesPossiveis: string[]): Decimal | null {
    for (const chave of chavesPossiveis) {
      const valor = indice.get(chave.trim().toLowerCase());
      if (valor === null || valor === undefined || valor === '') continue;
      try {
        const decimal = new Decimal(String(valor).replace(',', '.'));
        return decimal;
      } catch {
        continue;
      }
    }
    return null;
  }
}
