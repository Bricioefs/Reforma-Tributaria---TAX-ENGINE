import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AtivacaoService } from '../ativacao/ativacao.service';
import { AuthService } from './auth.service';

/**
 * Aplicado GLOBALMENTE (ver `main.ts`) — bloqueia toda chamada de API
 * até o sistema estar (1) ativado por chave E (2) com login feito nesta
 * sessão. Bloqueio de verdade no BACKEND, não só esconder a tela no
 * front-end: mesmo chamando a API diretamente (curl, Postman, etc.),
 * sem ativação/login válidos as chamadas são recusadas com 403.
 *
 * Rotas sempre liberadas (a lista abaixo): as de ativação e login em si
 * (senão ninguém conseguiria nem ativar/logar), o health-check, e a
 * página inicial (`GET /`) — que precisa carregar para o JAVASCRIPT
 * dela poder perguntar `/ativacao/status` e `/auth/status` e decidir o
 * que mostrar.
 */
@Injectable()
export class AcessoGuard implements CanActivate {
  private readonly PREFIXOS_LIBERADOS = ['/ativacao', '/auth', '/api/status'];

  constructor(
    private readonly ativacaoService: AtivacaoService,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const rota: string = req.originalUrl || req.url || '';
    const caminho = rota.split('?')[0];

    if (caminho === '/' || this.PREFIXOS_LIBERADOS.some((p) => caminho.startsWith(p))) {
      return true;
    }

    const status = this.ativacaoService.obterStatus();
    if (!status.ativado) {
      throw new ForbiddenException(status.motivoBloqueio || 'Sistema não ativado — insira uma chave de ativação válida.');
    }

    if (!this.authService.estaLogado()) {
      throw new ForbiddenException('Faça login para continuar.');
    }

    return true;
  }
}
