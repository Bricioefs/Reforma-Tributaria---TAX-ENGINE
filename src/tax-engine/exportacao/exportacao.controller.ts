import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportacaoService } from './exportacao.service';
import { LancamentosService } from '../lancamentos/lancamentos.service';

/**
 * `GET /exportacao/excel?cnpj=...&anoInicio=2026&anoFim=2033` — baixa uma
 * planilha .xlsx com 3 abas: Lançamentos (projetados ano a ano),
 * Apuração IBS-CBS (por ano) e Gráficos (tabelas prontas para gráfico).
 *
 * `GET /exportacao/pdf?cnpj=...&anoInicio=2026&anoFim=2033` — baixa um
 * relatório .pdf resumido com leitura automática da projeção até o ano
 * final e um gráfico de barras do saldo por ano.
 *
 * Ambos usam TODOS os lançamentos salvos da empresa (qualquer competência)
 * — a mesma fonte já usada pela aba "Apuração Anual" — então nunca
 * divergem do que a tela mostra.
 */
@Controller('exportacao')
export class ExportacaoController {
  constructor(
    private readonly exportacaoService: ExportacaoService,
    private readonly lancamentosService: LancamentosService,
  ) {}

  @Get('excel')
  async exportarExcel(
    @Res() res: Response,
    @Query('cnpj') cnpj?: string,
    @Query('nomeEmpresa') nomeEmpresa?: string,
    @Query('anoInicio') anoInicio = '2026',
    @Query('anoFim') anoFim = '2033',
  ) {
    const lancamentos = this.lancamentosService.listar(cnpj);
    const buffer = await this.exportacaoService.gerarExcel(lancamentos, nomeEmpresa || 'Empresa', Number(anoInicio), Number(anoFim));

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tax-engine-${cnpj || 'sem-empresa'}-${anoInicio}-${anoFim}.xlsx"`,
    });
    res.send(buffer);
  }

  @Get('pdf')
  async exportarPdf(
    @Res() res: Response,
    @Query('cnpj') cnpj?: string,
    @Query('nomeEmpresa') nomeEmpresa?: string,
    @Query('anoInicio') anoInicio = '2026',
    @Query('anoFim') anoFim = '2033',
  ) {
    const lancamentos = this.lancamentosService.listar(cnpj);
    const buffer = await this.exportacaoService.gerarPdf(lancamentos, nomeEmpresa || 'Empresa', cnpj, Number(anoInicio), Number(anoFim));

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tax-engine-${cnpj || 'sem-empresa'}-${anoInicio}-${anoFim}.pdf"`,
    });
    res.send(buffer);
  }
}
