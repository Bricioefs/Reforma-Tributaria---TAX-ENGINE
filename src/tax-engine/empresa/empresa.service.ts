import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

export interface DadosEmpresa {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  uf: string;
  municipio: string;
  codigoMunicipioIbge: string;
  cnaeFiscal: string;
  cnaeFiscalDescricao: string;
  optanteSimplesNacional: boolean | null;
  porte: string;
  situacaoCadastral: string;
}

/**
 * Consulta dados cadastrais de uma empresa a partir do CNPJ, usando a
 * BrasilAPI (https://brasilapi.com.br/api/cnpj/v1/{cnpj}) — API pública
 * que consolida os dados abertos da Receita Federal, sem necessidade de
 * token/cadastro.
 *
 * Usado para preencher automaticamente, na interface web, os campos de
 * UF, município (IBGE), CNAE e opção pelo Simples Nacional a partir do
 * CNPJ do estabelecimento — em vez de o usuário digitar tudo manualmente.
 *
 * PENDÊNCIA DE INFRAESTRUTURA: requer acesso à internet em tempo de
 * execução. Se o servidor rodar em ambiente sem internet, este endpoint
 * falha graciosamente (ver tratamento de erro abaixo) — o restante do
 * motor tributário continua funcionando normalmente, já que nada mais
 * depende desta consulta.
 */
@Injectable()
export class EmpresaService {
  private readonly BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1';

  async buscarPorCnpj(cnpjBruto: string): Promise<DadosEmpresa> {
    const cnpj = cnpjBruto.replace(/\D/g, '');

    if (cnpj.length !== 14) {
      throw new HttpException('CNPJ inválido — deve conter 14 dígitos.', HttpStatus.BAD_REQUEST);
    }

    let resposta: globalThis.Response;
    try {
      // Timeout defensivo: sem isso, uma API pública lenta (não indisponível
      // — apenas devagar) faria cada consulta esperar indefinidamente. Isso
      // importa especialmente na consulta EM LOTE por CNPJ único durante a
      // importação de planilha (`ImportacaoPlanilhaController.consultarSimplesNacionalPorCnpjs()`),
      // onde uma única consulta lenta atrasaria a importação inteira.
      resposta = await fetch(`${this.BASE_URL}/${cnpj}`, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new HttpException(
        'Não foi possível consultar o CNPJ — verifique sua conexão com a internet.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (resposta.status === 404) {
      throw new HttpException('CNPJ não encontrado.', HttpStatus.NOT_FOUND);
    }
    if (!resposta.ok) {
      throw new HttpException('Falha ao consultar o CNPJ na base pública.', HttpStatus.BAD_GATEWAY);
    }

    const dados: any = await resposta.json();

    return {
      cnpj: dados.cnpj,
      razaoSocial: dados.razao_social,
      nomeFantasia: dados.nome_fantasia || dados.razao_social,
      uf: dados.uf,
      municipio: dados.municipio,
      codigoMunicipioIbge: dados.codigo_municipio_ibge ? String(dados.codigo_municipio_ibge) : '',
      cnaeFiscal: dados.cnae_fiscal ? String(dados.cnae_fiscal) : '',
      cnaeFiscalDescricao: dados.cnae_fiscal_descricao || '',
      optanteSimplesNacional: dados.opcao_pelo_simples ?? null,
      porte: dados.descricao_porte || '',
      situacaoCadastral: dados.descricao_situacao_cadastral || '',
    };
  }
}
