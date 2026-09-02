/**
 * Descobre, na base Firebird MG (industrial/SPM, filial 7), o nome real da
 * coluna de "estoque minimo" por produto, e se existe alguma tabela separada
 * de produto-por-filial que sobrescreva esse minimo por filial.
 *
 * Uso: npx tsx scripts/descobrir-coluna-estoque-minimo.ts [pro_codigo]
 *      npx tsx scripts/descobrir-coluna-estoque-minimo.ts 123
 */
import "dotenv/config";
import { queryFirebird } from "../server/db/firebird";

const LOJA = "mg" as const;
const FILIAL_MG = 7;
const proCodigoTeste = process.argv[2] || null;

interface FieldRow {
  TABELA: string;
  CAMPO: string;
}

interface TableRow {
  TABELA: string;
}

const trim = (v: unknown) => String(v ?? "").trim();

async function listarTabelasComMinimo(): Promise<TableRow[]> {
  const sql = `
    SELECT DISTINCT TRIM(r.RDB$RELATION_NAME) AS TABELA
    FROM RDB$RELATION_FIELDS r
    WHERE UPPER(r.RDB$FIELD_NAME) LIKE '%MIN%'
      AND r.RDB$RELATION_NAME NOT STARTING WITH 'RDB$'
      AND r.RDB$RELATION_NAME NOT STARTING WITH 'MON$'
    ORDER BY 1
  `;
  const rows = await queryFirebird<TableRow>(LOJA, sql);
  return rows.map((r) => ({ TABELA: trim(r.TABELA) }));
}

async function listarColunasMinimo(tabela: string): Promise<FieldRow[]> {
  const sql = `
    SELECT TRIM(r.RDB$RELATION_NAME) AS TABELA, TRIM(r.RDB$FIELD_NAME) AS CAMPO
    FROM RDB$RELATION_FIELDS r
    WHERE r.RDB$RELATION_NAME = ?
      AND UPPER(r.RDB$FIELD_NAME) LIKE '%MIN%'
    ORDER BY 2
  `;
  return queryFirebird<FieldRow>(LOJA, sql, [tabela]);
}

async function listarColunasProdutos(): Promise<FieldRow[]> {
  const sql = `
    SELECT TRIM(r.RDB$RELATION_NAME) AS TABELA, TRIM(r.RDB$FIELD_NAME) AS CAMPO
    FROM RDB$RELATION_FIELDS r
    WHERE r.RDB$RELATION_NAME = 'PRODUTOS'
    ORDER BY r.RDB$FIELD_POSITION
  `;
  return queryFirebird<FieldRow>(LOJA, sql);
}

async function testarProduto(campo: string, codigo: string) {
  const sql = `
    SELECT p.pro_codigo, p.pro_resumo, p.${campo} AS ESTOQUE_MINIMO,
           (SELECT disponivel FROM CONSULTA_ESTOQUE(p.pro_codigo, ${FILIAL_MG}, 1, 0, CAST('NOW' AS DATE))) AS SALDO
    FROM produtos p
    WHERE p.pro_codigo = ?
  `;
  return queryFirebird<Record<string, unknown>>(LOJA, sql, [codigo]);
}

async function main() {
  console.log(`[descobrir-estoque-minimo] Conectando na base ${LOJA} (filial ${FILIAL_MG})...\n`);

  console.log("== Tabelas com alguma coluna contendo 'MIN' ==");
  const tabelas = await listarTabelasComMinimo();
  for (const t of tabelas) console.log(`  - ${t.TABELA}`);

  console.log("\n== Colunas de PRODUTOS contendo 'MIN' ==");
  const camposProdutos = await listarColunasMinimo("PRODUTOS");
  for (const c of camposProdutos) console.log(`  - PRODUTOS.${c.CAMPO}`);
  if (camposProdutos.length === 0) {
    console.log("  (nenhuma coluna 'MIN' encontrada diretamente em PRODUTOS)");
  }

  const candidatasFilial = tabelas.filter((t) => t.TABELA !== "PRODUTOS" && /PRODUTO|ESTOQUE|FILIAL/.test(t.TABELA));
  if (candidatasFilial.length > 0) {
    console.log("\n== Possiveis tabelas por-filial com minimo (revisar manualmente) ==");
    for (const t of candidatasFilial) {
      const campos = await listarColunasMinimo(t.TABELA);
      for (const c of campos) console.log(`  - ${t.TABELA}.${c.CAMPO}`);
    }
  }

  if (camposProdutos.length === 0) {
    console.log("\n== Todas as colunas de PRODUTOS (para inspecao manual) ==");
    const todas = await listarColunasProdutos();
    for (const c of todas) console.log(`  - ${c.CAMPO}`);
  }

  if (proCodigoTeste && camposProdutos.length > 0) {
    console.log(`\n== Teste no produto ${proCodigoTeste} ==`);
    for (const c of camposProdutos) {
      try {
        const rows = await testarProduto(c.CAMPO, proCodigoTeste);
        console.log(`  PRODUTOS.${c.CAMPO}:`, rows[0] ?? "(produto nao encontrado)");
      } catch (err) {
        console.log(`  PRODUTOS.${c.CAMPO}: erro ->`, err instanceof Error ? err.message : err);
      }
    }
  } else if (!proCodigoTeste) {
    console.log("\n(Dica: rode de novo passando um pro_codigo conhecido como argumento para validar o valor contra a tela do Microsys.)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
