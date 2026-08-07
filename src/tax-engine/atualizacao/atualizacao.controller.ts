import { Controller, Get } from '@nestjs/common';
import { AtualizacaoService } from './atualizacao.service';

/** `GET /atualizacao/verificar` — checa se há uma versão mais nova publicada no servidor de licenças (chamado uma vez pelo front-end depois do login). */
@Controller('atualizacao')
export class AtualizacaoController {
  constructor(private readonly atualizacaoService: AtualizacaoService) {}

  @Get('verificar')
  verificar() {
    return this.atualizacaoService.verificar();
  }
}
