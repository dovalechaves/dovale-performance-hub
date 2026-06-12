import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Sun, Moon, LogOut, Users, Sparkles, AlertCircle, X,
  Send, ChevronRight, Phone, BarChart3, ClipboardList, ChevronDown,
  TrendingUp, Download, Loader2, CheckCircle2, Circle, History,
  Search, Briefcase, PieChart, Filter, ShieldCheck, ChevronLeft, Target,
  ShoppingBag, Store, FileText,
} from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { toast } from "sonner";
import confetti from "canvas-confetti";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

// ── Tipos ────────────────────────────────────────────────────────────────────
type Categoria = "A" | "B" | "C" | "D";
type ViewType = "rep" | "categoria" | "gerente" | "admin" | "relatorios";

interface Cliente {
  id: string; nome: string; telefone: string; cidade: string;
  categoria: Categoria; ultimaCompra: string; valorUltimaCompra: number;
  ticketMedio: number; frequenciaMensal: boolean; produtoFavorito: string; repId?: number;
}
interface VendedorInfo { nome: string; loja: string; meta: number; realizado: number; }
interface CrmLog {
  dataFull: string; loja: string; clienteId: number; nomeCliente: string;
  telefone: string; status: string; obs: string; rep_codigo: number; repLogin: string;
}
interface Rep { rep_codigo: number; rep_nome: string; }

// ── Constantes ────────────────────────────────────────────────────────────────
const categoriaInfo: Record<Categoria, { titulo: string; descricao: string; ticket: string }> = {
  A: { titulo: "Categoria A", descricao: "Clientes premium, alta frequência", ticket: "Acima de R$ 801" },
  B: { titulo: "Categoria B", descricao: "Clientes recorrentes de médio porte", ticket: "R$ 501 a R$ 800" },
  C: { titulo: "Categoria C", descricao: "Clientes ocasionais", ticket: "R$ 301 a R$ 500" },
  D: { titulo: "Categoria D", descricao: "Clientes esporádicos a reativar", ticket: "Até R$ 300" },
};

const catClasses: Record<Categoria, { text: string; bg: string; ring: string }> = {
  A: { text: "text-indigo-400", bg: "bg-indigo-500/10", ring: "ring-indigo-500/30 hover:ring-indigo-500/70" },
  B: { text: "text-amber-400",  bg: "bg-amber-500/10",  ring: "ring-amber-500/30 hover:ring-amber-500/70"   },
  C: { text: "text-pink-400",   bg: "bg-pink-500/10",   ring: "ring-pink-500/30 hover:ring-pink-500/70"     },
  D: { text: "text-red-400",    bg: "bg-red-500/10",    ring: "ring-red-500/30 hover:ring-red-500/70"       },
};

const SC_LOJAS = [
  { value: "l3",        label: "Rio de Janeiro" },
  { value: "l2",        label: "Santana"        },
  { value: "bh",        label: "Belo Horizonte" },
  { value: "campinas",  label: "Campinas"       },
  { value: "riopreto",  label: "Rio Preto"      },
  { value: "fortaleza", label: "Fortaleza"      },
];

const STATUS_LABELS: Record<string, string> = {
  comprou: "Comprou",
  nao_comprou: "Não comprou",
  retornar_contato: "Retornar contato",
  cancelado_agendamento: "Cancelado",
};

const GLOW_CSS = `
  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 0px transparent; }
    50% { box-shadow: 0 0 15px var(--glow-color); }
  }
  .glow-success { border-color: #22c55e !important; border-width: 2px;
    --glow-color: rgba(34,197,94,.6); animation: glow-pulse 1.2s ease-in-out 3; }
  .glow-error   { border-color: #ef4444 !important; border-width: 2px;
    --glow-color: rgba(239,68,68,.6); animation: glow-pulse 1.2s ease-in-out 3; }
  .glow-info    { border-color: #3b82f6 !important; border-width: 2px;
    --glow-color: rgba(59,130,246,.6); animation: glow-pulse 1.2s ease-in-out 3; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

// ── Utilitários ───────────────────────────────────────────────────────────────
function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const feriadosNacionais = ["01-01","04-21","05-01","09-07","10-12","11-02","11-15","12-25"];
function isDiaUtil(d: Date): boolean {
  const dw = d.getDay();
  if (dw === 0 || dw === 6) return false;
  const key = `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  return !feriadosNacionais.includes(key);
}

const { totalDiasUteis, diaUtilDeHoje } = (() => {
  const hoje = new Date();
  let total = 0, utilHoje = 0;
  const ano = hoje.getFullYear(), mes = hoje.getMonth();
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  for (let d = 1; d <= ultimo; d++) {
    const dt = new Date(ano, mes, d);
    if (isDiaUtil(dt)) { total++; if (d <= hoje.getDate()) utilHoje = total; }
  }
  return { totalDiasUteis: total, diaUtilDeHoje: utilHoje === 0 ? 1 : utilHoje };
})();

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

function isPotencialHoje(c: Cliente): boolean {
  if (totalDiasUteis === 0) return false;
  return (hashStr(c.id) % totalDiasUteis) + 1 === diaUtilDeHoje;
}

function moeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function glowClass(id: string, gm: Record<string, any>, sm: Record<string, string>) {
  const s = gm[id] || sm[id];
  if (s === "success" || s === "comprou") return "glow-success";
  if (s === "error" || s === "nao_comprou" || s === "cancelado_agendamento") return "glow-error";
  if (s === "info" || s === "retornar_contato") return "glow-info";
  return "";
}

// ── Hook SSE: clientes com streaming ─────────────────────────────────────────
const _cache: Map<string, { data: Cliente[]; ts: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function useSseClientes(loja: string, repCodigo: number) {
  const key = `${loja}:${repCodigo}`;
  const fresh = () => { const c = _cache.get(key); return c && Date.now() - c.ts < CACHE_TTL ? c.data : null; };
  const [clientes, setClientes] = useState<Cliente[]>(() => fresh() ?? []);
  const [isLoading, setIsLoading] = useState(() => !fresh() && !!loja);
  const [progress, setProgress] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!loja) return;
    const f = fresh();
    if (f) { setClientes(f); setIsLoading(false); return; }
    setClientes([]); setIsLoading(true); setProgress("Conectando...");
    const url = `${API_BASE}/sales-compass/clientes?loja=${encodeURIComponent(loja)}&rep_codigo=${repCodigo}`;
    const es = new EventSource(url);
    esRef.current = es;
    const acc: Cliente[] = [];
    es.addEventListener("progress", (e: MessageEvent) => setProgress(JSON.parse(e.data).message ?? "Carregando..."));
    es.addEventListener("chunk",    (e: MessageEvent) => { acc.push(...JSON.parse(e.data)); setClientes([...acc]); });
    es.addEventListener("done",     () => { _cache.set(key, { data: acc, ts: Date.now() }); setIsLoading(false); setProgress(null); es.close(); });
    es.addEventListener("error",    () => { setIsLoading(false); setProgress(null); es.close(); });
    es.onerror = () => { setIsLoading(false); setProgress(null); es.close(); };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { clientes, isLoading, progress };
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [d, setD] = useState(0);
  useEffect(() => {
    if (value === 0) { setD(0); return; }
    let s = 0; const inc = value / (1000 / 16);
    const t = setInterval(() => { s += inc; if (s >= value) { setD(value); clearInterval(t); } else setD(Math.floor(s)); }, 16);
    return () => clearInterval(t);
  }, [value]);
  return <>{d.toLocaleString("pt-BR")}</>;
}

// ── StatusBadges ──────────────────────────────────────────────────────────────
function StatusBadges({ c }: { c: Cliente }) {
  const dias = diasDesde(c.ultimaCompra);
  return (
    <span className="flex flex-wrap gap-1">
      {c.frequenciaMensal && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-full px-1.5 py-0.5">👑 Fiel</span>}
      {dias <= 30 && <span className="text-[10px] bg-green-500/10 text-green-500 border border-green-500/30 rounded-full px-1.5 py-0.5">🔥 Quente</span>}
      {dias > 30 && dias < 90 && <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-full px-1.5 py-0.5">⏰ Atenção</span>}
      {dias >= 90 && <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/30 rounded-full px-1.5 py-0.5">😞 Resgatar</span>}
    </span>
  );
}

// ── MetaProgress ──────────────────────────────────────────────────────────────
function MetaProgress({ meta, realizado }: { meta: number; realizado: number }) {
  const pct = meta > 0 ? Math.min(100, (realizado / meta) * 100) : 0;
  const color = pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-primary" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  );
}

// ── CrmModal ──────────────────────────────────────────────────────────────────
const CRM_ANIM_CSS = `
  @keyframes crm-modal-down {
    0%{transform:scale(1) rotate(0deg) translateY(0);opacity:1}
    40%{transform:scale(0.1) rotate(360deg) translateY(0);opacity:.5}
    100%{transform:scale(0) rotate(720deg) translateY(120vh);opacity:0}
  }
  .crm-modal-down{animation:crm-modal-down 1.5s cubic-bezier(.4,0,.2,1) forwards}
  @keyframes crm-modal-explode {
    0%{transform:scale(1);opacity:1;filter:blur(0)}
    25%{transform:scale(1.05);opacity:1;filter:brightness(1.2)}
    100%{transform:scale(1.3);opacity:0;filter:blur(10px)}
  }
  .crm-modal-explode{animation:crm-modal-explode .4s ease-out forwards}
  @keyframes crm-emoji-down {
    0%{transform:translate(-50%,-50%) scale(0) rotate(0deg);opacity:0}
    20%{transform:translate(-50%,-50%) scale(0) rotate(0deg);opacity:0}
    45%{transform:translate(-50%,-50%) scale(1.2) rotate(-15deg);opacity:1}
    60%{transform:translate(-50%,-50%) scale(1) rotate(0deg);opacity:1}
    100%{transform:translate(-50%,120vh) scale(.5) rotate(20deg);opacity:0}
  }
  .crm-emoji-down{animation:crm-emoji-down 1.5s cubic-bezier(.4,0,.2,1) forwards;position:fixed;top:50%;left:50%;z-index:10000;font-size:5rem;pointer-events:none}
`;

function CrmModal({ cliente, loja, repCodigo, repLogin, onClose, onSaved, forcado }: {
  cliente: Cliente; loja: string; repCodigo: number; repLogin: string;
  onClose: () => void; onSaved: (s: string) => void; forcado?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [isExploding, setIsExploding] = useState(false);
  const [isExitingDown, setIsExitingDown] = useState(false);
  const [showSadEmoji, setShowSadEmoji] = useState(false);

  const save = async () => {
    if (!status || obs.length < 30 || (status === "retornar_contato" && !dataHora)) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/sales-compass/crm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja, clienteId: cliente.id, nome: cliente.nome, telefone: cliente.telefone, status, dataHora, obs, repCodigo, repLogin }),
      });
      if (!r.ok) throw new Error("Erro ao salvar.");

      let delay = 1200;
      if (status === "comprou") {
        setIsExploding(true);
        confetti({ particleCount: 150, spread: 70, origin: { x: .5, y: .5 }, colors: ["#ffffff","#f8fafc","#6366f1","#4f46e5"], startVelocity: 45, ticks: 60, zIndex: 10001 });
        const end = Date.now() + 3000;
        const iv = setInterval(() => {
          if (Date.now() > end) { clearInterval(iv); return; }
          const pc = 50 * ((end - Date.now()) / 3000);
          confetti({ startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999, particleCount: pc, origin: { x: Math.random() * .3 + .1, y: Math.random() - .2 } });
          confetti({ startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999, particleCount: pc, origin: { x: Math.random() * .2 + .7, y: Math.random() - .2 } });
        }, 250);
        delay = 2500;
      } else if (status === "nao_comprou" || status === "cancelado_agendamento") {
        setIsExitingDown(true);
        setShowSadEmoji(true);
        delay = 1500;
      } else if (status === "retornar_contato") {
        confetti({ particleCount: 40, spread: 60, origin: { y: .8 }, shapes: [confetti.shapeFromText({ text: "⏰" }), confetti.shapeFromText({ text: "📅" })], scalar: 4, gravity: .6, zIndex: 9999 });
        delay = 1800;
      }

      setTimeout(() => { onSaved(status); }, delay);
    } catch (e: any) { toast.error(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className={`bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl ${isExploding ? "crm-modal-explode" : ""} ${isExitingDown ? "crm-modal-down" : ""}`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold">Registro de CRM</h3>
          <p className="text-sm text-muted-foreground truncate max-w-[180px]">{cliente.nome}</p>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Resultado do contato</label>
          <div className="flex flex-col gap-2">
            {["comprou","nao_comprou","retornar_contato"].map(s => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="sc_crm" value={s} checked={status === s} onChange={e => setStatus(e.target.value)} className="accent-primary" />
                {STATUS_LABELS[s]}
              </label>
            ))}
          </div>
        </div>
        {status === "retornar_contato" && (
          <div className="mb-4 animate-in fade-in">
            <label className="block text-sm font-medium mb-1">Data e Hora do Retorno</label>
            <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none" />
          </div>
        )}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-1">
            Observação <span className="text-destructive">*</span> <span className="text-xs text-muted-foreground">(mín. 30 chars)</span>
          </label>
          <textarea rows={3} value={obs} onChange={e => setObs(e.target.value)}
            className={`w-full bg-background border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary outline-none ${obs.length < 30 ? "border-destructive" : "border-input"}`} />
          <p className={`text-xs mt-1 ${obs.length >= 30 ? "text-green-500" : "text-destructive"}`}>{obs.length}/30</p>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          {!forcado && !saving && <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-muted-foreground hover:bg-muted/50">Fechar</button>}
          <button onClick={save} disabled={saving || obs.length < 30 || !status || (status === "retornar_contato" && !dataHora)}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium">
            {saving ? "Salvando..." : "Salvar CRM"}
          </button>
        </div>
      </div>
      {showSadEmoji && <div className="crm-emoji-down">😢</div>}
      <style dangerouslySetInnerHTML={{ __html: CRM_ANIM_CSS }} />
    </div>
  );
}

// ── HistoricoModal ────────────────────────────────────────────────────────────
function HistoricoModal({ logs, onClose }: { logs: CrmLog[]; onClose: () => void }) {
  const sorted = [...logs].sort((a, b) => new Date(b.dataFull).getTime() - new Date(a.dataFull).getTime());
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Histórico de Contatos</h3>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Fechar</button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground italic">Nenhum registro para este cliente.</p>
          ) : sorted.map((log, i) => (
            <div key={i} className={`p-4 rounded-xl border ${
              log.status === "comprou" ? "border-green-500/40 bg-green-500/5" :
              log.status === "nao_comprou" || log.status === "cancelado_agendamento" ? "border-red-500/40 bg-red-500/5" :
              "border-border bg-muted/30"}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded uppercase">{log.status?.replace(/_/g," ")}</span>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(log.dataFull).toLocaleString("pt-BR")}</span>
              </div>
              <p className="text-sm italic leading-relaxed break-words">"{log.obs}"</p>
              <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">Vendedor: {log.repLogin || "Sistema"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pendentes WPP (localStorage) ─────────────────────────────────────────────
type Pendente = { id: string; nome: string; telefone: string; categoria: Categoria };
const pKey = (rep: string) => `sc_pendentes_${rep}`;
const getPendentes = (rep: string): Pendente[] => { try { return JSON.parse(localStorage.getItem(pKey(rep)) || "[]"); } catch { return []; } };
const savePendentes = (rep: string, list: Pendente[]) => localStorage.setItem(pKey(rep), JSON.stringify(list));
const addPendente = (rep: string, c: Cliente) => { const l = getPendentes(rep).filter(p => p.id !== c.id); l.unshift({ id: c.id, nome: c.nome, telefone: c.telefone, categoria: c.categoria }); savePendentes(rep, l); };
const removePendente = (rep: string, id: string) => savePendentes(rep, getPendentes(rep).filter(p => p.id !== id));

// ── ContatoModal ──────────────────────────────────────────────────────────────
function ContatoModal({ cliente, onClose, onCrm, onWhatsApp }: { cliente: Cliente; onClose: () => void; onCrm: (c: Cliente) => void; onWhatsApp?: (c: Cliente) => void }) {
  const dias = diasDesde(cliente.ultimaCompra);
  const cc = catClasses[cliente.categoria];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center font-bold text-lg ${cc.bg} ${cc.text}`}>{cliente.categoria}</div>
          <div><h3 className="font-bold">{cliente.nome}</h3><StatusBadges c={cliente} /></div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground mb-6">
          <p><Phone className="inline h-3 w-3 mr-1" /><strong className="text-foreground">Tel:</strong> {cliente.telefone}</p>
          <p><strong className="text-foreground">Ticket médio:</strong> {moeda(cliente.ticketMedio)}</p>
          <p><strong className="text-foreground">Última compra:</strong> {moeda(cliente.valorUltimaCompra)} (há {dias} dias)</p>
          <p><strong className="text-foreground">Produtos:</strong> {cliente.produtoFavorito}</p>
        </div>
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-muted-foreground hover:bg-muted/50">Fechar</button>
          <button onClick={() => onCrm(cliente)} className="px-3 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 font-medium">Gerar CRM</button>
          <a href={`https://wa.me/55${cliente.telefone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
            onClick={() => { onWhatsApp?.(cliente); onClose(); }}
            className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1.5 font-medium">
            <Send className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// ── ClienteCard (modal global RepView) ────────────────────────────────────────
function ClienteCard({ cliente, potencial, gc, onCrm }: { cliente: Cliente; potencial: boolean; gc: string; onCrm: (c: Cliente) => void }) {
  const dias = diasDesde(cliente.ultimaCompra);
  const cc = catClasses[cliente.categoria];
  return (
    <div className={`bg-card border rounded-2xl p-4 flex items-center justify-between hover:shadow-md transition-all ${gc || "border-border"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm ${cc.bg} ${cc.text}`}>{cliente.categoria}</div>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{cliente.nome}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <StatusBadges c={cliente} />
            {potencial && <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 rounded-full px-1.5 py-0.5">✨ Hoje</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <div className="text-right hidden sm:block">
          <p className="text-[10px] text-muted-foreground">Há {dias}d</p>
          <p className="text-xs font-bold">{moeda(cliente.valorUltimaCompra)}</p>
        </div>
        <button onClick={() => onCrm(cliente)} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 active:scale-95">
          <Send className="h-3 w-3" /> CRM
        </button>
      </div>
    </div>
  );
}

function ClienteLista({ clientes, gm, sm, onCrm }: { clientes: Cliente[]; gm: Record<string, any>; sm: Record<string, string>; onCrm: (c: Cliente) => void }) {
  const [page, setPage] = useState(1);
  const total = clientes.length;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const sp = Math.min(page, totalPages);
  const start = (sp - 1) * 50;
  const paged = clientes.slice(start, start + 50);
  return (
    <div>
      <div className="space-y-2">
        {paged.map(c => <ClienteCard key={c.id} cliente={c} potencial={isPotencialHoje(c)} gc={glowClass(c.id, gm, sm)} onCrm={onCrm} />)}
        {paged.length === 0 && <p className="py-8 text-center text-muted-foreground text-sm italic">Nenhum cliente encontrado.</p>}
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{start+1}–{Math.min(start+50,total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={sp===1} onClick={()=>setPage(p=>p-1)} className="px-3 py-1.5 rounded-lg text-xs bg-secondary disabled:opacity-40">Anterior</button>
            <button disabled={sp===totalPages} onClick={()=>setPage(p=>p+1)} className="px-3 py-1.5 rounded-lg text-xs bg-secondary disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AnimatedLoadingScreen ─────────────────────────────────────────────────────
const FRASES = [
  "Venda não começa no produto, começa na confiança.",
  "Quem domina a constância domina o resultado.",
  "Cada 'não' aproxima você do próximo 'sim'.",
  "Meta alta exige mentalidade ainda maior.",
  "O cliente compra emoção e justifica com lógica.",
  "Disciplina em vendas vale mais que motivação passageira.",
  "Resultado é consequência de processo bem executado.",
  "Grandes vendas começam com grandes perguntas.",
  "Persistência transforma objeção em fechamento.",
  "O sucesso em vendas mora nos detalhes.",
  "Atendimento excepcional nunca sai de moda.",
  "Quem acompanha, vende. Quem desiste, perde.",
  "Vendas é sobre relacionamento antes de faturamento.",
  "Performance alta é construída diariamente.",
  "O esforço silencioso gera resultados barulhentos.",
  "Vender é entender pessoas.",
  "Coragem para prospectar muda qualquer resultado.",
  "O fechamento começa na escuta.",
  "Todo campeão de vendas já ouviu muitos 'nãos'.",
  "Em vendas, velocidade e atenção fazem diferença.",
  "Relacionamento forte sustenta metas altas.",
  "Quem vende com propósito vende mais.",
  "A consistência supera o talento sem disciplina.",
  "Bons vendedores convencem. Grandes vendedores conectam.",
  "O mercado não premia intenção, premia ação.",
  "Venda é ajudar alguém a tomar uma boa decisão.",
];

function AnimatedLoadingScreen({ loja, message, progress }: { loja: string; message?: string; progress?: string | null }) {
  const [frase, setFrase] = useState(() => FRASES[Math.floor(Math.random() * FRASES.length)]);
  useEffect(() => {
    const id = setInterval(() => setFrase(FRASES[Math.floor(Math.random() * FRASES.length)]), 5000);
    return () => clearInterval(id);
  }, []);
  const lojaLabel = SC_LOJAS.find(l => l.value === loja)?.label ?? loja.toUpperCase();
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-hidden">
      <div className="relative mb-10 h-28 w-full max-w-xs flex items-center justify-center border rounded-[2.5rem] overflow-hidden animate-sc-arena">
        <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-xl animate-sc-bounce">
          SC
        </div>
      </div>
      {frase && (
        <p key={frase} className="mb-5 text-base font-bold italic text-primary animate-in fade-in slide-in-from-top-4 duration-1000 max-w-sm">
          "{frase}"
        </p>
      )}
      <h2 className="text-lg font-bold text-foreground mb-1">{message ?? "Preparando sua carteira"}</h2>
      <p className="text-muted-foreground text-sm max-w-xs">
        {progress ?? <>Buscando clientes da loja <span className="font-semibold text-primary">{lojaLabel}</span>…</>}
      </p>
      <div className="mt-7 flex gap-2">
        <div className="h-1.5 w-8 rounded-full bg-primary animate-pulse" />
        <div className="h-1.5 w-8 rounded-full bg-primary/40 animate-pulse delay-75" />
        <div className="h-1.5 w-8 rounded-full bg-primary/20 animate-pulse delay-150" />
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes sc-bounce {
          0%,100%{transform:translate(-80px,-20px) scale(.9);opacity:.6;background:#6366f1}
          25%{transform:translate(80px,20px) scale(1.1);opacity:1;background:#ef4444}
          50%{transform:translate(-80px,20px) scale(.9);opacity:.6;background:#f97316}
          75%{transform:translate(80px,-20px) scale(1.1);opacity:1;background:#22c55e}
        }
        .animate-sc-bounce{animation:sc-bounce 6s linear infinite}
        @keyframes sc-arena {
          0%,100%{background:rgba(99,102,241,.05);border-color:rgba(99,102,241,.25);box-shadow:inset 0 0 20px rgba(99,102,241,.1)}
          25%{background:rgba(239,68,68,.05);border-color:rgba(239,68,68,.25);box-shadow:inset 0 0 20px rgba(239,68,68,.1)}
          50%{background:rgba(249,115,22,.05);border-color:rgba(249,115,22,.25);box-shadow:inset 0 0 20px rgba(249,115,22,.1)}
          75%{background:rgba(34,197,94,.05);border-color:rgba(34,197,94,.25);box-shadow:inset 0 0 20px rgba(34,197,94,.1)}
        }
        .animate-sc-arena{animation:sc-arena 6s linear infinite}
      `}} />
    </main>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Rep (Vendedor)
// ══════════════════════════════════════════════════════════════════════════════
function RepView({ loja, repCodigo, repLogin, onSetView, onSetCategoria }:
  { loja: string; repCodigo: number; repLogin: string; dark: boolean;
    onSetView: (v: ViewType) => void; onSetCategoria: (c: Categoria) => void }) {

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filtroGlobal, setFiltroGlobal] = useState<"carteira"|"potenciais"|"resgatar"|null>(null);
  const [contatoSel, setContatoSel] = useState<Cliente | null>(null);
  const [crmModal, setCrmModal] = useState<{ cliente: Cliente; forcado?: boolean } | null>(null);
  const [gm, setGm] = useState<Record<string, "success"|"error"|"info">>({});
  const [pendentes, setPendentes] = useState<Pendente[]>(() => getPendentes(repLogin));

  const { data: vendedor, isLoading: vLoading } = useQuery<VendedorInfo>({
    queryKey: ["sc-vendedor", loja, repCodigo],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedor?loja=${loja}&rep_codigo=${repCodigo}`).then(r=>r.json()),
    staleTime: 300_000,
  });

  const { clientes, isLoading: cLoading, progress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: async () => { const r = await fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    refetchInterval: 30_000, staleTime: 15_000,
  });
  const log_teste = console.log("teste testando");
  const sm = useMemo(() => {
    const m: Record<string,string> = {};
    [...crmLogs].sort((a,b)=>new Date(a.dataFull).getTime()-new Date(b.dataFull).getTime()).forEach(l=>{m[String(l.clienteId)]=l.status;});
    return m;
  }, [crmLogs]);

  // Remove pendentes que já têm CRM registrado hoje
  useEffect(() => {
    if (!crmLogs.length) return;
    const hoje = new Date().toLocaleDateString("pt-BR");
    const registradosHoje = new Set(
      crmLogs.filter(l => new Date(l.dataFull).toLocaleDateString("pt-BR") === hoje).map(l => String(l.clienteId))
    );
    const atualizados = getPendentes(repLogin).filter(p => !registradosHoje.has(p.id));
    savePendentes(repLogin, atualizados);
    setPendentes(atualizados);
  }, [crmLogs, repLogin]);

  const handleWhatsApp = (c: Cliente) => {
    addPendente(repLogin, c);
    setPendentes(getPendentes(repLogin));
  };

  const potenciaisHoje = clientes.filter(isPotencialHoje).length;
  const inativos = clientes.filter(c => diasDesde(c.ultimaCompra) >= 90).length;

  const filtrados = useMemo(() => {
    if (!filtroGlobal || !clientes.length) return [];
    let f = [...clientes];
    if (filtroGlobal === "potenciais") f = f.filter(isPotencialHoje);
    if (filtroGlobal === "resgatar")   f = f.filter(c => diasDesde(c.ultimaCompra) >= 90);
    return f.sort((a,b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));
  }, [clientes, filtroGlobal]);

  const onSaved = (status: string) => {
    if (!crmModal) return;
    const g = status === "comprou" ? "success" : (status === "nao_comprou" || status === "cancelado_agendamento") ? "error" : "info";
    setGm(prev => ({ ...prev, [crmModal.cliente.id]: g as any }));
    removePendente(repLogin, crmModal.cliente.id);
    setPendentes(getPendentes(repLogin));
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.cliente.nome}`);
    if (status === "retornar_contato") toast.info(`⏰ Retorno agendado`);
    setCrmModal(null);
  };

  if (vLoading || cLoading) return (
    <AnimatedLoadingScreen loja={loja} progress={
      clientes.length > 0 ? `${clientes.length} clientes carregados...` : (progress ?? null)
    } />
  );
  const firstFromUser = user?.usuario.split(".")[0] ?? "";
  const firstFromDisplay = user?.displayName?.trim() ? user.displayName.trim().split(/\s+/)[0] : "";
  const displayLooksLikeLogin = !!user && firstFromDisplay.toLowerCase() === user.usuario.toLowerCase();
  const greetingBase = firstFromDisplay && !displayLooksLikeLogin ? firstFromDisplay : firstFromUser;
  const greetingName = greetingBase ? greetingBase.charAt(0).toUpperCase() + greetingBase.slice(1) : "usuário";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8"> 
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Bom dia, { greetingName || "Vendedor"} 👋</h1>
        <p className="text-muted-foreground text-sm mt-1">Selecione uma categoria para acessar sua carteira e as oportunidades do dia.</p>
        {vendedor && vendedor.meta > 0 && (
          <div className="mt-4 bg-card border border-border rounded-2xl p-4 max-w-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Meta vs Realizado</span>
              <span className="font-bold">{moeda(vendedor.realizado)} / {moeda(vendedor.meta)}</span>
            </div>
            <MetaProgress meta={vendedor.meta} realizado={vendedor.realizado} />
          </div>
        )}
      </div>

      {pendentes.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {pendentes.length} cliente{pendentes.length > 1 ? "s" : ""} aguardando registro de CRM
          </p>
          <div className="flex flex-col gap-2">
            {pendentes.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-amber-500/10 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${catClasses[p.categoria]?.bg} ${catClasses[p.categoria]?.text} mr-2`}>{p.categoria}</span>
                  <span className="text-sm font-medium truncate">{p.nome}</span>
                </div>
                <button
                  onClick={() => { const c = clientes.find(cl => cl.id === p.id); if (c) setCrmModal({ cliente: c }); }}
                  className="shrink-0 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors"
                >
                  Registrar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {[
          { key: "carteira",   icon: <Users className="h-5 w-5 text-primary" />,         bg: "bg-primary/10",   val: clientes.length, label: "Clientes na carteira", hint: "CLIQUE PARA VER TODOS",    hintColor: "text-primary" },
          { key: "potenciais", icon: <Sparkles className="h-5 w-5 text-amber-500" />,    bg: "bg-amber-500/10", val: potenciaisHoje,   label: "Potenciais hoje",      hint: "CLIQUE PARA CONTATAR A-D", hintColor: "text-amber-500" },
          { key: "resgatar",   icon: <AlertCircle className="h-5 w-5 text-red-400" />,   bg: "bg-red-500/10",   val: inativos,         label: "A resgatar (90+ dias)", hint: "CLIQUE PARA RECUPERAR",   hintColor: "text-red-400" },
        ].map(({ key, icon, bg, val, label, hint, hintColor }) => (
          <div key={key}
            onClick={() => setFiltroGlobal(key as any)}
            className={`${key === "carteira" ? "col-span-2 sm:col-span-1" : ""} rounded-2xl bg-card border p-5 shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-1 group ${filtroGlobal === key ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border"}`}>
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold"><AnimatedNumber value={val} /></p>
              </div>
            </div>
            <div className={`mt-3 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity ${hintColor}`}>{hint}</div>
          </div>
        ))}
      </section>

      <h2 className="text-lg font-semibold mb-4">Carteira por categoria</h2>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {(["A","B","C","D"] as Categoria[]).map(cat => {
          const total = clientes.filter(c => c.categoria === cat).length;
          const pot   = clientes.filter(c => c.categoria === cat && isPotencialHoje(c)).length;
          const cc = catClasses[cat]; const info = categoriaInfo[cat];
          return (
            <button key={cat} onClick={() => { onSetCategoria(cat); onSetView("categoria"); }}
              className={`text-left rounded-2xl bg-card border p-5 ring-2 ring-transparent transition-all hover:-translate-y-1 hover:shadow-xl ${cc.ring}`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`h-12 w-12 rounded-xl ${cc.bg} flex items-center justify-center font-bold text-xl ${cc.text}`}>{cat}</div>
                <ChevronRight className={`h-4 w-4 ${cc.text}`} />
              </div>
              <h3 className="font-semibold text-sm">{info.titulo}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{info.ticket}</p>
              <div className="mt-4 pt-3 border-t border-border flex justify-between">
                <div><p className="text-xs text-muted-foreground">Clientes</p><p className={`font-bold text-lg ${cc.text}`}><AnimatedNumber value={total} /></p></div>
                <div className="text-right"><p className="text-xs text-muted-foreground">Hoje</p><p className={`font-bold text-lg ${cc.text}`}><AnimatedNumber value={pot} /></p></div>
              </div>
            </button>
          );
        })}
      </section>

      <button onClick={() => onSetView("relatorios")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ClipboardList className="h-4 w-4" /> Ver relatórios de CRM
      </button>

      {filtroGlobal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-card border border-border rounded-[2rem] w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-border flex items-center justify-between bg-primary/5">
              <div>
                <h3 className="font-bold text-lg">
                  {filtroGlobal === "carteira" ? "Minha Carteira Total" : filtroGlobal === "potenciais" ? "Potenciais de Hoje" : "Recuperação de Clientes"}
                </h3>
                <p className="text-xs text-muted-foreground">{filtrados.length} clientes • A a D</p>
              </div>
              <button onClick={() => setFiltroGlobal(null)} className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ClienteLista clientes={filtrados} gm={gm} sm={sm} onCrm={c => { setCrmModal({ cliente: c }); setFiltroGlobal(null); }} />
            </div>
          </div>
        </div>
      )}

      {contatoSel && <ContatoModal cliente={contatoSel} onClose={() => setContatoSel(null)} onWhatsApp={handleWhatsApp} onCrm={c => { setCrmModal({ cliente: c }); setContatoSel(null); }} />}
      {crmModal && <CrmModal cliente={crmModal.cliente} loja={loja} repCodigo={repCodigo} repLogin={repLogin} onClose={() => setCrmModal(null)} onSaved={onSaved} forcado={crmModal.forcado} />}
      <style dangerouslySetInnerHTML={{ __html: GLOW_CSS }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Categoria
// ══════════════════════════════════════════════════════════════════════════════
function CategoriaView({ loja, repCodigo, repLogin, categoria, onBack }:
  { loja: string; repCodigo: number; repLogin: string; categoria: Categoria; onBack: () => void }) {

  const queryClient = useQueryClient();
  const PGSIZE = 50;
  const [crmModal, setCrmModal] = useState<Cliente | null>(null);
  const [historicoLogs, setHistoricoLogs] = useState<CrmLog[] | null>(null);
  const [gm, setGm] = useState<Record<string,"success"|"error"|"info">>({});
  const [filtroNome, setFiltroNome] = useState("");
  const [page, setPage] = useState(1);
  const [contatoSel, setContatoSel] = useState<Cliente | null>(null);
  const [pendentes, setPendentes] = useState<Pendente[]>(() => getPendentes(repLogin));

  const { clientes, isLoading, progress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: async () => { const r = await fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    refetchInterval: 30_000,
  });

  const sm = useMemo(() => {
    const m: Record<string,string> = {};
    [...crmLogs].sort((a,b)=>new Date(a.dataFull).getTime()-new Date(b.dataFull).getTime()).forEach(l=>{m[String(l.clienteId)]=l.status;});
    return m;
  }, [crmLogs]);

  useEffect(() => {
    if (!crmLogs.length) return;
    const hoje = new Date().toLocaleDateString("pt-BR");
    const registradosHoje = new Set(
      crmLogs.filter(l => new Date(l.dataFull).toLocaleDateString("pt-BR") === hoje).map(l => String(l.clienteId))
    );
    const atualizados = getPendentes(repLogin).filter(p => !registradosHoje.has(p.id));
    savePendentes(repLogin, atualizados);
    setPendentes(atualizados);
  }, [crmLogs, repLogin]);

  const handleWhatsApp = (c: Cliente) => {
    addPendente(repLogin, c);
    setPendentes(getPendentes(repLogin));
  };

  const lista = useMemo(() => clientes.filter(c=>c.categoria===categoria).sort((a,b)=>new Date(b.ultimaCompra).getTime()-new Date(a.ultimaCompra).getTime()), [clientes, categoria]);
  const potenciais = useMemo(() => lista.filter(isPotencialHoje), [lista]);
  const listaFiltrada = useMemo(() => filtroNome.trim() ? lista.filter(c=>c.nome.toLowerCase().includes(filtroNome.toLowerCase())) : lista, [lista, filtroNome]);
  const totalPages = Math.ceil(listaFiltrada.length / PGSIZE);
  const paginada = useMemo(() => listaFiltrada.slice((page-1)*PGSIZE, page*PGSIZE), [listaFiltrada, page]);

  useEffect(() => { setPage(1); }, [filtroNome, categoria]);

  const onSaved = (status: string) => {
    if (!crmModal) return;
    const g = status === "comprou" ? "success" : (status === "nao_comprou" || status === "cancelado_agendamento") ? "error" : "info";
    setGm(prev => ({ ...prev, [crmModal.id]: g as any }));
    removePendente(repLogin, crmModal.id);
    setPendentes(getPendentes(repLogin));
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.nome}`);
    setCrmModal(null);
  };

  const cc = catClasses[categoria];
  const info = categoriaInfo[categoria];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {pendentes.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {pendentes.length} cliente{pendentes.length > 1 ? "s" : ""} aguardando registro de CRM
          </p>
          <div className="flex flex-col gap-2">
            {pendentes.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-amber-500/10 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${catClasses[p.categoria]?.bg} ${catClasses[p.categoria]?.text} mr-2`}>{p.categoria}</span>
                  <span className="text-sm font-medium truncate">{p.nome}</span>
                </div>
                <button
                  onClick={() => { const c = clientes.find(cl => cl.id === p.id); if (c) setCrmModal(c); }}
                  className="shrink-0 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors"
                >
                  Registrar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
        <div className={`h-10 w-10 rounded-xl ${cc.bg} flex items-center justify-center font-bold ${cc.text}`}>{categoria}</div>
        <div className="flex-1">
          <h2 className="font-bold">{info.titulo}</h2>
          <p className="text-xs text-muted-foreground">{info.ticket}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Clientes</p>
          <p className={`text-xl font-bold ${cc.text}`}><AnimatedNumber value={lista.length} /></p>
        </div>
      </div>

      {isLoading ? (
        <AnimatedLoadingScreen loja={loja} progress={
          clientes.length > 0 ? `${clientes.length} clientes carregados...` : (progress ?? null)
        } />
      ) : (
        <>
          {/* Seção potenciais de hoje */}
          {potenciais.length > 0 && (
            <section className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <h3 className="font-semibold">Potenciais para contato hoje ({potenciais.length})</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {potenciais.map(c => {
                  const dias = diasDesde(c.ultimaCompra);
                  return (
                    <div key={c.id} className={`rounded-2xl bg-card border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all ${glowClass(c.id, gm, sm) || "border-border"}`}>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{c.nome}</p>
                        <div className="mt-1 mb-1"><StatusBadges c={c} /></div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.telefone}</span>
                          <span>Há {dias} dias</span>
                          <span className="flex items-center gap-1"><ShoppingBag className="h-3 w-3" /> TM: {moeda(c.ticketMedio)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setHistoricoLogs(crmLogs.filter(l=>String(l.clienteId)===String(c.id)))}
                          className="p-2 rounded-lg hover:bg-muted border border-border text-muted-foreground hover:text-foreground" title="Histórico CRM">
                          <ClipboardList className="h-4 w-4" />
                        </button>
                        <button onClick={() => setContatoSel(c)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 active:scale-95">
                          <Send className="h-3.5 w-3.5" /> Contatar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Busca */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input placeholder="Pesquisar por nome..." value={filtroNome} onChange={e=>setFiltroNome(e.target.value)}
              className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>

          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Todos os clientes ({listaFiltrada.length})</h3>
          <div className="space-y-3">
            {paginada.map((c, idx) => {
              const dias = diasDesde(c.ultimaCompra);
              return (
                <div key={c.id} className={`bg-card border rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-muted/20 hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-1 ${glowClass(c.id, gm, sm) || "border-border"}`}
                  style={{ animationDelay: `${Math.min(idx*30,800)}ms`, animationFillMode: "both" }}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`h-11 w-11 rounded-full ${cc.bg} ${cc.text} flex items-center justify-center font-semibold text-sm shrink-0`}>
                      {c.nome.split(" ").slice(0,2).map(s=>s[0]).join("")}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{c.nome}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{c.telefone}</p>
                      <div className="mt-1"><StatusBadges c={c} /></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><ShoppingBag className="h-3 w-3" /> Última compra</p>
                      <p className="font-semibold text-sm">{moeda(c.valorUltimaCompra)}</p>
                      <p className="text-xs text-muted-foreground">Há {dias} dias</p>
                    </div>
                    <div className="hidden md:block">
                      <p className="text-xs text-muted-foreground">Ticket médio</p>
                      <p className="font-semibold text-sm">{moeda(c.ticketMedio)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setHistoricoLogs(crmLogs.filter(l=>String(l.clienteId)===String(c.id)))}
                        className="p-2 rounded-lg hover:bg-primary/10 text-primary border border-border" title="Histórico CRM">
                        <ClipboardList className="h-4 w-4" />
                      </button>
                      <button onClick={() => setContatoSel(c)}
                        className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 active:scale-95">
                        <Send className="h-3.5 w-3.5" /> Contatar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {paginada.length === 0 && <p className="py-10 text-center text-muted-foreground italic">Nenhum cliente encontrado.</p>}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8 py-6 border-t border-border">
              <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                className="flex items-center gap-1 px-4 py-2 rounded-xl border hover:bg-muted disabled:opacity-50 text-sm">
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <span className="text-sm bg-muted/50 px-4 py-2 rounded-xl border">
                Pág <span className="text-primary font-bold">{page}</span> / {totalPages}
                <span className="text-xs text-muted-foreground ml-2">({listaFiltrada.length})</span>
              </span>
              <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                className="flex items-center gap-1 px-4 py-2 rounded-xl border hover:bg-muted disabled:opacity-50 text-sm">
                Próxima <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {contatoSel && <ContatoModal cliente={contatoSel} onClose={() => setContatoSel(null)} onWhatsApp={handleWhatsApp} onCrm={c=>{setCrmModal(c);setContatoSel(null);}} />}
      {crmModal && <CrmModal cliente={crmModal} loja={loja} repCodigo={repCodigo} repLogin={repLogin} onClose={() => setCrmModal(null)} onSaved={onSaved} />}
      {historicoLogs !== null && <HistoricoModal logs={historicoLogs} onClose={() => setHistoricoLogs(null)} />}
      <style dangerouslySetInnerHTML={{ __html: GLOW_CSS }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Gerente / Admin  (layout sidebar igual ao original)
// ══════════════════════════════════════════════════════════════════════════════
function GerenteView({ loja: initialLoja, repLogin, isAdmin, onSetView }:
  { loja: string; repLogin: string; isAdmin: boolean; onSetView: (v: ViewType) => void }) {

  const queryClient = useQueryClient();
  const PGSIZE = 50;
  const [loja, setLoja] = useState(initialLoja || "l3");
  const [selectedRep, setSelectedRep] = useState<Rep | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState("TODAS");
  const [filtroMotivo, setFiltroMotivo] = useState("TODOS");
  const [filtroNome, setFiltroNome] = useState("");
  const [filtroContatados, setFiltroContatados] = useState(false);
  const [mostrarTodaCarteira, setMostrarTodaCarteira] = useState(false);
  const [crmModal, setCrmModal] = useState<Cliente | null>(null);
  const [historicoLogs, setHistoricoLogs] = useState<CrmLog[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => { setSelectedRep(null); setMostrarTodaCarteira(false); setFiltroMotivo("TODOS"); setFiltroContatados(false); }, [loja]);
  useEffect(() => { setMostrarTodaCarteira(false); setFiltroMotivo("TODOS"); setFiltroContatados(false); setFiltroNome(""); }, [selectedRep]);
  useEffect(() => { setPage(1); }, [selectedRep, loja, filtroCategoria, filtroMotivo, filtroNome, filtroContatados, mostrarTodaCarteira]);

  const repCodigo = selectedRep?.rep_codigo ?? 0;

  const { data: reps = [], isLoading: repsLoading } = useQuery<Rep[]>({
    queryKey: ["sc-vendedores", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedores?loja=${loja}`).then(r=>r.json()),
    staleTime: 300_000,
  });

  const lojaLabel = SC_LOJAS.find(l => l.value === loja)?.label || loja.toUpperCase();
  const vendedoresComTodos = useMemo<Rep[]>(() => [{ rep_codigo: 0, rep_nome: `Toda a Loja (${lojaLabel})` }, ...reps], [reps, lojaLabel]);

  const { data: vendedor } = useQuery<VendedorInfo>({
    queryKey: ["sc-vendedor", loja, repCodigo],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedor?loja=${loja}&rep_codigo=${repCodigo}`).then(r=>r.json()),
    enabled: !!loja && selectedRep !== null, staleTime: 300_000,
  });

  // Performance da loja inteira (rep_codigo=0) — usada no 4º card
  const { data: performanceLoja } = useQuery<VendedorInfo>({
    queryKey: ["sc-vendedor-loja", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedor?loja=${loja}&rep_codigo=0`).then(r=>r.json()),
    enabled: !!loja, staleTime: 300_000,
  });

  const { clientes, isLoading: cLoading, progress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: async () => { const r = await fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    refetchInterval: 30_000,
  });

  const stats = useMemo(() => {
    const hoje = new Date().toLocaleDateString("pt-BR");
    const ids = new Set(clientes.map(c => String(c.id)));
    const logsGerais = crmLogs.filter(l => ids.has(String(l.clienteId)));
    const contatadosHojeIds = Array.from(new Set(
      logsGerais.filter(l => new Date(l.dataFull).toLocaleDateString("pt-BR") === hoje).map(l => String(l.clienteId))
    ));
    const statusPorCliente: Record<string,string> = {};
    [...logsGerais].sort((a,b)=>new Date(a.dataFull).getTime()-new Date(b.dataFull).getTime())
      .forEach(l => { statusPorCliente[String(l.clienteId)] = l.status; });
    const motivos: Record<string,number> = {};
    Object.values(statusPorCliente).forEach(s => { motivos[s] = (motivos[s] || 0) + 1; });

    const listaFiltrada = clientes.filter(c => {
      const matchCat   = filtroCategoria === "TODAS" || c.categoria === filtroCategoria;
      const matchNome  = c.nome.toLowerCase().includes(filtroNome.toLowerCase());
      const matchMot   = filtroMotivo === "TODOS" || statusPorCliente[String(c.id)] === filtroMotivo;
      const isHoje     = contatadosHojeIds.includes(String(c.id));
      let vis = false;
      if (mostrarTodaCarteira) vis = true;
      else if (filtroContatados) vis = isHoje;
      else if (filtroMotivo !== "TODOS") vis = matchMot;
      else vis = isPotencialHoje(c) || isHoje;
      return matchCat && matchNome && matchMot && vis;
    });

    const vendedorMap: Record<string,string> = {};
    reps.forEach(r => { vendedorMap[String(r.rep_codigo)] = r.rep_nome; });

    return { listaFiltrada, contatadosHojeIds, totalEmCarteira: clientes.length,
      totalPotenciais: clientes.filter(isPotencialHoje).length, totalContatados: contatadosHojeIds.length,
      motivos, statusPorCliente, vendedorMap };
  }, [clientes, crmLogs, filtroCategoria, filtroNome, filtroMotivo, mostrarTodaCarteira, filtroContatados, reps]);

  const totalPages = Math.ceil(stats.listaFiltrada.length / PGSIZE);
  const paginada = useMemo(() => stats.listaFiltrada.slice((page-1)*PGSIZE, page*PGSIZE), [stats.listaFiltrada, page]);

  const onSaved = (status: string) => {
    if (!crmModal) return;
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.nome}`);
    setCrmModal(null);
  };

  const motiEmoji = (m: string) => m.includes("comprou") && !m.includes("nao") ? "😊" : m.includes("nao") || m.includes("cancelado") ? "😢" : m.includes("retornar") ? "⏰" : "💬";

  const selectRep = (v: string) => {
    if (v === "") { setSelectedRep(null); return; }
    const n = Number(v);
    if (n === 0) { setSelectedRep({ rep_codigo: 0, rep_nome: "Todos da loja" }); return; }
    const f = reps.find(r => r.rep_codigo === n);
    if (f) setSelectedRep(f);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Cabeçalho admin */}
      {isAdmin ? (
        <div className="bg-primary/5 border border-primary/20 p-5 sm:p-6 rounded-3xl mb-8 flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 w-full lg:w-auto">
            <div className="h-12 w-12 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shrink-0">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Administração Global</h1>
              <p className="text-muted-foreground text-sm">Selecione uma unidade para visualizar</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-center w-full lg:w-auto">
            {/* Botão Relatório */}
            <button onClick={() => onSetView("relatorios")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 shadow-md active:scale-95">
              <FileText className="h-4 w-4" /> Relatório
            </button>
            {/* Desktop: botões de loja */}
            <div className="hidden md:flex flex-wrap gap-2">
              {SC_LOJAS.map(l => (
                <button key={l.value} onClick={() => setLoja(l.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border whitespace-nowrap transition-all ${loja === l.value ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card border-border hover:bg-muted"}`}>
                  {l.label}
                </button>
              ))}
            </div>
            {/* Mobile: select */}
            <div className="md:hidden w-full">
              <div className="relative">
                <select value={loja} onChange={e => setLoja(e.target.value)}
                  className="appearance-none w-full bg-card border border-border rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20 shadow-sm">
                  {SC_LOJAS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Painel do Gerente</h1>
            <p className="text-muted-foreground text-sm">Monitorando unidade: <span className="font-bold text-primary">{lojaLabel}</span></p>
          </div>
          <button onClick={() => onSetView("relatorios")}
            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 shadow-md active:scale-95">
            <FileText className="h-4 w-4" /> Relatório
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ── Sidebar: vendedores ─────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          <h3 className="font-bold text-base flex items-center gap-2 px-1"><Briefcase className="h-5 w-5 text-primary" /> Colaboradores</h3>
          {/* Desktop */}
          <div className="hidden lg:flex flex-col gap-2 overflow-y-auto max-h-[600px] pr-1 no-scrollbar">
            {repsLoading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              : vendedoresComTodos.map(v => (
              <button key={v.rep_codigo}
                onClick={() => setSelectedRep(v.rep_codigo === 0 ? { rep_codigo: 0, rep_nome: "Todos da loja" } : reps.find(r => r.rep_codigo === v.rep_codigo) ?? null as any)}
                className={`w-full text-left p-4 rounded-2xl border transition-all shadow-sm hover:-translate-y-0.5 ${
                  (selectedRep?.rep_codigo ?? -1) === v.rep_codigo
                    ? "bg-primary border-primary text-primary-foreground shadow-lg"
                    : "bg-card border-border hover:border-primary/50 hover:bg-muted/50"}`}>
                <p className="font-bold text-sm truncate uppercase">{v.rep_nome}</p>
                <p className={`text-[10px] ${(selectedRep?.rep_codigo ?? -1) === v.rep_codigo ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {v.rep_codigo === 0 ? "Toda a loja" : `ID: ${v.rep_codigo}`}
                </p>
              </button>
            ))}
          </div>
          {/* Mobile */}
          <div className="lg:hidden">
            <div className="relative">
              <select value={selectedRep?.rep_codigo ?? ""} onChange={e => selectRep(e.target.value)}
                className="appearance-none w-full bg-card border border-border rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20 shadow-sm">
                <option value="">Selecione o vendedor...</option>
                {vendedoresComTodos.map(v => <option key={v.rep_codigo} value={v.rep_codigo}>{v.rep_nome}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {/* ── Conteúdo principal ──────────────────────────── */}
        <div className="lg:col-span-9 space-y-6 relative min-h-[400px]">
          {selectedRep === null ? (
            <div className="h-96 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl text-muted-foreground">
              <Store className="h-16 w-16 mb-4 opacity-10" />
              <p>Selecione um colaborador da loja <strong className="text-foreground">{lojaLabel}</strong></p>
            </div>
          ) : (
            <>
              {/* Overlay loading */}
              {cLoading && (
                <div className="absolute inset-0 bg-background/75 backdrop-blur-[2px] flex flex-col items-center justify-center z-20 rounded-3xl gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm font-medium">{progress ?? "Carregando..."}</p>
                  {clientes.length > 0 && <p className="text-xs text-primary">{clientes.length} clientes...</p>}
                </div>
              )}

              {/* Cards resumo */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Card 1 – Clientes em carteira */}
                <div onClick={() => { setMostrarTodaCarteira(true); setFiltroMotivo("TODOS"); setFiltroContatados(false); }}
                  className={`bg-card border p-4 sm:p-5 rounded-2xl shadow-sm flex items-center gap-3 sm:gap-4 hover:-translate-y-1 hover:shadow-md transition-all cursor-pointer ${mostrarTodaCarteira ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border"}`}>
                  <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0"><Users className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Clientes em Carteira</p>
                    <p className="text-xl sm:text-2xl font-bold"><AnimatedNumber value={stats.totalEmCarteira} /></p>
                    {mostrarTodaCarteira && <p className="text-[10px] text-primary font-bold animate-pulse uppercase">Lista Completa</p>}
                  </div>
                </div>
                {/* Card 2 – Potenciais hoje */}
                <div onClick={() => { setMostrarTodaCarteira(false); setFiltroMotivo("TODOS"); setFiltroContatados(false); }}
                  className={`bg-card border p-4 sm:p-5 rounded-2xl shadow-sm flex items-center gap-3 sm:gap-4 hover:-translate-y-1 hover:shadow-md transition-all cursor-pointer ${!mostrarTodaCarteira && !filtroContatados && filtroMotivo === "TODOS" ? "border-orange-500/20 bg-orange-50/30 ring-2 ring-orange-500/20" : "border-border"}`}>
                  <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0"><TrendingUp className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Potenciais Hoje</p>
                    <p className="text-xl sm:text-2xl font-bold"><AnimatedNumber value={stats.totalPotenciais} /></p>
                    {!mostrarTodaCarteira && !filtroContatados && filtroMotivo === "TODOS" && <p className="text-[10px] text-orange-500 font-bold animate-pulse uppercase">Vendo Hoje</p>}
                  </div>
                </div>
                {/* Card 3 – Contatados hoje */}
                <div onClick={() => { setMostrarTodaCarteira(false); setFiltroMotivo("TODOS"); setFiltroContatados(true); }}
                  className={`bg-card border p-4 sm:p-5 rounded-2xl shadow-sm flex items-center gap-3 sm:gap-4 hover:-translate-y-1 hover:shadow-md transition-all cursor-pointer ${filtroContatados ? "border-green-500/20 bg-green-50/30 ring-2 ring-green-500/20" : "border-border"}`}>
                  <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500 shrink-0"><CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Contatados Hoje</p>
                    <p className="text-xl sm:text-2xl font-bold"><AnimatedNumber value={stats.totalContatados} /></p>
                    {filtroContatados && <p className="text-[10px] text-green-500 font-bold animate-pulse uppercase">Vendo Contatados</p>}
                  </div>
                </div>
                {/* Card 4 – Meta x Realizado (loja inteira) */}
                <div className="bg-card border border-border p-4 sm:p-5 rounded-2xl shadow-sm flex items-center gap-3 sm:gap-4 hover:-translate-y-1 hover:shadow-md transition-all">
                  <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0"><Target className="h-5 w-5 sm:h-6 sm:w-6" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wider">Meta x Realizado</p>
                    <p className="text-xl sm:text-2xl font-bold text-primary">
                      <AnimatedNumber value={performanceLoja?.meta && performanceLoja.meta > 0 ? Math.round((performanceLoja.realizado / performanceLoja.meta) * 100) : 0} />%
                    </p>
                    {performanceLoja?.meta && performanceLoja.meta > 0 && (
                      <>
                        <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-1000 ${
                            (performanceLoja.realizado / performanceLoja.meta) >= 1 ? "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,.6)]" :
                            (performanceLoja.realizado / performanceLoja.meta) >= 0.71 ? "bg-green-500" :
                            (performanceLoja.realizado / performanceLoja.meta) >= 0.50 ? "bg-yellow-500" : "bg-red-500"
                          }`} style={{ width: `${Math.min((performanceLoja.realizado / performanceLoja.meta) * 100, 100)}%` }} />
                        </div>
                        <p className="text-[9px] text-muted-foreground mt-1 truncate">
                          Loja: <span className="font-semibold text-foreground">{moeda(performanceLoja.realizado)}</span>
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta barra do vendedor selecionado */}
              {vendedor && vendedor.meta > 0 && selectedRep && selectedRep.rep_codigo !== 0 && (
                <div className="bg-card border border-border p-4 rounded-2xl">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground font-medium">{selectedRep.rep_nome}</span>
                    <span className="font-bold">{moeda(vendedor.realizado)} / {moeda(vendedor.meta)}</span>
                  </div>
                  <MetaProgress meta={vendedor.meta} realizado={vendedor.realizado} />
                </div>
              )}

              {/* CRM motivos + filtro categoria */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-8 bg-card border border-border p-6 rounded-3xl shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold flex items-center gap-2"><PieChart className="h-4 w-4" /> Histórico CRM</h4>
                    {filtroMotivo !== "TODOS" && <button onClick={() => setFiltroMotivo("TODOS")} className="text-xs text-primary hover:underline">Limpar</button>}
                  </div>
                  {Object.keys(stats.motivos).length === 0
                    ? <p className="text-sm text-muted-foreground italic">Nenhum contato registrado.</p>
                    : (
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(stats.motivos).map(([motivo, qtd]) => (
                        <button key={motivo}
                          onClick={() => { setFiltroMotivo(motivo); setMostrarTodaCarteira(false); setFiltroContatados(false); }}
                          className={`flex flex-col p-3 rounded-xl min-w-[110px] text-left border transition-all relative group overflow-hidden ${filtroMotivo === motivo ? "bg-primary/10 border-primary" : "bg-muted/40 border-transparent hover:border-border"}`}>
                          <span className="text-[10px] uppercase font-bold text-muted-foreground">{STATUS_LABELS[motivo] || motivo}</span>
                          <span className="text-lg font-bold text-primary"><AnimatedNumber value={qtd as number} /></span>
                          <span className="absolute -right-1 -bottom-1 text-2xl opacity-0 group-hover:opacity-20 transition-all">{motiEmoji(motivo)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="md:col-span-4 bg-card border border-border p-6 rounded-3xl shadow-sm">
                  <h4 className="font-bold mb-4 flex items-center gap-2"><Filter className="h-4 w-4" /> Categoria</h4>
                  <div className="grid grid-cols-3 md:grid-cols-2 gap-2">
                    {["TODAS","A","B","C","D"].map(cat => {
                      const cc = cat !== "TODAS" ? catClasses[cat as Categoria] : null;
                      return (
                        <button key={cat} onClick={() => setFiltroCategoria(cat)}
                          className={`px-2 py-2 rounded-xl text-xs font-bold border ring-2 transition-all ${
                            filtroCategoria === cat
                              ? cat === "TODAS" ? "bg-primary text-primary-foreground border-primary ring-primary/20 shadow-lg"
                                : `${cc!.bg} ${cc!.text} border-transparent ring-transparent shadow-lg`
                              : "ring-transparent bg-background text-muted-foreground border-border hover:border-primary/30"}`}>
                          {cat === "TODAS" ? "Todas" : cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Busca */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input placeholder={mostrarTodaCarteira ? "Pesquisar em toda a carteira..." : "Pesquisar nas oportunidades..."}
                  value={filtroNome} onChange={e => setFiltroNome(e.target.value)}
                  className="w-full bg-card border border-border rounded-2xl pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              </div>

              {/* Lista */}
              <div className="space-y-3">
                {paginada.map((c, idx) => {
                  const statusColor = stats.statusPorCliente[String(c.id)] === "comprou" ? "border-green-500/40" :
                    stats.statusPorCliente[String(c.id)] === "nao_comprou" ? "border-red-500/40" :
                    stats.statusPorCliente[String(c.id)] === "retornar_contato" ? "border-blue-500/40" : "border-border";
                  return (
                    <div key={c.id}
                      className={`bg-card border rounded-2xl p-4 flex items-center justify-between hover:shadow-md hover:bg-muted/20 transition-all animate-in fade-in slide-in-from-bottom-1 ${statusColor}`}
                      style={{ animationDelay: `${Math.min(idx*30,800)}ms`, animationFillMode: "both" }}>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{c.nome}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {c.telefone}
                          {stats.vendedorMap[String(c.repId)] && <> • <span className="text-primary font-medium">{stats.vendedorMap[String(c.repId)]}</span></>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                        <span className={`h-6 w-6 rounded-md text-[10px] font-bold flex items-center justify-center ${catClasses[c.categoria].bg} ${catClasses[c.categoria].text}`}>
                          {c.categoria}
                        </span>
                        {stats.contatadosHojeIds.includes(String(c.id)) ? (
                          <span className="hidden sm:inline-flex items-center gap-1 text-green-500 text-xs font-medium"><CheckCircle2 className="h-4 w-4" /> Contatado</span>
                        ) : (
                          <span className="hidden sm:inline-flex items-center gap-1 text-amber-500 text-xs"><Circle className="h-4 w-4" /> Pendente</span>
                        )}
                        <button onClick={() => setHistoricoLogs(crmLogs.filter(l => String(l.clienteId) === String(c.id)))}
                          className="p-2 hover:bg-primary/10 rounded-xl text-primary" title="Histórico CRM">
                          <History className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {paginada.length === 0 && !cLoading && <p className="py-10 text-center text-muted-foreground italic">Nenhum cliente encontrado.</p>}
              </div>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-6 py-6 border-t border-border">
                  <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl border hover:bg-muted disabled:opacity-50 text-sm">
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </button>
                  <span className="text-sm bg-muted/50 px-4 py-2 rounded-xl border">
                    Pág <span className="text-primary font-bold">{page}</span> / {totalPages}
                    <span className="text-xs text-muted-foreground ml-2">({stats.listaFiltrada.length})</span>
                  </span>
                  <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl border hover:bg-muted disabled:opacity-50 text-sm">
                    Próxima <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {crmModal && <CrmModal cliente={crmModal} loja={loja} repCodigo={selectedRep?.rep_codigo ?? 0} repLogin={repLogin} onClose={() => setCrmModal(null)} onSaved={onSaved} />}
      {historicoLogs !== null && <HistoricoModal logs={historicoLogs} onClose={() => setHistoricoLogs(null)} />}
      <style dangerouslySetInnerHTML={{ __html: GLOW_CSS }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Relatórios
// ══════════════════════════════════════════════════════════════════════════════
function RelatoriosView({ loja: initialLoja, isAdmin, onBack }:
  { loja: string; isAdmin: boolean; onBack: () => void }) {

  const [loja, setLoja] = useState(initialLoja || "l3");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");

  const { data: logs = [], isLoading } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: async () => { const r = await fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`); if (!r.ok) throw new Error(await r.text()); return r.json(); },
    staleTime: 30_000,
  });

  const filtrados = useMemo(() => logs.filter(l => {
    if (filtroStatus !== "todos" && l.status !== filtroStatus) return false;
    if (filtroInicio && new Date(l.dataFull) < new Date(filtroInicio)) return false;
    if (filtroFim && new Date(l.dataFull) > new Date(filtroFim + "T23:59:59")) return false;
    if (filtroCliente && !l.nomeCliente?.toLowerCase().includes(filtroCliente.toLowerCase())) return false;
    return true;
  }), [logs, filtroStatus, filtroInicio, filtroFim, filtroCliente]);

  const exportarCSV = () => {
    const header = "Data,Loja,Vendedor,ID Cliente,Cliente,Telefone,Status,Observação\n";
    const rows = filtrados.map(l => [
      new Date(l.dataFull).toLocaleString("pt-BR"), l.loja, l.repLogin, l.clienteId,
      l.nomeCliente, l.telefone, STATUS_LABELS[l.status] || l.status,
      `"${(l.obs || "").replace(/"/g,'""')}"`,
    ].join(",")).join("\n");
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `CRM_${loja.toUpperCase()}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
        <div>
          <h2 className="font-bold text-xl flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Relatórios CRM</h2>
          <p className="text-xs text-muted-foreground">{filtrados.length} registros</p>
        </div>
        <button onClick={exportarCSV}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {isAdmin && (
          <div className="relative">
            <select value={loja} onChange={e=>setLoja(e.target.value)}
              className="appearance-none w-full rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              {SC_LOJAS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        )}
        <div className="relative">
          <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)}
            className="appearance-none w-full rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            <option value="todos">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
        <input type="date" value={filtroInicio} onChange={e=>setFiltroInicio(e.target.value)}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <input type="date" value={filtroFim} onChange={e=>setFiltroFim(e.target.value)}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <input placeholder="Filtrar por cliente..." value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)}
          className="col-span-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {["Data","Vendedor","Cliente","Telefone","Status","Observação"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0,200).map((l,i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.dataFull).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</td>
                  <td className="px-4 py-3 text-xs font-mono">{l.repLogin||"—"}</td>
                  <td className="px-4 py-3 font-medium">{l.nomeCliente}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.telefone}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      l.status === "comprou" ? "bg-green-500/10 text-green-500" :
                      l.status === "nao_comprou" ? "bg-red-500/10 text-red-400" :
                      l.status === "retornar_contato" ? "bg-blue-500/10 text-blue-400" :
                      "bg-muted text-muted-foreground"}`}>
                      {STATUS_LABELS[l.status] || l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={l.obs}>{l.obs}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground italic">Nenhum registro encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PÁGINA PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function SalesCompass() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [view, setView] = useState<ViewType>("rep");
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria>("A");

  // Atualiza permissões ao abrir o app — reflete mudanças feitas no Hub sem precisar de logout
  useEffect(() => { refreshUser(); }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const appConfig = (user as any)?.apps?.salescompass;
  const role      = appConfig?.role ?? "viewer";
  const loja      = appConfig?.loja ?? "l3";
  const repCodigo: number = Number(appConfig?.usu_codigo_sistema) || 0;
  const repLogin  = user?.usuario ?? "";

  // ── Papel no Sales Compass ──────────────────────────────────────────────
  // admin  → painel completo com seleção de loja
  // manager → painel da loja fixa com seleção de vendedor
  // viewer  → apenas a própria carteira
  const isAdmin   = role === "admin";
  const isGerente = role === "manager" || isAdmin;
  // Gerente "híbrido" ou vendedor com código próprio → pode ver RepView
  const hasOwnCarteira = !isAdmin && repCodigo > 0;

  useEffect(() => {
    if (isAdmin)                      { setView("admin");   return; }
    if (isGerente && !hasOwnCarteira) { setView("gerente"); return; }
    setView("rep"); // viewer, ou gerente híbrido com código próprio
  }, [isAdmin, isGerente, hasOwnCarteira]);

  const viewLabels: Record<ViewType,string> = {
    rep: "Minha Carteira", categoria: `Categoria ${selectedCategoria}`,
    gerente: "Painel do Gerente", admin: "Painel Admin", relatorios: "Relatórios CRM",
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">Sales Compass</span>
            <div className="h-5 w-px bg-border hidden sm:block" />
            <span className="text-xs text-muted-foreground hidden sm:block">{viewLabels[view]}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Nav tabs → apenas gerente e admin veem */}
            {isGerente && (
              <div className="hidden sm:flex items-center gap-1">
                {/* "Minha Carteira" só para gerente híbrido (tem código próprio) */}
                {hasOwnCarteira && (
                  <button onClick={() => setView("rep")}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view==="rep"||view==="categoria" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    Minha Carteira
                  </button>
                )}
                <button onClick={() => setView(isAdmin ? "admin" : "gerente")}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view==="gerente"||view==="admin" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  Painel
                </button>
                <button onClick={() => setView("relatorios")}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view==="relatorios" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  Relatórios
                </button>
              </div>
            )}
            <button onClick={() => setDark(d=>!d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => { logout(); navigate("/login"); }}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="flex-1 flex flex-col">
        {/* ── Viewer / Gerente híbrido: minha carteira ──────────────────── */}
        {(view === "rep" || view === "categoria") && !isGerente && repCodigo === 0 && (
          // Vendedor sem código de representante configurado
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground px-4">
            <AlertCircle className="w-16 h-16 opacity-20" />
            <p className="text-lg font-semibold">Sem acesso configurado</p>
            <p className="text-sm text-center max-w-sm">Nenhum código de representante foi vinculado à sua conta. Solicite ao administrador a configuração do <strong>Rep SCmp</strong> no gerenciamento do Hub.</p>
          </div>
        )}
        {view === "rep" && (hasOwnCarteira || !isGerente) && repCodigo > 0 && (
          <RepView loja={loja} repCodigo={repCodigo} repLogin={repLogin} dark={dark}
            onSetView={setView} onSetCategoria={c => setSelectedCategoria(c)} />
        )}
        {view === "categoria" && repCodigo > 0 && (
          <CategoriaView loja={loja} repCodigo={repCodigo} repLogin={repLogin}
            categoria={selectedCategoria} onBack={() => setView("rep")} />
        )}
        {/* ── Gerente: painel da loja fixa ──────────────────────────────── */}
        {view === "gerente" && (
          <GerenteView loja={loja} repLogin={repLogin} isAdmin={false} onSetView={setView} />
        )}
        {/* ── Admin: painel com seleção de loja ────────────────────────── */}
        {view === "admin" && (
          <GerenteView loja={loja} repLogin={repLogin} isAdmin={true} onSetView={setView} />
        )}
        {/* ── Relatórios ──────────────────────────────────────────────── */}
        {view === "relatorios" && (
          <RelatoriosView loja={loja} isAdmin={isAdmin}
            onBack={() => setView(isAdmin ? "admin" : isGerente ? "gerente" : "rep")} />
        )}
      </main>
    </div>
  );
}
