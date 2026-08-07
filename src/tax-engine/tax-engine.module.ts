import { Module } from '@nestjs/common';
import { BaseCalculoService } from './base-calculo/base-calculo.service';
import { BeneficiosService } from './beneficios/beneficios.service';
import { CreditoService } from './credito/credito.service';
import { RegimeStrategyFactory } from './regimes/regime-strategy.factory';
import { AuditoriaService } from './auditoria/auditoria.service';
import { DebitoService } from './debito/debito.service';
import { AjustesService } from './ajustes/ajustes.service';
import { ResponsabilidadeTributariaService } from './operacoes-especiais/responsabilidade-tributaria.service';
import { SplitPaymentService } from './split-payment/split-payment.service';
import { ImpostoSeletivoService } from './imposto-seletivo/imposto-seletivo.service';
import { CashbackService } from './cashback/cashback.service';
import { ApuracaoMensalService } from './apuracao/apuracao-mensal.service';
import { ProjecaoAnualService } from './apuracao/projecao-anual.service';
import { DashboardService } from './dashboard/dashboard.service';
import { ImportadorNcmNbsService } from './integracao/importador-ncm-nbs.service';
import { ImportadorConformidadeFacilService } from './beneficios/importador-conformidade-facil';
import { OperacaoController } from './http/operacao.controller';
import { BeneficiosController } from './http/beneficios.controller';
import { ApuracaoController } from './http/apuracao.controller';
import { DashboardController } from './http/dashboard.controller';
import { FrontendController } from './http/frontend.controller';
import { EmpresaController } from './empresa/empresa.controller';
import { EmpresaService } from './empresa/empresa.service';
import { LancamentosController } from './lancamentos/lancamentos.controller';
import { LancamentosService } from './lancamentos/lancamentos.service';
import { ImportacaoPlanilhaController } from './importacao-planilha/importacao-planilha.controller';
import { ImportacaoPlanilhaService } from './importacao-planilha/importacao-planilha.service';
import { ParametrizacaoController } from './parametrizacao/parametrizacao.controller';
import { ParametrizacaoService } from './parametrizacao/parametrizacao.service';
import { AtivacaoController } from './ativacao/ativacao.controller';
import { AtivacaoService } from './ativacao/ativacao.service';
import { ConfigServidorService } from './ativacao/config-servidor.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AcessoGuard } from './auth/acesso.guard';
import { AtualizacaoController } from './atualizacao/atualizacao.controller';
import { AtualizacaoService } from './atualizacao/atualizacao.service';
import { ExportacaoController } from './exportacao/exportacao.controller';
import { ExportacaoService } from './exportacao/exportacao.service';

@Module({
  controllers: [
    FrontendController,
    OperacaoController,
    BeneficiosController,
    ApuracaoController,
    DashboardController,
    EmpresaController,
    LancamentosController,
    ImportacaoPlanilhaController,
    ExportacaoController,
    ParametrizacaoController,
    AtivacaoController,
    AuthController,
    AtualizacaoController,
  ],
  providers: [
    BaseCalculoService,
    BeneficiosService,
    CreditoService,
    RegimeStrategyFactory,
    AuditoriaService,
    ResponsabilidadeTributariaService,
    DebitoService,
    AjustesService,
    SplitPaymentService,
    ImpostoSeletivoService,
    CashbackService,
    ApuracaoMensalService,
    ProjecaoAnualService,
    DashboardService,
    ImportadorNcmNbsService,
    ImportadorConformidadeFacilService,
    EmpresaService,
    LancamentosService,
    ImportacaoPlanilhaService,
    ExportacaoService,
    ParametrizacaoService,
    AtivacaoService,
    AuthService,
    AcessoGuard,
    ConfigServidorService,
    AtualizacaoService,
  ],
  exports: [
    DebitoService,
    CreditoService,
    AuditoriaService,
    BeneficiosService,
    BaseCalculoService,
    AjustesService,
    ResponsabilidadeTributariaService,
    SplitPaymentService,
    ImpostoSeletivoService,
    CashbackService,
    ApuracaoMensalService,
    ProjecaoAnualService,
    DashboardService,
    ImportadorNcmNbsService,
    ImportadorConformidadeFacilService,
    EmpresaService,
    LancamentosService,
    ImportacaoPlanilhaService,
    ExportacaoService,
    ParametrizacaoService,
    AtivacaoService,
    AuthService,
  ],
})
export class TaxEngineModule {}
