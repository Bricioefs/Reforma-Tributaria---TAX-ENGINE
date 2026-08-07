import { Injectable, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ResultadoDebito, RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';

export interface PerfilBeneficiario {
  cpf: string;
  inscritoCadastroUnico: boolean; // CadÚnico — critério de elegibilidade
  municipioIbge?: string;
  uf?: string;
}

export interface RegraCashback {
  categoria: string; // ex: "ENERGIA_ELETRICA", "AGUA_SANEAMENTO", "GAS_BOTIJAO", "TELECOM"
  percentualIbs: Decimal;
  percentualCbs: Decimal;
  baseLegal: string;
}

export interface ResultadoCashback {
  elegivel: boolean;
  categoria?: string;
  valorRestituidoIbs: Decimal;
  valorRestituidoCbs: Decimal;
  valorRestituidoTotal: Decimal;
  memoria: RegistroMemoriaCalculo;
}

/**
 * Motor de Cashback (LC 214/2025, art. 44 e seguintes) — devolução de parte
 * do IBS/CBS pago por famílias de baixa renda inscritas no Cadastro Único,
 * sobre categorias essenciais (energia elétrica, água/saneamento, gás de
 * cozinha, telecomunicações, entre outras que vierem a ser definidas).
 *
 * Elegibilidade depende de inscrição no CadÚnico — critério objetivo já
 * conhecido; os PERCENTUAIS de restituição por categoria podem variar por
 * ente federativo (Estados/Municípios podem majorar o percentual mínimo
 * federal) — por isso são parametrizados via `RegraCashback`, nunca fixos
 * no código.
 *
 * PENDÊNCIA REGULAMENTAR: os percentuais mínimos nacionais definitivos por
 * categoria e a lista completa de categorias elegíveis dependem de
 * regulamentação complementar do Comitê Gestor — o seed abaixo é
 * ilustrativo (percentuais zerados), substituível por
 * `RegraCashbackRepository` em produção.
 */
@Injectable()
export class CashbackService {
  constructor(@Optional() private readonly regras: RegraCashback[] = SEED_REGRAS_CASHBACK) {}

  calcular(
    beneficiario: PerfilBeneficiario,
    categoriaOperacao: string,
    debitos: ResultadoDebito[],
  ): ResultadoCashback {
    if (!beneficiario.inscritoCadastroUnico) {
      return this.naoElegivel(categoriaOperacao, 'Beneficiário não inscrito no Cadastro Único (CadÚnico).');
    }

    const regra = this.regras.find((r) => r.categoria === categoriaOperacao);
    if (!regra) {
      return this.naoElegivel(categoriaOperacao, 'Categoria da operação não consta na lista de itens elegíveis a cashback.');
    }

    const totalIbs = debitos
      .filter((d) => d.tributo === 'IBS_ESTADUAL' || d.tributo === 'IBS_MUNICIPAL')
      .reduce((acc, d) => acc.plus(d.valor), new Decimal(0));
    const totalCbs = debitos
      .filter((d) => d.tributo === 'CBS')
      .reduce((acc, d) => acc.plus(d.valor), new Decimal(0));

    const valorRestituidoIbs = totalIbs.times(regra.percentualIbs).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const valorRestituidoCbs = totalCbs.times(regra.percentualCbs).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      elegivel: true,
      categoria: categoriaOperacao,
      valorRestituidoIbs,
      valorRestituidoCbs,
      valorRestituidoTotal: valorRestituidoIbs.plus(valorRestituidoCbs),
      memoria: {
        regraAplicada: 'CashbackService.calcular',
        baseLegal: regra.baseLegal,
        parametrosUsados: {
          categoria: categoriaOperacao,
          percentualIbs: regra.percentualIbs.toString(),
          percentualCbs: regra.percentualCbs.toString(),
          cpfBeneficiario: beneficiario.cpf,
        },
        aliquotaUtilizada: regra.percentualIbs,
        baseCalculo: totalIbs.plus(totalCbs),
        valorApurado: valorRestituidoIbs.plus(valorRestituidoCbs),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }

  private naoElegivel(categoria: string, motivo: string): ResultadoCashback {
    return {
      elegivel: false,
      categoria,
      valorRestituidoIbs: new Decimal(0),
      valorRestituidoCbs: new Decimal(0),
      valorRestituidoTotal: new Decimal(0),
      memoria: {
        regraAplicada: 'CashbackService.calcular (não elegível)',
        baseLegal: 'LC 214/2025, art. 44 (elegibilidade por inscrição no CadÚnico)',
        parametrosUsados: { categoria, motivo },
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: new Decimal(0),
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }
}

/** Seed ilustrativo — percentuais definitivos dependem de regulamentação (ver docstring). */
export const SEED_REGRAS_CASHBACK: RegraCashback[] = [
  {
    categoria: 'ENERGIA_ELETRICA',
    percentualIbs: new Decimal(0), // PENDÊNCIA REGULAMENTAR
    percentualCbs: new Decimal(0),
    baseLegal: 'LC 214/2025, art. 44, I (energia elétrica residencial de baixa renda)',
  },
  {
    categoria: 'AGUA_SANEAMENTO',
    percentualIbs: new Decimal(0),
    percentualCbs: new Decimal(0),
    baseLegal: 'LC 214/2025, art. 44, II (água e saneamento)',
  },
  {
    categoria: 'GAS_BOTIJAO',
    percentualIbs: new Decimal(0),
    percentualCbs: new Decimal(0),
    baseLegal: 'LC 214/2025, art. 44, III (gás de cozinha — GLP botijão)',
  },
  {
    categoria: 'TELECOM',
    percentualIbs: new Decimal(0),
    percentualCbs: new Decimal(0),
    baseLegal: 'LC 214/2025, art. 44, IV (telecomunicações)',
  },
];
