import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Sun, Moon, Users, MapPin, Target, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import {
  STATES,
  STATE_BY_SIGLA,
  TOTAIS,
  coberturaPct,
  type StateCoverage,
} from "@/data/prospeccaoMock";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const GEO_URL = "/br-states.json";

// Escala de cor por cobertura: vermelho (baixa cobertura = oportunidade) → verde (alta)
function corCobertura(pct: number): string {
  if (pct < 20) return "#ef4444";
  if (pct < 40) return "#f59e0b";
  if (pct < 60) return "#eab308";
  if (pct < 80) return "#84cc16";
  return "#22c55e";
}

const LEGENDA = [
  { label: "< 20%", cor: "#ef4444" },
  { label: "20–40%", cor: "#f59e0b" },
  { label: "40–60%", cor: "#eab308" },
  { label: "60–80%", cor: "#84cc16" },
  { label: "≥ 80%", cor: "#22c55e" },
];

const fmt = (n: number) => n.toLocaleString("pt-BR");

export default function Prospeccao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ nome: string; pct: number; x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const coberturaGeral = coberturaPct(TOTAIS.naBase, TOTAIS.foraBase);
  const pieData = [
    { name: "Na base", value: TOTAIS.naBase, cor: "#22c55e" },
    { name: "Fora da base", value: TOTAIS.foraBase, cor: "#94a3b8" },
  ];

  const estado: StateCoverage | null = selected ? STATE_BY_SIGLA[selected] ?? null : null;

  // ranking de estados por menor cobertura (maior oportunidade) para destaque
  const oportunidades = useMemo(
    () =>
      [...STATES]
        .sort((a, b) => coberturaPct(a.naBase, a.foraBase) - coberturaPct(b.naBase, b.foraBase))
        .slice(0, 5),
    [],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
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
        <div className="container mx-auto max-w-7xl px-4 py-8 space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={<Users className="w-5 h-5" />} label="Clientes na base" value={fmt(TOTAIS.naBase)} tone="emerald" />
            <KpiCard icon={<Target className="w-5 h-5" />} label="Fora da base (potencial)" value={fmt(TOTAIS.foraBase)} tone="slate" />
            <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Cobertura geral" value={`${coberturaGeral}%`} tone="blue" />
            <KpiCard icon={<MapPin className="w-5 h-5" />} label="Estados" value={String(STATES.length)} tone="violet" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Pizza */}
            <div className="glass-card rounded-xl p-6 border border-border bg-card">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                % de clientes na base
              </h3>
              <div className="relative h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="none">
                      {pieData.map((d) => (
                        <Cell key={d.name} fill={d.cor} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-bold text-foreground">{coberturaGeral}%</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">na base</span>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.cor }} />
                      {d.name}
                    </span>
                    <span className="font-mono text-foreground">{fmt(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Mapa */}
            <div className="glass-card rounded-xl p-4 border border-border bg-card lg:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cobertura por estado {selected && `— ${STATE_BY_SIGLA[selected]?.nome}`}
                </h3>
                {selected && (
                  <button onClick={() => setSelected(null)} className="text-[11px] text-primary hover:underline">
                    limpar seleção
                  </button>
                )}
              </div>

              <div className="relative">
                <ComposableMap
                  projection="geoMercator"
                  projectionConfig={{ scale: 780, center: [-54, -15] }}
                  width={800}
                  height={520}
                  style={{ width: "100%", height: "auto" }}
                >
                  <Geographies geography={GEO_URL}>
                    {({ geographies }: { geographies: any[] }) =>
                      geographies.map((geo) => {
                        const sigla = geo.properties.sigla as string;
                        const st = STATE_BY_SIGLA[sigla];
                        const pct = st ? coberturaPct(st.naBase, st.foraBase) : 0;
                        const isSel = selected === sigla;
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            onMouseEnter={(e) =>
                              setHover({ nome: st?.nome ?? sigla, pct, x: e.clientX, y: e.clientY })
                            }
                            onMouseMove={(e) =>
                              setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
                            }
                            onMouseLeave={() => setHover(null)}
                            onClick={() => setSelected((s) => (s === sigla ? null : sigla))}
                            style={{
                              default: {
                                fill: corCobertura(pct),
                                stroke: "#0f172a",
                                strokeWidth: isSel ? 1.5 : 0.5,
                                opacity: selected && !isSel ? 0.45 : 0.9,
                                outline: "none",
                                cursor: "pointer",
                              },
                              hover: { fill: corCobertura(pct), opacity: 1, outline: "none", cursor: "pointer" },
                              pressed: { fill: corCobertura(pct), outline: "none" },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>
                </ComposableMap>

                {hover && (
                  <div
                    className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
                    style={{ left: hover.x + 12, top: hover.y + 12 }}
                  >
                    <div className="font-semibold text-foreground">{hover.nome}</div>
                    <div className="text-muted-foreground">
                      cobertura <span className="font-mono" style={{ color: corCobertura(hover.pct) }}>{hover.pct}%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Legenda */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Cobertura:</span>
                {LEGENDA.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.cor }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Drill de cidade / oportunidades */}
          <div className="glass-card rounded-xl p-6 border border-border bg-card">
            {estado ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {estado.nome} — cobertura por cidade
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {fmt(estado.naBase)} na base · {fmt(estado.foraBase)} fora · {coberturaPct(estado.naBase, estado.foraBase)}%
                  </span>
                </div>
                <div className="space-y-3">
                  {estado.cidades.map((c) => {
                    const pct = coberturaPct(c.naBase, c.foraBase);
                    return (
                      <div key={c.cidade}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-foreground">{c.cidade}</span>
                          <span className="text-muted-foreground font-mono">
                            {fmt(c.naBase)} / {fmt(c.naBase + c.foraBase)} · {pct}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: corCobertura(pct) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground mb-1">Maiores oportunidades</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Estados com menor cobertura — clique num estado no mapa para ver as cidades.
                </p>
                <div className="space-y-3">
                  {oportunidades.map((s) => {
                    const pct = coberturaPct(s.naBase, s.foraBase);
                    return (
                      <button
                        key={s.sigla}
                        onClick={() => setSelected(s.sigla)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-foreground">{s.nome}</span>
                          <span className="text-muted-foreground font-mono">
                            {fmt(s.foraBase)} fora da base · {pct}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: corCobertura(pct) }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "slate" | "blue" | "violet";
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-500 bg-emerald-500/10",
    slate: "text-slate-400 bg-slate-400/10",
    blue: "text-blue-500 bg-blue-500/10",
    violet: "text-violet-500 bg-violet-500/10",
  };
  return (
    <div className="glass-card rounded-xl p-4 border border-border bg-card flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</div>
      <div>
        <div className="text-xl font-bold text-foreground leading-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
