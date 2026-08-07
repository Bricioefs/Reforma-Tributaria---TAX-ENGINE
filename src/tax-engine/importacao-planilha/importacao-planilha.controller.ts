import { BadRequestException, Body, Controller, Get, MessageEvent, Param, Post, Query, Sse, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import Decimal from 'decimal.js';
import { ImportacaoPlanilhaService, TipoLotePlanilha } from './importacao-planilha.service';
import { DebitoService } from '../debito/debito.service';
import { LancamentosService } from '../lancamentos/lancamentos.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EmpresaService } from '../empresa/empresa.service';

/** A cada quantas linhas gravar em disco durante um lote — equilíbrio entre performance (menos gravações, cada uma com custo real de I/O mesmo sendo assíncrona) e resiliência (menos trabalho perdido se o processo cair no meio de uma planilha grande). Aumentado de 50 para 500: numa planilha de dezenas de milhares de linhas, gravar a cada 50 significa mais de mil gravações do arquivo inteiro — mesmo cada uma sendo rápida isoladamente, o total de I/O real (e o que um antivírus precisa escanear) soma. */
const LINHAS_POR_GRAVACAO = 500;

/**
 * A cada quantas linhas emitir um evento de progresso (SSE) e ceder o
 * controle ao event loop (`setImmediate`) — em vez de a CADA linha.
 *
 * Relatado: planilha de ~2900 linhas "demorando bastante" para integrar.
 * Medido: o cálculo puro de 2900 linhas leva menos de 1s (com a escrita
 * em disco já suspendida durante o lote); o gargalo real era emitir um
 * evento SSE + ceder o controle a cada UMA linha — 2900 idas e vindas ao
 * event loop, e do lado do navegador, 2900 atualizações de DOM (barra +
 * percentual + texto, 3 escritas cada = ~8700 reflows), perceptível como
 * travamento mesmo com o cálculo em si sendo rápido. Emitir a cada 10
 * linhas reduz isso para ~290 eventos/atualizações — quase imperceptível
 * ao olho, e bem mais leve para o navegador processar.
 */
const LINHAS_POR_ATUALIZACAO_PROGRESSO = 10;

/**
 * Converte o valor de um campo de formulário HTML ("true" | "" | undefined)
 * para booleano, preservando a diferença entre "não informado" e "informado
 * como não" — `dto.campo === 'true'` sozinho SEMPRE vira `false` quando o
 * campo não veio na requisição (undefined === 'true' é false, nunca
 * undefined), misturando "o usuário não marcou nada" com "o usuário marcou
 * que não é" — bug real encontrado testando a consulta automática de
 * Simples Nacional: todo lançamento sem resultado de consulta (rede fora)
 * ficava com `contraparteOptanteSimplesNacional = false` (uma afirmação
 * incorreta) em vez de `undefined` ("não sabemos"), distorcendo o indicador
 * do dashboard "% de entradas do Simples Nacional" (que trata os 3 estados
 * separadamente).
 */
function paraBooleanOuIndefinido(valor: string | undefined): boolean | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  return valor === 'true';
}

interface ImportarPlanilhaDto {
  tipoLote: TipoLotePlanilha;
  dataOperacao: string; // "YYYY-MM-DD" — aplicada a todas as linhas do lote
  cnpj?: string;
  cfopPadrao?: string;
  /**
   * Alíquota de ISS (%) a aplicar sobre a base de cálculo — SÓ para
   * linhas cujo CFOP seja exatamente 5933 ou 6933 (prestação de serviço
   * tributado pelo ISSQN, com ICMS/IPI não incidentes — os CFOPs
   * específicos de "serviço" dentro de uma planilha majoritariamente de
   * mercadorias). Pedido explícito: a planilha real não traz uma coluna
   * de ISS pronta (companhias comerciais raramente prestam serviço), mas
   * quando alguma linha específica for CFOP 5933/6933, o sistema calcula
   * o ISS devido com base nesta alíquota informada pelo usuário — não
   * existe uma tabela nacional de alíquotas de ISS (cada município fixa
   * a própria, dentro do intervalo de 2% a 5% do art. 8º-A da LC 116/2003),
   * por isso é sempre informada manualmente, nunca adivinhada.
   */
  aliquotaIss?: string;
  /**
   * Se a CONTRAPARTE de todas as linhas deste lote (fornecedor numa
   * importação de ENTRADA, cliente numa de SAÍDA) é optante pelo Simples
   * Nacional — usado tanto no cálculo (compras de fornecedor do Simples
   * não geram crédito integral automaticamente, ver `RegimeSimplesNacionalStrategy`)
   * quanto no indicador do dashboard "% de entradas de empresas do
   * Simples Nacional". Serve de RESERVA quando `consultarSimplesNacional`
   * está desligado ou a consulta falhou para o CNPJ daquela linha — com a
   * consulta automática ligada, cada linha usa o resultado real do SEU
   * PRÓPRIO fornecedor/cliente, não esse valor único para o lote inteiro.
   */
  contraparteSimplesNacional?: string; // "true" | "" (do form HTML)
  /**
   * Consulta AUTOMATICAMENTE na Receita Federal (mesma BrasilAPI já usada
   * na busca de empresa) se cada fornecedor/cliente é optante pelo
   * Simples Nacional — usa o CNPJ de cada linha (coluna "CNPJ/CPF"), uma
   * consulta por CNPJ ÚNICO (não por linha — uma planilha real de ~11 mil
   * linhas de entrada pode ter só ~60 fornecedores distintos). Correção
   * de um relato: importar sem isso ligado nunca reportava nenhum
   * fornecedor como Simples Nacional, mesmo quando alguns realmente eram
   * — o sistema só tinha um campo manual pra planilha inteira, não uma
   * consulta de verdade por fornecedor.
   */
  consultarSimplesNacional?: string; // "true" | "" (do form HTML)
}

/**
 * `POST /importacao/planilha` (multipart/form-data) — importa e calcula a
 * planilha inteira numa única requisição, sem progresso incremental (mais
 * simples para consumo por script/API; o front-end web usa o fluxo de
 * duas etapas abaixo, que reporta progresso real linha a linha).
 *
 * `POST /importacao/planilha/upload` (multipart/form-data) — só faz o
 * UPLOAD e o parse do arquivo (rápido, mesmo para planilhas grandes) e
 * devolve um `importId` + o total de linhas encontradas. Não calcula
 * nada ainda.
 *
 * `GET /importacao/planilha/progresso/:importId?tipoLote=...&dataOperacao=...&cnpj=...&cfopPadrao=...`
 * (Server-Sent Events) — processa a sessão criada pelo upload, linha a
 * linha, emitindo um evento `progresso` (`{processadas, total}`) a cada
 * `LINHAS_POR_ATUALIZACAO_PROGRESSO` linhas calculadas e salvas (não a
 * cada linha individual — ver comentário da constante), e por fim um
 * evento `concluido` com o
 * resultado completo (mesmo formato do endpoint de requisição única
 * acima) antes de encerrar a conexão. Existe justamente porque, em
 * planilhas grandes, cada linha passa pelo motor de cálculo completo E
 * grava em disco — sem isso, o usuário via só uma mensagem genérica de
 * "importando…" por até vários segundos, sem saber se estava travado ou
 * só demorando.
 */
@Controller('importacao')
export class ImportacaoPlanilhaController {
  constructor(
    private readonly importacaoService: ImportacaoPlanilhaService,
    private readonly debitoService: DebitoService,
    private readonly lancamentosService: LancamentosService,
    private readonly auditoriaService: AuditoriaService,
    private readonly empresaService: EmpresaService,
  ) {}

  @Post('planilha')
  @UseInterceptors(FileInterceptor('arquivo'))
  async importar(@UploadedFile() arquivo: Express.Multer.File, @Body() dto: ImportarPlanilhaDto) {
    if (!arquivo) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "arquivo").');
    }
    const linhasBrutas = this.parseOuErro(arquivo.buffer);
    return this.processarLote(linhasBrutas, dto);
  }

  @Post('planilha/upload')
  @UseInterceptors(FileInterceptor('arquivo'))
  upload(@UploadedFile() arquivo: Express.Multer.File) {
    if (!arquivo) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "arquivo").');
    }
    const linhasBrutas = this.parseOuErro(arquivo.buffer);
    const importId = this.importacaoService.iniciarSessao(linhasBrutas);
    return { importId, totalLinhasBrutas: linhasBrutas.length };
  }

  @Sse('planilha/progresso/:importId')
  progresso(
    @Param('importId') importId: string,
    @Query('tipoLote') tipoLote: TipoLotePlanilha,
    @Query('dataOperacao') dataOperacao: string,
    @Query('cnpj') cnpj?: string,
    @Query('cfopPadrao') cfopPadrao?: string,
    @Query('aliquotaIss') aliquotaIss?: string,
    @Query('contraparteSimplesNacional') contraparteSimplesNacional?: string,
    @Query('consultarSimplesNacional') consultarSimplesNacional?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const linhasBrutas = this.importacaoService.obterSessao(importId);
      if (!linhasBrutas) {
        subscriber.next({ type: 'erro', data: { message: 'Sessão de importação não encontrada ou expirada — envie o arquivo novamente.' } });
        subscriber.complete();
        return;
      }

      const dto: ImportarPlanilhaDto = { tipoLote, dataOperacao, cnpj, cfopPadrao, aliquotaIss, contraparteSimplesNacional, consultarSimplesNacional };
      let cancelado = false;

      this.processarComProgresso(
        linhasBrutas,
        dto,
        (processadas, total) => {
          subscriber.next({ type: 'progresso', data: { processadas, total } });
        },
        (atual, total) => {
          subscriber.next({ type: 'consultando-fornecedores', data: { atual, total } });
        },
      )
        .then((resultado) => {
          this.importacaoService.removerSessao(importId);
          if (cancelado) return;
          subscriber.next({ type: 'concluido', data: resultado });
          subscriber.complete();
        })
        .catch((e: Error) => {
          this.importacaoService.removerSessao(importId);
          if (cancelado) return;
          subscriber.next({ type: 'erro', data: { message: e.message } });
          subscriber.complete();
        });

      return () => {
        cancelado = true;
      };
    });
  }

  private parseOuErro(buffer: Buffer): Record<string, unknown>[] {
    try {
      return this.importacaoService.parse(buffer);
    } catch (e) {
      throw new BadRequestException(`Não foi possível ler o arquivo — verifique se é um Excel válido (.xls ou .xlsx). Detalhe: ${(e as Error).message}`);
    }
  }

  /**
   * Consulta, na Receita Federal (via `EmpresaService`, mesma BrasilAPI já
   * usada na busca de empresa), se cada CNPJ ÚNICO da lista é optante
   * pelo Simples Nacional — uma requisição por CNPJ, com um pequeno atraso
   * entre elas (educado com uma API pública gratuita, sem token; evita
   * ficar sujeito a limite de requisições por rajada). Falhas em CNPJs
   * individuais (não encontrado, CNPJ inválido, uma falha pontual de
   * rede) NÃO interrompem os demais — esse CNPJ fica de fora do mapa
   * (tratado como "não informado" depois, cai pro flag manual do lote se
   * houver um).
   */
  private async consultarSimplesNacionalPorCnpjs(
    cnpjsUnicos: string[],
    aoProgredir?: (atual: number, total: number) => void,
  ): Promise<Map<string, boolean | null>> {
    const mapa = new Map<string, boolean | null>();
    for (let i = 0; i < cnpjsUnicos.length; i++) {
      try {
        const empresa = await this.empresaService.buscarPorCnpj(cnpjsUnicos[i]);
        mapa.set(cnpjsUnicos[i], empresa.optanteSimplesNacional);
      } catch {
        // CNPJ não encontrado, inválido, ou falha pontual de rede — segue
        // para os próximos, esse fica sem informação (não é um erro fatal
        // para a importação inteira).
      }
      aoProgredir?.(i + 1, cnpjsUnicos.length);
      if (i < cnpjsUnicos.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200)); // educado com a API pública
      }
    }
    return mapa;
  }

  private async processarLote(linhasBrutas: Record<string, unknown>[], dto: ImportarPlanilhaDto) {
    if (dto.tipoLote !== 'ENTRADA' && dto.tipoLote !== 'SAIDA') {
      throw new BadRequestException('tipoLote deve ser "ENTRADA" ou "SAIDA".');
    }
    if (!dto.dataOperacao) {
      throw new BadRequestException('dataOperacao é obrigatória (aplicada a todas as linhas da planilha).');
    }

    const dataOperacao = new Date(dto.dataOperacao);
    const competencia = dto.dataOperacao.slice(0, 7);

    let mapaSimplesNacional: Map<string, boolean | null> | undefined;
    if (dto.consultarSimplesNacional === 'true') {
      const cnpjsUnicos = this.importacaoService.extrairCnpjsUnicos(linhasBrutas);
      mapaSimplesNacional = await this.consultarSimplesNacionalPorCnpjs(cnpjsUnicos);
    }

    const { mapeadas, ignoradas, totalLinhas } = this.importacaoService.mapearParaOperacoes(linhasBrutas, dto.tipoLote, dataOperacao, dto.cfopPadrao, dto.aliquotaIss, paraBooleanOuIndefinido(dto.contraparteSimplesNacional), mapaSimplesNacional);

    let totalCbs = new Decimal(0);
    let totalIbsEstadual = new Decimal(0);
    let totalIbsMunicipal = new Decimal(0);

    // Gravação em disco suspensa durante o lote inteiro — sem isso, cada
    // linha reescreveria o arquivo inteiro (cada vez maior) tanto de
    // lançamentos quanto de auditoria (3x por linha, um por tributo) —
    // gravação O(n²), perceptível como "travado" em planilhas grandes.
    this.lancamentosService.suspenderEscritaAutomatica();
    this.auditoriaService.suspenderEscritaAutomatica();
    try {
      const linhasProcessadas = mapeadas.map(({ linha, dados, origem }) => {
        const resultados = this.debitoService.calcularOperacao(dados);

        for (const r of resultados) {
          if (r.tributo === 'CBS') totalCbs = totalCbs.plus(r.valor);
          else if (r.tributo === 'IBS_ESTADUAL') totalIbsEstadual = totalIbsEstadual.plus(r.valor);
          else if (r.tributo === 'IBS_MUNICIPAL') totalIbsMunicipal = totalIbsMunicipal.plus(r.valor);
        }

        this.lancamentosService.adicionar(dto.cnpj, {
          operacaoId: dados.operacaoId,
          tipo: dados.tipo,
          competencia,
          resultados,
          descricao: origem.descricao,
          ncm: dados.ncm,
          nbs: dados.nbs,
          valorBruto: dados.valorBruto.toString(),
          cfop: dados.cfop,
          valorPis: origem.valorPis?.toString(),
          valorCofins: origem.valorCofins?.toString(),
          valorIcms: origem.valorIcms?.toString(),
          valorIss: origem.valorIss?.toString(),
          valorIpi: origem.valorIpi?.toString(),
          zfmOuAlc: dados.operacaoZfmOuAlc,
          numeroNota: origem.numeroNota,
          chaveAcesso: origem.chaveAcesso,
          quantidade: origem.quantidade?.toString(),
          nomeContraparte: origem.nomeContraparte,
          cnpjContraparte: origem.cnpjContraparte,
          contraparteOptanteSimplesNacional: dados.optanteSimplesNacional,
        });

        return this.montarLinhaProcessada(linha, dados, origem, resultados);
      });

      return this.montarResultado(totalLinhas, linhasProcessadas, ignoradas, competencia, totalCbs, totalIbsEstadual, totalIbsMunicipal);
    } finally {
      this.lancamentosService.retomarEscritaAutomatica();
      this.auditoriaService.retomarEscritaAutomatica();
    }
  }

  /**
   * Mesma lógica de `processarLote`, mas calculando linha por linha e
   * reportando o progresso a cada `LINHAS_POR_ATUALIZACAO_PROGRESSO`
   * linhas (não a cada linha individual — ver comentário da constante).
   * O `setImmediate` cede o controle ao event loop só nesses pontos de
   * atualização; sem ceder o controle em algum ponto, o loop síncrono
   * roda até o fim antes do Node conseguir de fato escrever os eventos
   * SSE no socket, e o "progresso em tempo real" chegaria todo de uma vez
   * no final (mesmo problema do endpoint de requisição única, só que
   * escondido atrás de uma conexão que parece progressiva).
   */
  private async processarComProgresso(
    linhasBrutas: Record<string, unknown>[],
    dto: ImportarPlanilhaDto,
    aoProgredir: (processadas: number, total: number) => void,
    aoConsultarFornecedor?: (atual: number, total: number) => void,
  ) {
    if (dto.tipoLote !== 'ENTRADA' && dto.tipoLote !== 'SAIDA') {
      throw new Error('tipoLote deve ser "ENTRADA" ou "SAIDA".');
    }
    if (!dto.dataOperacao) {
      throw new Error('dataOperacao é obrigatória (aplicada a todas as linhas da planilha).');
    }

    const dataOperacao = new Date(dto.dataOperacao);
    const competencia = dto.dataOperacao.slice(0, 7);

    let mapaSimplesNacional: Map<string, boolean | null> | undefined;
    if (dto.consultarSimplesNacional === 'true') {
      const cnpjsUnicos = this.importacaoService.extrairCnpjsUnicos(linhasBrutas);
      mapaSimplesNacional = await this.consultarSimplesNacionalPorCnpjs(cnpjsUnicos, aoConsultarFornecedor);
    }

    const { mapeadas, ignoradas, totalLinhas } = this.importacaoService.mapearParaOperacoes(linhasBrutas, dto.tipoLote, dataOperacao, dto.cfopPadrao, dto.aliquotaIss, paraBooleanOuIndefinido(dto.contraparteSimplesNacional), mapaSimplesNacional);

    let totalCbs = new Decimal(0);
    let totalIbsEstadual = new Decimal(0);
    let totalIbsMunicipal = new Decimal(0);
    const linhasProcessadas: ReturnType<typeof this.montarLinhaProcessada>[] = [];

    // Gravação em disco suspensa durante o lote — só grava a cada
    // LINHAS_POR_GRAVACAO linhas (não a cada linha) e ao final. Ver
    // comentário equivalente em `processarLote()`.
    this.lancamentosService.suspenderEscritaAutomatica();
    this.auditoriaService.suspenderEscritaAutomatica();
    try {
      for (let i = 0; i < mapeadas.length; i++) {
        const { linha, dados, origem } = mapeadas[i];
        const resultados = this.debitoService.calcularOperacao(dados);

        for (const r of resultados) {
          if (r.tributo === 'CBS') totalCbs = totalCbs.plus(r.valor);
          else if (r.tributo === 'IBS_ESTADUAL') totalIbsEstadual = totalIbsEstadual.plus(r.valor);
          else if (r.tributo === 'IBS_MUNICIPAL') totalIbsMunicipal = totalIbsMunicipal.plus(r.valor);
        }

        this.lancamentosService.adicionar(dto.cnpj, {
          operacaoId: dados.operacaoId,
          tipo: dados.tipo,
          competencia,
          resultados,
          descricao: origem.descricao,
          ncm: dados.ncm,
          nbs: dados.nbs,
          valorBruto: dados.valorBruto.toString(),
          cfop: dados.cfop,
          valorPis: origem.valorPis?.toString(),
          valorCofins: origem.valorCofins?.toString(),
          valorIcms: origem.valorIcms?.toString(),
          valorIss: origem.valorIss?.toString(),
          valorIpi: origem.valorIpi?.toString(),
          zfmOuAlc: dados.operacaoZfmOuAlc,
          numeroNota: origem.numeroNota,
          chaveAcesso: origem.chaveAcesso,
          quantidade: origem.quantidade?.toString(),
          nomeContraparte: origem.nomeContraparte,
          cnpjContraparte: origem.cnpjContraparte,
          contraparteOptanteSimplesNacional: dados.optanteSimplesNacional,
        });

        linhasProcessadas.push(this.montarLinhaProcessada(linha, dados, origem, resultados));

        const ultimaLinha = i + 1 === mapeadas.length;
        if ((i + 1) % LINHAS_POR_ATUALIZACAO_PROGRESSO === 0 || ultimaLinha) {
          aoProgredir(i + 1, mapeadas.length);
          // cede o controle ao event loop para o chunk SSE ser enviado de verdade antes da próxima leva de linhas
          await new Promise((resolve) => setImmediate(resolve));
        }

        if ((i + 1) % LINHAS_POR_GRAVACAO === 0) {
          // Assíncrono (não bloqueia o event loop) — ver `escreverJsonAsync()`
          // para o porquê: relatado que uma planilha de 54 mil linhas
          // perdia a conexão SSE durante a importação; uma gravação
          // SÍNCRONA de um arquivo grande (dezenas/centenas de MB nesse
          // tamanho de planilha) trava o event loop pela duração da
          // escrita, represando os eventos de progresso já enfileirados —
          // numa máquina com disco lento ou antivírus interceptando a
          // escrita, essa pausa pode ser longa o bastante para o
          // navegador considerar a conexão morta.
          await this.lancamentosService.persistirAsync();
          await this.auditoriaService.persistirAsync();
        }
      }

      return this.montarResultado(totalLinhas, linhasProcessadas, ignoradas, competencia, totalCbs, totalIbsEstadual, totalIbsMunicipal);
    } finally {
      this.lancamentosService.retomarEscritaAutomatica();
      this.auditoriaService.retomarEscritaAutomatica();
    }
  }

  private montarLinhaProcessada(
    linha: number,
    dados: ReturnType<ImportacaoPlanilhaService['mapearParaOperacoes']>['mapeadas'][number]['dados'],
    origem: ReturnType<ImportacaoPlanilhaService['mapearParaOperacoes']>['mapeadas'][number]['origem'],
    resultados: ReturnType<DebitoService['calcularOperacao']>,
  ) {
    return {
      linha,
      operacaoId: dados.operacaoId,
      codigoProduto: origem.codigoProduto,
      descricao: origem.descricao,
      ncm: dados.ncm,
      nbs: dados.nbs,
      cfop: dados.cfop,
      valorBruto: dados.valorBruto.toString(),
      resultados,
    };
  }

  private montarResultado(
    totalLinhas: number,
    linhasProcessadas: unknown[],
    ignoradas: ReturnType<ImportacaoPlanilhaService['mapearParaOperacoes']>['ignoradas'],
    competencia: string,
    totalCbs: Decimal,
    totalIbsEstadual: Decimal,
    totalIbsMunicipal: Decimal,
  ) {
    return {
      totalLinhas,
      processadas: linhasProcessadas.length,
      ignoradas,
      competencia,
      resumo: {
        totalCbs: totalCbs.toDecimalPlaces(2).toString(),
        totalIbsEstadual: totalIbsEstadual.toDecimalPlaces(2).toString(),
        totalIbsMunicipal: totalIbsMunicipal.toDecimalPlaces(2).toString(),
        totalGeral: totalCbs.plus(totalIbsEstadual).plus(totalIbsMunicipal).toDecimalPlaces(2).toString(),
      },
      linhas: linhasProcessadas,
    };
  }
}
