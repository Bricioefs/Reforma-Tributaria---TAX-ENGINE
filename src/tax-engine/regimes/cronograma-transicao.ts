import Decimal from 'decimal.js';

export interface AliquotasDoAno {
  cbs: Decimal;
  ibsEstadual: Decimal;
  ibsMunicipal: Decimal;
}

/**
 * Alíquotas de referência PLENAS (sistema já maduro, a partir de 2033).
 *
 * PENDÊNCIA REGULAMENTAR: a LC 214/2025 não fixa esses percentuais — eles
 * dependem de cálculo do Tribunal de Contas da União e Resolução do
 * Senado Federal (CF, art. 156-A, §1º, X), buscando manter a carga
 * tributária neutra em relação ao sistema atual. Projeções de mercado
 * mais citadas apontam ~8,8% (CBS) + ~17,7% (IBS) ≈ 26,5%. Os valores
 * abaixo — CBS 10% + IBS 18% = 28% — são o PADRÃO usado neste motor
 * enquanto a alíquota definitiva não é publicada.
 *
 * CONFIGURÁVEL: como a alíquota definitiva ainda não existe, o usuário
 * pode alterar esses dois valores (`definirAliquotasPlenas()`, exposto
 * via `GET/PUT /parametrizacao/aliquotas-plenas`) para testar cenários
 * com premissas diferentes — todo o sistema (cálculo de operação,
 * apuração, projeção, exportação) usa esses valores em tempo real, sem
 * precisar recompilar nada. Guardados como `let` (não `const`) POR ISSO,
 * mas nunca exportados diretamente — só através de `obterAliquotasPlenas()`/
 * `definirAliquotasPlenas()`, para evitar o problema de "binding" do
 * CommonJS (um `import { ALIQUOTA_X }` direto não veria a atualização
 * feita depois por uma função deste módulo).
 */
let aliquotaCbsPlena = new Decimal(10);
let aliquotaIbsPlena = new Decimal(18);

export function obterAliquotaCbsPlena(): Decimal {
  return aliquotaCbsPlena;
}

export function obterAliquotaIbsPlena(): Decimal {
  return aliquotaIbsPlena;
}

/** Redefine as alíquotas de referência plenas — usadas por TODO cálculo/projeção feito a partir de agora (não recalcula retroativamente lançamentos já persistidos, que guardam o valor calculado na época). */
export function definirAliquotasPlenas(cbs: Decimal, ibs: Decimal): void {
  if (cbs.isNegative() || ibs.isNegative()) {
    throw new Error('Alíquotas não podem ser negativas.');
  }
  aliquotaCbsPlena = cbs;
  aliquotaIbsPlena = ibs;
}

/** Volta as alíquotas plenas para o padrão do sistema (CBS 10% + IBS 18%). */
export function restaurarAliquotasPlenasPadrao(): void {
  aliquotaCbsPlena = new Decimal(10);
  aliquotaIbsPlena = new Decimal(18);
}

/**
 * Proporção do IBS pleno destinada à parcela ESTADUAL (o restante vai
 * para a parcela MUNICIPAL). A LC 214/2025 não fixa uma proporção única
 * nacional — cada ente calcula a própria alíquota de referência (CF, art.
 * 156-A, §1º, X) — este valor é um padrão ilustrativo e parametrizável.
 */
export const PROPORCAO_IBS_ESTADUAL = new Decimal(0.9);

function dividirIbs(ibsTotal: Decimal): { estadual: Decimal; municipal: Decimal } {
  const estadual = ibsTotal.times(PROPORCAO_IBS_ESTADUAL).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const municipal = ibsTotal.minus(estadual).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return { estadual, municipal };
}

/**
 * Cronograma de transição (LC 214/2025, art. 343 e seguintes):
 *
 *   2026            — Alíquotas-teste fixas: CBS 0,9% / IBS 0,1%,
 *                      compensáveis com PIS/COFINS/ICMS/ISS (fase de
 *                      calibração de sistemas, sem efeito arrecadatório
 *                      líquido pretendido).
 *   2027 a 2028      — CBS plena (substitui PIS/COFINS integralmente);
 *                      IBS permanece na alíquota-teste de 0,1% (ICMS/ISS
 *                      ainda vigentes em paralelo).
 *   2029 a 2032      — IBS sobe gradualmente (10 pontos percentuais da
 *                      alíquota plena por ano) enquanto ICMS/ISS são
 *                      proporcionalmente reduzidos.
 *   2033 em diante    — Sistema pleno: CBS e IBS na alíquota de
 *                      referência integral; ICMS/ISS extintos.
 *
 * PENDÊNCIA REGULAMENTAR: a rampa linear de 2029 a 2032 (10 p.p./ano)
 * segue o cronograma amplamente divulgado com base nos arts. 343 a 348 da
 * LC 214/2025; ajustes finos por lei complementar posterior são um ponto
 * de extensão nesta função.
 */
export function aliquotasParaAno(ano: number): AliquotasDoAno {
  if (ano <= 2026) {
    const { estadual, municipal } = dividirIbs(new Decimal(0.1));
    return { cbs: new Decimal(0.9), ibsEstadual: estadual, ibsMunicipal: municipal };
  }

  if (ano === 2027 || ano === 2028) {
    const { estadual, municipal } = dividirIbs(new Decimal(0.1));
    return { cbs: obterAliquotaCbsPlena(), ibsEstadual: estadual, ibsMunicipal: municipal };
  }

  if (ano >= 2029 && ano <= 2032) {
    const fatorRampa = new Decimal((ano - 2028) * 10).dividedBy(100); // 2029: 10% ... 2032: 40%
    const { estadual, municipal } = dividirIbs(obterAliquotaIbsPlena().times(fatorRampa));
    return { cbs: obterAliquotaCbsPlena(), ibsEstadual: estadual, ibsMunicipal: municipal };
  }

  // 2033 em diante — sistema pleno
  const { estadual, municipal } = dividirIbs(obterAliquotaIbsPlena());
  return { cbs: obterAliquotaCbsPlena(), ibsEstadual: estadual, ibsMunicipal: municipal };
}

/** Conveniência para resolver a partir de uma data de operação. */
export function aliquotasParaData(data: Date): AliquotasDoAno {
  return aliquotasParaAno(data.getFullYear());
}
