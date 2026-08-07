/**
 * Classificações baseadas no CFOP da operação — pedido explícito do
 * usuário: a busca de benefício de exportação/importação deve olhar o
 * CFOP primeiro (não só o campo `tipo`/`âmbito` escolhido manualmente),
 * e o cálculo de crédito/débito deve considerar se aquele CFOP específico
 * de fato gera crédito (entrada) ou débito (saída) — nem toda entrada
 * gera crédito, nem toda saída gera débito (ex: remessa sem venda).
 */

function cfopNormalizado(cfop: string | undefined | null): string {
  return (cfop ?? '').replace(/\D/g, '');
}

/** Verifica se o CFOP começa com um prefixo específico (aceita CFOP com ou sem pontuação, ex: "6.101" ou "6101"). */
export function cfopComecaCom(cfop: string | undefined | null, prefixo: string): boolean {
  const normalizado = cfopNormalizado(cfop);
  return normalizado.length > 0 && normalizado.startsWith(prefixo);
}

/**
 * CFOPs que representam mera MOVIMENTAÇÃO de mercadoria — remessa/retorno
 * para conserto, industrialização por encomenda, demonstração,
 * consignação ou depósito — SEM transferência definitiva de propriedade.
 * Por não haver operação onerosa (circulação de riqueza), não geram
 * débito na saída nem crédito na entrada, mesmo vindo de uma planilha
 * importada como "COMPRA"/"VENDA" genérica (que por si só assumiria
 * crédito/débito integral).
 *
 * PENDÊNCIA: lista inicial com os CFOPs mais reconhecidos dessa
 * natureza (grupo "remessa"/"retorno" da Tabela CFOP oficial) — ajustar
 * aqui se a lista completa usada pela empresa for mais ampla ou mais
 * restrita do que isso.
 */
const CFOPS_SEM_CREDITO_OU_DEBITO = new Set([
  // Remessa para industrialização por encomenda / retorno
  '5901', '5902', '6901', '6902', '1901', '1902', '2901', '2902', '3901',
  // Remessa para conserto ou reparo / retorno
  '5915', '5916', '6915', '6916', '1915', '1916', '2915', '2916',
  // Remessa para demonstração / retorno
  '5912', '5913', '6912', '6913', '1912', '1913', '2912', '2913',
  // Remessa para depósito fechado ou armazém geral / retorno
  '5905', '5906', '6905', '6906', '1905', '1906', '2905', '2906',
  // Remessa em consignação mercantil / retorno
  '5917', '5918', '6917', '6918', '1917', '1918', '2917', '2918',
]);

/**
 * `true` quando o CFOP indica uma operação que efetivamente gera
 * crédito (entrada) ou débito (saída) de IBS/CBS — `false` para
 * remessas/retornos sem transferência de propriedade.
 *
 * Sem CFOP informado, retorna `true` (não bloqueia o cálculo) — mais
 * seguro do que presumir "não gera" só por falta de informação.
 */
export function cfopGeraCreditoOuDebito(cfop: string | undefined | null): boolean {
  const normalizado = cfopNormalizado(cfop);
  if (!normalizado) return true;
  return !CFOPS_SEM_CREDITO_OU_DEBITO.has(normalizado);
}
