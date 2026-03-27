import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Target, Users, Save, Loader2, ArrowLeft, RefreshCw, Shield, ChevronDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import {
  getRepresentantes,
  getMetas,
  saveMeta,
  saveDiasUteis,
  LOJAS,
  type Representante,
  type Meta,
} from "@/services/api";
import logoWhite from "@/assets/logo-white.png";
import logoBlue from "@/assets/logo-blue.png";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

// ─── Seção: Gestão de Metas ───────────────────────────────────────────────
function SecaoMetas({ dark }: { dark: boolean }) {
  const { user, can } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loja, setLoja] = useState(() => user?.loja ?? "bh");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [reps, setReps] = useState<Representante[]>([]);
  const [metasMap, setMetasMap] = useState<Record<string, string>>({});
  const [diasUteis, setDiasUteis] = useState<string>("");
  const [savingDias, setSavingDias] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const [repsData, metasData] = await Promise.all([
        getRepresentantes(loja),
        getMetas(loja, mes, ano),
      ]);
      setReps(repsData);
      const map: Record<string, string> = {};
      for (const m of metasData) {
        map[m.rep_codigo] = m.meta_valor.toString();
      }
      setMetasMap(map);
      // dias_uteis é o mesmo para todos os vendedores do mês
      const du = metasData[0]?.dias_uteis;
      if (du) setDiasUteis(String(du));
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [loja, mes, ano]);

  useEffect(() => { carregar(); }, [carregar]);

  const handleSalvar = async (rep: Representante) => {
    const valor = parseFloat(metasMap[rep.rep_codigo]?.replace(",", ".") || "0");
    if (!valor || isNaN(valor)) return;
    setSaving(rep.rep_codigo);
    setErro("");
    try {
      await saveMeta({
        rep_codigo: rep.rep_codigo,
        rep_nome: rep.rep_nome,
        loja,
        meta_valor: valor,
        dias_uteis: diasUteis ? Number(diasUteis) : null,
        mes,
        ano,
      });
      setSucesso(`Meta de ${rep.rep_nome} salva!`);
      setTimeout(() => setSucesso(""), 3000);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Gestão de Metas
        </h2>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        {/* Loja — só admin troca */}
        {isAdmin ? (
          <div className="relative">
            <select
              value={loja}
              onChange={(e) => setLoja(e.target.value)}
              className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {LOJAS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          </div>
        ) : (
          <span className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground font-semibold">
            {LOJAS.find(l => l.value === loja)?.label ?? loja.toUpperCase()}
          </span>
        )}

        {/* Mês */}
        <div className="relative">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {MESES.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Ano */}
        <input
          type="number"
          value={ano}
          onChange={(e) => setAno(Number(e.target.value))}
          className="w-24 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          min={2024}
          max={2099}
        />

        <button
          onClick={carregar}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {/* Dias úteis do mês */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <span className="text-xs text-muted-foreground dark:text-slate-300 font-medium whitespace-nowrap">
          Dias úteis de {MESES[mes - 1]}/{ano}:
        </span>
        <input
          type="number"
          value={diasUteis}
          onChange={(e) => setDiasUteis(e.target.value)}
          min={1}
          max={31}
          placeholder="ex: 22"
          className="w-20 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          disabled={savingDias || !diasUteis}
          onClick={async () => {
            setSavingDias(true);
            setErro("");
            try {
              await saveDiasUteis(loja, mes, ano, Number(diasUteis));
              setSucesso("Dias úteis salvos!");
              setTimeout(() => setSucesso(""), 3000);
            } catch (e: unknown) {
              setErro(e instanceof Error ? e.message : "Erro ao salvar dias úteis");
            } finally {
              setSavingDias(false);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {savingDias ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Salvar
        </button>
        <span className="text-[10px] text-muted-foreground">
          Meta diária = meta ÷ dias úteis
        </span>
      </div>

      {/* Feedback */}
      {erro && <p className="text-xs text-red-400">{erro}</p>}
      {sucesso && <p className="text-xs text-primary">{sucesso}</p>}

      {/* Tabela */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Cód.</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Vendedor</th>
              <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">
                Meta — {MESES[mes - 1]}/{ano}
              </th>
              {can("manage:metas") && (
                <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Ação</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </td>
              </tr>
            ) : reps.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-xs">
                  Nenhum vendedor encontrado para esta loja.
                </td>
              </tr>
            ) : (
              reps.map((rep, i) => {
                const metaAtual = metasMap[rep.rep_codigo];
                return (
                  <motion.tr
                    key={rep.rep_codigo}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {rep.rep_codigo}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {rep.rep_nome}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {can("manage:metas") ? (
                        <input
                          type="number"
                          value={metasMap[rep.rep_codigo] ?? ""}
                          onChange={(e) =>
                            setMetasMap((prev) => ({ ...prev, [rep.rep_codigo]: e.target.value }))
                          }
                          placeholder="0,00"
                          className="w-40 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-right text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                        />
                      ) : (
                        <span className="font-mono text-foreground">
                          {metaAtual ? fmt(parseFloat(metaAtual)) : <span className="text-muted-foreground">—</span>}
                        </span>
                      )}
                    </td>
                    {can("manage:metas") && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleSalvar(rep)}
                          disabled={saving === rep.rep_codigo || !metasMap[rep.rep_codigo]}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {saving === rep.rep_codigo ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}
                          Salvar
                        </button>
                      </td>
                    )}
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Seção: Gestão de Usuários (só admin) ────────────────────────────────
function SecaoUsuarios() {
  const MOCK_USUARIOS = [
    { usuario: "kevin.silva",      role: "admin"   as Role, loja: null },
    { usuario: "henrique.berbert", role: "admin"   as Role, loja: null },
    { usuario: "paul.moraes",      role: "admin"   as Role, loja: null },
    { usuario: "willian.rubim",    role: "admin"   as Role, loja: null },
    { usuario: "joao.pedro",       role: "admin"   as Role, loja: null },
    { usuario: "gerente.teste",    role: "manager" as Role, loja: null },
  ];

  const LOJAS_OPTIONS = [
    { value: "bh",  label: "BH" },
    { value: "l2",  label: "Santana" },
    { value: "l3",  label: "Rio de Janeiro" },
  ];

  const [usuarios, setUsuarios] = useState(MOCK_USUARIOS);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const persist = async (usuario: string, role: Role, loja: string | null) => {
    setSaving(usuario);
    try {
      await fetch(`${window.location.protocol}//${window.location.hostname}:3001/api/auth/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, role, loja }),
      });
      setSaved(usuario);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  const handleRoleChange = (usuario: string, novaRole: Role) => {
    const loja = novaRole === "manager"
      ? (usuarios.find(u => u.usuario === usuario)?.loja ?? "bh")
      : null;
    setUsuarios(prev => prev.map(u => u.usuario === usuario ? { ...u, role: novaRole, loja } : u));
    persist(usuario, novaRole, loja);
  };

  const handleLojaChange = (usuario: string, novaLoja: string) => {
    setUsuarios(prev => prev.map(u => u.usuario === usuario ? { ...u, loja: novaLoja } : u));
    const role = usuarios.find(u => u.usuario === usuario)?.role ?? "manager";
    persist(usuario, role, novaLoja);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
          Gestão de Usuários
        </h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-widest">
          Admin
        </span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Usuário</th>
              <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Alterar Role</th>
              <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Loja</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u, i) => (
              <motion.tr
                key={u.usuario}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-foreground">{u.usuario}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest
                    ${u.role === "admin" ? "bg-primary/15 text-primary" :
                      u.role === "manager" ? "bg-blue-500/15 text-blue-400" :
                      "bg-muted text-muted-foreground"}`}>
                    {ROLE_LABELS[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="relative inline-flex items-center gap-2">
                    <div className="relative">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.usuario, e.target.value as Role)}
                        disabled={u.usuario === "kevin.silva" || saving === u.usuario}
                        className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                    {saving === u.usuario && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    {saved === u.usuario && <span className="text-[10px] text-emerald-400 font-semibold">Salvo</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {u.role === "manager" ? (
                    <div className="relative inline-block">
                      <select
                        value={u.loja ?? "bh"}
                        onChange={(e) => handleLojaChange(u.usuario, e.target.value)}
                        disabled={saving === u.usuario}
                        className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                      >
                        {LOJAS_OPTIONS.map(l => (
                          <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        * O usuário <span className="text-primary font-mono">kevin.silva</span> é administrador fixo e não pode ter sua role alterada.
      </p>
    </section>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────
export default function Gestao() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [dark] = useState(true);

  if (!can("manage:metas") && !can("manage:users")) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Acesso restrito.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background scanline">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-36 overflow-hidden">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0" : "opacity-100"}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100" : "opacity-0"}`} />
            </div>
            <div className="h-6 w-px bg-border" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">Gerenciamento</p>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-foreground leading-tight">{user.usuario}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary">{user.roleLabel}</span>
              </div>
            )}
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Painel
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="container mx-auto px-4 py-8 space-y-10 max-w-4xl">
        {can("manage:metas") && <SecaoMetas dark={dark} />}
        {can("manage:roles") && <SecaoUsuarios />}
      </main>
    </div>
  );
}
