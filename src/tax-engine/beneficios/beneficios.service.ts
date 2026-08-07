import { Injectable, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DadosOperacao, BeneficioResolvido } from '../interfaces/tax-engine.interfaces';
import { codigoFiscalEstaEm } from '../util/normalizador-classificacao-fiscal';
import { itensCestaBasicaComoCriteriosNcm } from './itens-cesta-basica';

/**
 * Representa uma linha do cadastro `Beneficio` + `BeneficioClassificacao`
 * (aqui simplificada em memória para a Fase 1; em produção viria do
 * repositório Prisma — ver PrismaBeneficioRepository, ponto de extensão).
 */
export interface BeneficioCadastrado {
  codigo: string;
  tipo: BeneficioResolvido['tipo'];
  percentualReducao?: Decimal;
  baseLegal: string;
  cumulativo: boolean;
  vigenciaInicio: Date;
  vigenciaFim?: Date;
  /** Condição de aplicação, quando houver (ex: "DESTINADOS À ALIMENTAÇÃO HUMANA") — informativa, não usada para filtrar automaticamente. */
  condicao?: string;
  criterios: {
    ncm?: string[];
    nbs?: string[];
    cest?: string[];
    cfop?: string[];
    cnae?: string[];
    uf?: string[];
    municipioIbge?: string[];
    tipoOperacao?: string[];
    destinacao?: string[];
    finalidade?: string[];
  };
}

/**
 * Motor de Benefícios Fiscais.
 *
 * Localiza automaticamente TODOS os benefícios aplicáveis a uma operação,
 * cruzando NCM, NBS, CEST, CFOP, CNAE, UF, Município, tipo de operação,
 * destinação e finalidade. Permite múltiplos benefícios simultâneos quando
 * marcados como `cumulativo`.
 *
 * Em produção, este serviço consulta o repositório (Prisma) e/ou a API
 * oficial da calculadora do Piloto CBS / Conformidade Fácil (ENCAT/SVRS-RS)
 * para enriquecer o cadastro local — ponto de extensão: `IBeneficioSource`.
 */
@Injectable()
export class BeneficiosService {
  private cadastro: BeneficioCadastrado[];

  constructor(@Optional() cadastroInicial: BeneficioCadastrado[] = SEED_BENEFICIOS) {
    this.cadastro = cadastroInicial;
  }

  /**
   * Substitui o cadastro em memória pelo conteúdo vindo de um repositório
   * real (ex: `BeneficioPrismaRepository.listarVigentes()` ou o adaptador
   * de importação do sistema NCM/NBS existente — ver `integracao/`).
   * Chamar no bootstrap da aplicação assim que `DATABASE_URL` estiver
   * disponível, substituindo o `SEED_BENEFICIOS` usado nas Fases 1-4.
   */
  hidratarCadastro(novoCadastro: BeneficioCadastrado[]): void {
    this.cadastro = novoCadastro;
  }

  localizarBeneficiosAplicaveis(dados: DadosOperacao): BeneficioResolvido[] {
    const candidatos = this.cadastro.filter((b) => this.vigente(b, dados.dataOperacao) && this.combina(b, dados));

    if (candidatos.length === 0) return [];

    // Se algum candidato não permite cumulação, ele prevalece isolado
    // (regra de precedência simplificada — em produção seguiria hierarquia
    // definida em Parametrizacao, pois a LC 214/2025 não cria uma ordem
    // universal de precedência entre benefícios; isso é PENDÊNCIA REGULAMENTAR
    // em vários casos específicos).
    const naoCumulativos = candidatos.filter((c) => !c.cumulativo);
    const selecionados = naoCumulativos.length > 0 ? [naoCumulativos[0]] : candidatos;

    return selecionados.map((b) => this.paraResolvido(b));
  }

  /**
   * Lista TODOS os benefícios cadastrados que combinam com a classificação
   * informada (NCM/NBS/CFOP/etc.) e estão vigentes — SEM aplicar a regra de
   * precedência do não-cumulativo usada por `localizarBeneficiosAplicaveis()`.
   *
   * Uso: consulta informativa (`/beneficios/consulta`) — o usuário quer ver
   * TUDO que está cadastrado para aquele NCM/NBS, mesmo quando só um deles
   * seria efetivamente aplicado numa operação real (ex: um NCM pode
   * aparecer tanto na lista ilustrativa de cesta básica quanto na base
   * real do Conformidade Fácil — o cálculo aplica só um, mas a consulta
   * deve mostrar os dois, para o usuário entender a origem de cada um).
   *
   * NÃO usar para calcular o valor de uma operação — para isso,
   * `localizarBeneficiosAplicaveis()` continua sendo a fonte correta.
   */
  localizarTodosCandidatos(dados: DadosOperacao): BeneficioResolvido[] {
    return this.cadastro
      .filter((b) => this.vigente(b, dados.dataOperacao) && this.combina(b, dados))
      .map((b) => this.paraResolvido(b));
  }

  private paraResolvido(b: BeneficioCadastrado): BeneficioResolvido {
    return {
      codigo: b.codigo,
      tipo: b.tipo,
      percentualReducao: b.percentualReducao,
      baseLegal: b.baseLegal,
      cumulativo: b.cumulativo,
      condicao: b.condicao,
    };
  }

  private vigente(b: BeneficioCadastrado, data: Date): boolean {
    if (data < b.vigenciaInicio) return false;
    if (b.vigenciaFim && data > b.vigenciaFim) return false;
    return true;
  }

  private combina(b: BeneficioCadastrado, dados: DadosOperacao): boolean {
    const c = b.criterios;
    // Critérios de classificação do item (NCM/NBS/CEST/CNAE): se o benefício
    // exige o critério, a operação PRECISA ter o campo correspondente
    // preenchido e ele precisa constar na lista — ausência do campo não é
    // "neutra", é reprovação (evita falso positivo entre bem e serviço).
    if (c.ncm && !codigoFiscalEstaEm(dados.ncm, c.ncm)) return false;
    if (c.nbs && !codigoFiscalEstaEm(dados.nbs, c.nbs)) return false;
    if (c.cest && !codigoFiscalEstaEm(dados.cest, c.cest)) return false;
    if (c.cnae && !codigoFiscalEstaEm(dados.cnae, c.cnae)) return false;
    if (c.cfop && !c.cfop.includes(dados.cfop)) return false;
    if (c.uf && (!dados.ufDestino || !c.uf.includes(dados.ufDestino))) return false;
    if (c.municipioIbge && (!dados.municipioDestinoIbge || !c.municipioIbge.includes(dados.municipioDestinoIbge))) return false;
    if (c.tipoOperacao && !c.tipoOperacao.includes(dados.tipo)) return false;
    if (c.destinacao && (!dados.destinacao || !c.destinacao.includes(dados.destinacao))) return false;
    if (c.finalidade && (!dados.finalidade || !c.finalidade.includes(dados.finalidade))) return false;
    // Se o benefício não define nenhum critério de classificação, não se aplica
    // por segurança (evita falso positivo de benefício "curinga").
    const semCriterios = Object.values(c).every((v) => v === undefined);
    if (semCriterios) return false;
    return true;
  }

  /** Aplica os benefícios resolvidos sobre uma alíquota nominal, retornando a efetiva. */
  aplicarSobreAliquota(aliquotaNominal: Decimal, beneficios: BeneficioResolvido[]): Decimal {
    let aliquota = new Decimal(aliquotaNominal);
    for (const b of beneficios) {
      switch (b.tipo) {
        case 'ALIQUOTA_ZERO':
        case 'ISENCAO':
        case 'IMUNIDADE':
        case 'SUSPENSAO':
        case 'DIFERIMENTO':
          // Suspensão e diferimento não extinguem o débito, apenas postergam
          // a exigibilidade — tratados no Motor de Débito com flag própria.
          // Aqui, para fins de cálculo do valor devido no período, zeram a alíquota.
          aliquota = new Decimal(0);
          break;
        case 'REDUCAO_PERCENTUAL':
          if (b.percentualReducao) {
            const fator = new Decimal(1).minus(b.percentualReducao.dividedBy(100));
            aliquota = aliquota.times(fator);
          }
          break;
      }
    }
    return aliquota.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }
}

/**
 * Seed mínimo para a Fase 1 — exemplos reais da LC 214/2025.
 * Em produção, substituir por `PrismaBeneficioRepository` lendo da tabela
 * `Beneficio`/`BeneficioClassificacao`, alimentada pela integração com o
 * Conformidade Fácil (endpoint /anexos, ~3991 registros de NCM/NBS por Anexo).
 */
export const SEED_BENEFICIOS: BeneficioCadastrado[] = [
  {
    codigo: 'CESTA_BASICA_ALIQUOTA_ZERO',
    tipo: 'ALIQUOTA_ZERO',
    baseLegal: 'LC 214/2025, art. 141, Anexo I (Cesta Básica Nacional de Alimentos)',
    cumulativo: false,
    vigenciaInicio: new Date('2026-01-01'),
    criterios: {
      ncm: itensCestaBasicaComoCriteriosNcm(),
      tipoOperacao: ['VENDA'],
    },
  },
  {
    codigo: 'MEDICAMENTOS_REDUCAO_60',
    tipo: 'REDUCAO_PERCENTUAL',
    percentualReducao: new Decimal(60),
    baseLegal: 'LC 214/2025, art. 137, Anexo VI (Dispositivos médicos e medicamentos)',
    cumulativo: false,
    vigenciaInicio: new Date('2026-01-01'),
    criterios: {
      ncm: ['3004.90.99'], // exemplo genérico de medicamento
      tipoOperacao: ['VENDA'],
    },
  },
  {
    codigo: 'SERVICOS_SAUDE_REDUCAO_60',
    tipo: 'REDUCAO_PERCENTUAL',
    percentualReducao: new Decimal(60),
    baseLegal: 'LC 214/2025, art. 136 (Serviços de saúde)',
    cumulativo: false,
    vigenciaInicio: new Date('2026-01-01'),
    criterios: {
      nbs: ['1.0101.00.00'], // exemplo genérico de serviço de saúde
      tipoOperacao: ['VENDA'],
    },
  },
];
