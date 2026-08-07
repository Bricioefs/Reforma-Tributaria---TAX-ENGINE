import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import Decimal from 'decimal.js';
import { BeneficioCadastrado } from './beneficios.service';
import { paraDataUTC } from '../util/datas-fiscais';

/**
 * Forma de cada registro já agrupado em `assets/beneficios-conformidade-facil.json`
 * — um registro por (Anexo, item da lei), com todos os códigos NCM/NBS
 * cobertos por aquele item já reunidos em `codigos`.
 *
 * O agrupamento e a extração do tipo/percentual de benefício a partir do
 * texto de `descrAnexo` (ex: "...SUBMETIDOS À REDUÇÃO DE 60%...") foram
 * feitos UMA VEZ, offline, a partir da exportação bruta da API pública do
 * Conformidade Fácil (`https://cff.svrs.rs.gov.br/api/v1/consultas/anexos`)
 * — ver `converterRegistrosBrutos()` abaixo para reprocessar uma nova
 * exportação, se precisar atualizar.
 */
export interface RegistroAnexoAgrupado {
  codigo: string;
  tipo: 'ALIQUOTA_ZERO' | 'REDUCAO_PERCENTUAL';
  percentualReducao: number | null;
  baseLegal: string;
  descrAnexo: string;
  condicao: string | null;
  observacao: string | null;
  cumulativo: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  tipoNomenclatura: 'NCM' | 'NBS';
  codigos: string[];
}

/** Forma de um registro individual (não agrupado) da API bruta do Conformidade Fácil. */
export interface RegistroAnexoBruto {
  nroAnexo: number;
  codNcmNbs: string;
  TipoNomenclatura: 'NCM' | 'NBS';
  TipoPermissao: 'Permitido' | 'Não Permitido' | null;
  descrCondicao: string | null;
  descrExcecao: string | null;
  texObservacao: string | null;
  dthIniVig: string;
  dthFimVig: string | null;
  nroItemAnexoLei: number;
  descrItemAnexo: string;
  descrAnexo: string;
}

/**
 * Importa a base pública de benefícios fiscais do Conformidade Fácil
 * (ENCAT/SVRS-RS — `https://cff.svrs.rs.gov.br/api/v1/consultas/anexos`)
 * para o formato consumido por `BeneficiosService.hidratarCadastro()`.
 *
 * Cobre os Anexos cujo texto (`descrAnexo`) descreve claramente um
 * percentual de redução ou alíquota zero (Anexos 1, 4-13, 15 — produtos
 * alimentícios, dispositivos médicos, insumos agropecuários, produções
 * culturais, segurança nacional, etc. — 294 itens agrupados, ~2.281
 * códigos NCM/NBS distintos).
 *
 * NÃO cobre os grupos de "regime específico" da mesma base (transporte
 * coletivo, planos de saúde, serviços financeiros, imóveis, hotelaria,
 * exportação de serviços, energia elétrica, ICT, turismo, Prouni etc.) —
 * esses já têm mecânica própria modelada em `regimes/strategies/` e
 * `operacoes-especiais/strategies/` (bases de cálculo diferentes, regras
 * de crédito distintas), incompatível com o modelo genérico de "% de
 * redução sobre a base padrão" usado por `BeneficiosService`. Ligar os
 * NCM/NBS específicos desses grupos às Strategies correspondentes
 * (hoje com listas de exemplo pequenas) é o próximo passo de integração.
 */
@Injectable()
export class ImportadorConformidadeFacilService {
  /** Carrega o JSON já processado, empacotado com a aplicação. */
  carregarDoAsset(): BeneficioCadastrado[] {
    const caminho = join(__dirname, '..', '..', 'assets', 'beneficios-conformidade-facil.json');
    const conteudo = readFileSync(caminho, 'utf-8');
    const registros: RegistroAnexoAgrupado[] = JSON.parse(conteudo);
    return this.converterRegistrosAgrupados(registros);
  }

  converterRegistrosAgrupados(registros: RegistroAnexoAgrupado[]): BeneficioCadastrado[] {
    return registros.map((r) => ({
      codigo: r.codigo,
      tipo: r.tipo,
      percentualReducao: r.percentualReducao !== null ? new Decimal(r.percentualReducao) : undefined,
      baseLegal: r.baseLegal,
      cumulativo: r.cumulativo,
      vigenciaInicio: paraDataUTC(r.vigenciaInicio),
      vigenciaFim: r.vigenciaFim ? paraDataUTC(r.vigenciaFim) : undefined,
      condicao: r.condicao ?? undefined,
      criterios: {
        ncm: r.tipoNomenclatura === 'NCM' ? r.codigos : undefined,
        nbs: r.tipoNomenclatura === 'NBS' ? r.codigos : undefined,
      },
    }));
  }

  /**
   * Reprocessa uma exportação BRUTA (não agrupada) da API do Conformidade
   * Fácil — útil para atualizar a base quando uma nova versão da lei ou
   * dos Anexos for publicada, sem depender do arquivo `assets/` já
   * processado. Aplica a mesma lógica de agrupamento e extração de
   * percentual usada para gerar o asset original.
   */
  converterRegistrosBrutos(registrosBrutos: RegistroAnexoBruto[]): BeneficioCadastrado[] {
    const grupos = new Map<string, RegistroAnexoAgrupado>();

    for (const r of registrosBrutos) {
      const beneficio = this.extrairTipoPercentual(r.descrAnexo);
      if (!beneficio) continue; // Anexo sem percentual/zero explícito no texto — não é um caso genérico de %
      if (r.TipoPermissao === 'Não Permitido') continue; // exceção explícita — não cadastra benefício para este código

      const chave = `${r.nroAnexo}-${r.nroItemAnexoLei}-${r.TipoNomenclatura}`;
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = {
          codigo: `ANEXO${r.nroAnexo}_ITEM${r.nroItemAnexoLei}`,
          tipo: beneficio.tipo,
          percentualReducao: beneficio.percentual,
          baseLegal: `LC 214/2025, Anexo ${r.nroAnexo}, item ${r.nroItemAnexoLei} — ${r.descrItemAnexo}`,
          descrAnexo: r.descrAnexo,
          condicao: r.descrCondicao,
          observacao: r.texObservacao,
          cumulativo: false,
          vigenciaInicio: r.dthIniVig,
          vigenciaFim: r.dthFimVig,
          tipoNomenclatura: r.TipoNomenclatura,
          codigos: [],
        };
        grupos.set(chave, grupo);
      }
      if (!grupo.codigos.includes(r.codNcmNbs)) grupo.codigos.push(r.codNcmNbs);
    }

    return this.converterRegistrosAgrupados([...grupos.values()]);
  }

  private extrairTipoPercentual(descrAnexo: string): { tipo: 'ALIQUOTA_ZERO' | 'REDUCAO_PERCENTUAL'; percentual: number | null } | null {
    if (descrAnexo.includes('REDUÇÃO A ZERO')) return { tipo: 'ALIQUOTA_ZERO', percentual: null };
    const match = descrAnexo.match(/REDUÇÃO DE (\d+)%/);
    if (match) {
      const percentual = Number(match[1]);
      return percentual >= 100 ? { tipo: 'ALIQUOTA_ZERO', percentual: null } : { tipo: 'REDUCAO_PERCENTUAL', percentual };
    }
    return null;
  }
}
