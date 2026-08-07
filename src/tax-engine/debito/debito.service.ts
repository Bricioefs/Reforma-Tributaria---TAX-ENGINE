import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DadosOperacao, ResultadoDebito } from '../interfaces/tax-engine.interfaces';
import { BaseCalculoService } from '../base-calculo/base-calculo.service';
import { BeneficiosService } from '../beneficios/beneficios.service';
import { RegimeStrategyFactory } from '../regimes/regime-strategy.factory';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ResponsabilidadeTributariaService } from '../operacoes-especiais/responsabilidade-tributaria.service';

/**
 * Motor de Débito — orquestrador central do Tax Engine.
 *
 * Fluxo (por operação):
 *   1. Motor de Base de Cálculo resolve a base "por fora" de IBS/CBS.
 *   2. Motor de Benefícios localiza automaticamente benefícios aplicáveis
 *      (NCM/NBS/CEST/CFOP/CNAE/UF/Município/tipo/destinação/finalidade).
 *   3. Regime Strategy Factory resolve a estratégia de cálculo do regime
 *      aplicável (padrão, diferenciado/específico, ou operação especial).
 *   4. A estratégia calcula os débitos finais, já considerando benefícios.
 *   5. Cada resultado gera um registro de auditoria/memória de cálculo.
 *   6. Se a operação envolve marketplace ou triangulação, a responsabilidade
 *      pelo recolhimento é resolvida e também registrada na auditoria.
 *
 * Este é o ponto único de entrada do motor tributário para cálculo de uma
 * operação — mantém o núcleo estável mesmo quando novos regimes/benefícios
 * são adicionados (Strategy + Factory absorvem a variação). Eventos
 * POSTERIORES à operação (devolução, cancelamento, complemento de preço,
 * desconto condicional) não passam por aqui — ver `AjustesService`.
 */
@Injectable()
export class DebitoService {
  constructor(
    private readonly baseCalculo: BaseCalculoService,
    private readonly beneficios: BeneficiosService,
    private readonly regimeFactory: RegimeStrategyFactory,
    private readonly auditoria: AuditoriaService,
    private readonly responsabilidadeTributaria: ResponsabilidadeTributariaService,
  ) {}

  /**
   * Resolve os débitos de uma operação (base + benefícios + regime) SEM
   * registrar nada na auditoria — usado pelo cálculo real
   * (`calcularOperacao`, que registra em seguida) e também pela consulta
   * de benefícios (`BeneficiosController`), que precisa do mesmo resultado
   * de resolução de regime para não divergir do cálculo real, mas não deve
   * gerar registro de auditoria/dashboard para uma simples consulta.
   *
   * Isso corrige uma classe de bug: regimes diferenciados baseados em NBS
   * (transporte coletivo, planos de saúde, serviços financeiros, bens
   * imóveis, hotelaria — ver `regimes/codigos-nbs-reais.ts`) são
   * reconhecidos automaticamente aqui, porque o mesmo `RegimeStrategyFactory`
   * usado no cálculo real é reaproveitado — antes, a consulta só verificava
   * `BeneficiosService.cadastro` (que só tem NCM, vindo da base do
   * Conformidade Fácil — zero entradas de NBS), então uma consulta por NBS
   * nunca encontrava esses regimes, mesmo eles sendo corretamente
   * aplicados no cálculo de verdade.
   */
  resolverSemAuditoria(dados: DadosOperacao): ResultadoDebito[] {
    const bases = this.baseCalculo.calcularBaseIbsCbs(dados);
    const beneficiosAplicaveis = this.beneficios.localizarBeneficiosAplicaveis(dados);
    const regime = this.regimeFactory.resolver(dados);
    return regime.calcular(dados, bases, beneficiosAplicaveis);
  }

  /**
   * Igual a `resolverSemAuditoria()`, mas calcula com TODOS os regimes que
   * casam com a operação (`RegimeStrategyFactory.resolverTodos()`), não só
   * o de maior precedência — usado pela consulta de benefícios para
   * mostrar mais de uma tributação possível quando o mesmo NCM/NBS se
   * encaixa em mais de um regime (situação real: alguns NBS aparecem em
   * mais de um grupo da base oficial, dependendo do contexto da operação
   * que o sistema não tem como distinguir sozinho).
   *
   * Retorna um resultado por regime aplicável — cada um com sua própria
   * `beneficiosAplicados`. NÃO usado para o cálculo real de uma operação
   * (que precisa de um valor definitivo, único) — só para a consulta.
   */
  resolverTodosOsRegimesSemAuditoria(dados: DadosOperacao): ResultadoDebito[][] {
    const bases = this.baseCalculo.calcularBaseIbsCbs(dados);
    const beneficiosAplicaveis = this.beneficios.localizarBeneficiosAplicaveis(dados);
    const regimes = this.regimeFactory.resolverTodos(dados);
    return regimes.map((regime) => regime.calcular(dados, bases, beneficiosAplicaveis));
  }

  calcularOperacao(dados: DadosOperacao): ResultadoDebito[] {
    const resultados = this.resolverSemAuditoria(dados);

    for (const r of resultados) {
      this.auditoria.registrar(dados.operacaoId, { ...r.memoria, dataOperacao: dados.dataOperacao });
    }

    const responsabilidade = this.responsabilidadeTributaria.resolver(dados);
    if (responsabilidade) {
      this.auditoria.registrar(dados.operacaoId, {
        regraAplicada: 'ResponsabilidadeTributariaService.resolver',
        baseLegal: responsabilidade.baseLegal,
        parametrosUsados: {
          responsavelPeloRecolhimento: responsabilidade.responsavelPeloRecolhimento,
          detalhe: responsabilidade.detalhe,
        },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: resultados[0].baseCalculo,
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      });
    }

    return resultados;
  }
}
