import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class AppController {
  @Get('status')
  status() {
    return {
      servico: 'Tax Engine IBS/CBS/IS',
      status: 'no ar',
      endpoints: [
        'POST /operacoes/calculo',
        'POST /operacoes/simulacao',
        'GET  /beneficios/consulta',
        'POST /apuracao/:estabelecimentoId/:competencia',
        'POST /apuracao/:estabelecimentoId/:competencia/fechamento',
        'GET  /apuracao/historico/:operacaoId',
        'GET  /dashboard/beneficios-aplicados',
        'GET  /dashboard/indicadores-por-regime',
      ],
      documentacao: 'Ver README.md (visão geral) e HISTORICO-DESENVOLVIMENTO.md (detalhes técnicos e exemplos de cada endpoint) na raiz do projeto.',
    };
  }
}
