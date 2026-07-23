import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Sun, Moon, Users, Target, MapPin, Loader2, AlertCircle, Search,
  FileSpreadsheet, ChevronLeft, ChevronRight, Building2, MapPinned, Phone, HelpCircle,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { useAuth } from "@/context/AuthContext";
import {
  fetchCnaes,
  fetchVerificarCadastros,
  normalizaForma,
  type CadastroRegistro,
  type FormaCadastro,
} from "@/services/prospeccao";
import { MultiSelect, type MultiOption } from "@/components/prospeccao/MultiSelect";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const fmt = (n: number) => n.toLocaleString("pt-BR");
const DASH = "—";

// Metadados de exibição de cada forma de vínculo (por onde o cliente foi encontrado).
const FORMA_META: Record<FormaCadastro, { label: string; icon: typeof Building2; color: string }> = {
  CNPJ: { label: "CNPJ", icon: Building2, color: "hsl(217 91% 60%)" },
  CEP: { label: "CEP", icon: MapPinned, color: "hsl(75 55% 42%)" },
  Telefone: { label: "Telefone", icon: Phone, color: "hsl(262 83% 66%)" },
  Outro: { label: "Outro", icon: HelpCircle, color: "hsl(var(--muted-foreground))" },
};

// Linha da tabela — um registro do mercado (na base ou fora dela).
interface ClienteRow {
  cnpj: string;
  razao: string;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  naBase: boolean; // se o cliente já existe na base interna (comCadastro)
  situacao: string; // "Ativo" | "Inativo" | … (só faz sentido para quem está na base)
  forma: FormaCadastro | null; // por onde foi encontrado; null quando fora da base
  cnae: string;
}

const PAGE_SIZES = [25, 50, 100];

type BaseFiltro = "ambos" | "na" | "fora";

// Deixa o telefone bruto ("5551999215808") um pouco mais legível, sem arriscar
// mangear números fora do padrão (mantém o valor original se não casar).
function formatTelefone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const nac = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return raw;
}

function toRow(r: CadastroRegistro, naBase: boolean): ClienteRow {
  return {
    cnpj: r.cnpj ?? "",
    razao: (r.razao ?? "").trim(),
    cidade: (r.cidade ?? "").trim(),
    uf: (r.uf ?? "").trim().toUpperCase(),
    telefone: (r.telefone ?? "").trim(),
    email: (r.email ?? "").trim(),
    naBase,
    situacao: (r.situacaoInterna ?? "").trim() || (naBase ? "—" : "Sem cadastro"),
    forma: naBase ? normalizaForma(r.formaCadastro) : null,
    cnae: (r.cnae ?? "").trim(),
  };
}

export default function ClientesProspeccao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  // CNAEs iniciais vêm da URL (?cnae=a,b) para manter contexto ao vir da cobertura.
  const initialCnaes = useMemo(() => {
    const raw = params.get("cnae");
    return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }, [params]);
  const initialUfs = useMemo(() => {
    const raw = params.get("uf");
    return raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
  }, [params]);

  const [selCnaes, setSelCnaes] = useState<string[]>(initialCnaes);
  const [selUfs, setSelUfs] = useState<string[]>(initialUfs);
  const [baseFiltro, setBaseFiltro] = useState<BaseFiltro>("ambos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const { data: cnaes = [], isLoading: cnaesLoading } = useQuery({
    queryKey: ["prospeccao-cnaes"],
    queryFn: ({ signal }) => fetchCnaes(signal),
    staleTime: Infinity,
  });
  // Sem CNAE na URL, começa no primeiro segmento (mesmo default da cobertura).
  useEffect(() => {
    if (cnaes.length && selCnaes.length === 0 && initialCnaes.length === 0) setSelCnaes([cnaes[0]]);
  }, [cnaes, selCnaes.length, initialCnaes.length]);

  // Resposta bruta por CNAE — mesma chave da cobertura não serve (lá guardamos só
  // o agregado); aqui precisamos dos registros para a tabela.
  const registroQueries = useQueries({
    queries: selCnaes.map((cnae) => ({
      queryKey: ["prospeccao-verificar", cnae],
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchVerificarCadastros(cnae, signal),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const isFetching = registroQueries.some((q) => q.isFetching);
  const isError = registroQueries.some((q) => q.isError);

  const cnaeOptions: MultiOption[] = useMemo(() => cnaes.map((c) => ({ value: c, label: c })), [cnaes]);

  // Todos os registros do mercado (na base + fora), unificados pelos CNAEs
  // selecionados e deduplicados por CNPJ (o mesmo cliente pode casar em mais de
  // um segmento). Em caso de conflito, quem está na base prevalece.
  const clientes = useMemo(() => {
    const porCnpj = new Map<string, ClienteRow>();
    const add = (r: CadastroRegistro, naBase: boolean) => {
      const row = toRow(r, naBase);
      const key = row.cnpj || `${row.razao}|${row.telefone}`;
      const atual = porCnpj.get(key);
      if (!atual || (!atual.naBase && row.naBase)) porCnpj.set(key, row);
    };
    registroQueries.forEach((q) => {
      (q.data?.comCadastro ?? []).forEach((r) => add(r, true));
      (q.data?.semCadastro ?? []).forEach((r) => add(r, false));
    });
    return [...porCnpj.values()].sort((a, b) => a.razao.localeCompare(b.razao, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registroQueries.map((q) => q.dataUpdatedAt).join(",")]);

  // Opções de UF derivadas do que veio (só estados presentes nos dados).
  const ufOptions: MultiOption[] = useMemo(() => {
    const set = new Set(clientes.map((c) => c.uf).filter(Boolean));
    return [...set].sort().map((uf) => ({ value: uf, label: uf, hint: uf }));
  }, [clientes]);

  // Filtro por base (na/fora/ambos) + estado + busca textual.
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return clientes.filter((c) => {
      if (baseFiltro === "na" && !c.naBase) return false;
      if (baseFiltro === "fora" && c.naBase) return false;
      if (selUfs.length && !selUfs.includes(c.uf)) return false;
      if (!q) return true;
      return (
        c.razao.toLocaleLowerCase("pt-BR").includes(q) ||
        c.cnpj.toLowerCase().includes(q) ||
        c.cidade.toLocaleLowerCase("pt-BR").includes(q) ||
        c.telefone.includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    });
  }, [clientes, baseFiltro, selUfs, search]);

  // Reseta paginação quando o conjunto muda.
  useEffect(() => setPage(1), [selCnaes, selUfs, baseFiltro, search, pageSize]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const start = (pageSafe - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const comEmail = useMemo(() => filtered.filter((c) => c.email).length, [filtered]);
  const naBaseCount = useMemo(() => filtered.filter((c) => c.naBase).length, [filtered]);

  const exportXlsx = () => {
    const headers = ["Razão social", "CNPJ", "Cidade", "UF", "Telefone", "Email", "Na base", "Situação", "Encontrado por", "Segmento (CNAE)"];
    const rows = filtered.map((c) => [
      c.razao, c.cnpj, c.cidade, c.uf, c.telefone, c.email, c.naBase ? "Sim" : "Não",
      c.naBase ? c.situacao : "", c.forma ? FORMA_META[c.forma].label : "", c.cnae,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{ wch: 42 }, { wch: 20 }, { wch: 22 }, { wch: 5 }, { wch: 18 }, { wch: 32 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, `clientes_prospeccao_${total}.xlsx`);
  };

  const goCobertura = () => {
    const qs = selCnaes.length ? `?cnae=${encodeURIComponent(selCnaes.join(","))}` : "";
    navigate(`/prospeccao${qs}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-gradient-card shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={goCobertura} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors" title="Voltar para cobertura">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">CLIENTES</h1>
              <p className="text-[10px] text-muted-foreground">Detalhes e contatos por segmento</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={goCobertura} className="hidden sm:flex items-center gap-1.5 text-xs px-3 h-8 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
              <Target className="w-3.5 h-3.5" /> Cobertura
            </button>
            {user && <span className="text-xs text-muted-foreground hidden md:inline">{user.displayName}</span>}
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-[1280px] px-5 pt-7 pb-12 flex flex-col gap-5">
          {/* Filtros */}
          <div className="glass-card rounded-xl p-4 relative z-40">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <Target className="w-4 h-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Segmento (CNAE)</span>
              </div>
              <MultiSelect
                className="flex-1 min-w-[220px]"
                options={cnaeOptions}
                values={selCnaes}
                onChange={setSelCnaes}
                placeholder={cnaesLoading ? "Carregando segmentos…" : "Selecione segmentos (CNAE)…"}
                manyLabel="segmentos"
                searchPlaceholder="Buscar segmento…"
                disabled={cnaesLoading}
              />
              <div className="flex items-center gap-2 shrink-0">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estado</span>
              </div>
              <MultiSelect
                className="w-[200px]"
                options={ufOptions}
                values={selUfs}
                onChange={setSelUfs}
                placeholder="Todos os estados"
                manyLabel="estados"
                searchPlaceholder="Buscar estado…"
                disabled={!clientes.length}
              />
              {isFetching && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> carregando…
                </span>
              )}
            </div>
          </div>

          {isError && (
            <div className="glass-card rounded-xl p-4 border-destructive/40 bg-destructive/5 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Erro ao carregar dados da ApiDovale. Verifique a conexão e tente novamente.
            </div>
          )}

          {!selCnaes.length ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <Target className="w-7 h-7 text-primary mx-auto mb-2.5" />
              <p className="text-sm font-bold text-foreground">Selecione ao menos um segmento</p>
              <p className="text-[12.5px] text-muted-foreground mt-1.5">Escolha um ou mais CNAEs acima para listar os clientes.</p>
            </div>
          ) : !clientes.length && isFetching ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <Loader2 className="w-7 h-7 text-primary mx-auto mb-2.5 animate-spin" />
              <p className="text-sm font-bold text-foreground">Carregando clientes…</p>
            </div>
          ) : !clientes.length ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <Users className="w-7 h-7 text-muted-foreground/50 mx-auto mb-2.5" />
              <p className="text-sm font-bold text-foreground">Nenhum cliente encontrado</p>
              <p className="text-[12.5px] text-muted-foreground mt-1.5">A ApiDovale não retornou registros para os segmentos selecionados.</p>
            </div>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden">
              {/* Barra de ações: busca, contagem, tamanho de página, export */}
              <div className="flex items-center gap-3 flex-wrap p-4 border-b border-border">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por razão, CNPJ, cidade, telefone ou email…"
                    className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                {/* Filtro na base / fora da base / ambos */}
                <div className="flex items-center rounded-lg border border-border bg-secondary/40 p-0.5 shrink-0">
                  {([
                    { k: "ambos", label: "Todos" },
                    { k: "na", label: "Na base" },
                    { k: "fora", label: "Fora da base" },
                  ] as { k: BaseFiltro; label: string }[]).map((opt) => (
                    <button
                      key={opt.k}
                      onClick={() => setBaseFiltro(opt.k)}
                      className={`text-[12px] font-medium px-2.5 h-8 rounded-md transition-colors ${baseFiltro === opt.k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                  {fmt(total)} clientes · {fmt(naBaseCount)} na base · {fmt(comEmail)} com email
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-muted-foreground">por página</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-9 rounded-lg bg-secondary/60 border border-border text-sm text-foreground px-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <button
                  onClick={exportXlsx}
                  disabled={!total}
                  className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
                </button>
              </div>

              {/* Tabela */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="font-semibold px-4 py-2.5">Razão social</th>
                      <th className="font-semibold px-4 py-2.5">CNPJ</th>
                      <th className="font-semibold px-4 py-2.5">Cidade / UF</th>
                      <th className="font-semibold px-4 py-2.5">Telefone</th>
                      <th className="font-semibold px-4 py-2.5">Email</th>
                      <th className="font-semibold px-4 py-2.5">Na base</th>
                      <th className="font-semibold px-4 py-2.5">Situação</th>
                      <th className="font-semibold px-4 py-2.5">Encontrado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!total && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          Nenhum cliente para o filtro atual.
                        </td>
                      </tr>
                    )}
                    {pageRows.map((c, i) => {
                      const F = c.forma ? FORMA_META[c.forma] : null;
                      const Icon = F?.icon;
                      const ativo = c.situacao.toLocaleLowerCase("pt-BR") === "ativo";
                      return (
                        <tr key={`${c.cnpj}-${i}`} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-2.5 text-foreground font-medium max-w-[280px] truncate" title={c.razao}>{c.razao || DASH}</td>
                          <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs whitespace-nowrap">{c.cnpj || DASH}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {c.cidade || DASH}{c.uf ? <span className="text-muted-foreground/60"> / {c.uf}</span> : null}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {c.telefone ? (
                              <a href={`tel:${c.telefone}`} className="hover:text-primary">{formatTelefone(c.telefone)}</a>
                            ) : DASH}
                          </td>
                          <td className="px-4 py-2.5 max-w-[220px] truncate">
                            {c.email ? (
                              <a href={`mailto:${c.email}`} className="text-primary hover:underline" title={c.email}>{c.email}</a>
                            ) : <span className="text-muted-foreground/50">{DASH}</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.naBase ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                              {c.naBase ? "Sim" : "Não"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {c.naBase ? (
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${ativo ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                                {c.situacao}
                              </span>
                            ) : <span className="text-muted-foreground/50">{DASH}</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {F && Icon ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                <Icon className="w-3.5 h-3.5" style={{ color: F.color }} />
                                {F.label}
                              </span>
                            ) : <span className="text-muted-foreground/50">{DASH}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  {total ? `${fmt(start + 1)}–${fmt(Math.min(start + pageSize, total))} de ${fmt(total)}` : "0 resultados"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pageSafe <= 1}
                    className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" /> Anterior
                  </button>
                  <span className="text-xs text-muted-foreground font-mono px-2">{pageSafe} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={pageSafe >= totalPages}
                    className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
                  >
                    Próxima <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
