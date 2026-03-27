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

// Códigos ignorados por loja
const IGNORAR_CODIGOS: Record<string, number[]> = {
  l2: [954, 159, 951, 6, 39, 114],      // Santana: E-COMMERCE, JOSI, LIZ, LOJA, PAMELA, THASMIN
  l3: [519, 543, 559, 2049],             // Rio de Janeiro: LENIN, LIGIA BENTO, RAYANE LIMA, REBECA PEREIRA
};

/** Gera o trecho WHERE para Firebird */
export function firebirdFiltroRep(alias = "r", loja = "bh"): string {
  const nomes = IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ");
  const codigos = IGNORAR_CODIGOS[loja];
  const codigoFiltro = codigos?.length
    ? `AND ${alias}.REP_CODIGO NOT IN (${codigos.join(", ")})`
    : "";
  return `
    AND ${alias}.REP_NOME IS NOT NULL
    AND ${alias}.REP_NOME NOT CONTAINING 'DISTRIBUIDOR'
    AND ${alias}.REP_NOME NOT IN (${nomes})
    ${codigoFiltro}
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
