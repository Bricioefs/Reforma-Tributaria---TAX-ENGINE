import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * `GET /auth/status`     — se já existe usuário cadastrado, e se está logado nesta sessão.
 * `POST /auth/cadastrar` — cria o único usuário desta instalação (corpo: `{ usuario, senha }`); só funciona uma vez.
 * `POST /auth/login`     — autentica (corpo: `{ usuario, senha }`).
 * `POST /auth/logout`    — encerra a sessão atual.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('status')
  status() {
    return {
      temUsuarioCadastrado: this.authService.temUsuarioCadastrado(),
      logado: this.authService.estaLogado(),
    };
  }

  @Post('cadastrar')
  cadastrar(@Body() corpo: { usuario: string; senha: string }) {
    return this.authService.cadastrar(corpo?.usuario, corpo?.senha);
  }

  @Post('login')
  login(@Body() corpo: { usuario: string; senha: string }) {
    return this.authService.login(corpo?.usuario, corpo?.senha);
  }

  @Post('logout')
  logout() {
    this.authService.logout();
    return { sucesso: true };
  }
}
