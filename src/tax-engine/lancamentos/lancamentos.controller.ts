import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { LancamentosService } from './lancamentos.service';

/**
 * `GET /lancamentos?cnpj=...`    — lista os lançamentos salvos da empresa (ou "sem empresa" se cnpj não informado).
 * `GET /lancamentos/competencia?cnpj=...&competencia=...` — lançamentos de uma empresa filtrados por competência (YYYY-MM).
 * `POST /lancamentos`            — salva um novo lançamento (corpo inclui `cnpj` e `competencia`).
 * `DELETE /lancamentos?cnpj=...` — limpa os lançamentos salvos daquela empresa (ou "sem empresa").
 */
@Controller('lancamentos')
export class LancamentosController {
  constructor(private readonly lancamentosService: LancamentosService) {}

  @Get()
  listar(@Query('cnpj') cnpj?: string) {
    return this.lancamentosService.listar(cnpj);
  }

  @Get('competencia')
  listarPorCompetencia(@Query('cnpj') cnpj: string | undefined, @Query('competencia') competencia: string) {
    return this.lancamentosService.listarPorCompetencia(cnpj, competencia);
  }

  @Post()
  adicionar(@Body() corpo: { cnpj?: string; operacaoId: string; tipo: string; competencia: string; resultados: unknown[] }) {
    const { cnpj, ...lancamento } = corpo;
    return this.lancamentosService.adicionar(cnpj, lancamento as any);
  }

  @Delete()
  limpar(@Query('cnpj') cnpj?: string) {
    this.lancamentosService.limpar(cnpj);
    return { ok: true };
  }
}
