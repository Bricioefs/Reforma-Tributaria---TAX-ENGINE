import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB } from 'pdf-lib';
import Decimal from 'decimal.js';
import { LancamentoPersistido } from '../lancamentos/lancamentos.service';
import { ProjecaoAnualService, ProjecaoAnual, CargaTributariaTotalAnual } from '../apuracao/projecao-anual.service';
import { adicionarGraficosNativos, DefinicaoGraficoNativo } from './graficos-nativos.util';

const COR_CABECALHO = 'FF1A4D8F';
const COR_TEXTO_CABECALHO = 'FFFFFFFF';
const COR_DEVEDOR = 'FFB3261E';
const COR_CREDOR = 'FF1E7E34';

function formatarMoedaXlsx(valor: Decimal | number): number {
  return Number(valor);
}

/**
 * Exportação de relatórios para análise externa — não substitui a tela do
 * sistema, é para o usuário levar os números para fora (planilha própria,
 * anexar num e-mail, imprimir para reunião etc.).
 *
 * `gerarExcel()` — pasta de trabalho com 3 abas:
 *   1. "Lançamentos" — todos os lançamentos (entrada e saída) de uma
 *      empresa, com o valor total projetado ano a ano até o ano final
 *      informado (reaproveita `ProjecaoAnualService.projetarPorLancamento()`).
 *   2. "Apuração IBS-CBS" — a apuração ano a ano (débito, crédito, saldo,
 *      situação devedor/credor), calculada a partir dos MESMOS lançamentos
 *      de entrada e saída (reaproveita `ProjecaoAnualService.projetar()` —
 *      a mesma fonte usada pela tela "Apuração Anual", garantindo que a
 *      planilha exportada sempre bate com o que o sistema mostra).
 *   3. "Gráficos" — tabelas já organizadas para o usuário selecionar e
 *      inserir um gráfico no Excel (Inserir > Gráfico). Não embute um
 *      gráfico já pronto como imagem: a única biblioteca capaz de
 *      renderizar gráfico como imagem em Node depende de um binário
 *      nativo compilado (`canvas`) que não atravessa de forma confiável
 *      para os executáveis Windows/Mac gerados por `pkg` a partir deste
 *      ambiente — preferiu-se não arriscar quebrar os executáveis já
 *      funcionando só para embutir uma imagem. O PDF (abaixo) já traz um
 *      gráfico de barras de verdade, desenhado em vetor (sem essa
 *      dependência).
 *
 * `gerarPdf()` — relatório resumido de uma página com a "leitura da
 * projeção" (interpretação automática dos números, não um parecer
 * contábil profissional — ver aviso no rodapé do próprio PDF) e um
 * gráfico de barras vetorial da evolução do saldo até o ano final.
 */
@Injectable()
export class ExportacaoService {
  constructor(private readonly projecaoService: ProjecaoAnualService) {}

  async gerarExcel(
    lancamentos: LancamentoPersistido[],
    _nomeEmpresa: string,
    anoInicio: number,
    anoFim: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tax Engine IBS/CBS/IS';
    workbook.created = new Date();

    const projecaoAnual = this.projecaoService.projetar(lancamentos, anoInicio, anoFim);
    const cargaTributariaTotal = this.projecaoService.projetarCargaTributariaTotal(lancamentos, anoInicio, anoFim);

    this.montarAbaDashboard(workbook, projecaoAnual);
    this.montarAbaLancamentos(workbook, lancamentos, anoInicio, anoFim);
    this.montarAbaApuracao(workbook, projecaoAnual);
    this.montarAbaCargaTributariaTotal(workbook, cargaTributariaTotal);
    this.montarAbaGraficos(workbook, projecaoAnual, lancamentos);

    const bufferSemGraficosNativos = Buffer.from(await workbook.xlsx.writeBuffer());

    // Gráficos NATIVOS de verdade (não imagem) — ver graficos-nativos.util.ts
    // para o porquê disso não poder ser feito direto pelo ExcelJS. Se algo
    // der errado aqui (biblioteca de terceiros, mais frágil que o resto do
    // sistema — já confirmado que quebra em alguns formatos de dados), a
    // planilha ainda sai completa e correta SEM os gráficos, em vez de
    // travar a exportação inteira por causa de um extra visual.
    try {
      return await adicionarGraficosNativos(bufferSemGraficosNativos, this.definirGraficosDashboard(projecaoAnual));
    } catch (erro) {
      // eslint-disable-next-line no-console
      console.error('Não foi possível gerar os gráficos nativos do Dashboard Fiscal — planilha exportada sem eles.', erro);
      return bufferSemGraficosNativos;
    }
  }

  /**
   * Define os 4 gráficos do Dashboard Fiscal — mesmo conjunto do painel de
   * referência que o usuário mostrou (evolução do saldo total, débito x
   * crédito de CBS, composição do saldo por tributo, débito x crédito de
   * IBS Estadual). Cada um tem um número de séries DIFERENTE de propósito
   * (1, 2, 3, 2) — importante manter assim precisamente para exercitar o
   * caminho "gráfico único" isoladamente (ver aviso em `graficos-nativos.util.ts`
   * sobre por que múltiplos gráficos com formatos diferentes não podem ser
   * gerados juntos numa única chamada).
   */
  private definirGraficosDashboard(projecaoAnual: ProjecaoAnual[]): DefinicaoGraficoNativo[] {
    const anos = projecaoAnual.map((p) => String(p.ano));
    const valor = (arr: ProjecaoAnual[], campo: keyof ProjecaoAnual) =>
      Object.fromEntries(arr.map((p) => [String(p.ano), Number(p[campo])]));

    return [
      {
        nomeAba: 'Gráf. Saldo Total',
        tipo: 'area',
        titulo: 'Evolução do Saldo Total',
        series: ['Saldo Total'],
        categorias: anos,
        dados: { 'Saldo Total': valor(projecaoAnual, 'saldoTotal') },
      },
      {
        nomeAba: 'Gráf. Débito x Crédito CBS',
        tipo: 'column',
        titulo: 'Débito vs Crédito CBS',
        series: ['Débito CBS', 'Crédito CBS'],
        categorias: anos,
        dados: {
          'Débito CBS': valor(projecaoAnual, 'totalDebitoCbs'),
          'Crédito CBS': valor(projecaoAnual, 'totalCreditoCbs'),
        },
      },
      {
        nomeAba: 'Gráf. Composição Saldo',
        tipo: 'line',
        titulo: 'Composição do Saldo por Tributo',
        series: ['Saldo CBS', 'Saldo IBS Est.', 'Saldo IBS Mun.'],
        categorias: anos,
        dados: {
          'Saldo CBS': valor(projecaoAnual, 'saldoCbs'),
          'Saldo IBS Est.': valor(projecaoAnual, 'saldoIbsEstadual'),
          'Saldo IBS Mun.': valor(projecaoAnual, 'saldoIbsMunicipal'),
        },
      },
      {
        nomeAba: 'Gráf. Déb. x Créd. IBS Est.',
        tipo: 'column',
        titulo: 'Débito vs Crédito IBS Estadual',
        series: ['Débito IBS Est.', 'Crédito IBS Est.'],
        categorias: anos,
        dados: {
          'Débito IBS Est.': valor(projecaoAnual, 'totalDebitoIbsEstadual'),
          'Crédito IBS Est.': valor(projecaoAnual, 'totalCreditoIbsEstadual'),
        },
      },
    ];
  }

  /**
   * Aba "Dashboard Fiscal" — os cartões de indicador (Saldo Total, Saldo
   * CBS, Saldo IBS Estadual, Saldo IBS Municipal) e o aviso de Situação
   * (Devedor/Credor), no estilo do painel de referência mostrado pelo
   * usuário. Usa o ÚLTIMO ano do intervalo pedido como "ano em destaque"
   * (o Excel não tem um seletor de ano ao vivo como uma página web sem
   * usar VBA/macros — o mais próximo sem introduzir essa complexidade é
   * mostrar o ano final da projeção, que é o resultado mais relevante
   * para decisão de longo prazo).
   */
  private montarAbaDashboard(workbook: ExcelJS.Workbook, projecaoAnual: ProjecaoAnual[]) {
    const ws = workbook.addWorksheet('Dashboard Fiscal');
    const ultimo = projecaoAnual[projecaoAnual.length - 1];
    const primeiro = projecaoAnual[0];

    ws.mergeCells('B2:I2');
    ws.getCell('B2').value = 'Dashboard Fiscal';
    ws.getCell('B2').font = { size: 18, bold: true, color: { argb: COR_CABECALHO } };

    ws.mergeCells('B3:I3');
    ws.getCell('B3').value = `Análise de Apuração IBS-CBS (${primeiro.ano}-${ultimo.ano}) — indicadores do ano de ${ultimo.ano}`;
    ws.getCell('B3').font = { size: 11, color: { argb: 'FF6B7280' } };

    const cartoes: { titulo: string; valor: Decimal; coluna: string }[] = [
      { titulo: 'Saldo Total', valor: ultimo.saldoTotal, coluna: 'B' },
      { titulo: 'Saldo CBS', valor: ultimo.saldoCbs, coluna: 'D' },
      { titulo: 'Saldo IBS Estadual', valor: ultimo.saldoIbsEstadual, coluna: 'F' },
      { titulo: 'Saldo IBS Municipal', valor: ultimo.saldoIbsMunicipal, coluna: 'H' },
    ];

    const linhaCartao = 5;
    for (const cartao of cartoes) {
      const colFim = String.fromCharCode(cartao.coluna.charCodeAt(0) + 1);
      ws.mergeCells(`${cartao.coluna}${linhaCartao}:${colFim}${linhaCartao}`);
      ws.mergeCells(`${cartao.coluna}${linhaCartao + 1}:${colFim}${linhaCartao + 1}`);
      const celTitulo = ws.getCell(`${cartao.coluna}${linhaCartao}`);
      const celValor = ws.getCell(`${cartao.coluna}${linhaCartao + 1}`);
      celTitulo.value = cartao.titulo;
      celTitulo.font = { size: 10, color: { argb: 'FF6B7280' } };
      celValor.value = `R$ ${this.formatarMoedaTexto(cartao.valor.abs())}`;
      celValor.font = { size: 16, bold: true, color: { argb: cartao.valor.greaterThan(0) ? COR_DEVEDOR : COR_CREDOR } };
      for (const linha of [linhaCartao, linhaCartao + 1]) {
        for (const col of [cartao.coluna, colFim]) {
          ws.getCell(`${col}${linha}`).border = { top: { style: 'thin', color: { argb: 'FFF3C4C4' } }, bottom: { style: 'thin', color: { argb: 'FFF3C4C4' } }, left: { style: 'thin', color: { argb: 'FFF3C4C4' } }, right: { style: 'thin', color: { argb: 'FFF3C4C4' } } };
        }
      }
    }

    const situacao = ultimo.situacao === 'DEVEDOR' ? 'Devedor' : ultimo.situacao === 'CREDOR' ? 'Credor' : 'Neutro';
    const corSituacao = ultimo.situacao === 'DEVEDOR' ? COR_DEVEDOR : ultimo.situacao === 'CREDOR' ? COR_CREDOR : 'FF6B7280';
    const mensagemSituacao =
      ultimo.situacao === 'CREDOR'
        ? 'A empresa é credora de impostos no ano de destaque. Há saldo a recuperar.'
        : ultimo.situacao === 'DEVEDOR'
          ? 'A empresa é devedora de impostos no ano de destaque.'
          : 'Saldo neutro no ano de destaque.';

    ws.mergeCells('B8:I8');
    const celSituacao = ws.getCell('B8');
    celSituacao.value = `Situação: ${situacao}  —  ${mensagemSituacao}`;
    celSituacao.font = { bold: true, color: { argb: corSituacao } };
    celSituacao.border = { top: { style: 'thin', color: { argb: 'FFF3C4C4' } }, bottom: { style: 'thin', color: { argb: 'FFF3C4C4' } }, left: { style: 'thin', color: { argb: 'FFF3C4C4' } }, right: { style: 'thin', color: { argb: 'FFF3C4C4' } } };

    ws.mergeCells('B10:I10');
    ws.getCell('B10').value = 'Os 4 gráficos completos (evolução do saldo, débito x crédito por tributo, composição do saldo) estão nas abas "Dashboard - ..." a seguir — são gráficos nativos do Excel, você pode clicar e editar como qualquer outro.';
    ws.getCell('B10').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    ws.getCell('B10').alignment = { wrapText: true };

    ws.columns.forEach((col) => (col.width = 14));
    ws.getColumn(1).width = 3;
  }

  private montarAbaLancamentos(workbook: ExcelJS.Workbook, lancamentos: LancamentoPersistido[], anoInicio: number, anoFim: number) {
    const ws = workbook.addWorksheet('Lançamentos');
    const anos: number[] = [];
    for (let a = anoInicio; a <= anoFim; a++) anos.push(a);

    const projecoes = this.projecaoService.projetarPorLancamentoDetalhado(lancamentos, anoInicio, anoFim);

    const cabecalho = [
      '#',
      'Operação',
      'Descrição',
      'NCM/NBS',
      'CFOP',
      'Tipo',
      'D/C',
      'Competência',
      'Valor Bruto',
      'Alíq. IBS Estadual (%)',
      'IBS Estadual (R$)',
      'Alíq. IBS Municipal (%)',
      'IBS Municipal (R$)',
      'Alíq. CBS (%)',
      'CBS (R$)',
      'Benefício Aplicado',
      ...anos.flatMap((a) => [`IBS Estadual ${a} (R$)`, `IBS Municipal ${a} (R$)`, `CBS ${a} (R$)`]),
    ];
    ws.addRow(cabecalho);
    this.estilizarCabecalho(ws.getRow(1), cabecalho.length);

    const colunaAnosInicial = 17; // primeira coluna do bloco ano a ano (1-indexado; após "Benefício Aplicado", coluna 16)

    projecoes.forEach((p, i) => {
      const original = lancamentos[i];
      const porTributo = (trib: string) => original.resultados.find((r) => r.tributo === trib);
      const aliquota = (trib: string) => {
        const r = porTributo(trib);
        return r ? Number(r.aliquotaEfetiva) : null;
      };
      const valorOriginal = (trib: string) => {
        const r = porTributo(trib);
        return r ? formatarMoedaXlsx(r.valor as unknown as Decimal) : 0;
      };

      const codigosVistos = new Set<string>();
      const beneficios: string[] = [];
      for (const r of original.resultados) {
        for (const b of r.beneficiosAplicados || []) {
          if (!codigosVistos.has(b.codigo)) {
            codigosVistos.add(b.codigo);
            const percentual = b.percentualReducao !== undefined && b.percentualReducao !== null ? ` (${Number(b.percentualReducao)}% red.)` : '';
            beneficios.push(b.codigo + percentual);
          }
        }
      }

      const linha = ws.addRow([
        i + 1,
        p.operacaoId,
        original.descricao ?? '',
        original.ncm ?? original.nbs ?? '',
        original.cfop ?? '',
        p.tipo,
        p.entrada ? 'Crédito' : 'Débito',
        p.competencia,
        original.valorBruto ? formatarMoedaXlsx(new Decimal(original.valorBruto)) : 0,
        aliquota('IBS_ESTADUAL'),
        valorOriginal('IBS_ESTADUAL'),
        aliquota('IBS_MUNICIPAL'),
        valorOriginal('IBS_MUNICIPAL'),
        aliquota('CBS'),
        valorOriginal('CBS'),
        beneficios.length > 0 ? beneficios.join('; ') : 'Sem benefício',
        ...anos.flatMap((a) => {
          const v = p.porAno[String(a)];
          return [formatarMoedaXlsx(v.ibsEstadual), formatarMoedaXlsx(v.ibsMunicipal), formatarMoedaXlsx(v.cbs)];
        }),
      ]);

      linha.getCell(9).numFmt = 'R$ #,##0.00'; // Valor Bruto
      for (const col of [10, 12, 14]) linha.getCell(col).numFmt = '0.0000"%"'; // alíquotas
      for (const col of [11, 13, 15]) linha.getCell(col).numFmt = 'R$ #,##0.00'; // valores originais IBS Est./IBS Mun./CBS
      for (let col = colunaAnosInicial; col <= cabecalho.length; col++) linha.getCell(col).numFmt = 'R$ #,##0.00'; // bloco ano a ano
    });

    ws.columns.forEach((col, i) => {
      col.width = i === 2 ? 30 : i === 15 ? 28 : i === 1 ? 16 : 14;
    });
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  }

  private montarAbaApuracao(workbook: ExcelJS.Workbook, projecaoAnual: ProjecaoAnual[]) {
    const ws = workbook.addWorksheet('Apuração IBS-CBS');
    const cabecalho = [
      'Ano',
      'Débito CBS',
      'Crédito CBS',
      'Saldo CBS',
      'Débito IBS Estadual',
      'Crédito IBS Estadual',
      'Saldo IBS Estadual',
      'Débito IBS Municipal',
      'Crédito IBS Municipal',
      'Saldo IBS Municipal',
      'Saldo Total',
      'Situação',
    ];
    ws.addRow(cabecalho);
    this.estilizarCabecalho(ws.getRow(1), cabecalho.length);

    for (const p of projecaoAnual) {
      const linha = ws.addRow([
        p.ano,
        formatarMoedaXlsx(p.totalDebitoCbs),
        formatarMoedaXlsx(p.totalCreditoCbs),
        formatarMoedaXlsx(p.saldoCbs),
        formatarMoedaXlsx(p.totalDebitoIbsEstadual),
        formatarMoedaXlsx(p.totalCreditoIbsEstadual),
        formatarMoedaXlsx(p.saldoIbsEstadual),
        formatarMoedaXlsx(p.totalDebitoIbsMunicipal),
        formatarMoedaXlsx(p.totalCreditoIbsMunicipal),
        formatarMoedaXlsx(p.saldoIbsMunicipal),
        formatarMoedaXlsx(p.saldoTotal),
        p.situacao === 'DEVEDOR' ? 'Devedor' : p.situacao === 'CREDOR' ? 'Credor' : 'Neutro',
      ]);
      for (let col = 2; col <= 11; col++) linha.getCell(col).numFmt = 'R$ #,##0.00';
      const corSituacao = p.situacao === 'DEVEDOR' ? COR_DEVEDOR : p.situacao === 'CREDOR' ? COR_CREDOR : undefined;
      if (corSituacao) {
        linha.getCell(12).font = { color: { argb: corSituacao }, bold: true };
      }
    }

    ws.columns.forEach((col) => (col.width = 18));
  }

  /**
   * Aba "Carga Tributária Total" — a previsão de TUDO que a empresa
   * pagaria em cada ano da transição até 2033: os 5 tributos substituídos
   * pela reforma (PIS, COFINS, ICMS, ISS, IPI — aplicando o cronograma de
   * extinção sobre o valor original informado em cada lançamento) MAIS o
   * IBS/CBS já projetado na aba "Apuração IBS-CBS". Vazia (tudo zero)
   * quando nenhum lançamento tiver os valores originais desses tributos
   * informados — não é erro, é o comportamento esperado quando só o
   * IBS/CBS foi testado até agora.
   */
  private montarAbaCargaTributariaTotal(workbook: ExcelJS.Workbook, cargaTributaria: CargaTributariaTotalAnual[]) {
    const ws = workbook.addWorksheet('Carga Tributária Total');

    ws.mergeCells('A1:M1');
    ws.getCell('A1').value = 'Previsão de todos os tributos (sistema atual + reforma) por ano da transição — 2026 a 2033';
    ws.getCell('A1').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
    ws.addRow([]);

    const cabecalho = [
      'Ano',
      'Saldo PIS',
      'Saldo COFINS',
      'Saldo ICMS',
      'Saldo ISS',
      'Saldo IPI',
      'Total tributos substituídos',
      'Saldo IBS+CBS',
      'CARGA TRIBUTÁRIA TOTAL',
    ];
    ws.addRow(cabecalho);
    this.estilizarCabecalho(ws.getRow(3), cabecalho.length);

    for (const c of cargaTributaria) {
      const linha = ws.addRow([
        c.ano,
        formatarMoedaXlsx(c.pis.saldo),
        formatarMoedaXlsx(c.cofins.saldo),
        formatarMoedaXlsx(c.icms.saldo),
        formatarMoedaXlsx(c.iss.saldo),
        formatarMoedaXlsx(c.ipi.saldo),
        formatarMoedaXlsx(c.saldoTotalTributosSubstituidos),
        formatarMoedaXlsx(c.saldoTotalIbsCbs),
        formatarMoedaXlsx(c.saldoTotalGeral),
      ]);
      for (let col = 2; col <= 9; col++) linha.getCell(col).numFmt = 'R$ #,##0.00';
      linha.getCell(9).font = { bold: true, color: { argb: COR_CABECALHO } };
    }

    ws.columns.forEach((col) => (col.width = 20));
  }

  private montarAbaGraficos(workbook: ExcelJS.Workbook, projecaoAnual: ProjecaoAnual[], lancamentos: LancamentoPersistido[]) {
    const ws = workbook.addWorksheet('Gráficos');

    ws.addRow(['Tabelas prontas para gráfico — selecione os dados e use Inserir > Gráfico no Excel']).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.addRow([]);

    ws.addRow(['Saldo total apurado por ano (R$)']).font = { bold: true };
    const cab1 = ws.addRow(['Ano', 'Saldo Total']);
    this.estilizarCabecalho(cab1, 2);
    for (const p of projecaoAnual) {
      const linha = ws.addRow([p.ano, formatarMoedaXlsx(p.saldoTotal)]);
      linha.getCell(2).numFmt = 'R$ #,##0.00';
    }
    ws.addRow([]);

    ws.addRow(['Débito total vs Crédito total por ano (R$)']).font = { bold: true };
    const cab2 = ws.addRow(['Ano', 'Débito Total', 'Crédito Total']);
    this.estilizarCabecalho(cab2, 3);
    for (const p of projecaoAnual) {
      const debitoTotal = p.totalDebitoCbs.plus(p.totalDebitoIbsEstadual).plus(p.totalDebitoIbsMunicipal);
      const creditoTotal = p.totalCreditoCbs.plus(p.totalCreditoIbsEstadual).plus(p.totalCreditoIbsMunicipal);
      const linha = ws.addRow([p.ano, formatarMoedaXlsx(debitoTotal), formatarMoedaXlsx(creditoTotal)]);
      linha.getCell(2).numFmt = 'R$ #,##0.00';
      linha.getCell(3).numFmt = 'R$ #,##0.00';
    }
    ws.addRow([]);

    ws.addRow(['Quantidade de lançamentos por tipo']).font = { bold: true };
    const cab3 = ws.addRow(['Tipo', 'Quantidade']);
    this.estilizarCabecalho(cab3, 2);
    const porTipo = new Map<string, number>();
    for (const l of lancamentos) porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? 0) + 1);
    for (const [tipo, qtd] of porTipo.entries()) ws.addRow([tipo, qtd]);

    ws.columns.forEach((col) => (col.width = 20));
  }

  private estilizarCabecalho(row: ExcelJS.Row, numColunas: number) {
    for (let i = 1; i <= numColunas; i++) {
      const cell = row.getCell(i);
      cell.font = { bold: true, color: { argb: COR_TEXTO_CABECALHO } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } };
    }
  }

  // ---------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------
  //
  // Usa `pdf-lib` (não `pdfkit`) DE PROPÓSITO: `pdfkit` depende de
  // `fontkit`, que chama `new TextDecoder('ascii')` no carregamento do
  // módulo — isso derruba o processo INTEIRO quando empacotado pelo `pkg`
  // (`RangeError: The "ascii" encoding is not supported`, ICU reduzida do
  // Node embutido no `pkg`). `pdf-lib`, usando só as 14 fontes padrão do
  // PDF (sem incorporar fonte customizada), nunca carrega `fontkit` —
  // testado dentro do executável empacotado antes de entrar na versão
  // final.

  async gerarPdf(
    lancamentos: LancamentoPersistido[],
    nomeEmpresa: string,
    cnpj: string | undefined,
    anoInicio: number,
    anoFim: number,
  ): Promise<Buffer> {
    const projecaoAnual = this.projecaoService.projetar(lancamentos, anoInicio, anoFim);

    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([595.28, 841.89]); // A4 em pontos
    let y = 792;

    const novaPaginaSeNecessario = (alturaNecessaria: number) => {
      if (y - alturaNecessaria < 60) {
        page = doc.addPage([595.28, 841.89]);
        y = 792;
      }
    };

    y = this.escreverCabecalhoPdf(page, fonte, fonteNegrito, y, nomeEmpresa, cnpj, lancamentos.length);
    y = this.escreverResumoExecutivoPdf(page, fonte, fonteNegrito, y, projecaoAnual, anoInicio, anoFim);
    novaPaginaSeNecessario(200);
    y = this.escreverGraficoBarrasPdf(page, fonte, fonteNegrito, y, projecaoAnual);
    novaPaginaSeNecessario(200);
    y = this.escreverTabelaResumoPdf(page, fonte, fonteNegrito, y, projecaoAnual);

    const cargaTributariaTotal = this.projecaoService.projetarCargaTributariaTotal(lancamentos, anoInicio, anoFim);
    const temTributosAntigos = cargaTributariaTotal.some((c) => c.saldoTotalTributosSubstituidos.abs().greaterThan(0));
    if (temTributosAntigos) {
      novaPaginaSeNecessario(200);
      y = this.escreverCargaTributariaTotalPdf(page, fonte, fonteNegrito, y, cargaTributariaTotal);
    }

    novaPaginaSeNecessario(150);
    y = this.escreverParecerPdf(page, fonte, fonteNegrito, y, projecaoAnual, anoInicio, anoFim);

    this.escreverRodapePdf(page, fonte);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  private escreverCargaTributariaTotalPdf(page: PDFPage, fonte: PDFFont, fonteNegrito: PDFFont, y: number, carga: import('../apuracao/projecao-anual.service').CargaTributariaTotalAnual[]): number {
    page.drawText('Carga tributária total (PIS, COFINS, ICMS, ISS, IPI + IBS/CBS)', { x: 50, y, size: 13, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 20;

    const nota =
      'Inclui os tributos do sistema atual informados nos lançamentos, aplicando o cronograma de extinção/redução ' +
      'da reforma (PIS/COFINS extintos em 2027; ICMS/ISS reduzidos gradualmente de 2029 a 2032 e extintos em 2033; ' +
      'IPI zerado a partir de 2027, exceto Zona Franca de Manaus), somados ao IBS/CBS já projetado.';
    y = this.desenharParagrafo(page, fonte, nota, 50, y, 8, 495, this.cor('#6b7280'));
    y -= 10;

    const colX = [50, 105, 165, 225, 285, 345, 410];
    const cabecalho = ['Ano', 'PIS', 'COFINS', 'ICMS', 'ISS', 'IPI', 'TOTAL GERAL'];
    page.drawRectangle({ x: 50, y: y - 13, width: 495, height: 18, color: this.cor('#1a4d8f') });
    cabecalho.forEach((texto, i) => page.drawText(texto, { x: colX[i], y: y - 8, size: 8, font: fonteNegrito, color: rgb(1, 1, 1) }));
    y -= 18;

    for (const c of carga) {
      page.drawRectangle({ x: 50, y: y - 12, width: 495, height: 16, color: c.ano % 2 === 0 ? this.cor('#f3f4f6') : rgb(1, 1, 1) });
      const valores = [String(c.ano), this.formatarMoedaTexto(c.pis.saldo), this.formatarMoedaTexto(c.cofins.saldo), this.formatarMoedaTexto(c.icms.saldo), this.formatarMoedaTexto(c.iss.saldo), this.formatarMoedaTexto(c.ipi.saldo), this.formatarMoedaTexto(c.saldoTotalGeral)];
      valores.forEach((texto, i) => page.drawText(texto, { x: colX[i], y: y - 8, size: 8, font: i === 6 ? fonteNegrito : fonte, color: this.cor('#374151') }));
      y -= 16;
    }
    return y - 15;
  }

  private cor(hex: string): RGB {
    const n = parseInt(hex.replace('#', ''), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  /** Quebra um texto em linhas que cabem em `larguraMax`, para desenhar parágrafo por parágrafo com `page.drawText`. */
  private quebrarLinhas(texto: string, fonte: PDFFont, tamanho: number, larguraMax: number): string[] {
    const palavras = texto.split(' ');
    const linhas: string[] = [];
    let linhaAtual = '';
    for (const palavra of palavras) {
      const tentativa = linhaAtual ? linhaAtual + ' ' + palavra : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) > larguraMax && linhaAtual) {
        linhas.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        linhaAtual = tentativa;
      }
    }
    if (linhaAtual) linhas.push(linhaAtual);
    return linhas;
  }

  private desenharParagrafo(page: PDFPage, fonte: PDFFont, texto: string, x: number, y: number, tamanho: number, largura: number, corTexto: RGB): number {
    const linhas = this.quebrarLinhas(texto, fonte, tamanho, largura);
    let yAtual = y;
    for (const linha of linhas) {
      page.drawText(linha, { x, y: yAtual, size: tamanho, font: fonte, color: corTexto });
      yAtual -= tamanho * 1.4;
    }
    return yAtual;
  }

  private escreverCabecalhoPdf(
    page: PDFPage,
    fonte: PDFFont,
    fonteNegrito: PDFFont,
    y: number,
    nomeEmpresa: string,
    cnpj: string | undefined,
    totalLancamentos: number,
  ): number {
    page.drawText('Relatório de Projeção Tributária IBS/CBS', { x: 50, y, size: 18, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 24;
    page.drawText(nomeEmpresa + (cnpj ? ` — CNPJ ${cnpj}` : ''), { x: 50, y, size: 11, font: fonte, color: this.cor('#333333') });
    y -= 15;
    page.drawText(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${totalLancamentos} lançamento(s) considerado(s)`, {
      x: 50,
      y,
      size: 9,
      font: fonte,
      color: this.cor('#6b7280'),
    });
    y -= 14;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: this.cor('#e5e7eb') });
    return y - 20;
  }

  private escreverResumoExecutivoPdf(page: PDFPage, fonte: PDFFont, fonteNegrito: PDFFont, y: number, projecaoAnual: ProjecaoAnual[], anoInicio: number, anoFim: number): number {
    const atual = projecaoAnual[0];
    const final = projecaoAnual[projecaoAnual.length - 1];

    page.drawText('Resumo executivo', { x: 50, y, size: 13, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 20;

    const situacaoTexto = (s: ProjecaoAnual['situacao']) => (s === 'DEVEDOR' ? 'devedora' : s === 'CREDOR' ? 'credora' : 'neutra');

    const texto =
      `Considerando os lançamentos informados, em ${anoInicio} a empresa fica em situação ${situacaoTexto(atual.situacao)}, ` +
      `com saldo de R$ ${this.formatarMoedaTexto(atual.saldoTotal.abs())}. Projetando a mesma base de operações até ${anoFim} ` +
      `(alíquota plena do cronograma de transição da reforma), a situação projetada é ${situacaoTexto(final.situacao)}, ` +
      `com saldo de R$ ${this.formatarMoedaTexto(final.saldoTotal.abs())}.`;

    y = this.desenharParagrafo(page, fonte, texto, 50, y, 10, 495, this.cor('#333333'));
    return y - 15;
  }

  private escreverGraficoBarrasPdf(page: PDFPage, fonte: PDFFont, fonteNegrito: PDFFont, y: number, projecaoAnual: ProjecaoAnual[]): number {
    page.drawText('Evolução do saldo por ano', { x: 50, y, size: 13, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 25;

    const areaX = 60;
    const areaTopo = y;
    const areaLargura = 460;
    const areaAltura = 160;
    const numBarras = projecaoAnual.length;
    const espacamento = 12;
    const larguraBarra = (areaLargura - espacamento * (numBarras - 1)) / numBarras;

    const maiorAbsoluto = Math.max(...projecaoAnual.map((p) => Math.abs(p.saldoTotal.toNumber())), 1);
    const linhaZero = areaTopo - areaAltura / 2;

    page.drawLine({ start: { x: areaX, y: linhaZero }, end: { x: areaX + areaLargura, y: linhaZero }, thickness: 1, color: this.cor('#d1d5db') });

    projecaoAnual.forEach((p, i) => {
      const x = areaX + i * (larguraBarra + espacamento);
      const alturaBarra = (Math.abs(p.saldoTotal.toNumber()) / maiorAbsoluto) * (areaAltura / 2 - 10);
      const devedor = p.situacao === 'DEVEDOR';
      const yBarra = devedor ? linhaZero : linhaZero - alturaBarra;
      const corBarra = devedor ? this.cor('#b3261e') : p.situacao === 'CREDOR' ? this.cor('#1e7e34') : this.cor('#9ca3af');
      page.drawRectangle({ x, y: yBarra, width: larguraBarra, height: Math.max(alturaBarra, 1), color: corBarra });

      const rotulo = String(p.ano);
      const larguraRotulo = fonte.widthOfTextAtSize(rotulo, 7);
      page.drawText(rotulo, { x: x + (larguraBarra - larguraRotulo) / 2, y: linhaZero - areaAltura / 2 - 2, size: 7, font: fonte, color: this.cor('#374151') });
    });

    y = areaTopo - areaAltura - 25;
    page.drawText('Barras vermelhas: saldo devedor. Barras verdes: saldo credor.', { x: 50, y, size: 8, font: fonte, color: this.cor('#6b7280') });
    return y - 15;
  }

  private escreverTabelaResumoPdf(page: PDFPage, fonte: PDFFont, fonteNegrito: PDFFont, y: number, projecaoAnual: ProjecaoAnual[]): number {
    page.drawText('Saldo apurado por ano', { x: 50, y, size: 13, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 20;

    const colX = [55, 130, 260];
    page.drawRectangle({ x: 50, y: y - 13, width: 495, height: 18, color: this.cor('#1a4d8f') });
    ['Ano', 'Saldo Total (R$)', 'Situação'].forEach((texto, i) =>
      page.drawText(texto, { x: colX[i], y: y - 8, size: 9, font: fonteNegrito, color: rgb(1, 1, 1) }),
    );
    y -= 18;

    for (const p of projecaoAnual) {
      page.drawRectangle({ x: 50, y: y - 12, width: 495, height: 16, color: p.ano % 2 === 0 ? this.cor('#f3f4f6') : rgb(1, 1, 1) });
      page.drawText(String(p.ano), { x: colX[0], y: y - 8, size: 9, font: fonte, color: this.cor('#374151') });
      page.drawText('R$ ' + this.formatarMoedaTexto(p.saldoTotal.abs()), { x: colX[1], y: y - 8, size: 9, font: fonte, color: this.cor('#374151') });
      const corSituacao = p.situacao === 'DEVEDOR' ? this.cor('#b3261e') : p.situacao === 'CREDOR' ? this.cor('#1e7e34') : this.cor('#6b7280');
      page.drawText(p.situacao === 'DEVEDOR' ? 'Devedor' : p.situacao === 'CREDOR' ? 'Credor' : 'Neutro', { x: colX[2], y: y - 8, size: 9, font: fonte, color: corSituacao });
      y -= 16;
    }
    return y - 15;
  }

  private escreverParecerPdf(page: PDFPage, fonte: PDFFont, fonteNegrito: PDFFont, y: number, projecaoAnual: ProjecaoAnual[], anoInicio: number, anoFim: number): number {
    page.drawText('Leitura da projeção', { x: 50, y, size: 13, font: fonteNegrito, color: this.cor('#1a4d8f') });
    y -= 20;

    const primeiro = projecaoAnual[0];
    const ultimo = projecaoAnual[projecaoAnual.length - 1];
    const diferenca = ultimo.saldoTotal.minus(primeiro.saldoTotal);
    const variacaoTexto = diferenca.greaterThan(0)
      ? `um AUMENTO de R$ ${this.formatarMoedaTexto(diferenca.abs())} no saldo`
      : diferenca.lessThan(0)
        ? `uma REDUÇÃO de R$ ${this.formatarMoedaTexto(diferenca.abs())} no saldo`
        : 'nenhuma variação relevante no saldo';

    const passaPorCredor = projecaoAnual.some((p) => p.situacao === 'CREDOR');

    const texto =
      `Entre ${anoInicio} e ${anoFim}, mantidas as mesmas operações informadas, a projeção indica ${variacaoTexto} — ` +
      'reflexo direto do cronograma de transição da reforma tributária (as alíquotas de referência do IBS e da CBS ' +
      'sobem gradualmente até atingirem o patamar pleno).' +
      (passaPorCredor
        ? ' Em pelo menos um dos anos projetados a empresa fica em situação de saldo CREDOR — vale planejar o fluxo de caixa considerando esse crédito acumulado.'
        : ' Em todos os anos projetados a empresa permanece em situação devedora.');

    y = this.desenharParagrafo(page, fonte, texto, 50, y, 10, 495, this.cor('#333333'));
    y -= 15;

    const aviso =
      'Esta leitura é gerada automaticamente a partir dos lançamentos informados no sistema e do cronograma de ' +
      'transição da LC 214/2025 — não constitui parecer contábil ou tributário profissional. Para uma análise ' +
      'definitiva, consulte um contador ou tributarista.';
    y = this.desenharParagrafo(page, fonte, aviso, 50, y, 8, 495, this.cor('#9ca3af'));
    return y;
  }

  private escreverRodapePdf(page: PDFPage, fonte: PDFFont) {
    const texto =
      'Tax Engine IBS/CBS/IS — cálculo baseado na LC 214/2025 e EC 132/2023. Alguns percentuais e mecânicas de ' +
      'cálculo ainda dependem de regulamentação complementar não publicada em sua totalidade — consulte o sistema ' +
      'para a lista de pendências vigente na data de geração deste relatório.';
    const linhas = this.quebrarLinhas(texto, fonte, 8, 495);
    let y = 55;
    for (const linha of linhas) {
      const largura = fonte.widthOfTextAtSize(linha, 8);
      page.drawText(linha, { x: 50 + (495 - largura) / 2, y, size: 8, font: fonte, color: this.cor('#9ca3af') });
      y -= 11;
    }
  }

  private formatarMoedaTexto(valor: Decimal): string {
    return valor.toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
