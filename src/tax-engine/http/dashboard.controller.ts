import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from '../dashboard/dashboard.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { LancamentosService } from '../lancamentos/lancamentos.service';

/**
 * `GET /dashboard/beneficios-aplicados`  — base afetada por benefício fiscal.
 * `GET /dashboard/indicadores-por-regime` — contagem de operações por regime tributário aplicado.
 * `GET /dashboard/economia-por-beneficio` — economia em R$ gerada por cada benefício (alíquota de referência do ano vs. efetiva aplicada).
 * `GET /dashboard/total-por-tributo`      — total apurado, IBS vs CBS.
 * `GET /dashboard/evolucao-anual`         — total apurado por ano da operação (tendência ao longo do cronograma de transição).
 * `GET /dashboard/comparativo-simples-nacional?cnpj=...` — % das entradas (valor comprado) que vieram de fornecedores optantes pelo Simples Nacional, vs. demais empresas.
 * `GET /dashboard/operacao`               — memória de cálculo completa de uma operação específica.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly auditoriaService: AuditoriaService,
    private readonly lancamentosService: LancamentosService,
  ) {}

  @Get('beneficios-aplicados')
  beneficiosAplicados() {
    const memorias = this.auditoriaService.listarTodos().map((r) => r.memoria);
    return this.dashboardService.baseAfetadaPorBeneficio(memorias);
  }

  @Get('indicadores-por-regime')
  indicadoresPorRegime() {
    const memorias = this.auditoriaService.listarTodos().map((r) => r.memoria);
    return this.dashboardService.indicadoresPorRegime(memorias);
  }

  @Get('economia-por-beneficio')
  economiaPorBeneficio() {
    const memorias = this.auditoriaService.listarTodos().map((r) => r.memoria);
    return this.dashboardService.economiaGeradaPorBeneficios(memorias);
  }

  @Get('total-por-tributo')
  totalPorTributo() {
    const memorias = this.auditoriaService.listarTodos().map((r) => r.memoria);
    return this.dashboardService.totalPorTributo(memorias);
  }

  @Get('evolucao-anual')
  evolucaoAnual() {
    const memorias = this.auditoriaService.listarTodos().map((r) => r.memoria);
    return this.dashboardService.evolucaoAnualTotalApurado(memorias);
  }

  @Get('comparativo-simples-nacional')
  comparativoSimplesNacional(@Query('cnpj') cnpj?: string) {
    const lancamentos = this.lancamentosService.listar(cnpj);
    return this.dashboardService.comparativoEntradasSimplesNacional(lancamentos);
  }

  @Get('operacao')
  memoriaOperacao(@Query('operacaoId') operacaoId: string) {
    return this.auditoriaService.obterMemoriaDaOperacao(operacaoId);
  }
}
