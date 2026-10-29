import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Loader2, PackageSearch, Search, X } from "lucide-react";
import logoWhite from "@/assets/logo-white.png";
import { buscarProdutos, sugerirProdutos, type ProdutoConsulta, type ResultadoConsulta, type Sugestao } from "@/lib/consulta-produtos-api";

type FilialKey = "sjc" | "mg";

const NAVY = "#00205C";
const YELLOW = "#FFD700";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const PAGE_BG = "#f0f4f8";
const OK = "#15803d";
const BAD = "#b91c1c";

const FILIAL_NOME: Record<FilialKey, string> = { sjc: "SJC", mg: "MG" };
const nBR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: number | null | undefined) => (v == null ? "—" : nBR.format(v));
const money = (v: number | null | undefined) => (v == null || v === 0 ? "—" : brl.format(v));

function lerOcultarCusto(): boolean {
  try { return localStorage.getItem("consulta_produtos_ocultar_custo") === "1"; } catch { return false; }
}

const TAB_ESTOQUE = "#0f766e"; // verde-azulado: bloco de estoque
const TAB_PRECO = "#7c3aed"; // roxo: bloco de tabelas de preço
const PROMO = "#b45309"; // âmbar: promoção do mês
const PROMO_BG = "#fef9c3"; // amarelo claro, igual à linha da Consulta de Preço do Microsys

type Celula = { texto: string; cor?: string };

function Secao({ cor, titulo, subtitulo, children }: { cor: string; titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden mt-3" style={{ border: `1.5px solid ${cor}` }}>
      <div className="flex items-baseline gap-2 px-2.5 py-1.5" style={{ background: cor }}>
        <span className="text-[11px] font-extrabold tracking-wider text-white">{titulo}</span>
        {subtitulo && <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{subtitulo}</span>}
      </div>
      <div className="px-2.5 pb-1">{children}</div>
    </div>
  );
}

// Colunas de preço/custo: largas o bastante para "R$ 12.345,67" em negrito (antes 78px: os valores
// das duas filiais se sobrepunham). Larguras fixas mantêm cabeçalho e linhas alinhados.
const COLUNAS_PRECO = (n: number) => `minmax(56px,1fr) repeat(${n}, 112px)`;

// Linha de grade: rótulo + uma célula por coluna (filiais e, quando há, o total).
function LinhaGrade({ rotulo, celulas, colunas, destaque }: { rotulo: string; celulas: Celula[]; colunas: string; destaque?: boolean }) {
  return (
    <div className="grid items-center py-1.5" style={{ gridTemplateColumns: colunas, borderTop: `1px solid ${BORDER}` }}>
      <span className="text-xs" style={{ color: MUTED, fontWeight: destaque ? 700 : 500 }}>{rotulo}</span>
      {celulas.map((c, i) => (
        <span key={i} className="text-right tabular-nums whitespace-nowrap" style={{ fontSize: destaque ? 15 : 13, fontWeight: destaque ? 700 : 500, color: c.cor ?? NAVY }}>
          {c.texto}
        </span>
      ))}
    </div>
  );
}

function CabecalhoColunas({ nomes, colunas, totalIdx }: { nomes: string[]; colunas: string; totalIdx: number }) {
  return (
    <div className="grid items-center py-1.5" style={{ gridTemplateColumns: colunas }}>
      <span />
      {nomes.map((n, i) => (
        <span
          key={n}
          className="text-right text-[11px] font-extrabold tracking-wide"
          style={{ color: i === totalIdx ? NAVY : MUTED }}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

const dataBR = (iso: string | null) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");

const somar = (vals: (number | null | undefined)[]): number | null => {
  const v = vals.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

function CardProduto({ p, filiais, ocultarCusto }: { p: ProdutoConsulta; filiais: FilialKey[]; ocultarCusto: boolean }) {
  const dado = (f: FilialKey) => p.filiais[f];
  const comTotal = filiais.length > 1;
  const nomes = [...filiais.map((f) => FILIAL_NOME[f]), ...(comTotal ? ["TOTAL"] : [])];
  const colunas = `minmax(64px,1fr) repeat(${nomes.length}, 78px)`;
  const totalIdx = comTotal ? nomes.length - 1 : -1;

  // Estoque: valor por filial + total (soma das filiais mostradas).
  const estoque = (campo: "saldo" | "disponivel" | "reservado", corDisp?: boolean): Celula[] => {
    const porFilial = filiais.map((f) => dado(f)?.[campo]);
    const cel = (v: number | null | undefined, ehTotal = false): Celula => ({
      texto: qtd(v),
      cor: corDisp ? ((v ?? 0) > 0 ? OK : BAD) : ehTotal ? NAVY : undefined,
    });
    return [...porFilial.map((v) => cel(v)), ...(comTotal ? [cel(somar(porFilial), true)] : [])];
  };

  // Preço/custo: não faz sentido somar — a coluna do total fica vazia.
  const preco = (tab: "atacado" | "ddf", campo: "preco" | "custo"): Celula[] => [
    ...filiais.map((f) => ({ texto: money(dado(f)?.tabelas[tab][campo]) })),
    ...(comTotal ? [{ texto: "", cor: MUTED }] : []),
  ];

  // Promoção mensal: só aparece quando o servidor confirma que o produto está numa tabela
  // "PROMOÇÃO MENSAL" ativa e dentro da validade (se estiver em mais de uma, vale a de validade mais longa).
  const promoDe = (f: FilialKey) => dado(f)?.promocao ?? null;
  const emPromo = filiais.some((f) => promoDe(f) != null);
  const refPromo = filiais.map(promoDe).find((x) => x != null) ?? null;
  const colunasPromo = COLUNAS_PRECO(filiais.length);
  const descontoPct = (f: FilialKey) => {
    const orig = dado(f)?.tabelas.atacado.preco, pr = promoDe(f)?.preco;
    return orig && pr ? `-${Math.round((1 - pr / orig) * 100)}%` : "—";
  };

  return (
    <div
      className="rounded-xl p-3 mb-4"
      style={{ background: "#fff", border: emPromo ? `2px solid ${PROMO}` : `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: NAVY, color: "#fff" }}>{p.codigo}</span>
        {p.tipo && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "#e2e8f0", color: MUTED }}>{p.tipo}</span>}
      </div>
      <p className="text-sm font-semibold leading-snug" style={{ color: NAVY }}>{p.descricao}</p>

      {emPromo && refPromo && (
        <div className="rounded-lg overflow-hidden mt-3" style={{ border: `1.5px solid ${PROMO}`, background: PROMO_BG }}>
          <div className="px-2.5 py-1.5" style={{ background: PROMO }}>
            <span className="text-[11px] font-extrabold tracking-wider text-white">⭐ EM PROMOÇÃO DO MÊS</span>
            <p className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.9)" }}>
              {refPromo.nome}{refPromo.validade ? ` · válida até ${dataBR(refPromo.validade)}` : ""}
            </p>
          </div>
          <div className="px-2.5 pb-1">
            <CabecalhoColunas nomes={filiais.map((f) => FILIAL_NOME[f])} colunas={colunasPromo} totalIdx={-1} />
            <LinhaGrade rotulo="Preço original (Atacado)" colunas={colunasPromo} celulas={filiais.map((f) => ({ texto: promoDe(f) ? money(dado(f)?.tabelas.atacado.preco) : "—" }))} />
            <LinhaGrade rotulo="Preço promocional" colunas={colunasPromo} destaque celulas={filiais.map((f) => ({ texto: promoDe(f) ? money(promoDe(f)!.preco) : "sem promoção", cor: promoDe(f) ? PROMO : MUTED }))} />
            <LinhaGrade rotulo="Desconto" colunas={colunasPromo} celulas={filiais.map((f) => ({ texto: promoDe(f) ? descontoPct(f) : "—", cor: PROMO }))} />
          </div>
        </div>
      )}

      <Secao cor={TAB_ESTOQUE} titulo="ESTOQUE" subtitulo="Estoque 1 (Almoxarifado), posição de hoje">
        <CabecalhoColunas nomes={nomes} colunas={colunas} totalIdx={totalIdx} />
        <LinhaGrade rotulo="Saldo" colunas={colunas} celulas={estoque("saldo")} destaque />
        <LinhaGrade rotulo="Empenhado" colunas={colunas} celulas={estoque("reservado")} />
        <LinhaGrade rotulo="Disponível" colunas={colunas} celulas={estoque("disponivel", true)} />
      </Secao>

      <Secao cor={TAB_PRECO} titulo="TABELA 1 · ATACADO PADRÃO" subtitulo="preço e custo">
        <CabecalhoColunas nomes={filiais.map((f) => FILIAL_NOME[f])} colunas={COLUNAS_PRECO(filiais.length)} totalIdx={-1} />
        <LinhaGrade rotulo="Preço" colunas={COLUNAS_PRECO(filiais.length)} celulas={preco("atacado", "preco").slice(0, filiais.length)} destaque />
        {!ocultarCusto && <LinhaGrade rotulo="Custo" colunas={COLUNAS_PRECO(filiais.length)} celulas={preco("atacado", "custo").slice(0, filiais.length)} />}
      </Secao>

      <Secao cor={TAB_PRECO} titulo="TABELA 4 · DDF" subtitulo="preço e custo">
        <CabecalhoColunas nomes={filiais.map((f) => FILIAL_NOME[f])} colunas={COLUNAS_PRECO(filiais.length)} totalIdx={-1} />
        <LinhaGrade rotulo="Preço" colunas={COLUNAS_PRECO(filiais.length)} celulas={preco("ddf", "preco").slice(0, filiais.length)} destaque />
        {!ocultarCusto && <LinhaGrade rotulo="Custo" colunas={COLUNAS_PRECO(filiais.length)} celulas={preco("ddf", "custo").slice(0, filiais.length)} />}
      </Secao>
    </div>
  );
}

// Destaca em negrito, na descrição, as palavras que o usuário digitou.
function Destacado({ texto, termo }: { texto: string; termo: string }) {
  const palavras = termo.trim().split(/\s+/).filter((w) => w.length > 0).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!palavras.length) return <>{texto}</>;
  const partes = texto.split(new RegExp(`(${palavras.join("|")})`, "gi"));
  const ehPalavra = (p: string) => palavras.some((w) => new RegExp(`^${w}$`, "i").test(p));
  return (
    <>
      {partes.map((p, i) => (ehPalavra(p) ? <b key={i} style={{ color: NAVY }}>{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

const CACHE_RESULTADO_MS = 15_000;

export default function ConsultaProdutos() {
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [ocultarCusto, setOcultarCusto] = useState(lerOcultarCusto);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [sugAberto, setSugAberto] = useState(false);
  const [sugIndice, setSugIndice] = useState(-1);
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortSug = useRef<AbortController | null>(null);
  const abortBusca = useRef<AbortController | null>(null);
  const cacheSug = useRef(new Map<string, Sugestao[]>());
  const cacheRes = useRef(new Map<string, { ts: number; res: ResultadoConsulta }>());
  // texto que originou o resultado mostrado (para o autocomplete não reabrir após escolher)
  const textoEscolhido = useRef("");

  useEffect(() => {
    try { localStorage.setItem("consulta_produtos_ocultar_custo", ocultarCusto ? "1" : "0"); } catch { /* sem storage */ }
  }, [ocultarCusto]);

  // Sugestões enquanto digita: espera 120 ms sem digitar, cancela a requisição anterior e guarda o
  // que já buscou — voltar/apagar uma letra responde na hora.
  useEffect(() => {
    const q = texto.trim();
    abortSug.current?.abort();
    if (q.length < 2 || q === textoEscolhido.current) {
      setSugestoes([]);
      setSugAberto(false);
      return;
    }
    const emCache = cacheSug.current.get(q.toLowerCase());
    if (emCache) {
      setSugestoes(emCache);
      setSugIndice(-1);
      setSugAberto(true);
      return;
    }
    const ctrl = new AbortController();
    abortSug.current = ctrl;
    const t = setTimeout(() => {
      sugerirProdutos(q, ctrl.signal)
        .then((lista) => {
          if (ctrl.signal.aborted) return;
          cacheSug.current.set(q.toLowerCase(), lista);
          setSugestoes(lista);
          setSugIndice(-1);
          setSugAberto(true);
        })
        .catch(() => { /* cancelada ou falha de rede: mantém o que está na tela */ });
    }, 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [texto]);

  // Busca de verdade (um produto exato ou a lista completa). Resultado recente vem do cache.
  const consultar = (chave: string, q: string, codigo?: string) => {
    abortBusca.current?.abort();
    setSugAberto(false);
    setErro("");
    const emCache = cacheRes.current.get(chave);
    if (emCache && Date.now() - emCache.ts < CACHE_RESULTADO_MS) {
      setResultado(emCache.res);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortBusca.current = ctrl;
    setLoading(true);
    buscarProdutos(q, ctrl.signal, codigo)
      .then((r) => {
        if (ctrl.signal.aborted) return;
        cacheRes.current.set(chave, { ts: Date.now(), res: r });
        setResultado(r);
      })
      .catch((e) => { if (!ctrl.signal.aborted) { setResultado(null); setErro(e instanceof Error ? e.message : "Erro ao consultar"); } })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
  };

  const escolher = (s: Sugestao) => {
    textoEscolhido.current = s.descricao.trim();
    setTexto(s.descricao.trim());
    setSugAberto(false);
    inputRef.current?.blur(); // fecha o teclado no celular para ver o resultado
    consultar(`cod:${s.codigo}`, "", s.codigo);
  };

  const buscarTodos = () => {
    const q = texto.trim();
    if (q.length < 2) return;
    textoEscolhido.current = q;
    setSugAberto(false);
    inputRef.current?.blur();
    consultar(`q:${q.toLowerCase()}`, q);
  };

  const limpar = () => {
    abortBusca.current?.abort();
    textoEscolhido.current = "";
    setTexto("");
    setResultado(null);
    setErro("");
    setLoading(false);
    setSugAberto(false);
    inputRef.current?.focus();
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && sugestoes.length) {
      e.preventDefault();
      setSugAberto(true);
      setSugIndice((i) => (i + 1) % sugestoes.length);
    } else if (e.key === "ArrowUp" && sugestoes.length) {
      e.preventDefault();
      setSugIndice((i) => (i <= 0 ? sugestoes.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sugAberto && sugIndice >= 0 && sugestoes[sugIndice]) escolher(sugestoes[sugIndice]);
      else buscarTodos();
    } else if (e.key === "Escape") {
      setSugAberto(false);
    }
  };

  const filiais: FilialKey[] = ["sjc", "mg"];
  const baseComErro = resultado ? Object.entries(resultado.status).filter(([, s]) => s !== "ok") : [];
  const termo = texto.trim();

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      <div className="flex justify-center py-3" style={{ background: NAVY, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <img src={logoWhite} alt="Dovale" className="h-9 w-auto object-contain" />
      </div>
      <header className="sticky top-0 z-30" style={{ background: NAVY }}>
        <div className="flex items-center gap-2 px-3 h-12">
          <button onClick={() => navigate("/hub")} className="p-2 -ml-1 rounded-lg" style={{ color: "#fff" }} aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <PackageSearch size={18} style={{ color: YELLOW }} />
          <h1 className="text-sm font-bold text-white tracking-tight">INDÚSTRIA · CONSULTA DE PRODUTOS</h1>
          <button
            onClick={() => setOcultarCusto((v) => !v)}
            className="ml-auto p-2 rounded-lg"
            style={{ color: ocultarCusto ? YELLOW : "#fff" }}
            aria-label={ocultarCusto ? "Mostrar custo" : "Ocultar custo"}
            title={ocultarCusto ? "Custo oculto — toque para mostrar" : "Ocultar custo (útil ao projetar a tela)"}
          >
            {ocultarCusto ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <div className="px-3 pb-3 relative">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
            <input
              ref={inputRef}
              value={texto}
              onChange={(e) => { textoEscolhido.current = ""; setTexto(e.target.value); }}
              onKeyDown={aoTeclar}
              onFocus={() => { if (sugestoes.length && termo !== textoEscolhido.current) setSugAberto(true); }}
              onBlur={() => setSugAberto(false)}
              placeholder="Digite o nome ou o código do produto"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              role="combobox"
              aria-expanded={sugAberto}
              aria-autocomplete="list"
              className="w-full rounded-xl pl-9 pr-9 py-3 text-base outline-none"
              style={{ background: "#fff", color: NAVY, border: "none" }}
            />
            {texto && (
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={limpar}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5"
                style={{ color: MUTED }}
                aria-label="Limpar"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {sugAberto && sugestoes.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-3 right-3 mt-1 rounded-xl overflow-y-auto shadow-xl"
              style={{ background: "#fff", border: `1px solid ${BORDER}`, maxHeight: "60vh", zIndex: 40 }}
            >
              {sugestoes.map((s, i) => (
                <li
                  key={s.codigo}
                  role="option"
                  aria-selected={i === sugIndice}
                  // pointerdown + preventDefault: o campo não perde o foco antes do toque ser registrado
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => escolher(s)}
                  className="flex items-start gap-2 px-3 py-2.5 cursor-pointer"
                  style={{ minHeight: 48, background: i === sugIndice ? "#eef2ff" : "#fff", borderTop: i ? `1px solid ${BORDER}` : "none" }}
                >
                  <span className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded mt-0.5" style={{ background: NAVY, color: "#fff" }}>{s.codigo}</span>
                  <span className="text-sm leading-snug" style={{ color: MUTED }}>
                    <Destacado texto={s.descricao} termo={termo} />
                  </span>
                </li>
              ))}
              <li
                onPointerDown={(e) => e.preventDefault()}
                onClick={buscarTodos}
                className="px-3 py-2.5 text-xs font-semibold text-center cursor-pointer"
                style={{ background: "#f8fafc", color: NAVY, borderTop: `1px solid ${BORDER}` }}
              >
                Ver todos os resultados para “{termo}”
              </li>
            </ul>
          )}
        </div>
      </header>

      <main className="px-3 py-3 max-w-xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: MUTED }}>
            <Loader2 size={18} className="animate-spin" /> Consultando...
          </div>
        )}

        {!loading && erro && <p className="text-sm text-center py-6" style={{ color: BAD }}>{erro}</p>}

        {!loading && !erro && !resultado && (
          <p className="text-sm text-center py-10" style={{ color: MUTED }}>
            Comece a digitar o nome do produto (ex.: <b>corrente</b> ou <b>puxador tubo</b>) e escolha na lista, ou digite o código.
          </p>
        )}

        {!loading && resultado && baseComErro.length > 0 && (
          <p className="text-xs rounded-lg p-2 mb-3" style={{ background: "#fef2f2", color: BAD }}>
            Não consegui consultar: {baseComErro.map(([k]) => k.toUpperCase()).join(", ")}. Os números dessa filial podem estar faltando.
          </p>
        )}

        {!loading && resultado && resultado.produtos.length === 0 && (
          <p className="text-sm text-center py-10" style={{ color: MUTED }}>Nenhum produto ativo encontrado.</p>
        )}

        {!loading && resultado && resultado.produtos.length > 0 && (
          <>
            {resultado.produtos.length > 1 && (
              <p className="text-xs mb-2" style={{ color: MUTED }}>
                {resultado.produtos.length} produto(s){resultado.produtos.length >= 12 ? " — refine a busca para ver outros" : ""}
              </p>
            )}
            {resultado.produtos.map((p) => (
              <CardProduto key={p.codigo} p={p} filiais={filiais} ocultarCusto={ocultarCusto} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
