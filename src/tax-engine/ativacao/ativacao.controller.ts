import { Body, Controller, Get, Post } from '@nestjs/common';
import { AtivacaoService } from './ativacao.service';

/**
 * `GET /ativacao/status`             — se este computador já está ativado (rápido, só local — usado pelo AcessoGuard).
 * `POST /ativacao/ativar`            — tenta ativar com uma chave (corpo: `{ chave: "AAAAA-BBBBB-CCCCC-DDDDD" }`) — confirma com o servidor de licenças, se configurado.
 * `POST /ativacao/revalidar-online`  — confirma com o servidor de licenças que a ativação atual ainda é válida (chamada uma vez por sessão pelo front-end, não em toda requisição).
 *
 * Estas rotas (junto com as de `/auth`) são as ÚNICAS liberadas sem
 * ativação/login — ver `AcessoGuard`, aplicado globalmente a todo o
 * resto da API.
 */
@Controller('ativacao')
export class AtivacaoController {
  constructor(private readonly ativacaoService: AtivacaoService) {}

  @Get('status')
  status() {
    return this.ativacaoService.obterStatus();
  }

  @Post('ativar')
  async ativar(@Body() corpo: { chave: string }) {
    return this.ativacaoService.ativar(corpo?.chave);
  }

  @Post('revalidar-online')
  async revalidarOnline() {
    await this.ativacaoService.revalidarOnline();
    return this.ativacaoService.obterStatus();
  }
}
