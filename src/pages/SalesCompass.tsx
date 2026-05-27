import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Sun, Moon, LogOut, Users, Sparkles, AlertCircle, X,
  Send, ChevronRight, Phone, BarChart3, ClipboardList, ChevronDown,
  TrendingUp, Download, Loader2,
} from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

// ── Tipos ───────────────────────────────────────────────────────────────────
type Categoria = "A" | "B" | "C" | "D";
type ViewType = "rep" | "categoria" | "gerente" | "admin" | "relatorios";

interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  cidade: string;
  categoria: Categoria;
  ultimaCompra: string;
  valorUltimaCompra: number;
  ticketMedio: number;
  frequenciaMensal: boolean;
  produtoFavorito: string;
  repId?: number;
}

interface VendedorInfo {
  nome: string;
  loja: string;
  meta: number;
  realizado: number;
}

interface CrmLog {
  dataFull: string;
  loja: string;
  clienteId: number;
  nomeCliente: string;
  telefone: string;
  status: string;
  obs: string;
  rep_codigo: number;
  repLogin: string;
}

interface Rep {
  rep_codigo: number;
  rep_nome: string;
}

// ── Constantes de categoria ──────────────────────────────────────────────────
const categoriaInfo: Record<Categoria, { titulo: string; descricao: string; ticket: string }> = {
  A: { titulo: "Categoria A", descricao: "Clientes premium, alta frequência", ticket: "Acima de R$ 801" },
  B: { titulo: "Categoria B", descricao: "Clientes recorrentes de médio porte", ticket: "R$ 501 a R$ 800" },
  C: { titulo: "Categoria C", descricao: "Clientes ocasionais", ticket: "R$ 301 a R$ 500" },
  D: { titulo: "Categoria D", descricao: "Clientes esporádicos a reativar", ticket: "Até R$ 300" },
};

const catClasses: Record<Categoria, { text: string; bg: string; ring: string; border: string }> = {
  A: { text: "text-indigo-400", bg: "bg-indigo-500/10", ring: "ring-indigo-500/30 hover:ring-indigo-500/70", border: "border-indigo-500/40" },
  B: { text: "text-amber-400",  bg: "bg-amber-500/10",  ring: "ring-amber-500/30 hover:ring-amber-500/70",   border: "border-amber-500/40"  },
  C: { text: "text-pink-400",   bg: "bg-pink-500/10",   ring: "ring-pink-500/30 hover:ring-pink-500/70",     border: "border-pink-500/40"   },
  D: { text: "text-red-400",    bg: "bg-red-500/10",    ring: "ring-red-500/30 hover:ring-red-500/70",       border: "border-red-500/40"    },
};

const SC_LOJAS = [
  { value: "l3",       label: "Rio de Janeiro" },
  { value: "l2",       label: "Santana" },
  { value: "bh",       label: "Belo Horizonte" },
  { value: "campinas", label: "Campinas" },
  { value: "riopreto", label: "Rio Preto" },
  { value: "fortaleza",label: "Fortaleza" },
];

const STATUS_LABELS: Record<string, string> = {
  comprou: "Comprou",
  nao_comprou: "Não comprou",
  retornar_contato: "Retornar contato",
  cancelado_agendamento: "Cancelado",
};

// ── Utilidades ───────────────────────────────────────────────────────────────
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
  const ultimoDia = new Date(ano, mes+1, 0).getDate();
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const d = new Date(ano, mes, dia);
    if (isDiaUtil(d)) { total++; if (dia <= hoje.getDate()) utilHoje = total; }
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

// ── Hook SSE: carrega clientes via streaming (evita Cloudflare 524) ──────────
const _clientesCache: Map<string, { data: Cliente[]; ts: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function useSseClientes(loja: string, repCodigo: number) {
  const cacheKey = `${loja}:${repCodigo}`;

  const getCached = () => {
    const c = _clientesCache.get(cacheKey);
    return c && Date.now() - c.ts < CACHE_TTL ? c.data : null;
  };

  const [clientes, setClientes] = useState<Cliente[]>(() => getCached() ?? []);
  const [isLoading, setIsLoading] = useState(() => !getCached() && !!loja);
  const [progress, setProgress] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!loja) return;
    const cached = getCached();
    if (cached) {
      setClientes(cached);
      setIsLoading(false);
      return;
    }

    setClientes([]);
    setIsLoading(true);
    setProgress("Conectando...");

    const url = `${API_BASE}/sales-compass/clientes?loja=${encodeURIComponent(loja)}&rep_codigo=${repCodigo}`;
    const es = new EventSource(url);
    esRef.current = es;
    const accumulated: Cliente[] = [];

    es.addEventListener("progress", (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setProgress(d.message ?? "Carregando...");
    });

    es.addEventListener("chunk", (e: MessageEvent) => {
      const chunk: Cliente[] = JSON.parse(e.data);
      accumulated.push(...chunk);
      setClientes([...accumulated]);
    });

    es.addEventListener("done", () => {
      _clientesCache.set(cacheKey, { data: accumulated, ts: Date.now() });
      setIsLoading(false);
      setProgress(null);
      es.close();
    });

    es.addEventListener("error", (e: MessageEvent) => {
      try { console.error("[SSE clientes] error:", JSON.parse(e.data).message); } catch {}
      setIsLoading(false);
      setProgress(null);
      es.close();
    });

    es.onerror = () => {
      setIsLoading(false);
      setProgress(null);
      es.close();
    };

    return () => { es.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { clientes, isLoading, progress };
}

// ── Componente: número animado ────────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    if (value === 0) { setDisplay(0); return; }
    const inc = value / (1000 / 16);
    const t = setInterval(() => {
      start += inc;
      if (start >= value) { setDisplay(value); clearInterval(t); }
      else setDisplay(Math.floor(start));
    }, 16);
    return () => clearInterval(t);
  }, [value]);
  return <>{display.toLocaleString("pt-BR")}</>;
}

// ── Componente: badges de status do cliente ──────────────────────────────────
function StatusBadges({ cliente }: { cliente: Cliente }) {
  const dias = diasDesde(cliente.ultimaCompra);
  return (
    <span className="flex flex-wrap gap-1">
      {cliente.frequenciaMensal && (
        <span className="text-[10px] bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-full px-1.5 py-0.5">👑 Fiel</span>
      )}
      {dias <= 30 && (
        <span className="text-[10px] bg-green-500/10 text-green-500 border border-green-500/30 rounded-full px-1.5 py-0.5">🔥 Quente</span>
      )}
      {dias > 30 && dias < 90 && (
        <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-full px-1.5 py-0.5">⏰ Atenção</span>
      )}
      {dias >= 90 && (
        <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/30 rounded-full px-1.5 py-0.5">😞 Resgatar</span>
      )}
    </span>
  );
}

// ── Componente: barra de progresso da meta ────────────────────────────────────
function MetaProgress({ meta, realizado }: { meta: number; realizado: number }) {
  const pct = meta > 0 ? Math.min(100, (realizado / meta) * 100) : 0;
  const color = pct >= 100 ? "bg-green-500" : pct >= 70 ? "bg-primary" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-foreground tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  );
}

// ── Componente: Modal CRM ─────────────────────────────────────────────────────
interface CrmModalProps {
  cliente: Cliente;
  loja: string;
  repCodigo: number;
  repLogin: string;
  onClose: () => void;
  onSaved: (status: string) => void;
  forcado?: boolean;
}

function CrmModal({ cliente, loja, repCodigo, repLogin, onClose, onSaved, forcado }: CrmModalProps) {
  const [status, setStatus] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!status || obs.length < 30) return;
    if (status === "retornar_contato" && !dataHora) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/sales-compass/crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja, clienteId: cliente.id, nome: cliente.nome, telefone: cliente.telefone, status, dataHora, obs, repCodigo, repLogin }),
      });
      if (!r.ok) throw new Error("Erro ao salvar CRM.");
      onSaved(status);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar CRM.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">Registro de CRM</h3>
          <p className="text-sm text-muted-foreground">{cliente.nome}</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-2">Resultado do contato</label>
          <div className="flex flex-col gap-2">
            {["comprou", "nao_comprou", "retornar_contato"].map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="radio" name="sc_status" value={s} checked={status === s}
                  onChange={(e) => setStatus(e.target.value)} className="accent-primary" />
                {STATUS_LABELS[s]}
              </label>
            ))}
          </div>
        </div>

        {status === "retornar_contato" && (
          <div className="mb-4 animate-in fade-in">
            <label className="block text-sm font-medium text-foreground mb-1">Data e Hora do Retorno</label>
            <input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none" />
          </div>
        )}

        <div className="mb-5">
          <label className="block text-sm font-medium text-foreground mb-1">
            Observação <span className="text-destructive font-bold">*</span>
            <span className="text-xs text-muted-foreground ml-1">(mín. 30 caracteres)</span>
          </label>
          <textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
            className={`w-full bg-background border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary outline-none ${obs.length < 30 ? "border-destructive" : "border-input"}`} />
          <p className={`text-xs mt-1 ${obs.length >= 30 ? "text-green-500" : "text-destructive"}`}>
            {obs.length}/30 caracteres
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          {!forcado && (
            <button onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg text-muted-foreground hover:bg-muted/50 transition">
              Fechar
            </button>
          )}
          <button onClick={handleSave}
            disabled={saving || obs.length < 30 || !status || (status === "retornar_contato" && !dataHora)}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50 font-medium">
            {saving ? "Salvando..." : "Salvar CRM"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente: Card de cliente ───────────────────────────────────────────────
interface ClienteCardProps {
  cliente: Cliente;
  potencial: boolean;
  glowClass: string;
  onContactar: (c: Cliente) => void;
}

function ClienteCard({ cliente, potencial, glowClass, onContactar }: ClienteCardProps) {
  const dias = diasDesde(cliente.ultimaCompra);
  const cc = catClasses[cliente.categoria];
  return (
    <div className={`bg-card border rounded-2xl p-4 flex items-center justify-between hover:shadow-md transition-all group ${glowClass || "border-border"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm ${cc.bg} ${cc.text}`}>
          {cliente.categoria}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{cliente.nome}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadges cliente={cliente} />
            {potencial && <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 rounded-full px-1.5 py-0.5">✨ Hoje</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <div className="text-right hidden sm:block">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Há {dias}d</p>
          <p className="text-xs font-bold text-foreground">{moeda(cliente.valorUltimaCompra)}</p>
        </div>
        <button onClick={() => onContactar(cliente)}
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition active:scale-95">
          <Send className="h-3 w-3" /> CRM
        </button>
      </div>
    </div>
  );
}

// ── Componente: Modal de detalhes de contato ──────────────────────────────────
interface ContatoModalProps {
  cliente: Cliente;
  onClose: () => void;
  onCrm: (c: Cliente) => void;
}

function ContatoModal({ cliente, onClose, onCrm }: ContatoModalProps) {
  const dias = diasDesde(cliente.ultimaCompra);
  const cc = catClasses[cliente.categoria];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center font-bold text-lg ${cc.bg} ${cc.text}`}>
            {cliente.categoria}
          </div>
          <div>
            <h3 className="font-bold text-foreground">{cliente.nome}</h3>
            <StatusBadges cliente={cliente} />
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground mb-6">
          <p><Phone className="inline h-3 w-3 mr-1" /><strong className="text-foreground">Telefone:</strong> {cliente.telefone}</p>
          <p><strong className="text-foreground">Ticket médio:</strong> {moeda(cliente.ticketMedio)}</p>
          <p><strong className="text-foreground">Última compra:</strong> {moeda(cliente.valorUltimaCompra)} (há {dias} dias)</p>
          <p><strong className="text-foreground">Produtos frequentes:</strong> {cliente.produtoFavorito}</p>
        </div>
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-muted-foreground hover:bg-muted/50 transition">
            Fechar
          </button>
          <button onClick={() => onCrm(cliente)}
            className="px-3 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition font-medium">
            Gerar CRM
          </button>
          <a href={`https://wa.me/55${cliente.telefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
            onClick={() => onCrm(cliente)}
            className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition inline-flex items-center gap-1.5 font-medium">
            <Send className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Componente: lista de clientes paginada ────────────────────────────────────
const PAGE_SIZE = 50;

interface ClienteListaProps {
  clientes: Cliente[];
  glowMap: Record<string, "success" | "error" | "info">;
  statusMap: Record<string, string>;
  onCrm: (c: Cliente) => void;
  titulo?: string;
}

function ClienteLista({ clientes, glowMap, statusMap, onCrm, titulo }: ClienteListaProps) {
  const [page, setPage] = useState(1);
  const total = clientes.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paged = clientes.slice(start, start + PAGE_SIZE);

  function getGlowClass(id: string) {
    const s = glowMap[id] || statusMap[id];
    if (s === "success" || s === "comprou") return "border-green-500/60 shadow-[0_0_12px_rgba(34,197,94,0.3)]";
    if (s === "error" || s === "nao_comprou" || s === "cancelado_agendamento") return "border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)]";
    if (s === "info" || s === "retornar_contato") return "border-blue-500/60 shadow-[0_0_12px_rgba(59,130,246,0.3)]";
    return "";
  }

  return (
    <div>
      {titulo && <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">{titulo} ({total})</h3>}
      <div className="space-y-2">
        {paged.map((c) => (
          <ClienteCard key={c.id} cliente={c} potencial={isPotencialHoje(c)}
            glowClass={getGlowClass(c.id)} onContactar={onCrm} />
        ))}
        {paged.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-sm italic">Nenhum cliente encontrado.</p>
        )}
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{start+1}–{Math.min(start+PAGE_SIZE, total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={safePage === 1} onClick={() => setPage(p => p-1)}
              className="px-3 py-1.5 rounded-lg text-xs bg-secondary disabled:opacity-40">Anterior</button>
            <button disabled={safePage === totalPages} onClick={() => setPage(p => p+1)}
              className="px-3 py-1.5 rounded-lg text-xs bg-secondary disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Vendedor (rep)
// ══════════════════════════════════════════════════════════════════════════════
function RepView({ loja, repCodigo, repLogin, dark, onSetView, onSetCategoria }:
  { loja: string; repCodigo: number; repLogin: string; dark: boolean;
    onSetView: (v: ViewType) => void; onSetCategoria: (c: Categoria) => void }) {

  const queryClient = useQueryClient();
  const [filtroGlobal, setFiltroGlobal] = useState<"carteira" | "potenciais" | "resgatar" | null>(null);
  const [contatoSelecionado, setContatoSelecionado] = useState<Cliente | null>(null);
  const [crmModal, setCrmModal] = useState<{ cliente: Cliente; forcado?: boolean } | null>(null);
  const [glowMap, setGlowMap] = useState<Record<string, "success" | "error" | "info">>({});

  const { data: vendedor, isLoading: vLoading } = useQuery<VendedorInfo>({
    queryKey: ["sc-vendedor", loja, repCodigo],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedor?loja=${loja}&rep_codigo=${repCodigo}`).then(r => r.json()),
    staleTime: 1000 * 60 * 5,
  });

  const { clientes, isLoading: cLoading, progress: clientesProgress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const statusMap = useMemo(() => {
    const m: Record<string, string> = {};
    [...crmLogs].sort((a, b) => new Date(a.dataFull).getTime() - new Date(b.dataFull).getTime())
      .forEach(l => { m[String(l.clienteId)] = l.status; });
    return m;
  }, [crmLogs]);

  const potenciaisHoje = clientes.filter(isPotencialHoje).length;
  const inativos = clientes.filter(c => diasDesde(c.ultimaCompra) >= 90).length;

  const clientesFiltradosGlobal = useMemo(() => {
    if (!filtroGlobal || !clientes.length) return [];
    let f = [...clientes];
    if (filtroGlobal === "potenciais") f = f.filter(isPotencialHoje);
    if (filtroGlobal === "resgatar") f = f.filter(c => diasDesde(c.ultimaCompra) >= 90);
    return f.sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));
  }, [clientes, filtroGlobal]);

  const handleCrmSaved = (status: string) => {
    if (!crmModal) return;
    const id = crmModal.cliente.id;
    const g = status === "comprou" ? "success" : (status === "nao_comprou" || status === "cancelado_agendamento") ? "error" : "info";
    setGlowMap(prev => ({ ...prev, [id]: g }));
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.cliente.nome}`);
    if (status === "retornar_contato") toast.info(`⏰ Retorno agendado para ${crmModal.cliente.nome}`);
    setCrmModal(null);
  };

  const isLoading = vLoading || cLoading;

  if (isLoading) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm">{clientesProgress ?? "Carregando carteira..."}</p>
      {clientes.length > 0 && (
        <p className="text-xs text-primary">{clientes.length} clientes carregados...</p>
      )}
    </div>
  );

  const categorias: Categoria[] = ["A", "B", "C", "D"];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Saudação + meta */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          Olá, {vendedor?.nome?.split(" ")[0] || "Vendedor"} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie sua carteira e registre contatos do dia.</p>
        {vendedor && vendedor.meta > 0 && (
          <div className="mt-4 bg-card border border-border rounded-2xl p-4 max-w-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Meta vs Realizado</span>
              <span className="font-bold text-foreground">{moeda(vendedor.realizado)} / {moeda(vendedor.meta)}</span>
            </div>
            <MetaProgress meta={vendedor.meta} realizado={vendedor.realizado} />
          </div>
        )}
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div onClick={() => setFiltroGlobal("carteira")}
          className={`col-span-3 sm:col-span-1 rounded-2xl bg-card border p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-1 ${filtroGlobal === "carteira" ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Carteira total</p>
              <p className="text-2xl font-bold text-foreground"><AnimatedNumber value={clientes.length} /></p>
            </div>
          </div>
        </div>
        <div onClick={() => setFiltroGlobal("potenciais")}
          className="rounded-2xl bg-card border border-border p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-1 group">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Potenciais hoje</p>
              <p className="text-2xl font-bold text-foreground"><AnimatedNumber value={potenciaisHoje} /></p>
            </div>
          </div>
        </div>
        <div onClick={() => setFiltroGlobal("resgatar")}
          className="rounded-2xl bg-card border border-border p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-1 group">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">A resgatar (90d+)</p>
              <p className="text-2xl font-bold text-foreground"><AnimatedNumber value={inativos} /></p>
            </div>
          </div>
        </div>
      </div>

      {/* Grade de categorias */}
      <h2 className="text-lg font-semibold text-foreground mb-4">Carteira por categoria</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {categorias.map(cat => {
          const total = clientes.filter(c => c.categoria === cat).length;
          const potenciais = clientes.filter(c => c.categoria === cat && isPotencialHoje(c)).length;
          const cls = catClasses[cat];
          const info = categoriaInfo[cat];
          return (
            <button key={cat} onClick={() => { onSetCategoria(cat); onSetView("categoria"); }}
              className={`text-left rounded-2xl bg-card border p-5 ring-2 ring-transparent transition-all hover:-translate-y-1 hover:shadow-xl ${cls.ring}`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`h-12 w-12 rounded-xl ${cls.bg} flex items-center justify-center font-bold text-xl ${cls.text}`}>{cat}</div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground ${cls.text}`} />
              </div>
              <h3 className="font-semibold text-foreground text-sm">{info.titulo}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{info.ticket}</p>
              <div className="mt-4 pt-3 border-t border-border flex justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Clientes</p>
                  <p className={`font-bold text-lg ${cls.text}`}><AnimatedNumber value={total} /></p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Hoje</p>
                  <p className={`font-bold text-lg ${cls.text}`}><AnimatedNumber value={potenciais} /></p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Botão relatórios */}
      <button onClick={() => onSetView("relatorios")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
        <ClipboardList className="h-4 w-4" /> Ver relatórios de CRM
      </button>

      {/* Modal global (carteira/potenciais/resgatar) */}
      {filtroGlobal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-[2rem] w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-border flex items-center justify-between bg-primary/5">
              <div>
                <h3 className="font-bold text-foreground text-lg">
                  {filtroGlobal === "carteira" ? "Minha Carteira Total" : filtroGlobal === "potenciais" ? "Potenciais de Hoje" : "Recuperação de Clientes"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{clientesFiltradosGlobal.length} clientes</p>
              </div>
              <button onClick={() => setFiltroGlobal(null)} className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-muted transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <ClienteLista clientes={clientesFiltradosGlobal} glowMap={glowMap} statusMap={statusMap}
                onCrm={(c) => { setCrmModal({ cliente: c }); setFiltroGlobal(null); }} />
            </div>
          </div>
        </div>
      )}

      {/* Modal detalhes contato */}
      {contatoSelecionado && (
        <ContatoModal cliente={contatoSelecionado} onClose={() => setContatoSelecionado(null)}
          onCrm={(c) => { setCrmModal({ cliente: c }); setContatoSelecionado(null); }} />
      )}

      {/* Modal CRM */}
      {crmModal && (
        <CrmModal cliente={crmModal.cliente} loja={loja} repCodigo={repCodigo} repLogin={repLogin}
          onClose={() => setCrmModal(null)} onSaved={handleCrmSaved} forcado={crmModal.forcado} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Categoria (detalhe)
// ══════════════════════════════════════════════════════════════════════════════
function CategoriaView({ loja, repCodigo, repLogin, categoria, onBack }:
  { loja: string; repCodigo: number; repLogin: string; categoria: Categoria; onBack: () => void }) {

  const queryClient = useQueryClient();
  const [crmModal, setCrmModal] = useState<Cliente | null>(null);
  const [glowMap, setGlowMap] = useState<Record<string, "success" | "error" | "info">>({});

  const { clientes, isLoading, progress: clientesProgress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const statusMap = useMemo(() => {
    const m: Record<string, string> = {};
    [...crmLogs].sort((a, b) => new Date(a.dataFull).getTime() - new Date(b.dataFull).getTime())
      .forEach(l => { m[String(l.clienteId)] = l.status; });
    return m;
  }, [crmLogs]);

  const clientesCategoria = useMemo(() => {
    const cats = clientes.filter(c => c.categoria === categoria);
    const potenciais = cats.filter(isPotencialHoje);
    const resto = cats.filter(c => !isPotencialHoje(c)).sort((a, b) => a.nome.localeCompare(b.nome));
    return [...potenciais, ...resto];
  }, [clientes, categoria]);

  const handleCrmSaved = (status: string) => {
    if (!crmModal) return;
    const g = status === "comprou" ? "success" : status === "nao_comprou" || status === "cancelado_agendamento" ? "error" : "info";
    setGlowMap(prev => ({ ...prev, [crmModal.id]: g }));
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.nome}`);
    setCrmModal(null);
  };

  const cls = catClasses[categoria];
  const info = categoriaInfo[categoria];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted transition">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className={`h-10 w-10 rounded-xl ${cls.bg} flex items-center justify-center font-bold ${cls.text}`}>{categoria}</div>
        <div>
          <h2 className="font-bold text-foreground">{info.titulo}</h2>
          <p className="text-xs text-muted-foreground">{info.ticket} • {clientesCategoria.length} clientes</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">{clientesProgress ?? "Carregando..."}</p>
          {clientes.length > 0 && <p className="text-xs text-primary">{clientes.length} carregados...</p>}
        </div>
      ) : (
        <ClienteLista clientes={clientesCategoria} glowMap={glowMap} statusMap={statusMap}
          onCrm={(c) => setCrmModal(c)} />
      )}

      {crmModal && (
        <CrmModal cliente={crmModal} loja={loja} repCodigo={repCodigo} repLogin={repLogin}
          onClose={() => setCrmModal(null)} onSaved={handleCrmSaved} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── VIEW: Gerente/Admin
// ══════════════════════════════════════════════════════════════════════════════
function GerenteView({ loja: initialLoja, repLogin, isAdmin, onSetView }:
  { loja: string; repLogin: string; isAdmin: boolean; onSetView: (v: ViewType) => void }) {

  const queryClient = useQueryClient();
  const [loja, setLoja] = useState(initialLoja || "l3");
  const [selectedRep, setSelectedRep] = useState<Rep | null>(null);
  const [glowMap, setGlowMap] = useState<Record<string, "success" | "error" | "info">>({});
  const [crmModal, setCrmModal] = useState<Cliente | null>(null);

  const { data: reps = [], isLoading: repsLoading } = useQuery<Rep[]>({
    queryKey: ["sc-vendedores", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedores?loja=${loja}`).then(r => r.json()),
    staleTime: 1000 * 60 * 5,
  });

  const repCodigo = selectedRep?.rep_codigo ?? 0;

  const { data: vendedor } = useQuery<VendedorInfo>({
    queryKey: ["sc-vendedor", loja, repCodigo],
    queryFn: () => fetch(`${API_BASE}/sales-compass/vendedor?loja=${loja}&rep_codigo=${repCodigo}`).then(r => r.json()),
    enabled: !!loja,
    staleTime: 1000 * 60 * 5,
  });

  const { clientes, isLoading: cLoading, progress: clientesProgress } = useSseClientes(loja, repCodigo);

  const { data: crmLogs = [] } = useQuery<CrmLog[]>({
    queryKey: ["sc-crm-logs", loja],
    queryFn: () => fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const statusMap = useMemo(() => {
    const m: Record<string, string> = {};
    [...crmLogs].sort((a, b) => new Date(a.dataFull).getTime() - new Date(b.dataFull).getTime())
      .forEach(l => { m[String(l.clienteId)] = l.status; });
    return m;
  }, [crmLogs]);

  // Log de hoje por vendedor
  const logsHoje = crmLogs.filter(l => {
    const d = new Date(l.dataFull);
    const hoje = new Date();
    return d.toDateString() === hoje.toDateString();
  });

  const handleCrmSaved = (status: string) => {
    if (!crmModal) return;
    const g = status === "comprou" ? "success" : status === "nao_comprou" || status === "cancelado_agendamento" ? "error" : "info";
    setGlowMap(prev => ({ ...prev, [crmModal.id]: g }));
    queryClient.invalidateQueries({ queryKey: ["sc-crm-logs", loja] });
    if (status === "comprou") toast.success(`✅ Venda registrada! ${crmModal.nome}`);
    setCrmModal(null);
  };

  const clientesOrdenados = useMemo(() => {
    const potenciais = clientes.filter(isPotencialHoje);
    const resto = clientes.filter(c => !isPotencialHoje(c)).sort((a, b) => a.nome.localeCompare(b.nome));
    return [...potenciais, ...resto];
  }, [clientes]);

  const lojaLabel = SC_LOJAS.find(l => l.value === loja)?.label || loja.toUpperCase();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            {isAdmin ? "Painel Administrativo" : "Painel do Gerente"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{lojaLabel}</p>
        </div>
        <div className="sm:ml-auto flex flex-wrap gap-2">
          {isAdmin && (
            <div className="relative">
              <select value={loja} onChange={e => { setLoja(e.target.value); setSelectedRep(null); }}
                className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                {SC_LOJAS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          )}
          <div className="relative">
            <select value={selectedRep?.rep_codigo ?? ""}
              onChange={e => {
                const v = e.target.value;
                setSelectedRep(v ? reps.find(r => String(r.rep_codigo) === v) || null : null);
              }}
              className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="">Todos os vendedores</option>
              {reps.map(r => <option key={r.rep_codigo} value={r.rep_codigo}>{r.rep_nome}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
          <button onClick={() => onSetView("relatorios")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground hover:text-foreground hover:bg-primary/10 transition">
            <ClipboardList className="h-4 w-4" /> Relatórios
          </button>
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Carteira", value: clientes.length, icon: <Users className="h-4 w-4 text-primary" />, bg: "bg-primary/10" },
          { label: "Potenciais", value: clientes.filter(isPotencialHoje).length, icon: <Sparkles className="h-4 w-4 text-amber-500" />, bg: "bg-amber-500/10" },
          { label: "Contatos hoje", value: new Set(logsHoje.filter(l => !selectedRep || l.rep_codigo === selectedRep.rep_codigo).map(l => l.clienteId)).size, icon: <TrendingUp className="h-4 w-4 text-green-500" />, bg: "bg-green-500/10" },
          { label: "A resgatar", value: clientes.filter(c => diasDesde(c.ultimaCompra) >= 90).length, icon: <AlertCircle className="h-4 w-4 text-red-400" />, bg: "bg-red-500/10" },
        ].map(card => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-4">
            <div className={`h-8 w-8 rounded-lg ${card.bg} flex items-center justify-center mb-2`}>{card.icon}</div>
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="text-2xl font-bold text-foreground"><AnimatedNumber value={card.value} /></p>
          </div>
        ))}
      </div>

      {/* Meta do vendedor selecionado */}
      {selectedRep && vendedor && vendedor.meta > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 mb-6 max-w-md">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-foreground">{vendedor.nome}</span>
            <span className="text-muted-foreground">{moeda(vendedor.realizado)} / {moeda(vendedor.meta)}</span>
          </div>
          <MetaProgress meta={vendedor.meta} realizado={vendedor.realizado} />
        </div>
      )}

      {/* Lista de clientes */}
      {cLoading || repsLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">{clientesProgress ?? "Carregando..."}</p>
          {clientes.length > 0 && <p className="text-xs text-primary">{clientes.length} clientes carregados...</p>}
        </div>
      ) : (
        <ClienteLista clientes={clientesOrdenados} glowMap={glowMap} statusMap={statusMap}
          onCrm={(c) => setCrmModal(c)}
          titulo={selectedRep ? `Carteira de ${selectedRep.rep_nome}` : "Carteira Total da Loja"} />
      )}

      {crmModal && (
        <CrmModal cliente={crmModal} loja={loja} repCodigo={selectedRep?.rep_codigo ?? 0} repLogin={repLogin}
          onClose={() => setCrmModal(null)} onSaved={handleCrmSaved} />
      )}
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
    queryFn: () => fetch(`${API_BASE}/sales-compass/crm-logs?loja=${loja}`).then(r => r.json()),
    staleTime: 30_000,
  });

  const filtrados = useMemo(() => {
    return logs.filter(l => {
      if (filtroStatus !== "todos" && l.status !== filtroStatus) return false;
      if (filtroInicio && new Date(l.dataFull) < new Date(filtroInicio)) return false;
      if (filtroFim && new Date(l.dataFull) > new Date(filtroFim + "T23:59:59")) return false;
      if (filtroCliente && !l.nomeCliente?.toLowerCase().includes(filtroCliente.toLowerCase())) return false;
      return true;
    });
  }, [logs, filtroStatus, filtroInicio, filtroFim, filtroCliente]);

  const exportarCSV = () => {
    const bom = "﻿";
    const header = "Data,Loja,Vendedor,ID Cliente,Cliente,Telefone,Status,Observação\n";
    const rows = filtrados.map(l => [
      new Date(l.dataFull).toLocaleString("pt-BR"),
      l.loja, l.repLogin, l.clienteId, l.nomeCliente, l.telefone,
      STATUS_LABELS[l.status] || l.status,
      `"${(l.obs || "").replace(/"/g, '""')}"`,
    ].join(",")).join("\n");
    const blob = new Blob([bom + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CRM_${loja.toUpperCase()}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-muted transition">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-bold text-foreground text-xl flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" /> Relatórios CRM
          </h2>
          <p className="text-xs text-muted-foreground">{filtrados.length} registros</p>
        </div>
        <button onClick={exportarCSV}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {isAdmin && (
          <div className="relative">
            <select value={loja} onChange={e => setLoja(e.target.value)}
              className="appearance-none w-full rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              {SC_LOJAS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        )}
        <div className="relative">
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="appearance-none w-full rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
            <option value="todos">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
        <input type="date" value={filtroInicio} onChange={e => setFiltroInicio(e.target.value)}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <input type="date" value={filtroFim} onChange={e => setFiltroFim(e.target.value)}
          className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <input placeholder="Filtrar por cliente..." value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
          className="col-span-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {["Data", "Vendedor", "Cliente", "Telefone", "Status", "Observação"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, 200).map((l, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(l.dataFull).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-foreground">{l.repLogin || "—"}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{l.nomeCliente}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.telefone}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      l.status === "comprou" ? "bg-green-500/10 text-green-500" :
                      l.status === "nao_comprou" ? "bg-red-500/10 text-red-400" :
                      l.status === "retornar_contato" ? "bg-blue-500/10 text-blue-400" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {STATUS_LABELS[l.status] || l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={l.obs}>{l.obs}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm italic">Nenhum registro encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── PÁGINA PRINCIPAL: SalesCompass
// ══════════════════════════════════════════════════════════════════════════════
export default function SalesCompass() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [view, setView] = useState<ViewType>("rep");
  const [selectedCategoria, setSelectedCategoria] = useState<Categoria>("A");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Determina perfil com base no app salescompass
  const appConfig = (user as any)?.apps?.salescompass;
  const role = appConfig?.role ?? "viewer";
  const loja = appConfig?.loja ?? "l3";
  const repCodigo: number = role === "viewer" ? (Number(appConfig?.usu_codigo_sistema) || 0) : 0;
  const repLogin = user?.usuario ?? "";

  const isAdmin = role === "admin" || user?.hubRole === "admin";
  const isGerente = role === "manager" || role === "admin" || user?.hubRole === "admin";

  // Redireciona para view adequada ao perfil
  useEffect(() => {
    if (isAdmin) { setView("admin"); return; }
    if (isGerente) { setView("gerente"); return; }
    setView("rep");
  }, [isAdmin, isGerente]);

  // Título da view no header
  const viewLabels: Record<ViewType, string> = {
    rep: "Minha Carteira",
    categoria: `Categoria ${selectedCategoria}`,
    gerente: "Painel do Gerente",
    admin: "Painel Admin",
    relatorios: "Relatórios CRM",
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
              <img src={logoBlue} alt="Dovale"
                className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
              <img src={logoWhite} alt="Dovale"
                className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
              Sales Compass
            </span>
            <div className="h-5 w-px bg-border hidden sm:block" />
            <span className="text-xs text-muted-foreground hidden sm:block">{viewLabels[view]}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Navegação interna */}
            {isGerente && (
              <div className="hidden sm:flex items-center gap-1">
                {!isAdmin && (
                  <button onClick={() => setView("rep")}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view === "rep" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    Minha Carteira
                  </button>
                )}
                <button onClick={() => setView(isAdmin ? "admin" : "gerente")}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view === "gerente" || view === "admin" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  Painel
                </button>
                <button onClick={() => setView("relatorios")}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view === "relatorios" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  Relatórios
                </button>
              </div>
            )}
            <button onClick={() => setDark(d => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => { logout(); navigate("/login"); }}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Conteúdo ────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col">
        {view === "rep" && (
          <RepView loja={loja} repCodigo={repCodigo} repLogin={repLogin} dark={dark}
            onSetView={setView}
            onSetCategoria={(c) => setSelectedCategoria(c)} />
        )}
        {view === "categoria" && (
          <CategoriaView loja={loja} repCodigo={repCodigo} repLogin={repLogin}
            categoria={selectedCategoria} onBack={() => setView("rep")} />
        )}
        {view === "gerente" && (
          <GerenteView loja={loja} repLogin={repLogin} isAdmin={false}
            onSetView={setView} />
        )}
        {view === "admin" && (
          <GerenteView loja={loja} repLogin={repLogin} isAdmin={true}
            onSetView={setView} />
        )}
        {view === "relatorios" && (
          <RelatoriosView loja={loja} isAdmin={isAdmin}
            onBack={() => setView(isAdmin ? "admin" : isGerente ? "gerente" : "rep")} />
        )}
      </main>
    </div>
  );
}
