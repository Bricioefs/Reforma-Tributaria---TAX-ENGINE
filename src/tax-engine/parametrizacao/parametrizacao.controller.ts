import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ParametrizacaoService } from './parametrizacao.service';

/**
 * `GET /parametrizacao/aliquotas-plenas`    — alíquotas de referência atuais (CBS e IBS, em %).
 * `PUT /parametrizacao/aliquotas-plenas`    — altera as alíquotas de referência (corpo: `{ cbs: "10", ibs: "18" }`).
 * `POST /parametrizacao/aliquotas-plenas/restaurar-padrao` — volta para CBS 10% / IBS 18%.
 */
@Controller('parametrizacao')
export class ParametrizacaoController {
  constructor(private readonly parametrizacaoService: ParametrizacaoService) {}

  @Get('aliquotas-plenas')
  obter() {
    return this.parametrizacaoService.obterAliquotasPlenas();
  }

  @Put('aliquotas-plenas')
  definir(@Body() corpo: { cbs: string; ibs: string }) {
    return this.parametrizacaoService.definirAliquotasPlenas(corpo.cbs, corpo.ibs);
  }

  @Post('aliquotas-plenas/restaurar-padrao')
  restaurarPadrao() {
    return this.parametrizacaoService.restaurarPadrao();
  }
}
