import JSZip from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSXChart = require('xlsx-chart');

export interface DefinicaoGraficoNativo {
  /** Nome da aba que vai conter o gráfico (ex: "Gráfico - Saldo Total"). */
  nomeAba: string;
  tipo: 'area' | 'column' | 'line' | 'bar' | 'pie' | 'radar' | 'scatter';
  titulo: string;
  /** Nome de cada série (linha da legenda). */
  series: string[];
  /** Categorias do eixo X (ex: os anos). */
  categorias: string[];
  /** dados[serie][categoria] = valor. */
  dados: Record<string, Record<string, number>>;
}

/**
 * Gera gráficos NATIVOS do Excel (de verdade — o usuário pode clicar,
 * editar cores, mudar tipo, tudo como qualquer gráfico feito à mão no
 * Excel) e injeta cada um como uma aba nova num workbook `.xlsx` JÁ
 * PRONTO (gerado pelo `ExcelJS`).
 *
 * POR QUE NÃO É TÃO SIMPLES QUANTO PARECE: `ExcelJS` (a biblioteca usada
 * para o resto da planilha) NÃO tem suporte a gráficos — nenhuma versão,
 * confirmado lendo o próprio código-fonte do pacote (`grep -r chart`
 * não retorna nada). A única forma de gerar um gráfico NATIVO (não uma
 * imagem) em Node sem depender de um binário nativo compilado (que seria
 * o mesmo tipo de risco de quebrar os executáveis já visto antes com
 * `pdfkit`/`fontkit`) é a biblioteca `xlsx-chart`, que monta o XML do
 * gráfico (OOXML) puro em JavaScript.
 *
 * `xlsx-chart` só sabe gerar um `.xlsx` PRÓPRIO dela (com só 2 abas: uma
 * com o gráfico, outra com os dados) — não sabe "adicionar uma aba" a um
 * workbook que já existe. E seu modo de "múltiplos gráficos" (`charts: []`)
 * quebra com uma exceção NÃO TRATADA (`Cannot set properties of undefined`)
 * quando os gráficos têm números de séries diferentes entre si — testado
 * e confirmado antes de decidir a arquitetura abaixo. Como os 4 gráficos
 * deste dashboard têm 1, 2, 3 e 2 séries respectivamente, usar o modo
 * multi quebraria o processo inteiro na prática.
 *
 * Por isso: cada gráfico é gerado ISOLADAMENTE (`gerarUmGrafico()`, sempre
 * no modo de gráfico único — testado e estável mesmo com valores
 * negativos, zero, ou só 1 ano de dados), e depois as partes relevantes
 * (`xl/charts/chartN.xml`, `xl/drawings/drawingN.xml` e as duas abas —
 * a do gráfico e a da tabela de dados que o alimenta) são copiadas para
 * dentro do workbook principal via `jszip`, renumerando tudo para não
 * colidir com o que já existe (`mesclarGraficoNoWorkbook()`).
 *
 * `xlsx-chart` referencia sua própria aba de dados por um texto fixo,
 * `'Table!...'`, dentro do XML do gráfico — como cada gráfico precisa de
 * um nome de aba ÚNICO dentro do workbook final (não dá pra ter duas
 * abas chamadas "Table"), o nome é trocado por um nome único SEM espaços
 * (`DadosGraficoN`) antes de copiar, com uma substituição de texto simples
 * no XML do gráfico (`Table!` → `DadosGraficoN!`) — funciona porque nomes
 * de aba sem espaço/caractere especial não precisam de aspas nas fórmulas
 * do Excel, evitando ter que reescrever a fórmula inteira.
 *
 * A aba de dados de cada gráfico usa cadeia de caracteres (`shared
 * strings`) do PRÓPRIO arquivo pequeno gerado pelo `xlsx-chart` — em vez
 * de mesclar essa tabela de strings compartilhadas com a do workbook
 * principal (funcionaria, mas seria falho — cada referência de célula usa
 * um ÍNDICE numérico que teria que ser recalculado uma a uma), cada
 * célula de texto é convertida para "inline string" (`t="inlineStr"`) —
 * um formato igualmente válido no OOXML que carrega o texto direto na
 * célula, sem precisar de tabela compartilhada nenhuma. Mais simples e
 * sem risco de um índice errado apontar pro texto errado.
 */
export async function adicionarGraficosNativos(bufferPrincipal: Buffer, graficos: DefinicaoGraficoNativo[]): Promise<Buffer> {
  const zipPrincipal = await JSZip.loadAsync(bufferPrincipal);

  const workbookXmlPath = 'xl/workbook.xml';
  const workbookRelsPath = 'xl/_rels/workbook.xml.rels';
  const contentTypesPath = '[Content_Types].xml';

  let workbookXml = await zipPrincipal.file(workbookXmlPath)!.async('string');
  let workbookRelsXml = await zipPrincipal.file(workbookRelsPath)!.async('string');
  let contentTypesXml = await zipPrincipal.file(contentTypesPath)!.async('string');

  let proximoSheetIndex = maiorNumeroEm(zipPrincipal, /xl\/worksheets\/sheet(\d+)\.xml$/) + 1;
  let proximoChartIndex = maiorNumeroEm(zipPrincipal, /xl\/charts\/chart(\d+)\.xml$/) + 1;
  let proximoDrawingIndex = maiorNumeroEm(zipPrincipal, /xl\/drawings\/drawing(\d+)\.xml$/) + 1;
  let proximoRid = maiorRid(workbookRelsXml) + 1;
  let proximoSheetId = maiorSheetId(workbookXml) + 1;

  for (let i = 0; i < graficos.length; i++) {
    const def = graficos[i];
    const sufixo = `Dash${i + 1}`;
    const bufferGrafico = await gerarUmGrafico(def);
    const zipGrafico = await JSZip.loadAsync(bufferGrafico);

    // --- extrai e transforma as partes do gráfico isolado ---
    let chartXml = await zipGrafico.file('xl/charts/chart1.xml')!.async('string');
    const drawingXml = await zipGrafico.file('xl/drawings/drawing1.xml')!.async('string');
    const drawingRelsXml = await zipGrafico.file('xl/drawings/_rels/drawing1.xml.rels')!.async('string');
    const chartSheetXml = await zipGrafico.file('xl/worksheets/sheet1.xml')!.async('string');
    let dadosSheetXml = await zipGrafico.file('xl/worksheets/sheet2.xml')!.async('string');
    const sharedStringsXml = await zipGrafico.file('xl/sharedStrings.xml')!.async('string');

    const nomeAbaDados = `DadosGrafico${sufixo}`;
    chartXml = chartXml.split('Table!').join(`${nomeAbaDados}!`);
    dadosSheetXml = converterParaInlineStrings(dadosSheetXml, extrairSharedStrings(sharedStringsXml));

    // --- aloca números novos, sem colidir com o que já existe no principal ---
    const sheetChartNum = proximoSheetIndex++;
    const sheetDadosNum = proximoSheetIndex++;
    const chartNum = proximoChartIndex++;
    const drawingNum = proximoDrawingIndex++;

    const chartSheetPath = `xl/worksheets/sheet${sheetChartNum}.xml`;
    const dadosSheetPath = `xl/worksheets/sheet${sheetDadosNum}.xml`;
    const chartPath = `xl/charts/chart${chartNum}.xml`;
    const drawingPath = `xl/drawings/drawing${drawingNum}.xml`;
    const chartSheetRelsPath = `xl/worksheets/_rels/sheet${sheetChartNum}.xml.rels`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingNum}.xml.rels`;

    zipPrincipal.file(chartPath, chartXml);
    zipPrincipal.file(drawingPath, drawingXml);
    zipPrincipal.file(drawingRelsPath, drawingRelsXml.replace('chart1.xml', `chart${chartNum}.xml`));
    zipPrincipal.file(chartSheetPath, chartSheetXml);
    zipPrincipal.file(dadosSheetPath, dadosSheetXml);
    zipPrincipal.file(
      chartSheetRelsPath,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/>` +
        '</Relationships>',
    );

    // --- registra as 2 abas novas no workbook.xml ---
    const ridChart = `rId${proximoRid++}`;
    const ridDados = `rId${proximoRid++}`;
    const sheetIdChart = proximoSheetId++;
    const sheetIdDados = proximoSheetId++;

    workbookXml = workbookXml.replace(
      '</sheets>',
      `<sheet name="${escaparXml(nomeAbaValido(def.nomeAba))}" sheetId="${sheetIdChart}" r:id="${ridChart}"/>` +
        `<sheet name="${escaparXml(nomeAbaValido(nomeAbaDados))}" sheetId="${sheetIdDados}" r:id="${ridDados}"/></sheets>`,
    );
    workbookRelsXml = workbookRelsXml.replace(
      '</Relationships>',
      `<Relationship Id="${ridChart}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetChartNum}.xml"/>` +
        `<Relationship Id="${ridDados}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetDadosNum}.xml"/></Relationships>`,
    );

    // --- registra as partes novas no [Content_Types].xml ---
    contentTypesXml = contentTypesXml.replace(
      '</Types>',
      `<Override PartName="/${chartSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/${dadosSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
        `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    );
  }

  zipPrincipal.file(workbookXmlPath, workbookXml);
  zipPrincipal.file(workbookRelsPath, workbookRelsXml);
  zipPrincipal.file(contentTypesPath, contentTypesXml);

  return zipPrincipal.generateAsync({ type: 'nodebuffer' });
}

function gerarUmGrafico(def: DefinicaoGraficoNativo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const xlsxChart = new XLSXChart();
    xlsxChart.generate(
      {
        chart: def.tipo,
        chartTitle: def.titulo,
        titles: def.series,
        fields: def.categorias,
        data: def.dados,
      },
      (err: Error | null, data: Buffer) => {
        if (err) reject(err);
        else resolve(data);
      },
    );
  });
}

function maiorNumeroEm(zip: JSZip, padrao: RegExp): number {
  let maior = 0;
  zip.forEach((caminho) => {
    const m = caminho.match(padrao);
    if (m) maior = Math.max(maior, Number(m[1]));
  });
  return maior;
}

function maiorRid(relsXml: string): number {
  let maior = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) maior = Math.max(maior, Number(m[1]));
  return maior;
}

function maiorSheetId(workbookXml: string): number {
  let maior = 0;
  for (const m of workbookXml.matchAll(/sheetId="(\d+)"/g)) maior = Math.max(maior, Number(m[1]));
  return maior;
}

function extrairSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = [];
  for (const m of sharedStringsXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) strings.push(m[1]);
  return strings;
}

/** Troca célula de texto (`t="s"`, referência numérica à tabela de strings compartilhadas) por texto embutido direto na célula (`t="inlineStr"`) — evita ter que mesclar/reindexar a tabela de strings compartilhadas do workbook principal. */
function converterParaInlineStrings(sheetXml: string, strings: string[]): string {
  return sheetXml.replace(/<c ([^>]*)t="s"([^>]*)>\s*<v>(\d+)<\/v>\s*<\/c>/g, (_match, antes, depois, indice) => {
    const texto = strings[Number(indice)] ?? '';
    return `<c ${antes}t="inlineStr"${depois}><is><t>${texto}</t></is></c>`;
  });
}

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * O Excel limita nomes de aba a 31 caracteres (e não aceita `: \ / ? * [ ]`)
 * — ultrapassar isso corrompe a referência ao reabrir o arquivo (ou gera
 * colisão entre duas abas cujo nome fica idêntico depois de truncado por
 * outra ferramenta). Trunca com segurança em vez de deixar isso quebrar
 * silenciosamente mais tarde, caso um título de gráfico maior seja
 * adicionado no futuro.
 */
function nomeAbaValido(nome: string): string {
  const semCaracteresInvalidos = nome.replace(/[:\\/?*[\]]/g, '');
  return semCaracteresInvalidos.slice(0, 31);
}
