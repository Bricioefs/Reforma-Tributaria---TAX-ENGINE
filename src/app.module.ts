import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TaxEngineModule } from './tax-engine/tax-engine.module';
import { AppController } from './app.controller';
import { AcessoGuard } from './tax-engine/auth/acesso.guard';

@Module({
  imports: [TaxEngineModule],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AcessoGuard }],
})
export class AppModule {}
