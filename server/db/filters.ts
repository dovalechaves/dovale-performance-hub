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
  l2: [954, 159, 951, 6, 39, 114],        // Santana: E-COMMERCE, JOSI, LIZ, LOJA, PAMELA, THASMIN
  l3: [519, 543, 559, 2049],              // Rio de Janeiro: LENIN, LIGIA BENTO, RAYANE LIMA, REBECA PEREIRA
};

// Códigos PERMITIDOS por loja (whitelist — somente esses aparecem)
const PERMITIR_CODIGOS: Record<string, number[]> = {
  campinas: [24, 42, 6, 29, 3, 43],       // BEATRIZ, CAMILA, CHICO, Ester, LOJA, MAIARA
};

/** Gera o trecho WHERE para Firebird */
export function firebirdFiltroRep(alias = "r", loja = "bh"): string {
  const permitidos = PERMITIR_CODIGOS[loja];
  if (permitidos?.length) {
    return `AND ${alias}.REP_CODIGO IN (${permitidos.join(", ")})`;
  }
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

/**
 * Consolidação de representantes no painel de vendas.
 * As vendas dos códigos listados são somadas ao código "pai".
 * Exemplo: em BH, CAMILA/CLARICE/DEISE/etc são somadas ao rep 46 (LOJA).
 */
const CONSOLIDAR_REPS: Record<string, { pai: number; nome: string; filhos: number[] }[]> = {
  bh: [
    { pai: 46, nome: "LOJA", filhos: [3119, 46, 3115, 26, 3114, 100] },
    // 3119, 46, 3115, 26, 3114, 100 conforme solicitado
  ],
};

export interface VendaRow {
  rep_codigo: string;
  rep_nome: string;
  total_vendas: number;
}

/** Consolida vendas: mantém cards individuais e soma filhos no pai */
export function consolidarVendas(rows: VendaRow[], loja: string): VendaRow[] {
  const regras = CONSOLIDAR_REPS[loja];
  if (!regras?.length) return rows;

  // Monta mapa: filho -> pai
  const filhoParaPai = new Map<string, { pai: string; nome: string }>();
  for (const r of regras) {
    for (const f of r.filhos) {
      filhoParaPai.set(String(f), { pai: String(r.pai), nome: r.nome });
    }
  }

  // Acumula total do pai
  const paiTotals = new Map<string, { nome: string; total: number }>();
  for (const row of rows) {
    const code = String(row.rep_codigo).trim();
    const target = filhoParaPai.get(code);
    if (target) {
      const existing = paiTotals.get(target.pai);
      if (existing) {
        existing.total += row.total_vendas;
      } else {
        paiTotals.set(target.pai, { nome: target.nome, total: row.total_vendas });
      }
    }
  }

  // Soma vendas do próprio pai (se existir)
  for (const row of rows) {
    const code = String(row.rep_codigo).trim();
    if (paiTotals.has(code) && !filhoParaPai.has(code)) {
      paiTotals.get(code)!.total += row.total_vendas;
    }
  }

  // Monta resultado: todos os rows originais + atualiza/insere o pai
  const result: VendaRow[] = [];
  const paiCodes = new Set(paiTotals.keys());

  for (const row of rows) {
    const code = String(row.rep_codigo).trim();
    if (paiCodes.has(code)) {
      // Substitui pelo total consolidado
      const p = paiTotals.get(code)!;
      result.push({ rep_codigo: code, rep_nome: p.nome, total_vendas: p.total });
      paiCodes.delete(code); // só insere uma vez
    } else {
      result.push(row);
    }
  }

  // Se o pai não existia nos rows originais, adiciona
  for (const [code, p] of paiTotals) {
    if (!rows.some(r => String(r.rep_codigo).trim() === code)) {
      result.push({ rep_codigo: code, rep_nome: p.nome, total_vendas: p.total });
    }
  }

  return result;
}

/** Gera o trecho WHERE para Firebird vendas */
export function firebirdFiltroVendas(alias = "r", loja = "bh"): string {
  const baseFiltro = firebirdFiltroRep(alias, loja);
  // Para BH, não aplicar filtros por nome para os códigos na lista de consolidação de LOJA
  if (loja === "bh") {
    const codigosConsolidados = CONSOLIDAR_REPS.bh[0]?.filhos || [];
    if (codigosConsolidados.length) {
      const codigos = codigosConsolidados.join(", ");
      return baseFiltro
        .replace(
          `AND ${alias}.REP_NOME NOT CONTAINING 'DISTRIBUIDOR'`,
          `AND (${alias}.REP_NOME NOT CONTAINING 'DISTRIBUIDOR' OR ${alias}.REP_CODIGO IN (${codigos}))`
        )
        .replace(
          `AND ${alias}.REP_NOME NOT IN (${IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ")})`,
          `AND (${alias}.REP_NOME NOT IN (${IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ")}) OR ${alias}.REP_CODIGO IN (${codigos}))`
        );
    }
  }
  return baseFiltro;
}

/** Gera o trecho WHERE para SQL Server */
export function sqlServerFiltroRep(col = "rep_nome"): string {
  const nomes = IGNORAR_NOMES_BH.map(n => `'${n}'`).join(", ");
  return `
    AND ${col} NOT LIKE '%DISTRIBUIDOR%'
    AND ${col} NOT IN (${nomes})
  `;
}
