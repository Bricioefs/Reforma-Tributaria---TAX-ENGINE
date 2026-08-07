import Decimal from 'decimal.js';
import {
  DadosOperacao,
  RegimeTributarioStrategy,
  ResultadoBaseCalculo,
  BeneficioResolvido,
  ResultadoDebito,
} from '../../interfaces/tax-engine.interfaces';
import { cfopComecaCom } from '../../util/classificacao-cfop';

/**
 * Exportação (LC 214/2025, art. 9º, IV c/c CF, art. 156-A, §1º, VII) —
 * IMUNIDADE constitucional. Diferente de isenção: o direito a crédito das
 * etapas anteriores é MANTIDO integralmente (não há estorno), e o exportador
 * pode inclusive pedir ressarcimento do saldo credor acumulado.
 *
 * Reconhece EXCLUSIVAMENTE pelo CFOP de saída começando com "7" — grupo
 * oficial da Tabela CFOP para "operações com o exterior" (inclui
 * exportação). Se o CFOP não começar com 7 (mesmo que `tipo=EXPORTACAO`
 * ou `ambito=INTERNACIONAL` tenham sido marcados), a operação NÃO é
 * tratada como exportação — cai para o regime padrão, que busca o
 * benefício pelo NCM/NBS normalmente.
 *
 * (Corrigido: uma primeira versão usava o prefixo "6" por pedido
 * explícito do usuário — "6.xxx" é na verdade o grupo de operações
 * INTERESTADUAIS na Tabela CFOP oficial, não exportação; confirmado e
 * ajustado para "7", o prefixo correto.)
 *
 * Precedência alta: quando o CFOP indica exportação, ela sempre prevalece
 * sobre qualquer regime setorial.
 */
export class RegimeExportacaoStrategy implements RegimeTributarioStrategy {
  readonly codigo = 'REGIME_EXPORTACAO';
  readonly baseLegal = 'LC 214/2025, art. 9º, IV c/c CF, art. 156-A, §1º, VII (imunidade nas exportações)';

  aplicavel(dados: DadosOperacao): boolean {
    return cfopComecaCom(dados.cfop, '7');
  }

  calcular(
    _dados: DadosOperacao,
    baseCalculo: ResultadoBaseCalculo[],
    _beneficios: BeneficioResolvido[],
  ): ResultadoDebito[] {
    const baseIbs = baseCalculo.find((b) => b.tributo === 'IBS')!;
    const baseCbs = baseCalculo.find((b) => b.tributo === 'CBS')!;

    const imunidade: BeneficioResolvido = {
      codigo: 'EXPORTACAO_IMUNIDADE_MANTEM_CREDITO',
      tipo: 'IMUNIDADE',
      baseLegal: this.baseLegal,
      cumulativo: false,
    };

    return [
      this.zero('IBS_ESTADUAL', baseIbs.baseCalculo, imunidade),
      this.zero('IBS_MUNICIPAL', baseIbs.baseCalculo, imunidade),
      this.zero('CBS', baseCbs.baseCalculo, imunidade),
    ];
  }

  private zero(tributo: ResultadoDebito['tributo'], base: Decimal, beneficio: BeneficioResolvido): ResultadoDebito {
    return {
      tributo,
      baseCalculo: base,
      aliquotaNominal: new Decimal(0),
      aliquotaEfetiva: new Decimal(0),
      valor: new Decimal(0),
      beneficiosAplicados: [beneficio],
      memoria: {
        regraAplicada: `RegimeExportacaoStrategy (${tributo})`,
        baseLegal: this.baseLegal,
        parametrosUsados: { base: base.toString(), creditoAnteriorMantido: true },
        beneficioAplicadoCodigo: beneficio.codigo,
        aliquotaUtilizada: new Decimal(0),
        baseCalculo: base,
        valorApurado: new Decimal(0),
        dataVigenciaRegra: new Date('2026-01-01'),
        versaoRegra: '1.0.0',
      },
    };
  }
}
