/**
 * Filtros de representantes por loja.
 * Nomes/códigos que não devem aparecer no sistema.
 */
export const IGNORAR_NOMES_BH = [
  'DESCONSIDERAR',
  'DUPLICIDADE',
  'INATIVO',
  'MARCILIO',
  'JARDEL',
];

/** Gera o trecho WHERE para Firebird */
export function firebirdFiltroRep(alias = "r"): string {
  const nomes = IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ");
  return `
    AND ${alias}.REP_NOME IS NOT NULL
    AND ${alias}.REP_NOME NOT CONTAINING 'DISTRIBUIDOR'
    AND ${alias}.REP_NOME NOT IN (${nomes})
  `;
}

/** Gera o trecho WHERE para SQL Server */
export function sqlServerFiltroRep(col = "rep_nome"): string {
  const nomes = IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ");
  return `
    AND ${col} NOT LIKE '%DISTRIBUIDOR%'
    AND ${col} NOT IN (${nomes})
  `;
}
