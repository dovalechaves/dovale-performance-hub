import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Sun, Moon, Users, MapPin, Target, TrendingUp, CheckCircle2, Sparkles, Loader2, AlertCircle,
  Building2, MapPinned, Phone, HelpCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  fetchCnaes,
  fetchVerificarCadastros,
  buildCobertura,
  mergeFormas,
  somaFormas,
  FORMAS_CADASTRO,
  type Cobertura,
  type CityCoverage,
  type FormaCadastro,
  type FormasBreakdown,
} from "@/services/prospeccao";
import { MultiSelect, type MultiOption } from "@/components/prospeccao/MultiSelect";
import { KpiCard } from "@/components/prospeccao/KpiCard";
import { DonutChart } from "@/components/prospeccao/DonutChart";
import { BrazilCoverageMap } from "@/components/prospeccao/BrazilCoverageMap";
import { CoverageBar, CoverageLegend, pctOf } from "@/components/prospeccao/coverage";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const fmt = (n: number) => n.toLocaleString("pt-BR");

// Estado agregado (soma dos CNAEs selecionados), com cidades unificadas.
interface ViewState {
  nome: string;
  naBase: number;
  ativos: number;
  foraBase: number;
  formas: FormasBreakdown;
  cidades: CityCoverage[];
}

// Metadados de exibição de cada forma de vínculo (por onde o cliente foi encontrado).
const FORMA_META: Record<FormaCadastro, { label: string; icon: typeof Building2; color: string }> = {
  CNPJ: { label: "Por CNPJ", icon: Building2, color: "hsl(217 91% 60%)" },
  CEP: { label: "Por CEP", icon: MapPinned, color: "hsl(75 55% 42%)" },
  Telefone: { label: "Por Telefone", icon: Phone, color: "hsl(262 83% 66%)" },
  Outro: { label: "Outros", icon: HelpCircle, color: "hsl(var(--muted-foreground))" },
};

export default function Prospeccao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [selCnaes, setSelCnaes] = useState<string[]>([]);
  const [selStates, setSelStates] = useState<string[]>([]);
  const [donutHover, setDonutHover] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Ao trocar de segmentos, limpa a seleção de estados (decisão de UX do handoff).
  useEffect(() => setSelStates([]), [selCnaes]);

  // Lista de CNAEs — carregada uma vez; default = primeiro segmento.
  const { data: cnaes = [], isLoading: cnaesLoading } = useQuery({
    queryKey: ["prospeccao-cnaes"],
    queryFn: ({ signal }) => fetchCnaes(signal),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (cnaes.length && selCnaes.length === 0) setSelCnaes([cnaes[0]]);
  }, [cnaes, selCnaes.length]);

  // Uma query por CNAE selecionado; agregamos os resultados numa visão só.
  const coberturaQueries = useQueries({
    queries: selCnaes.map((cnae) => ({
      queryKey: ["prospeccao-cobertura", cnae],
      queryFn: async ({ signal }: { signal?: AbortSignal }) =>
        buildCobertura(await fetchVerificarCadastros(cnae, signal)),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isFetching = coberturaQueries.some((q) => q.isFetching);
  const isError = coberturaQueries.some((q) => q.isError);
  const coberturas = coberturaQueries.map((q) => q.data).filter(Boolean) as Cobertura[];

  const cnaeOptions: MultiOption[] = useMemo(() => cnaes.map((c) => ({ value: c, label: c })), [cnaes]);

  // Agrega cobertura de TODOS os segmentos selecionados numa visão única por UF.
  const view = useMemo(() => {
    const st: Record<string, ViewState & { _c: Map<string, CityCoverage> }> = {};
    coberturas.forEach((cob) => {
      cob.states.forEach((s) => {
        if (!st[s.sigla]) st[s.sigla] = { nome: s.nome, naBase: 0, ativos: 0, foraBase: 0, formas: { CNPJ: 0, CEP: 0, Telefone: 0, Outro: 0 }, cidades: [], _c: new Map() };
        const acc = st[s.sigla];
        acc.naBase += s.naBase;
        acc.ativos += s.ativos;
        acc.foraBase += s.foraBase;
        mergeFormas(acc.formas, s.formas);
        s.cidades.forEach((ci) => {
          const cur = acc._c.get(ci.cidade) ?? { cidade: ci.cidade, naBase: 0, ativos: 0, foraBase: 0 };
          cur.naBase += ci.naBase;
          cur.ativos += ci.ativos;
          cur.foraBase += ci.foraBase;
          acc._c.set(ci.cidade, cur);
        });
      });
    });
    const out: Record<string, ViewState> = {};
    Object.entries(st).forEach(([sg, s]) => {
      out[sg] = {
        nome: s.nome,
        naBase: s.naBase,
        ativos: s.ativos,
        foraBase: s.foraBase,
        formas: s.formas,
        cidades: [...s._c.values()].sort((a, b) => b.naBase + b.foraBase - (a.naBase + a.foraBase)),
      };
    });
    return out;
  }, [coberturas]);

  const hasData = selCnaes.length > 0 && Object.keys(view).length > 0;
  const ufOptions: MultiOption[] = useMemo(
    () =>
      Object.entries(view)
        .map(([sg, s]) => ({ value: sg, label: s.nome, hint: sg }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [view],
  );
  const toggleState = (sg: string) =>
    setSelStates((p) => (p.includes(sg) ? p.filter((x) => x !== sg) : [...p, sg]));

  // KPIs + donut são escopados aos estados selecionados (ou todos, se nenhum).
  const scoped = selStates.length
    ? Object.entries(view).filter(([sg]) => selStates.includes(sg))
    : Object.entries(view);
  const totais = scoped.reduce(
    (a, [, s]) => {
      mergeFormas(a.formas, s.formas);
      return { naBase: a.naBase + s.naBase, ativos: a.ativos + s.ativos, foraBase: a.foraBase + s.foraBase, formas: a.formas };
    },
    { naBase: 0, ativos: 0, foraBase: 0, formas: { CNPJ: 0, CEP: 0, Telefone: 0, Outro: 0 } as FormasBreakdown },
  );
  const coberturaGeral = pctOf(totais.naBase, totais.foraBase);

  // Quebra "por onde o cliente foi encontrado na base": só formas com registros,
  // ordenadas da maior para a menor. O total das formas = clientes na base.
  const totalFormas = somaFormas(totais.formas);
  const formasView = FORMAS_CADASTRO
    .map((k) => ({ key: k, ...FORMA_META[k], value: totais.formas[k] }))
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value - a.value);
  const estado = selStates.length === 1 ? view[selStates[0]] : null;

  const inativosBase = Math.max(0, totais.naBase - totais.ativos);
  const pctAtiva = pctOf(totais.ativos, inativosBase); // % da base que está ativa
  const pieData = [
    { name: "Ativos na base", value: totais.ativos, color: "#22c55e" },
    { name: "Inativos na base", value: inativosBase, color: "hsl(145 48% 72%)" },
    { name: "Fora da base", value: totais.foraBase, color: "hsl(var(--muted-foreground))" },
  ];

  const oportunidades = useMemo(
    () =>
      Object.entries(view)
        .map(([sg, s]) => ({ sg, ...s, pct: pctOf(s.naBase, s.foraBase) }))
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 6),
    [view],
  );

  const mapData = useMemo(
    () => Object.fromEntries(Object.entries(view).map(([sg, s]) => [sg, { nome: s.nome, naBase: s.naBase, foraBase: s.foraBase }])),
    [view],
  );

  const tituloEstado =
    selStates.length === 1 ? ` — ${view[selStates[0]]?.nome}` : selStates.length > 1 ? ` — ${selStates.length} estados` : "";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header padrão Dovale */}
      <header className="border-b border-border bg-gradient-card shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate("/hub")} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">PROSPECÇÃO</h1>
              <p className="text-[10px] text-muted-foreground">Cobertura de base por região</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-[1200px] px-5 pt-7 pb-12 flex flex-col gap-5">
          {/* Filtros — z-40 para o popover ficar acima dos cards seguintes (stacking do glass) */}
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
                className="w-[220px]"
                options={ufOptions}
                values={selStates}
                onChange={setSelStates}
                placeholder="Todos os estados"
                manyLabel="estados"
                searchPlaceholder="Buscar estado…"
                disabled={!hasData}
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
              <p className="text-[12.5px] text-muted-foreground mt-1.5">Escolha um ou mais CNAEs acima para ver a cobertura da base.</p>
            </div>
          ) : !hasData && isFetching ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <Loader2 className="w-7 h-7 text-primary mx-auto mb-2.5 animate-spin" />
              <p className="text-sm font-bold text-foreground">Carregando cobertura…</p>
              <p className="text-[12.5px] text-muted-foreground mt-1.5">Consultando a ApiDovale para os segmentos selecionados.</p>
            </div>
          ) : !hasData ? (
            <div className="glass-card rounded-xl p-12 text-center">
              <MapPin className="w-7 h-7 text-muted-foreground/50 mx-auto mb-2.5" />
              <p className="text-sm font-bold text-foreground">Nenhum cadastro encontrado</p>
              <p className="text-[12.5px] text-muted-foreground mt-1.5">A ApiDovale não retornou registros para os segmentos selecionados.</p>
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <KpiCard icon={<Users className="w-5 h-5" />} label="Clientes na base" value={fmt(totais.naBase)} tone="success" />
                <KpiCard icon={<CheckCircle2 className="w-5 h-5" />} label="Clientes ativos" value={fmt(totais.ativos)} tone="gold" trend={`${pctAtiva}% da base`} />
                <KpiCard icon={<Target className="w-5 h-5" />} label="Fora da base (potencial)" value={fmt(totais.foraBase)} tone="slate" />
                <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Cobertura geral" value={`${coberturaGeral}%`} tone="primary" />
              </div>

              {/* Como o cliente foi encontrado na base (CNPJ / CEP / Telefone) */}
              {totalFormas > 0 && (
                <div className="glass-card rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Por onde o cliente foi encontrado na base{tituloEstado}
                      </h3>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{fmt(totalFormas)} vínculos</span>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {formasView.map((f) => {
                      const pct = totalFormas ? Math.round((f.value / totalFormas) * 100) : 0;
                      const Icon = f.icon;
                      return (
                        <div key={f.key} className="rounded-lg border border-border bg-secondary/40 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${f.color} 16%, transparent)`, color: f.color }}>
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="text-[12px] font-semibold text-foreground">{f.label}</span>
                            <span className="ml-auto text-[11px] text-muted-foreground font-mono">{pct}%</span>
                          </div>
                          <div className="text-xl font-bold text-foreground tabular-nums">{fmt(f.value)}</div>
                          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: f.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Donut + Mapa */}
              <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-stretch">
                <div className="glass-card rounded-xl p-5 flex flex-col">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Composição da base e do mercado</h3>
                  <div className="flex-1 flex items-center justify-center py-2.5">
                    <DonutChart size={220} data={pieData} centerValue={`${coberturaGeral}%`} centerLabel="na base" activeIndex={donutHover} onHover={setDonutHover} />
                  </div>
                  <div className="text-center text-[12.5px] text-muted-foreground -mt-0.5 mb-2.5">
                    <b className="text-[hsl(145_55%_38%)] font-bold">{pctAtiva}%</b> da base está ativa
                  </div>
                  <div className="flex flex-col gap-2">
                    {pieData.map((d, i) => (
                      <div
                        key={d.name}
                        onMouseEnter={() => setDonutHover(i)}
                        onMouseLeave={() => setDonutHover(null)}
                        className={`flex items-center justify-between text-[13px] px-2 py-1.5 rounded-sm transition-colors ${donutHover === i ? "bg-muted" : ""}`}
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: d.color }} />
                          {d.name}
                        </span>
                        <span className="font-mono text-xs text-foreground">{fmt(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-card rounded-xl p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Cobertura por estado{tituloEstado}</h3>
                    {selStates.length > 0 && (
                      <button onClick={() => setSelStates([])} className="text-[11px] text-primary hover:underline">limpar seleção</button>
                    )}
                  </div>
                  <div className="flex-1 flex items-center">
                    <BrazilCoverageMap data={mapData} selected={selStates} onSelect={toggleState} width={720} height={520} />
                  </div>
                  <div className="mt-2">
                    <CoverageLegend />
                  </div>
                </div>
              </div>

              {/* Drill / oportunidades — 3 modos */}
              <div className="glass-card rounded-xl p-5">
                {estado ? (
                  <div>
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-[15px] font-bold text-foreground">{estado.nome} — base por cidade</h3>
                        <span className="text-[11px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">{estado.cidades.length} cidades</span>
                        <span className="text-[11px] rounded-full bg-success text-success-foreground px-2 py-0.5 font-semibold">{pctOf(estado.ativos, estado.naBase - estado.ativos)}% ativos</span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {fmt(estado.naBase)} na base · {fmt(estado.ativos)} ativos · {fmt(estado.foraBase)} fora
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3.5 max-h-[30rem] overflow-y-auto pr-1">
                      {estado.cidades.map((c) => {
                        const p = pctOf(c.naBase, c.foraBase);
                        return <CoverageBar key={c.cidade} label={c.cidade} pct={p} meta={`${fmt(c.ativos)} ativos / ${fmt(c.naBase)} na base · ${p}%`} />;
                      })}
                    </div>
                  </div>
                ) : selStates.length > 1 ? (
                  <div>
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h3 className="text-[15px] font-bold text-foreground">{selStates.length} estados selecionados</h3>
                      <span className="text-xs text-muted-foreground font-mono">{fmt(totais.naBase)} na base · {fmt(totais.ativos)} ativos · {coberturaGeral}%</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3.5">
                      {selStates.map((sg) => {
                        const s = view[sg];
                        if (!s) return null;
                        const p = pctOf(s.naBase, s.foraBase);
                        return <CoverageBar key={sg} label={s.nome} pct={p} meta={`${fmt(s.ativos)} ativos / ${fmt(s.naBase)} na base · ${p}%`} onClick={() => setSelStates([sg])} />;
                      })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <Sparkles className="w-[18px] h-[18px] text-[hsl(75_55%_42%)]" />
                      <h3 className="text-[15px] font-bold text-foreground">Maiores oportunidades</h3>
                    </div>
                    <p className="text-[12.5px] text-muted-foreground mb-4">Estados com menor cobertura — clique num estado no mapa para ver as cidades.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3.5">
                      {oportunidades.map((s) => (
                        <CoverageBar key={s.sg} label={s.nome} pct={s.pct} meta={`${fmt(s.foraBase)} fora da base · ${s.pct}%`} onClick={() => setSelStates([s.sg])} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
