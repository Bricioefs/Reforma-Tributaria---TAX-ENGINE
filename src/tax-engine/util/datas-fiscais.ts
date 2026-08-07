/**
 * Interpreta uma string de data/hora ISO SEMPRE como UTC, mesmo quando não
 * traz sufixo de fuso (`Z` ou `+HH:MM`) — o comportamento padrão do
 * JavaScript para strings `"AAAA-MM-DDTHH:mm:ss"` sem fuso é interpretá-las
 * como HORÁRIO LOCAL do processo, o que causa datas de vigência
 * incorretas dependendo de onde o programa está rodando.
 *
 * BUG RELATADO E CORRIGIDO: um benefício com
 * `vigenciaInicio: "2026-01-01T00:00:00"` (sem fuso, como vem da
 * exportação do Conformidade Fácil) era interpretado como meia-noite no
 * fuso do PROCESSO — numa máquina no Brasil (UTC-3), isso equivale a
 * `2026-01-01T03:00:00Z`. Uma operação datada de `"2026-01-01"` (sempre
 * interpretada como `00:00:00Z` pelo JavaScript, por ser uma data "pura"
 * sem hora, vinda de um campo `<input type="date">`) ficava então ANTES
 * da vigência por 3 horas — o benefício era corretamente encontrado pela
 * tela de consulta (que usa a data atual do servidor, bem depois de
 * 2026-01-01, sem sofrer esse efeito de borda), mas NÃO era aplicado no
 * cálculo de uma operação datada exatamente do primeiro dia de vigência.
 *
 * Usar esta função em vez de `new Date(string)` sempre que a string vier
 * de uma fonte externa (exportação de dados, banco) sem garantia de
 * incluir o fuso horário.
 */
export function paraDataUTC(dataIso: string): Date {
  const jaTemFuso = /Z$|[+-]\d{2}:\d{2}$/.test(dataIso);
  return new Date(jaTemFuso ? dataIso : `${dataIso}Z`);
}
