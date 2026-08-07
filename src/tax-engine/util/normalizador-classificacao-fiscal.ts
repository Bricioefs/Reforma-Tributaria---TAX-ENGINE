/**
 * Normaliza um código de classificação fiscal (NCM, NBS, CEST, CNAE) para
 * comparação: remove tudo que não for letra/número e deixa em maiúsculas.
 *
 * Sem isso, "0901.21.00" (cadastrado com pontuação) nunca batia com
 * "09012100" (digitado sem pontuação) mesmo sendo o mesmo código — bug
 * relatado onde uma consulta de benefício por NCM não encontrava nada e o
 * cálculo da operação também não aplicava o benefício, mesmo para um NCM
 * que estava corretamente cadastrado.
 */
export function normalizarCodigoFiscal(codigo: string | undefined | null): string {
  return (codigo ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Compara duas listas/valores de código fiscal já normalizando ambos os lados. */
export function codigoFiscalEstaEm(codigo: string | undefined, lista: string[] | undefined): boolean {
  if (!codigo || !lista) return false;
  const alvo = normalizarCodigoFiscal(codigo);
  return lista.some((item) => normalizarCodigoFiscal(item) === alvo);
}
