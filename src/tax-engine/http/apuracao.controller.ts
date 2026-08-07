import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ApuracaoMensalService, ApuracaoMensalResultado } from '../apuracao/apuracao-mensal.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ResultadoDebito } from '../interfaces/tax-engine.interfaces';
import { CreditoApurado, CreditoService } from '../credito/credito.service';
import { lerJson, escreverJson } from '../persistencia/armazenamento-arquivo.util';
import { LancamentosService, LancamentoPersistido } from '../lancamentos/lancamentos.service';
import { ProjecaoAnualService } from '../apuracao/projecao-anual.service';
import { ehLancamentoDeEntrada } from '../lancamentos/classificacao-lancamento';

interface ApurarPeriodoDto {
  debitos: ResultadoDebito[];
  creditos: CreditoApurado[];
  saldoCredorTransportadoAnterior?: string;
}

const ARQUIVO_APURACOES = 'apuracoes.json';

/**
 * `POST /apuracao/:estabelecimentoId/:competencia`             — apura o período (débitos/créditos informados no corpo).
 * `POST /apuracao/:estabelecimentoId/:competencia/tempo-real`  — apura automaticamente, agregando TODOS os
 *                                                                  lançamentos salvos daquela empresa+competência
 *                                                                  (sem precisar colar JSON manualmente) — chamado
 *                                                                  pela interface web a cada novo lançamento.
 *                                                                  Lançamentos de ENTRADA (compra/importação) viram
 *                                                                  crédito automaticamente; os demais viram débito.
 * `GET  /apuracao/:estabelecimentoId/:competencia/classificacao` — prévia (sem persistir) dos débitos/créditos
 *                                                                  já classificados, para preencher os campos
 *                                                                  manuais da interface web.
 * `POST /apuracao/:estabelecimentoId/:competencia/fechamento`  — fecha o período (imutável).
 * `GET  /apuracao/historico/:operacaoId`                        — memória de cálculo de uma operação.
 *
 * As apurações ficam salvas em `dados/apuracoes.json` (ver
 * `armazenamento-arquivo.util.ts`) — sobrevivem a fechar o programa. Uma
 * apuração já FECHADA nunca é sobrescrita automaticamente (nem pela
 * atualização em tempo real, nem por um novo POST manual) — o período
 * fechado permanece congelado, e o retorno reflete o estado fechado atual.
 */
@Controller('apuracao')
export class ApuracaoController {
  private readonly apuracoes: Map<string, ApuracaoMensalResultado>;

  constructor(
    private readonly apuracaoService: ApuracaoMensalService,
    private readonly auditoriaService: AuditoriaService,
    private readonly lancamentosService: LancamentosService,
    private readonly projecaoAnualService: ProjecaoAnualService,
    private readonly creditoService: CreditoService,
  ) {
    const salvas = lerJson<Array<[string, ApuracaoMensalResultado]>>(ARQUIVO_APURACOES, []);
    this.apuracoes = new Map(salvas);
  }

  @Post(':estabelecimentoId/:competencia')
  apurar(
    @Param('estabelecimentoId') estabelecimentoId: string,
    @Param('competencia') competencia: string,
    @Body() dto: ApurarPeriodoDto,
  ) {
    const chave = this.chave(estabelecimentoId, competencia);
    const existente = this.apuracoes.get(chave);
    if (existente?.status === 'FECHADA') {
      // período fechado é imutável — não recalcula nem sobrescreve, só
      // devolve o estado congelado atual.
      return existente;
    }

    const resultado = this.apuracaoService.apurar(
      estabelecimentoId,
      competencia,
      dto.debitos,
      dto.creditos,
      dto.saldoCredorTransportadoAnterior ? new Decimal(dto.saldoCredorTransportadoAnterior) : undefined,
    );
    this.apuracoes.set(chave, resultado);
    this.persistir();
    return resultado;
  }

  /**
   * Apuração automática em tempo real: agrega todos os lançamentos já
   * salvos (via `LancamentosService`) para a empresa e competência
   * informadas, e apura direto — sem precisar que o cliente monte/cole o
   * JSON de débitos manualmente. Idempotente: chamar de novo após cada
   * lançamento simplesmente recalcula com o conjunto atualizado.
   */
  @Post(':estabelecimentoId/:competencia/tempo-real')
  apurarTempoReal(@Param('estabelecimentoId') estabelecimentoId: string, @Param('competencia') competencia: string) {
    const { debitos, creditos } = this.classificarLancamentos(estabelecimentoId, competencia);
    return this.apurar(estabelecimentoId, competencia, { debitos, creditos });
  }

  /**
   * Prévia (sem persistir) dos débitos/créditos já classificados a partir
   * dos lançamentos salvos — usado pela interface web para preencher os
   * campos manuais da aba de apuração sem duplicar a lógica de
   * classificação entrada/saída no front-end.
   */
  @Get(':estabelecimentoId/:competencia/classificacao')
  classificacao(@Param('estabelecimentoId') estabelecimentoId: string, @Param('competencia') competencia: string) {
    return this.classificarLancamentos(estabelecimentoId, competencia);
  }

  @Post(':estabelecimentoId/:competencia/fechamento')
  fechar(@Param('estabelecimentoId') estabelecimentoId: string, @Param('competencia') competencia: string) {
    const existente = this.apuracoes.get(this.chave(estabelecimentoId, competencia));
    if (!existente) {
      return { erro: `Apuração ${competencia} para ${estabelecimentoId} não encontrada — apure o período antes de fechar.` };
    }
    try {
      const fechada = this.apuracaoService.fechar(existente);
      this.apuracoes.set(this.chave(estabelecimentoId, competencia), fechada);
      this.persistir();
      return fechada;
    } catch (e) {
      return { erro: (e as Error).message };
    }
  }

  @Get('historico/:operacaoId')
  historico(@Param('operacaoId') operacaoId: string) {
    return this.auditoriaService.obterMemoriaDaOperacao(operacaoId);
  }

  /**
   * `GET /apuracao/projecao?cnpj=...&anoInicio=2026&anoFim=2033`
   *
   * Projeta o total de IBS/CBS de TODOS os lançamentos já salvos daquela
   * empresa (qualquer competência) para cada ano do intervalo informado,
   * aplicando o cronograma de transição — sem precisar relançar nada.
   * Ver `ProjecaoAnualService` para a mecânica de escalonamento.
   */
  @Get('projecao')
  projecaoAnual(
    @Query('cnpj') cnpj: string | undefined,
    @Query('anoInicio') anoInicio?: string,
    @Query('anoFim') anoFim?: string,
  ) {
    const lancamentos = this.lancamentosService.listar(cnpj);
    return this.projecaoAnualService.projetar(
      lancamentos,
      anoInicio ? Number(anoInicio) : undefined,
      anoFim ? Number(anoFim) : undefined,
    );
  }

  /**
   * `GET /apuracao/projecao-carga-total?cnpj=...&anoInicio=2026&anoFim=2033`
   *
   * Projeta a CARGA TRIBUTÁRIA TOTAL ano a ano: os 5 tributos
   * substituídos pela reforma (PIS, COFINS, ICMS, ISS, IPI — a partir do
   * valor original informado em cada lançamento, aplicando o cronograma
   * de extinção/redução) somados ao IBS/CBS já projetado — a previsão
   * completa de tudo que a empresa pagaria em cada ano da transição até
   * 2033, não só o que a reforma introduz. Ver `ProjecaoAnualService.projetarCargaTributariaTotal()`.
   */
  @Get('projecao-carga-total')
  projecaoCargaTributariaTotal(
    @Query('cnpj') cnpj: string | undefined,
    @Query('anoInicio') anoInicio?: string,
    @Query('anoFim') anoFim?: string,
  ) {
    const lancamentos = this.lancamentosService.listar(cnpj);
    return this.projecaoAnualService.projetarCargaTributariaTotal(
      lancamentos,
      anoInicio ? Number(anoInicio) : undefined,
      anoFim ? Number(anoFim) : undefined,
    );
  }

  /**
   * Classifica os lançamentos de uma empresa+competência em débitos
   * (saídas) e créditos (entradas — compra/importação), usando
   * `CreditoService` para apurar o crédito de cada tributo destacado nas
   * entradas. Ponto único usado tanto pela apuração automática quanto
   * pela prévia manual — garante que as duas nunca divirjam entre si.
   */
  private classificarLancamentos(
    estabelecimentoId: string,
    competencia: string,
  ): { debitos: ResultadoDebito[]; creditos: CreditoApurado[] } {
    const lancamentos = this.lancamentosService.listarPorCompetencia(estabelecimentoId, competencia);
    const debitos: ResultadoDebito[] = [];
    const creditos: CreditoApurado[] = [];

    for (const l of lancamentos) {
      if (ehLancamentoDeEntrada(l.tipo)) {
        creditos.push(...this.gerarCreditosDoLancamento(l));
      } else {
        debitos.push(...l.resultados);
      }
    }

    return { debitos, creditos };
  }

  private gerarCreditosDoLancamento(lancamento: LancamentoPersistido): CreditoApurado[] {
    return lancamento.resultados
      .filter((r) => new Decimal(r.valor).greaterThan(0)) // sem crédito a apurar quando o valor destacado é zero
      .map((r) =>
        this.creditoService.apurarCredito({
          tipo: 'INTEGRAL',
          tributo: r.tributo === 'CBS' ? 'CBS' : 'IBS',
          valorDestacadoDocumento: new Decimal(r.valor),
          origemDocumento: lancamento.operacaoId,
        }),
      );
  }

  private chave(estabelecimentoId: string, competencia: string): string {
    return `${estabelecimentoId}:${competencia}`;
  }

  private persistir(): void {
    escreverJson(ARQUIVO_APURACOES, [...this.apuracoes.entries()]);
  }
}
