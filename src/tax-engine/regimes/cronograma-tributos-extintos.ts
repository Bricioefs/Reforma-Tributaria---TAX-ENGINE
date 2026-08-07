import Decimal from 'decimal.js';

export interface PercentuaisTributosExtintos {
  /** % do valor original de PIS ainda devido naquele ano (0 a 100). */
  pis: Decimal;
  cofins: Decimal;
  icms: Decimal;
  iss: Decimal;
  ipi: Decimal;
}

/**
 * Cronograma de EXTINÇÃO/REDUÇÃO dos tributos substituídos pela reforma —
 * o espelho complementar do cronograma de transição de IBS/CBS já
 * implementado em `cronograma-transicao.ts` (a soma "% que resta do
 * tributo antigo" + "% já vigente do tributo novo" é sempre proporcional
 * por desenho da própria lei, para manter a carga tributária neutra
 * durante a transição).
 *
 *   PIS/COFINS (substituídos pela CBS):
 *     até 2026 — 100% (CBS só na alíquota-teste, ainda não substitui nada
 *                de fato; PIS/COFINS continuam sendo cobrados normalmente).
 *     a partir de 2027 — 0% (EXTINTOS de uma vez — LC 214/2025, art. 350 —
 *                não é uma redução gradual como ICMS/ISS: a CBS já entra
 *                em alíquota plena em 2027, substituindo integralmente).
 *
 *   ICMS/ISS (substituídos pelo IBS):
 *     até 2028 — 100% (IBS ainda na alíquota-teste de 0,1% nesse período,
 *                não substitui nada de fato).
 *     2029 a 2032 — reduzidos na MESMA proporção que o IBS sobe (10 pontos
 *                percentuais da alíquota plena por ano — mesma rampa de
 *                `aliquotasParaAno`): 2029→90%, 2030→80%, 2031→70%, 2032→60%.
 *     a partir de 2033 — 0% (extintos — sistema pleno).
 *
 *   IPI:
 *     até 2026 — 100%.
 *     a partir de 2027 — 0% (reduzido a zero — LC 214/2025, art. 353),
 *                EXCETO para operações com origem/destino na Zona Franca
 *                de Manaus ou Área de Livre Comércio (`operacaoZfmOuAlc`),
 *                onde o IPI é mantido para preservar a competitividade
 *                fiscal da ZFM — nesse caso, 100% em qualquer ano.
 *
 * PENDÊNCIA REGULAMENTAR: a rampa de 2029-2032 segue o mesmo cronograma
 * amplamente divulgado com base nos arts. 343 a 348 e 350 a 354 da LC
 * 214/2025 já usado em `cronograma-transicao.ts` — mesma ressalva de
 * ajuste fino por lei complementar posterior.
 */
export function percentuaisTributosExtintosParaAno(ano: number, zfm = false): PercentuaisTributosExtintos {
  const pisCofins = ano <= 2026 ? new Decimal(100) : new Decimal(0);

  let icmsIss: Decimal;
  if (ano <= 2028) icmsIss = new Decimal(100);
  else if (ano >= 2033) icmsIss = new Decimal(0);
  else icmsIss = new Decimal(100).minus((ano - 2028) * 10); // 2029: 90 ... 2032: 60

  const ipi = zfm ? new Decimal(100) : ano <= 2026 ? new Decimal(100) : new Decimal(0);

  return { pis: pisCofins, cofins: pisCofins, icms: icmsIss, iss: icmsIss, ipi };
}

/** Conveniência para resolver a partir de uma data de operação. */
export function percentuaisTributosExtintosParaData(data: Date, zfm = false): PercentuaisTributosExtintos {
  return percentuaisTributosExtintosParaAno(data.getFullYear(), zfm);
}
