import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import Decimal from 'decimal.js';
import { ImportacaoPlanilhaService } from '../importacao-planilha/importacao-planilha.service';
import { DadosOperacao, BeneficioResolvido } from '../interfaces/tax-engine.interfaces';
import { DebitoService } from '../debito/debito.service';
import { BeneficiosService } from '../beneficios/beneficios.service';

interface ConsultaPlanilhaDto {
  cfop?: string;
  tipo?: DadosOperacao['tipo'];
}

/**
 * `GET /beneficios/consulta?ncm=...&nbs=...&cfop=...&tipo=VENDA&data=...`
 *
 * Consulta de benefícios aplicáveis a uma classificação fiscal, sem
 * necessariamente calcular uma operação completa — útil para telas de
 * cadastro de produto ("este NCM/NBS tem benefício?") e para o seu sistema
 * de apuração por NCM/NBS já existente consultar antes de decidir a
 * alíquota.
 *
 * Combina DUAS fontes para retornar TODOS os benefícios cadastrados para
 * a classificação informada — não só o de maior precedência:
 *
 * 1. `DebitoService.resolverTodosOsRegimesSemAuditoria()` — todo REGIME
 *    (Strategy dedicada) cujo `aplicavel()` casar com a operação (ex: um
 *    NBS que aparece tanto em serviços financeiros quanto em planos de
 *    saúde).
 * 2. `BeneficiosService.localizarTodosCandidatos()` — todo REGISTRO
 *    cadastrado que combine com o NCM/NBS, mesmo quando um regime
 *    dedicado já "venceu" a precedência e esconderia os demais no
 *    cálculo real. Isso cobre o caso de um NCM aparecer em mais de uma
 *    fonte de dados (ex: café aparece tanto na lista ilustrativa de
 *    cesta básica de uma Strategy dedicada quanto na base real do
 *    Conformidade Fácil, dentro do cadastro genérico) — sem essa segunda
 *    fonte, só o resultado da Strategy dedicada apareceria.
 *
 * As duas listas são combinadas e deduplicadas por código. O CÁLCULO real
 * de uma operação (`calcularOperacao`) continua escolhendo só UM
 * resultado definitivo — essa ambiguidade só faz sentido ser exposta na
 * consulta, onde cabe ao usuário escolher a classificação correta para o
 * contexto real da operação dele.
 *
 * `POST /beneficios/consulta-planilha` (multipart/form-data) — mesma
 * consulta, mas em LOTE: recebe uma planilha Excel com uma coluna
 * "NCM/NBS" (e opcionalmente "Descrição") e devolve, para cada código, os
 * benefícios encontrados — sem precisar digitar um NCM de cada vez.
 */
@Controller('beneficios')
export class BeneficiosController {
  constructor(
    private readonly debitoService: DebitoService,
    private readonly beneficiosService: BeneficiosService,
    private readonly importacaoService: ImportacaoPlanilhaService,
  ) {}

  @Get('consulta')
  consultar(
    @Query('ncm') ncm?: string,
    @Query('nbs') nbs?: string,
    @Query('cest') cest?: string,
    @Query('cfop') cfop = '5102',
    @Query('cnae') cnae?: string,
    @Query('tipo') tipo: DadosOperacao['tipo'] = 'VENDA',
    @Query('data') data?: string,
  ) {
    const dadosMinimos: DadosOperacao = {
      operacaoId: 'consulta-beneficio',
      tipo,
      ambito: 'INTERNA',
      ncm,
      nbs,
      cest,
      cfop,
      cst: '000',
      cnae,
      valorBruto: new Decimal(0),
      dataOperacao: data ? new Date(data) : new Date(),
    };

    return this.beneficiosDaOperacao(dadosMinimos);
  }

  @Post('consulta-planilha')
  @UseInterceptors(FileInterceptor('arquivo'))
  consultarPlanilha(@UploadedFile() arquivo: Express.Multer.File, @Body() dto: ConsultaPlanilhaDto) {
    if (!arquivo) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "arquivo").');
    }

    let linhasBrutas: Record<string, unknown>[];
    try {
      linhasBrutas = this.importacaoService.parse(arquivo.buffer);
    } catch (e) {
      throw new BadRequestException(
        `Não foi possível ler o arquivo — verifique se é um Excel válido (.xls ou .xlsx). Detalhe: ${(e as Error).message}`,
      );
    }

    const codigos = this.importacaoService.extrairCodigos(linhasBrutas);
    const cfop = dto.cfop || '5102';
    const tipo = dto.tipo || 'VENDA';
    const dataReferencia = new Date();

    const resultados = codigos.map((c) => {
      const dadosMinimos: DadosOperacao = {
        operacaoId: 'consulta-planilha',
        tipo,
        ambito: 'INTERNA',
        ncm: c.ncm,
        nbs: c.nbs,
        cfop,
        cst: '000',
        valorBruto: new Decimal(0),
        dataOperacao: dataReferencia,
      };
      const beneficios = this.beneficiosDaOperacao(dadosMinimos);
      return {
        linha: c.linha,
        codigoOriginal: c.codigoOriginal,
        descricao: c.descricao,
        ncm: c.ncm,
        nbs: c.nbs,
        beneficios,
      };
    });

    const comBeneficio = resultados.filter((r) => r.beneficios.length > 0);

    return {
      totalLinhas: linhasBrutas.length,
      codigosEncontrados: codigos.length,
      comBeneficio: comBeneficio.length,
      semBeneficio: resultados.length - comBeneficio.length,
      resultados,
    };
  }

  /**
   * Resolve os benefícios/regimes aplicáveis a uma classificação fiscal —
   * TODOS os que casarem, não só o de maior precedência (o cálculo real de
   * uma operação usa só um, por precisar de um valor definitivo; a
   * consulta mostra todos porque o mesmo NCM/NBS pode legitimamente casar
   * com mais de um regime OU aparecer em mais de um registro cadastrado —
   * cabe ao usuário escolher o correto para o contexto real da operação
   * dele). Deduplica por código.
   */
  private beneficiosDaOperacao(dadosMinimos: DadosOperacao): BeneficioResolvido[] {
    const vistos = new Set<string>();
    const beneficios: BeneficioResolvido[] = [];

    const adicionar = (b: BeneficioResolvido) => {
      if (!vistos.has(b.codigo)) {
        vistos.add(b.codigo);
        beneficios.push(b);
      }
    };

    const resultadosPorRegime = this.debitoService.resolverTodosOsRegimesSemAuditoria(dadosMinimos);
    for (const resultados of resultadosPorRegime) {
      for (const r of resultados) {
        for (const b of r.beneficiosAplicados) adicionar(b);
      }
    }

    // Cobre o caso de um NCM/NBS estar cadastrado em mais de um registro
    // (ex: numa lista ilustrativa de uma Strategy dedicada E também na
    // base real do Conformidade Fácil) — a Strategy dedicada "vence" no
    // cálculo real e esconderia o segundo registro se não fosse por isso.
    for (const b of this.beneficiosService.localizarTodosCandidatos(dadosMinimos)) adicionar(b);

    return beneficios;
  }
}
