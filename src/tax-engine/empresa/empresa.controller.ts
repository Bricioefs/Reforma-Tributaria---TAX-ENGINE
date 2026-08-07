import { Controller, Get, Param } from '@nestjs/common';
import { EmpresaService } from './empresa.service';

/**
 * `GET /empresa/cnpj/:cnpj` — consulta dados cadastrais de uma empresa
 * (razão social, UF, município, CNAE, opção pelo Simples Nacional) para
 * preencher automaticamente o formulário de cálculo na interface web.
 */
@Controller('empresa')
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) {}

  @Get('cnpj/:cnpj')
  buscarPorCnpj(@Param('cnpj') cnpj: string) {
    return this.empresaService.buscarPorCnpj(cnpj);
  }
}
