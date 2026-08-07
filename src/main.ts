import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BeneficiosService } from './tax-engine/beneficios/beneficios.service';
import { ImportadorConformidadeFacilService } from './tax-engine/beneficios/importador-conformidade-facil';
import { ParametrizacaoService } from './tax-engine/parametrizacao/parametrizacao.service';

/**
 * Bootstrap da aplicação Tax Engine.
 *
 * Serve tanto a API REST (endpoints `/operacoes`, `/beneficios`,
 * `/apuracao`, `/dashboard`, status em `/api/status`) quanto a interface
 * web (formulário de preenchimento para cálculo, consulta de benefícios,
 * apuração e dashboards) na raiz — acessível em `http://localhost:3000`,
 * servida por `FrontendController` (ver `tax-engine/http/frontend.controller.ts`).
 *
 * O cadastro de benefícios é hidratado com a base real do Conformidade
 * Fácil (ENCAT/SVRS-RS) empacotada em `assets/beneficios-conformidade-facil.json`
 * — ~2.281 códigos NCM/NBS reais, em vez do `SEED_BENEFICIOS` ilustrativo
 * de 3 itens usado nas Fases 1-4. Para conectar a um banco real (Prisma)
 * no lugar deste JSON estático:
 * ```ts
 * const beneficiosService = app.get(BeneficiosService);
 * const repo = app.get(BeneficioPrismaRepository);
 * beneficiosService.hidratarCadastro(await repo.listarVigentes());
 * ```
 * ou, para reaproveitar o sistema NCM/NBS já existente do usuário, usar
 * `ImportadorNcmNbsService.converter(...)` no lugar do repositório Prisma.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  try {
    const beneficiosService = app.get(BeneficiosService);
    const importador = app.get(ImportadorConformidadeFacilService);
    beneficiosService.hidratarCadastro(importador.carregarDoAsset());
  } catch (erro) {
    // Se o asset não puder ser lido por qualquer motivo, o sistema segue
    // no ar com o SEED_BENEFICIOS ilustrativo padrão em vez de derrubar
    // a aplicação — melhor funcionar com dados reduzidos do que não
    // funcionar.
    console.warn('Não foi possível carregar a base de benefícios do Conformidade Fácil — usando o cadastro ilustrativo padrão.', erro);
  }

  try {
    app.get(ParametrizacaoService).carregarDoDisco();
  } catch (erro) {
    console.warn('Não foi possível carregar a parametrização salva — usando as alíquotas de referência padrão (CBS 10% / IBS 18%).', erro);
  }

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

bootstrap();
