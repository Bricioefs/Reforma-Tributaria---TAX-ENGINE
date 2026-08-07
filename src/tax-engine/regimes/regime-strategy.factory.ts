import { Injectable } from '@nestjs/common';
import { DadosOperacao, RegimeTributarioStrategy } from '../interfaces/tax-engine.interfaces';
import { RegimeCestaBasicaStrategy } from './strategies/regime-cesta-basica.strategy';
import { RegimePadraoStrategy } from './strategies/regime-padrao.strategy';
import { criarRegimesSetoriais } from './strategies/regime-reducao-setorial.strategy';
import { RegimeProdutorRuralStrategy } from './strategies/regime-produtor-rural.strategy';
import { RegimeCooperativaStrategy } from './strategies/regime-cooperativa.strategy';
import { RegimeCombustiveisStrategy } from './strategies/regime-combustiveis.strategy';
import { RegimeServicosFinanceirosStrategy } from './strategies/regime-servicos-financeiros.strategy';
import {
  RegimeBensImoveisStrategy,
  RegimeHotelariaBaresRestaurantesStrategy,
} from './strategies/regime-imoveis-hotelaria.strategy';
import {
  RegimeSimplesNacionalStrategy,
  RegimeZfmAlcStrategy,
  RegimeAdministracaoPublicaStrategy,
} from './strategies/regime-simples-zfm-adm-publica.strategy';
import { RegimeExportacaoStrategy } from '../operacoes-especiais/strategies/regime-exportacao.strategy';
import { RegimeImportacaoStrategy } from '../operacoes-especiais/strategies/regime-importacao.strategy';
import { RegimeCfopSemCreditoDebitoStrategy } from '../operacoes-especiais/strategies/regime-cfop-sem-credito-debito.strategy';
import {
  RegimeRemessaStrategy,
  RegimeRetornoStrategy,
  RegimeConsignacaoStrategy,
} from '../operacoes-especiais/strategies/regime-remessa-retorno-consignacao.strategy';
import { RegimeIndustrializacaoEncomendaStrategy } from '../operacoes-especiais/strategies/regime-industrializacao-encomenda.strategy';
import { RegimeBonificacaoAmostraStrategy } from '../operacoes-especiais/strategies/regime-bonificacao-amostra.strategy';

/**
 * Factory Pattern — resolve, para cada operação, qual RegimeTributarioStrategy
 * deve ser usada. Novos regimes são adicionados registrando uma nova
 * estratégia aqui — o núcleo do motor (DebitoService) nunca precisa mudar.
 *
 * ORDEM IMPORTA (precedência, do mais específico ao mais genérico):
 *   0. CFOP de mera movimentação, sem transferência de propriedade
 *      (remessa/retorno para conserto, industrialização por encomenda,
 *      demonstração, depósito, consignação) — verificado ANTES de tudo,
 *      inclusive de exportação/importação: um desses CFOPs ("3901") começa
 *      com o mesmo prefixo "3" usado para reconhecer importação — sem
 *      checar isso primeiro, uma remessa do exterior para industrialização
 *      (CFOP 3901) seria classificada por engano como importação de
 *      verdade, com valor calculado, em vez de corretamente zerada.
 *   1. Imunidade constitucional (administração pública, exportação) — nunca cede a outro regime.
 *   2. Situação do contribuinte (produtor rural não contribuinte, ato cooperativo interno).
 *   3. Opção do contribuinte (Simples Nacional híbrido).
 *   4. Regime territorial (ZFM/ALC).
 *   5. Natureza especial da operação (importação, remessa, retorno, consignação,
 *      industrialização por encomenda, bonificação/demonstração/amostra grátis).
 *   6. Regimes setoriais por produto/serviço (combustíveis, serviços financeiros,
 *      imóveis, hotelaria/bares/restaurantes, cesta básica, educação, saúde,
 *      transporte coletivo, planos de saúde).
 *   7. `RegimePadraoStrategy` — sempre o fallback final.
 *
 * PENDÊNCIA REGULAMENTAR: regimes ainda não implementados nesta fase —
 * concursos de prognósticos e sociedades profissionais — seguem como ponto
 * de extensão (registrar nova Strategy aqui) para uma fase futura, por
 * dependerem de regulamentação setorial ainda mais incipiente. Marketplace
 * e operações triangulares (Fase 3) não alteram o VALOR do tributo — são
 * tratadas por `ResponsabilidadeTributariaService`, que resolve apenas
 * quem recolhe.
 */
@Injectable()
export class RegimeStrategyFactory {
  private readonly estrategias: RegimeTributarioStrategy[];
  private readonly regimePadrao: RegimeTributarioStrategy;

  constructor() {
    // Alíquotas de referência resolvidas por ano dentro do próprio
    // RegimePadraoStrategy (ver cronograma-transicao.ts) — em produção,
    // substituir por AliquotaRepository (tabela `Aliquota`) assim que a
    // alíquota plena definitiva for publicada por Resolução do Senado.
    this.regimePadrao = new RegimePadraoStrategy();

    this.estrategias = [
      new RegimeCfopSemCreditoDebitoStrategy(),
      new RegimeAdministracaoPublicaStrategy(),
      new RegimeExportacaoStrategy(),
      new RegimeProdutorRuralStrategy(),
      new RegimeCooperativaStrategy(),
      new RegimeSimplesNacionalStrategy(),
      new RegimeZfmAlcStrategy(),
      new RegimeImportacaoStrategy(),
      new RegimeIndustrializacaoEncomendaStrategy(),
      new RegimeRemessaStrategy(),
      new RegimeRetornoStrategy(),
      new RegimeConsignacaoStrategy(),
      new RegimeBonificacaoAmostraStrategy(),
      new RegimeCombustiveisStrategy(),
      new RegimeServicosFinanceirosStrategy(),
      new RegimeBensImoveisStrategy(),
      new RegimeHotelariaBaresRestaurantesStrategy(),
      new RegimeCestaBasicaStrategy(),
      ...criarRegimesSetoriais(), // educação, saúde, transporte coletivo, planos de saúde
    ];
  }

  resolver(dados: DadosOperacao): RegimeTributarioStrategy {
    const especifica = this.estrategias.find((e) => e.aplicavel(dados));
    return especifica ?? this.regimePadrao;
  }

  /**
   * Retorna TODOS os regimes cuja `aplicavel()` casa com a operação, na
   * mesma ordem de precedência de `resolver()` — não só o primeiro. Usado
   * pela consulta de benefícios (`BeneficiosController`) para mostrar
   * TODAS as classificações possíveis de um NCM/NBS, já que o mesmo
   * código pode legitimamente casar com mais de um regime (ex: um NBS que
   * aparece tanto na lista de serviços financeiros quanto na de planos de
   * saúde, dependendo do contexto real da operação que o sistema não
   * consegue distinguir sozinho).
   *
   * O CÁLCULO real de uma operação (`resolver()`, usado por
   * `DebitoService.calcularOperacao`) continua escolhendo só UM regime —
   * o de maior precedência — porque uma nota fiscal precisa de um valor
   * definitivo; a ambiguidade só faz sentido ser exposta na consulta.
   */
  resolverTodos(dados: DadosOperacao): RegimeTributarioStrategy[] {
    const aplicaveis = this.estrategias.filter((e) => e.aplicavel(dados));
    return aplicaveis.length > 0 ? aplicaveis : [this.regimePadrao];
  }
}
