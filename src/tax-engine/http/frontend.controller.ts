import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Serve a interface web (`public/index.html`) diretamente na raiz.
 *
 * Usa leitura manual do arquivo em vez de `express.static`/
 * `app.useStaticAssets()` porque o `express.static` depende de `fs.stat`
 * de um jeito que não funciona de forma confiável dentro do sistema de
 * arquivos virtual do `pkg` (empacotamento em executável standalone) —
 * `fs.readFileSync` é suportado nesse ambiente, então essa abordagem é a
 * que efetivamente funciona nos executáveis distribuídos.
 */
@Controller()
export class FrontendController {
  @Get()
  index(@Res() res: Response) {
    const caminho = join(__dirname, '..', '..', 'public', 'index.html');
    const html = readFileSync(caminho, 'utf-8');
    res.type('html').send(html);
  }
}
