import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BeneficioCadastrado } from '../beneficios/beneficios.service';
import { paraDataUTC } from '../util/datas-fiscais';

/**
 * Forma esperada de um registro exportado pelo sistema de apuração
 * IBS/CBS por NCM/NBS já existente do usuário (app Python + web), que
 * consulta o Conformidade Fácil (ENCAT/SVRS-RS, endpoint `/anexos`) e a
 * ferramenta Legisweb. Ajustar os nomes de campo conforme o formato real
 * de exportação do sistema (JSON/CSV) — esta interface documenta o
 * CONTRATO esperado, não um formato fixo imutável.
 */
export interface RegistroExportadoSistemaExistente {
  ncm?: string;
  nbs?: string;
  cest?: string;
  cnae?: string;
  anexoLc214?: string; // referência ao Anexo da LC 214/2025 (I a XVII)
  cClassTrib?: string; // código de classificação tributária (Conformidade Fácil)
  tipoBeneficio: 'ALIQUOTA_ZERO' | 'REDUCAO_PERCENTUAL' | 'ISENCAO' | 'IMUNIDADE' | 'SUSPENSAO' | 'DIFERIMENTO';
  percentualReducao?: number;
  baseLegal: string;
  vigenciaInicio: string; // ISO date
  vigenciaFim?: string;
}

/**
 * Importador que converte a exportação do sistema de apuração NCM/NBS já
 * em produção (Python + web) para o formato `BeneficioCadastrado`
 * consumido por `BeneficiosService.hidratarCadastro()` neste motor.
 *
 * Uso sugerido no bootstrap da aplicação:
 * ```ts
 * const registros = await fetchDoSistemaExistente(); // sua API/export atual
 * const cadastro = importadorNcmNbs.converter(registros);
 * beneficiosService.hidratarCadastro(cadastro);
 * ```
 *
 * Isso evita reconstruir do zero o trabalho já feito (categorização por
 * Anexo da LC 214/2025, consulta ao Conformidade Fácil e ao Legisweb) —
 * este motor de cálculo passa a ser o "cérebro" de apuração por operação,
 * e o sistema existente continua sendo a fonte de verdade do cadastro de
 * benefícios por NCM/NBS.
 */
@Injectable()
export class ImportadorNcmNbsService {
  converter(registros: RegistroExportadoSistemaExistente[]): BeneficioCadastrado[] {
    return registros.map((r, indice) => ({
      codigo: this.gerarCodigo(r, indice),
      tipo: r.tipoBeneficio,
      percentualReducao: r.percentualReducao !== undefined ? new Decimal(r.percentualReducao) : undefined,
      baseLegal: r.baseLegal,
      cumulativo: false, // conservador por padrão — sistema existente pode ajustar caso a caso
      vigenciaInicio: paraDataUTC(r.vigenciaInicio),
      vigenciaFim: r.vigenciaFim ? paraDataUTC(r.vigenciaFim) : undefined,
      criterios: {
        ncm: r.ncm ? [r.ncm] : undefined,
        nbs: r.nbs ? [r.nbs] : undefined,
        cest: r.cest ? [r.cest] : undefined,
        cnae: r.cnae ? [r.cnae] : undefined,
        tipoOperacao: ['VENDA'], // sistema existente hoje classifica por entrada/saída — refinar ao integrar
      },
    }));
  }

  private gerarCodigo(r: RegistroExportadoSistemaExistente, indice: number): string {
    const base = r.ncm ?? r.nbs ?? `ITEM_${indice}`;
    return `IMPORTADO_${base}_${r.anexoLc214 ?? 'SEM_ANEXO'}`.replace(/\s+/g, '_').toUpperCase();
  }
}
