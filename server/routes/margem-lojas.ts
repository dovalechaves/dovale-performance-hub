import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

const router = Router();
export default router;

// Limita quantas queries Firebird rodam ao mesmo tempo nesta rota — o mesmo
// servidor (192.168.10.37) atende SJC e MG e também o ERP em produção das
// lojas, então paralelizar sem limite (12 lojas × 2 bases × 2 queries = até
// 48 conexões simultâneas) arriscaria sobrecarregar um servidor compartilhado
// com uso real. Isso só acelera a ordem de execução — não muda nenhuma
// query nem cálculo.
function criarLimitador(concorrenciaMaxima: number) {
  let emExecucao = 0;
  const fila: (() => void)[] = [];
  const proximo = () => {
    emExecucao--;
    const tarefa = fila.shift();
    if (tarefa) tarefa();
  };
  return function limitar<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const executar = () => {
        emExecucao++;
        fn().then(
          (valor) => { resolve(valor); proximo(); },
          (erro) => { reject(erro); proximo(); }
        );
      };
      if (emExecucao < concorrenciaMaxima) executar();
      else fila.push(executar);
    });
  };
}
const limitarFirebird = criarLimitador(6);

// ═══════════════════════════════════════════════════════════════════════════
// Painel "Margem de Venda das Lojas" — mede o LUCRO DA INDÚSTRIA (SJC/MG) nas
// vendas internas pra cada uma das lojas (não a margem de varejo da loja com
// o cliente final).
//
// Preço de venda (indústria → loja) — SEMPRE da tabela, produto normal ou
// chave, sem exceção: TABELAS_PRODUTOS.TBP_PRECO da tabela de preço específica
// daquela loja em SJC e/ou MG (ex: "TABELA BH" = código 6 em SJC / 8 em MG).
// É CALCULADO (qtde × tbp_preco), não o valor gravado no pedido.
//  - EP: só entram as CHAVES (identificadas por EP_ProdutosDoPedido.SUBGRUPO
//    = 'CHAVE'), com preço SEMPRE FIXO de R$ 1,51. A loja é identificada pelo
//    campo EP.VENDEDOR, que já traz o nome da loja diretamente (ex: "BH",
//    "Campinas", "Rio de Janeiro").
//  - Uma mesma chave pode vender pela indústria (SJC/MG) E pela EP na mesma
//    loja no mesmo período — as duas entram MESCLADAS numa linha só (soma
//    de quantidade e valor; o preço unitário exibido é a média ponderada
//    resultante, já que os dois lados podem usar preço unitário diferente).
//
// Custo:
//  - Produtos normais: TABELAS_PRODUTOS.TBP_CUSTO da tabela "Atacado" (código
//    1 em SJC e MG) — confirmado que não varia por tabela de preço.
//  - Chaves (produtos.pro_nivel2 = 1): o admin cadastra o custo manualmente
//    (aba "Custo de Chaves" no frontend) — um custo por produto, valendo pra
//    todas as lojas e pros dois canais (indústria e EP, custo é o mesmo nos
//    dois). Se a chave não tiver custo cadastrado, cai pro TBP_CUSTO da
//    tabela Atacado (mesmo fallback dos produtos normais).
//
// Com preço e custo resolvidos, calcula-se por linha: custo_total = custo
// unitário × qtde; lucro = valor_venda - custo_total; margem % = lucro /
// valor_venda × 100.
//
// Identificação de "venda pra loja X": cada loja é um CLIENTE cadastrado na
// própria SJC/MG (a indústria trata a loja como um cliente de transferência
// interna) — códigos de cliente confirmados manualmente com o Willian.
// ═══════════════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET ?? "dovale-disparo-jwt-secret-2024";

router.use((req: Request, res: Response, next) => {
  if (req.method === "OPTIONS") return next();
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ erro: "Não autenticado" });
  const token = auth.split(" ")[1];
  try {
    (req as any).usuarioLogado = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e: any) {
    if (e.name === "TokenExpiredError") return res.status(401).json({ erro: "Sessão expirada" });
    return res.status(401).json({ erro: "Token inválido" });
  }
});

// ── Lojas: cliente(s) de transferência interna + tabela de preço por base ────
interface Loja {
  key: string;
  nome: string;
  clientes: number[]; // códigos de cliente (união SJC/MG — o que não existir numa base simplesmente não bate)
  tabSJC: number | null;
  tabMG: number | null;
  vendedorEP: string[]; // valores de EP.VENDEDOR que identificam essa loja
}

const LOJAS: Loja[] = [
  { key: "bh", nome: "BH", clientes: [8106, 11283, 14985, 63718], tabSJC: 6, tabMG: 8, vendedorEP: ["BH", "Belo Horizonte"] },
  { key: "rj", nome: "Rio de Janeiro", clientes: [2006, 98030], tabSJC: 2, tabMG: 7, vendedorEP: ["Rio de Janeiro"] },
  { key: "riopreto", nome: "Rio Preto", clientes: [38915], tabSJC: 42, tabMG: 6, vendedorEP: ["Rio Preto"] },
  { key: "goiania", nome: "Goiânia", clientes: [45758, 134504, 141130], tabSJC: 78, tabMG: 23, vendedorEP: ["Goiania"] },
  { key: "uberlandia", nome: "Uberlândia", clientes: [34322], tabSJC: 145, tabMG: 89, vendedorEP: ["Uberlandia"] },
  { key: "santana", nome: "Santana", clientes: [6435, 59403, 79580], tabSJC: 86, tabMG: null, vendedorEP: ["Santana"] },
  { key: "campinas", nome: "Campinas", clientes: [7983], tabSJC: 42, tabMG: 6, vendedorEP: ["Campinas"] },
  { key: "fortaleza", nome: "Fortaleza", clientes: [21306], tabSJC: 105, tabMG: null, vendedorEP: ["Fortaleza"] },
  { key: "sorocaba", nome: "Sorocaba", clientes: [66258], tabSJC: 42, tabMG: 6, vendedorEP: ["Sorocaba"] },
  { key: "poa", nome: "Porto Alegre", clientes: [49268, 64399], tabSJC: 42, tabMG: 6, vendedorEP: ["Porto Alegre"] },
  { key: "lapa", nome: "Lapa", clientes: [63777], tabSJC: 42, tabMG: 6, vendedorEP: ["Lapa"] },
  { key: "guarulhos", nome: "Guarulhos", clientes: [36625], tabSJC: 42, tabMG: 6, vendedorEP: ["Guarulhos"] },
  // Bosque deixado de fora por enquanto (a pedido do Willian).
];

const TAB_CUSTO_ATACADO = 1;

const FILTRO_VENDA = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
`;

interface LinhaNormalizada {
  pro_codigo: number;
  pro_resumo: string;
  qtde: number;
  valor_venda: number;
  preco_unitario: number;
  preco_industria: number | null;
  preco_ep: number | null;
  custo_unitario: number | null;
  eh_chave: boolean;
  temIndustria: boolean;
  temEP: boolean;
}

// Mescla linhas da mesma loja com o mesmo produto (ex: chave que vendeu tanto
// pela indústria quanto pela EP) numa linha só — soma qtde/valor, preço
// unitário exibido vira a média ponderada (valor total / qtde total), e
// guarda de quais origens veio (pra mostrar "EP+INDÚSTRIA", "INDÚSTRIA" ou
// "EP" sem duplicar a linha do produto).
function mesclarPorProduto(linhas: LinhaNormalizada[]): LinhaNormalizada[] {
  const mapa = new Map<number, LinhaNormalizada>();
  for (const linha of linhas) {
    const atual = mapa.get(linha.pro_codigo);
    if (!atual) {
      mapa.set(linha.pro_codigo, { ...linha });
      continue;
    }
    atual.qtde += linha.qtde;
    atual.valor_venda += linha.valor_venda;
    if (!atual.pro_resumo && linha.pro_resumo) atual.pro_resumo = linha.pro_resumo;
    if (atual.custo_unitario == null && linha.custo_unitario != null) atual.custo_unitario = linha.custo_unitario;
    if (atual.preco_industria == null && linha.preco_industria != null) atual.preco_industria = linha.preco_industria;
    if (atual.preco_ep == null && linha.preco_ep != null) atual.preco_ep = linha.preco_ep;
    atual.eh_chave = atual.eh_chave || linha.eh_chave;
    atual.temIndustria = atual.temIndustria || linha.temIndustria;
    atual.temEP = atual.temEP || linha.temEP;
  }
  for (const linha of mapa.values()) {
    linha.preco_unitario = linha.qtde > 0 ? linha.valor_venda / linha.qtde : 0;
  }
  return [...mapa.values()];
}

function fonteLabel(linha: LinhaNormalizada): string {
  if (linha.temIndustria && linha.temEP) return "EP+INDÚSTRIA";
  if (linha.temEP) return "EP";
  return "INDÚSTRIA";
}

// ── SQL Server: tabela de custo POR FAMÍLIA de chave, alimentada pelo admin ──
// Família = produtos.pro_nivel3 (catálogo de famílias em PRODUTOS_NIVEL3 na
// SJC/MG, ex: código 1 = "YALE", 2 = "TETRA", 3 = "GORJE"...). Um custo só
// por família já cobre todas as chaves daquela família, nas duas bases.
let _custoFamiliaEnsured = false;
async function ensureCustoFamiliaTable(): Promise<void> {
  if (_custoFamiliaEnsured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.MARGEM_LOJAS_CUSTO_FAMILIA_CHAVE', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MARGEM_LOJAS_CUSTO_FAMILIA_CHAVE (
        familia_codigo INT NOT NULL PRIMARY KEY,
        custo DECIMAL(18,4) NOT NULL,
        atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
      );
    END
  `);
  _custoFamiliaEnsured = true;
}

async function getCustosFamiliaMap(): Promise<Map<number, number>> {
  await ensureCustoFamiliaTable();
  const pool = await getPool();
  const result = await pool.request().query(`SELECT familia_codigo, custo FROM dbo.MARGEM_LOJAS_CUSTO_FAMILIA_CHAVE WHERE custo <> 0`);
  return new Map(result.recordset.map((r: any) => [Number(r.familia_codigo), Number(r.custo)]));
}

// ── Vendas SJC/MG (produtos normais, com preço da tabela da loja) ───────────
function sqlVendaNaoChave(clientes: number[], tabPreco: number, inicio: string, fim: string, produto?: string) {
  return `
    select p.pro_codigo as pro_codigo, p.pro_resumo as pro_resumo,
      sum(i.pvi_quantidade) as qtde,
      tp.tbp_preco as preco_unitario,
      tpc.tbp_custo as custo_unitario
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    left join tabelas_produtos tp on tp.tbp_pro_codigo = p.pro_codigo and tp.tbp_tab_codigo = ${tabPreco}
    left join tabelas_produtos tpc on tpc.tbp_pro_codigo = p.pro_codigo and tpc.tbp_tab_codigo = ${TAB_CUSTO_ATACADO}
    where ped.pdv_cli_codigo in (${clientes.join(",")})
      and p.pro_nivel2 <> 1
      and ped.pdv_data >= date '${inicio}' and ped.pdv_data < date '${fim}'
      ${FILTRO_VENDA}
      ${produto ? `and p.pro_codigo = ${Number(produto)}` : ""}
    group by p.pro_codigo, p.pro_resumo, tp.tbp_preco, tpc.tbp_custo
  `;
}

// ── Vendas SJC/MG (chaves) ──────────────────────────────────────────────────
// Preço: SEMPRE o TBP_PRECO da tabela da própria loja, igual produto normal.
// Custo: admin (aba Custo de Chaves, por FAMÍLIA = pro_nivel3) se a família
// tiver custo cadastrado; senão cai pro TBP_CUSTO da tabela Atacado (igual
// produto normal).
function sqlVendaChave(clientes: number[], tabPreco: number, inicio: string, fim: string, produto?: string) {
  return `
    select p.pro_codigo as pro_codigo, p.pro_resumo as pro_resumo, p.pro_nivel3 as familia_codigo,
      sum(i.pvi_quantidade) as qtde,
      tp.tbp_preco as preco_tabela,
      tpc.tbp_custo as custo_unitario
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    left join tabelas_produtos tp on tp.tbp_pro_codigo = p.pro_codigo and tp.tbp_tab_codigo = ${tabPreco}
    left join tabelas_produtos tpc on tpc.tbp_pro_codigo = p.pro_codigo and tpc.tbp_tab_codigo = ${TAB_CUSTO_ATACADO}
    where ped.pdv_cli_codigo in (${clientes.join(",")})
      and p.pro_nivel2 = 1
      and ped.pdv_data >= date '${inicio}' and ped.pdv_data < date '${fim}'
      ${FILTRO_VENDA}
      ${produto ? `and p.pro_codigo = ${Number(produto)}` : ""}
    group by p.pro_codigo, p.pro_resumo, p.pro_nivel3, tp.tbp_preco, tpc.tbp_custo
  `;
}

async function coletarLoja(
  loja: Loja,
  custosFamilia: Map<number, number>,
  inicio: string,
  fim: string,
  produto?: string
): Promise<LinhaNormalizada[]> {
  const bases: { base: "sjc" | "mg"; tabPreco: number | null }[] = [
    { base: "sjc", tabPreco: loja.tabSJC },
    { base: "mg", tabPreco: loja.tabMG },
  ];

  // As até 4 queries (2 bases × não-chave/chave) desta loja são disparadas em
  // paralelo — cada uma passa pelo limitarFirebird, que segura a concorrência
  // real no servidor. Resultado idêntico ao loop sequencial de antes, só que
  // mais rápido.
  const porBase = await Promise.all(
    bases
      .filter(({ tabPreco }) => tabPreco != null)
      .map(async ({ base, tabPreco }) => {
        const linhasBase: LinhaNormalizada[] = [];

        const [rowsNaoChave, rowsChave] = await Promise.all([
          limitarFirebird(() =>
            queryFirebird<{ PRO_CODIGO: any; PRO_RESUMO: any; QTDE: any; PRECO_UNITARIO: any; CUSTO_UNITARIO: any }>(
              base,
              sqlVendaNaoChave(loja.clientes, tabPreco as number, inicio, fim, produto)
            )
          ),
          limitarFirebird(() =>
            queryFirebird<{ PRO_CODIGO: any; PRO_RESUMO: any; FAMILIA_CODIGO: any; QTDE: any; PRECO_TABELA: any; CUSTO_UNITARIO: any }>(
              base,
              sqlVendaChave(loja.clientes, tabPreco as number, inicio, fim, produto)
            )
          ),
        ]);

        for (const r of rowsNaoChave) {
          const qtde = Number(r.QTDE) || 0;
          const preco = r.PRECO_UNITARIO != null ? Number(r.PRECO_UNITARIO) : 0;
          linhasBase.push({
            pro_codigo: Number(r.PRO_CODIGO),
            pro_resumo: r.PRO_RESUMO?.toString().trim() || "",
            qtde,
            valor_venda: qtde * preco,
            preco_unitario: preco,
            preco_industria: preco,
            preco_ep: null,
            custo_unitario: r.CUSTO_UNITARIO != null ? Number(r.CUSTO_UNITARIO) : null,
            eh_chave: false,
            temIndustria: true,
            temEP: false,
          });
        }

        for (const r of rowsChave) {
          const codigo = Number(r.PRO_CODIGO);
          const qtde = Number(r.QTDE) || 0;
          // Preço: sempre o TBP_PRECO da tabela da loja, igual produto normal.
          const preco = r.PRECO_TABELA != null ? Number(r.PRECO_TABELA) : 0;
          // Custo: admin (aba Custo de Chaves, por família) primeiro; sem isso, cai pro TBP_CUSTO da Atacado.
          const familiaCodigo = r.FAMILIA_CODIGO != null ? Number(r.FAMILIA_CODIGO) : null;
          const custoAtacado = r.CUSTO_UNITARIO != null ? Number(r.CUSTO_UNITARIO) : null;
          const custo = (familiaCodigo != null ? custosFamilia.get(familiaCodigo) : undefined) ?? custoAtacado;
          linhasBase.push({
            pro_codigo: codigo,
            pro_resumo: r.PRO_RESUMO?.toString().trim() || "",
            qtde,
            valor_venda: qtde * preco,
            preco_unitario: preco,
            preco_industria: preco,
            preco_ep: null,
            custo_unitario: custo,
            eh_chave: true,
            temIndustria: true,
            temEP: false,
          });
        }

        return linhasBase;
      })
  );

  return porBase.flat();
}

// ── EP — só chaves, preço SEMPRE fixo em R$ 1,51. Custo: admin (aba Custo de
//    Chaves, por família — mesmo valor usado do lado indústria) senão cai pro
//    TBP_CUSTO da Atacado (via catálogo da SJC). ───────────────────────────
const EP_PRECO_FIXO_CHAVE = 1.51;
const SJC_TAB_CODIGO_ATACADO = 1;

async function coletarEPPorLoja(
  inicio: string,
  fim: string,
  custosFamilia: Map<number, number>,
  produto?: string
): Promise<Map<string, LinhaNormalizada[]>> {
  const resultado = new Map<string, LinhaNormalizada[]>();
  const todosVendedores = LOJAS.flatMap((l) => l.vendedorEP);
  if (todosVendedores.length === 0) return resultado;

  const pool = await getPool();
  const listaVendedores = todosVendedores.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
  const req = pool.request().input("ini", sql.VarChar, inicio).input("fim", sql.VarChar, fim);
  if (produto) req.input("produto", sql.Int, Number(produto));

  const result = await req.query(`
    SELECT e.VENDEDOR AS vendedor, p.CODIGO AS codigo, SUM(p.QTD) AS qtde
    FROM EP e
    INNER JOIN EP_ProdutosDoPedido p ON p.PedidoID = e.ID
    WHERE e.[DATA] >= @ini AND e.[DATA] < @fim
      AND e.VENDEDOR IN (${listaVendedores})
      AND p.SUBGRUPO = 'CHAVE'
      ${produto ? "AND p.CODIGO = @produto" : ""}
    GROUP BY e.VENDEDOR, p.CODIGO
  `);

  const linhasBrutas = result.recordset as { vendedor: string; codigo: number; qtde: number }[];
  if (linhasBrutas.length === 0) return resultado;

  const codigos = [...new Set(linhasBrutas.map((r) => Number(r.codigo)))];
  const catalogo = await limitarFirebird(() =>
    queryFirebird<{ PRO_CODIGO: any; PRO_RESUMO: any; FAMILIA_CODIGO: any; CUSTO_UNITARIO: any }>(
      "sjc",
      `
        select p.pro_codigo as pro_codigo, p.pro_resumo as pro_resumo, p.pro_nivel3 as familia_codigo, tp.tbp_custo as custo_unitario
        from produtos p
        left join tabelas_produtos tp on tp.tbp_pro_codigo = p.pro_codigo and tp.tbp_tab_codigo = ${SJC_TAB_CODIGO_ATACADO}
        where p.pro_codigo in (${codigos.join(",")})
      `
    )
  );
  const mapaCatalogo = new Map(
    catalogo.map((c) => [
      Number(c.PRO_CODIGO),
      {
        resumo: c.PRO_RESUMO?.toString().trim() || "",
        familiaCodigo: c.FAMILIA_CODIGO != null ? Number(c.FAMILIA_CODIGO) : null,
        custo: c.CUSTO_UNITARIO != null ? Number(c.CUSTO_UNITARIO) : null,
      },
    ])
  );

  for (const loja of LOJAS) {
    const linhasLoja: LinhaNormalizada[] = [];
    for (const r of linhasBrutas) {
      if (!loja.vendedorEP.includes(r.vendedor)) continue;
      const info = mapaCatalogo.get(Number(r.codigo));
      const qtde = Number(r.qtde) || 0;
      const custo = (info?.familiaCodigo != null ? custosFamilia.get(info.familiaCodigo) : undefined) ?? info?.custo ?? null;
      linhasLoja.push({
        pro_codigo: Number(r.codigo),
        pro_resumo: info?.resumo || "",
        qtde,
        valor_venda: qtde * EP_PRECO_FIXO_CHAVE,
        preco_unitario: EP_PRECO_FIXO_CHAVE,
        preco_industria: null,
        preco_ep: EP_PRECO_FIXO_CHAVE,
        custo_unitario: custo,
        eh_chave: true,
        temIndustria: false,
        temEP: true,
      });
    }
    if (linhasLoja.length > 0) resultado.set(loja.key, linhasLoja);
  }

  return resultado;
}

// ── GET /lojas ────────────────────────────────────────────────────────────────
router.get("/lojas", (_req: Request, res: Response) => {
  res.json(LOJAS.map((l) => ({ key: l.key, nome: l.nome })));
});

// ── GET /custo-familia — lista as FAMÍLIAS de chave (produtos.pro_nivel3,
//    catálogo em PRODUTOS_NIVEL3) que realmente têm chave cadastrada em SJC
//    e/ou MG, com o custo já salvo (ou null). Custo vale sempre, não é por
//    período — não depende de data.
router.get("/custo-familia", async (_req: Request, res: Response) => {
  try {
    const [custos, nomesSJC, codigosSJC, codigosMG] = await Promise.all([
      getCustosFamiliaMap(),
      limitarFirebird(() =>
        queryFirebird<{ CODIGO: any; NOME: any }>("sjc", `select codigo, nome from produtos_nivel3`)
      ),
      limitarFirebird(() =>
        queryFirebird<{ PRO_NIVEL3: any }>(
          "sjc",
          `select distinct pro_nivel3 from produtos where pro_nivel2 = 1 and pro_nivel3 is not null and pro_nivel3 <> 0`
        )
      ),
      limitarFirebird(() =>
        queryFirebird<{ PRO_NIVEL3: any }>(
          "mg",
          `select distinct pro_nivel3 from produtos where pro_nivel2 = 1 and pro_nivel3 is not null and pro_nivel3 <> 0`
        )
      ),
    ]);

    const mapaNomes = new Map(nomesSJC.map((n) => [Number(n.CODIGO), n.NOME?.toString().trim() || ""]));
    const codigosFamilia = new Set<number>([
      ...codigosSJC.map((r) => Number(r.PRO_NIVEL3)),
      ...codigosMG.map((r) => Number(r.PRO_NIVEL3)),
    ]);

    const lista = [...codigosFamilia]
      .map((codigo) => ({
        familia_codigo: codigo,
        familia_nome: mapaNomes.get(codigo) || `Família ${codigo}`,
        custo: custos.get(codigo) ?? null,
      }))
      .sort((a, b) => a.familia_nome.localeCompare(b.familia_nome));

    res.json(lista);
  } catch (e: any) {
    console.error("[margem-lojas] /custo-familia erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});

// ── POST /custo-familia — salva o custo de uma família de chave (admin) ────
router.post("/custo-familia", async (req: Request, res: Response) => {
  try {
    const familia_codigo = Number(req.body?.familia_codigo);
    const custo = Number(req.body?.custo);
    if (!Number.isFinite(familia_codigo) || !Number.isFinite(custo) || custo < 0) {
      return res.status(400).json({ erro: "familia_codigo e custo (>= 0) são obrigatórios" });
    }
    await ensureCustoFamiliaTable();
    const pool = await getPool();
    if (custo === 0) {
      // Campo "limpo" (custo 0) = remover o override — volta a cair pro
      // TBP_CUSTO da tabela Atacado, em vez de gravar 0 como custo fixo.
      await pool
        .request()
        .input("familia_codigo", sql.Int, familia_codigo)
        .query(`DELETE FROM dbo.MARGEM_LOJAS_CUSTO_FAMILIA_CHAVE WHERE familia_codigo = @familia_codigo`);
    } else {
      await pool
        .request()
        .input("familia_codigo", sql.Int, familia_codigo)
        .input("custo", sql.Decimal(18, 4), custo)
        .query(`
          MERGE dbo.MARGEM_LOJAS_CUSTO_FAMILIA_CHAVE AS destino
          USING (SELECT @familia_codigo AS familia_codigo) AS origem
          ON destino.familia_codigo = origem.familia_codigo
          WHEN MATCHED THEN UPDATE SET custo = @custo, atualizado_em = GETDATE()
          WHEN NOT MATCHED THEN INSERT (familia_codigo, custo, atualizado_em) VALUES (@familia_codigo, @custo, GETDATE());
        `);
    }
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[margem-lojas] POST /custo-familia erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});

// ── GET / — margem por loja/produto no período ────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const lojaFiltro = req.query.loja ? String(req.query.loja) : undefined;
    const produtoFiltro = req.query.produto ? String(req.query.produto) : undefined;
    const inicio = String(req.query.inicio ?? "");
    const fim = String(req.query.fim ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      return res.status(400).json({ erro: "Parâmetros 'inicio' e 'fim' obrigatórios (YYYY-MM-DD)" });
    }

    const lojas = lojaFiltro ? LOJAS.filter((l) => l.key === lojaFiltro) : LOJAS;
    if (lojaFiltro && lojas.length === 0) {
      return res.status(400).json({ erro: `Loja '${lojaFiltro}' não reconhecida` });
    }

    // custosFamilia precisa estar pronto antes de coletarEPPorLoja (ela usa o
    // mesmo custo cadastrado pelo admin), então busca primeiro.
    const custosFamilia = await getCustosFamiliaMap();
    const epPorLoja = await coletarEPPorLoja(inicio, fim, custosFamilia, produtoFiltro).catch((e: any) => {
      console.error("[margem-lojas] erro em EP:", e.message);
      return new Map<string, LinhaNormalizada[]>();
    });

    const linhas: Record<string, any>[] = [];
    const status: { loja: string; status: string }[] = [];

    // Todas as lojas são coletadas em paralelo (cada uma isolada em seu
    // próprio try/catch, igual antes — erro numa loja não derruba as
    // outras). A concorrência real no Firebird continua limitada pelo
    // limitarFirebird lá dentro de coletarLoja.
    const resultadosPorLoja = await Promise.all(
      lojas.map(async (loja) => {
        try {
          const rowsSJCMG = await coletarLoja(loja, custosFamilia, inicio, fim, produtoFiltro);
          const rowsEP = epPorLoja.get(loja.key) ?? [];
          const todas = mesclarPorProduto([...rowsSJCMG, ...rowsEP]);
          return { loja, todas, erro: null as string | null };
        } catch (e: any) {
          console.error(`[margem-lojas] erro em ${loja.nome}:`, e.message);
          return { loja, todas: [] as LinhaNormalizada[], erro: e.message as string };
        }
      })
    );

    for (const { loja, todas, erro } of resultadosPorLoja) {
      if (erro != null) {
        status.push({ loja: loja.nome, status: `ERRO: ${erro}` });
        continue;
      }
      for (const row of todas) {
        const custoTotal = row.custo_unitario != null ? row.custo_unitario * row.qtde : null;
        const lucro = custoTotal != null ? row.valor_venda - custoTotal : null;
        const margemPercentual = lucro != null && row.valor_venda > 0 ? (lucro / row.valor_venda) * 100 : null;
        linhas.push({
          loja: loja.nome,
          pro_codigo: row.pro_codigo,
          pro_resumo: row.pro_resumo,
          eh_chave: row.eh_chave,
          fonte: fonteLabel(row),
          qtde_vendida: row.qtde,
          valor_venda: Math.round(row.valor_venda * 100) / 100,
          preco_unitario: Math.round(row.preco_unitario * 100) / 100,
          preco_industria: row.preco_industria != null ? Math.round(row.preco_industria * 100) / 100 : null,
          preco_ep: row.preco_ep != null ? Math.round(row.preco_ep * 100) / 100 : null,
          custo_unitario: row.custo_unitario != null ? Math.round(row.custo_unitario * 100) / 100 : null,
          custo_total: custoTotal != null ? Math.round(custoTotal * 100) / 100 : null,
          lucro: lucro != null ? Math.round(lucro * 100) / 100 : null,
          margem_percentual: margemPercentual != null ? Math.round(margemPercentual * 100) / 100 : null,
        });
      }
      status.push({ loja: loja.nome, status: "OK" });
    }

    res.json({ linhas, status });
  } catch (e: any) {
    console.error("[margem-lojas] erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});
