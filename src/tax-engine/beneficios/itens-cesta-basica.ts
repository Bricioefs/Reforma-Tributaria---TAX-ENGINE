export interface ItemCestaBasica {
  ncm: string;
  descricao: string;
}

/**
 * Itens da Cesta Básica Nacional de Alimentos (LC 214/2025, art. 141,
 * Anexo I — alíquota zero de IBS/CBS). Lista ILUSTRATIVA — o Anexo I
 * completo tem centenas de códigos NCM; aqui ficam alguns exemplos reais
 * e representativos, substituíveis pela integração com o Conformidade
 * Fácil (ver `beneficios/repository/` e `integracao/`).
 *
 * ÚNICA fonte de verdade para "o que é cesta básica" neste motor — usada
 * tanto por `BeneficiosService` (endpoint de consulta) quanto por
 * `RegimeCestaBasicaStrategy` (cálculo real da operação). Antes desta
 * unificação, as duas listas eram mantidas separadamente e podiam
 * divergir (ex: um NCM presente numa lista e ausente na outra, fazendo a
 * consulta e o cálculo darem respostas diferentes para o mesmo produto).
 */
export const ITENS_CESTA_BASICA: ItemCestaBasica[] = [
  { ncm: '1006.30.21', descricao: 'Arroz' },
  { ncm: '1101.00.10', descricao: 'Farinha de trigo' },
  { ncm: '0713.33.19', descricao: 'Feijão' },
  { ncm: '0901.21.00', descricao: 'Café torrado e moído, não descafeinado' },
  { ncm: '0401.10.10', descricao: 'Leite fluido' },
  { ncm: '1905.90.90', descricao: 'Pão' },
];

export function itensCestaBasicaComoCriteriosNcm(): string[] {
  return ITENS_CESTA_BASICA.map((item) => item.ncm);
}
