/**
 * Tipos de operação que representam ENTRADA (compra/aquisição) — geram
 * direito a CRÉDITO na apuração, em vez de débito. `IMPORTACAO` também é
 * uma entrada (o IBS/CBS pago no desembaraço aduaneiro gera crédito ao
 * importador contribuinte).
 *
 * Os demais tipos (`VENDA`, `EXPORTACAO`, `BONIFICACAO`, etc.) são saídas
 * e geram débito normalmente.
 *
 * Fonte única — usada tanto pela apuração (`ApuracaoController`) quanto
 * pela projeção anual (`ProjecaoAnualService`), para as duas nunca
 * divergirem entre si sobre o que é crédito e o que é débito.
 */
export const TIPOS_DE_ENTRADA = new Set(['COMPRA', 'IMPORTACAO']);

export function ehLancamentoDeEntrada(tipo: string): boolean {
  return TIPOS_DE_ENTRADA.has(tipo);
}
