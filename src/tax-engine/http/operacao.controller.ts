import { Body, Controller, Post } from '@nestjs/common';
import { DebitoService } from '../debito/debito.service';
import { CalcularOperacaoDto, converterParaDadosOperacao } from './dto';

/**
 * Endpoints de cálculo de nota fiscal e simulação tributária.
 *
 * `POST /operacoes/calculo`   — calcula e registra a operação (memória de
 *                                cálculo persistida via `AuditoriaService`).
 * `POST /operacoes/simulacao` — mesmo motor de cálculo, mas para fins de
 *                                simulação (ex: "quanto pagaria se vendesse
 *                                por X?") — nesta fase o resultado não é
 *                                diferenciado do cálculo real porque a
 *                                persistência definitiva (Prisma) ainda não
 *                                está conectada; o ponto de extensão é
 *                                marcar `simulado: true` no repositório ao
 *                                integrar com o banco.
 */
@Controller('operacoes')
export class OperacaoController {
  constructor(private readonly debitoService: DebitoService) {}

  @Post('calculo')
  calcular(@Body() dto: CalcularOperacaoDto) {
    const dados = converterParaDadosOperacao(dto);
    const resultados = this.debitoService.calcularOperacao(dados);
    return { operacaoId: dados.operacaoId, resultados };
  }

  @Post('simulacao')
  simular(@Body() dto: CalcularOperacaoDto) {
    const dados = converterParaDadosOperacao(dto);
    const resultados = this.debitoService.calcularOperacao(dados);
    return { operacaoId: dados.operacaoId, simulado: true, resultados };
  }
}
