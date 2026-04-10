import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Sun, Moon, Plus, ClipboardList, PackageCheck,
  Send, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Loader2, Trash2, Eye,
  ChevronDown, ChevronRight, RotateCcw, FileText, Clock, Filter, MapPin,
} from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { toast } from "sonner";
import { API_BASE } from "@/services/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface Local {
  id: number;
  sessao_id: number;
  ordem: number;
  nome: string;
}

interface Contagem {
  id: number;
  item_id: number;
  local_id: number;
  qtd_contada: number | null;
  contado_por: string | null;
  contado_em: string | null;
}

interface Sessao {
  id: number;
  loja: string;
  nome: string;
  status: string;
  num_locais: number;
  criado_por: string;
  criado_em: string;
  enviado_em: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  feedback: string | null;
  total_itens: number;
  total_contados: number;
  locais?: Local[];
}

interface Item {
  id: number;
  sessao_id: number;
  pro_codigo: string;
  descricao: string | null;
  qtd_sistema: number;
  qtd_contada: number | null;
  custo_fiscal: number | null;
  editado_por: string | null;
  editado_em: string | null;
  contagens: Contagem[];
}

interface LogEntry {
  id: number;
  sessao_id: number;
  usuario: string;
  acao: string;
  detalhes: string | null;
  criado_em: string;
}

type View = "list" | "detail";
type ItemFilter = "todos" | "contados" | "nao_contados" | "divergentes";

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  RASCUNHO: { label: "Rascunho", color: "bg-gray-500", icon: <FileText className="h-3 w-3" /> },
  EM_ANDAMENTO: { label: "Em Andamento", color: "bg-blue-500", icon: <Clock className="h-3 w-3" /> },
  CONCLUIDO: { label: "Concluído", color: "bg-yellow-500", icon: <PackageCheck className="h-3 w-3" /> },
  ENVIADO: { label: "Enviado p/ Aprovação", color: "bg-purple-500", icon: <Send className="h-3 w-3" /> },
  APROVADO: { label: "Aprovado", color: "bg-green-600", icon: <CheckCircle2 className="h-3 w-3" /> },
  REJEITADO: { label: "Rejeitado", color: "bg-red-600", icon: <XCircle className="h-3 w-3" /> },
};

const LOJAS_INVENTARIO = [
  "FORTALEZA",
];

const ITEMS_PER_PAGE = 25;

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtCurrency(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Inline Contagem Cell ─────────────────────────────────────────────────────

function ContagemCell({
  contagem,
  canEdit,
  onSave,
}: {
  contagem: Contagem;
  canEdit: boolean;
  onSave: (contagemId: number, qtd: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");

  if (!canEdit) {
    return (
      <span className={contagem.qtd_contada === null ? "text-muted-foreground" : ""}>
        {contagem.qtd_contada ?? "—"}
      </span>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          min="0"
          className="w-16 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-primary/50"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && val !== "") {
              onSave(contagem.id, Number(val)).then(() => setEditing(false));
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button
          onClick={() => { if (val !== "") onSave(contagem.id, Number(val)).then(() => setEditing(false)); }}
          className="text-green-600 hover:text-green-700"
        >
          <CheckCircle2 className="w-3 h-3" />
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
          <XCircle className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setVal(String(contagem.qtd_contada ?? "")); setEditing(true); }}
      className={`cursor-pointer hover:underline ${contagem.qtd_contada === null ? "text-muted-foreground" : ""}`}
      title="Clique para editar"
    >
      {contagem.qtd_contada ?? "—"}
    </button>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Inventario() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const isAdmin = user?.apps?.dashboard?.role === "admin";
  const inventarioApp = (user?.apps as any)?.inventario;
  const isManager = isAdmin || inventarioApp?.role === "manager" || inventarioApp?.role === "admin";
  const usuario = user?.usuario ?? "Sistema";

  // ── State ──
  const [view, setView] = useState<View>("list");
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSessao, setSelectedSessao] = useState<Sessao | null>(null);
  const [locais, setLocais] = useState<Local[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create session
  const [showCreate, setShowCreate] = useState(false);
  const [newLoja, setNewLoja] = useState(LOJAS_INVENTARIO[0]);
  const [newNome, setNewNome] = useState("");
  const [newNumLocais, setNewNumLocais] = useState(1);
  const [newNomesLocais, setNewNomesLocais] = useState<string[]>(["Local 1"]);
  const [creating, setCreating] = useState(false);

  // Add item
  const [addCodigo, setAddCodigo] = useState("");
  const [adding, setAdding] = useState(false);

  // Contagem form
  const [showContagem, setShowContagem] = useState(false);
  const [contagemCodigo, setContagemCodigo] = useState("");
  const [contagemLocalId, setContagemLocalId] = useState<number | null>(null);
  const [contagemQtd, setContagemQtd] = useState("");
  const [savingContagem, setSavingContagem] = useState(false);

  // Recount confirmation modal
  const [showRecontagem, setShowRecontagem] = useState(false);
  const [recontagemInfo, setRecontagemInfo] = useState<{ item: Item; contagem: Contagem; novaQtd: number } | null>(null);

  // Add local
  const [showAddLocal, setShowAddLocal] = useState(false);
  const [newLocalNome, setNewLocalNome] = useState("");
  const [addingLocal, setAddingLocal] = useState(false);

  // Filters & sorting
  const [itemFilter, setItemFilter] = useState<ItemFilter>("todos");
  const [itemSearch, setItemSearch] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [sessaoFilter, setSessaoFilter] = useState<string>("all");
  const [itemSort, setItemSort] = useState<{ col: "diferenca" | "vlr_diferenca" | null; dir: "asc" | "desc" }>({ col: null, dir: "desc" });

  const toggleSort = (col: "diferenca" | "vlr_diferenca") => {
    setItemSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" });
    setItemPage(1);
  };

  // Feedback (reject)
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  // Logs panel
  const [showLogs, setShowLogs] = useState(false);

  // ── API helpers ──
  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const r = await fetch(`${API_BASE}/inventario${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...opts?.headers },
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(body.error || r.statusText);
    }
    return r.json();
  }, []);

  // ── Load sessions ──
  const loadSessoes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/sessoes");
      setSessoes(data);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { loadSessoes(); }, [loadSessoes]);

  // ── Load detail ──
  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch(`/sessoes/${id}`);
      setSelectedSessao(data);
      setLocais(data.locais ?? []);
      setItens(data.itens ?? []);
      const logsData = await apiFetch(`/sessoes/${id}/logs`);
      setLogs(logsData);
    } catch (e: any) { toast.error(e.message); }
    finally { setDetailLoading(false); }
  }, [apiFetch]);

  const openDetail = (s: Sessao) => {
    setView("detail");
    setItemFilter("todos");
    setItemSearch("");
    setItemPage(1);
    loadDetail(s.id);
  };

  // ── Create session ──
  const handleNumLocaisChange = (n: number) => {
    const clamped = Math.max(1, Math.min(50, n));
    setNewNumLocais(clamped);
    setNewNomesLocais((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push(`Local ${next.length + 1}`);
      return next.slice(0, clamped);
    });
  };

  const handleCreate = async () => {
    if (!newNome.trim()) { toast.error("Informe um nome para a sessão"); return; }
    setCreating(true);
    try {
      await apiFetch("/sessoes", {
        method: "POST",
        body: JSON.stringify({
          loja: newLoja,
          nome: newNome.trim(),
          usuario,
          num_locais: newNumLocais,
          nomes_locais: newNomesLocais,
        }),
      });
      toast.success("Sessão criada!");
      setShowCreate(false);
      setNewNome("");
      setNewNumLocais(1);
      setNewNomesLocais(["Local 1"]);
      loadSessoes();
    } catch (e: any) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  // ── Status change ──
  const changeStatus = async (status: string, feedback?: string) => {
    if (!selectedSessao) return;
    try {
      await apiFetch(`/sessoes/${selectedSessao.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, usuario, feedback }),
      });
      toast.success(`Status → ${STATUS_MAP[status]?.label || status}`);
      loadDetail(selectedSessao.id);
      loadSessoes();
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Add item ──
  const handleAddItem = async () => {
    if (!selectedSessao || !addCodigo.trim()) return;
    setAdding(true);
    try {
      await apiFetch(`/sessoes/${selectedSessao.id}/itens`, {
        method: "POST",
        body: JSON.stringify({ pro_codigo: addCodigo.trim(), usuario }),
      });
      setAddCodigo("");
      loadDetail(selectedSessao.id);
    } catch (e: any) { toast.error(e.message); }
    finally { setAdding(false); }
  };

  // ── Save contagem (per local) ──
  const handleSaveContagem = async (contagemId: number, qtd: number) => {
    if (!selectedSessao) return;
    try {
      await apiFetch(`/contagens/${contagemId}`, {
        method: "PATCH",
        body: JSON.stringify({ qtd_contada: qtd, usuario }),
      });
      loadDetail(selectedSessao.id);
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Insert contagem via form ──
  const saveContagem = async (contagemId: number, qtd: number) => {
    if (!selectedSessao) return;
    setSavingContagem(true);
    try {
      await apiFetch(`/contagens/${contagemId}`, {
        method: "PATCH",
        body: JSON.stringify({ qtd_contada: qtd, usuario }),
      });
      toast.success(`Contagem salva: ${contagemCodigo || "item"} → ${qtd}`);
      setContagemCodigo("");
      setContagemQtd("");
      loadDetail(selectedSessao.id);
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingContagem(false); }
  };

  const handleInsertContagem = async () => {
    if (!selectedSessao || !contagemCodigo.trim() || !contagemLocalId || contagemQtd === "") return;
    const item = itens.find((i) => String(i.pro_codigo) === contagemCodigo.trim());
    if (!item) { toast.error("Produto não encontrado nesta sessão"); return; }
    const contagem = item.contagens?.find((c) => c.local_id === contagemLocalId);
    if (!contagem) { toast.error("Contagem não encontrada para este local"); return; }

    // If already counted at this local, require manager confirmation
    if (contagem.qtd_contada !== null) {
      if (!isManager) {
        toast.error("Este item já foi contado. Somente Gerente ou Administrador pode recontar.");
        return;
      }
      setRecontagemInfo({ item, contagem, novaQtd: Number(contagemQtd) });
      setShowRecontagem(true);
      return;
    }

    await saveContagem(contagem.id, Number(contagemQtd));
  };

  const confirmRecontagem = async () => {
    if (!recontagemInfo) return;
    setShowRecontagem(false);
    await saveContagem(recontagemInfo.contagem.id, recontagemInfo.novaQtd);
    setRecontagemInfo(null);
  };

  // ── Add local ──
  const handleAddLocal = async () => {
    if (!selectedSessao || !newLocalNome.trim()) return;
    setAddingLocal(true);
    try {
      await apiFetch(`/sessoes/${selectedSessao.id}/locais`, {
        method: "POST",
        body: JSON.stringify({ nome: newLocalNome.trim(), usuario }),
      });
      toast.success(`Local "${newLocalNome.trim()}" adicionado`);
      setNewLocalNome("");
      setShowAddLocal(false);
      loadDetail(selectedSessao.id);
    } catch (e: any) { toast.error(e.message); }
    finally { setAddingLocal(false); }
  };

  // ── Delete item ──
  const handleDeleteItem = async (itemId: number) => {
    if (!selectedSessao) return;
    try {
      await apiFetch(`/itens/${itemId}`, { method: "DELETE", body: JSON.stringify({ usuario }) });
      loadDetail(selectedSessao.id);
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Delete session ──
  const handleDeleteSessao = async () => {
    if (!selectedSessao) return;
    if (!confirm("Excluir esta sessão de inventário?")) return;
    try {
      await apiFetch(`/sessoes/${selectedSessao.id}`, { method: "DELETE" });
      toast.success("Sessão excluída");
      setView("list");
      loadSessoes();
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Filtered & sorted items ──
  const filteredItems = useMemo(() => {
    let list = itens;
    if (itemFilter === "contados") list = list.filter((i) => i.qtd_contada !== null);
    if (itemFilter === "nao_contados") list = list.filter((i) => i.qtd_contada === null);
    if (itemFilter === "divergentes") list = list.filter((i) => i.qtd_contada !== null && i.qtd_contada !== i.qtd_sistema);
    if (itemSearch.trim()) {
      const t = itemSearch.trim().toLowerCase();
      list = list.filter((i) => i.pro_codigo.toLowerCase().includes(t) || (i.descricao?.toLowerCase().includes(t)));
    }
    if (itemSort.col) {
      const sorted = [...list];
      sorted.sort((a, b) => {
        const diffA = a.qtd_contada !== null ? a.qtd_contada - a.qtd_sistema : null;
        const diffB = b.qtd_contada !== null ? b.qtd_contada - b.qtd_sistema : null;
        let valA: number | null, valB: number | null;
        if (itemSort.col === "diferenca") { valA = diffA; valB = diffB; }
        else { valA = diffA !== null && a.custo_fiscal !== null ? diffA * a.custo_fiscal : null; valB = diffB !== null && b.custo_fiscal !== null ? diffB * b.custo_fiscal : null; }
        if (valA === null && valB === null) return 0;
        if (valA === null) return 1;
        if (valB === null) return -1;
        return itemSort.dir === "asc" ? valA - valB : valB - valA;
      });
      list = sorted;
    }
    return list;
  }, [itens, itemFilter, itemSearch, itemSort]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(itemPage, totalPages);
  const pageStart = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedItems = useMemo(() => filteredItems.slice(pageStart, pageStart + ITEMS_PER_PAGE), [filteredItems, pageStart]);

  useEffect(() => { setItemPage(1); }, [itemFilter, itemSearch]);

  // Summary stats
  const totalContados = itens.filter((i) => i.qtd_contada !== null).length;
  const totalNaoContados = itens.filter((i) => i.qtd_contada === null).length;
  const totalDivergentes = itens.filter((i) => i.qtd_contada !== null && i.qtd_contada !== i.qtd_sistema).length;
  const valorDiferenca = itens.reduce((acc, i) => {
    if (i.qtd_contada === null || i.custo_fiscal === null) return acc;
    return acc + (i.qtd_contada - i.qtd_sistema) * i.custo_fiscal;
  }, 0);

  // Filtered sessions
  const filteredSessoes = useMemo(() => {
    if (sessaoFilter === "all") return sessoes;
    return sessoes.filter((s) => s.status === sessaoFilter);
  }, [sessoes, sessaoFilter]);

  const canEdit = selectedSessao && ["RASCUNHO", "EM_ANDAMENTO"].includes(selectedSessao.status);
  const canEditQtd = canEdit && isManager;

  // Helper: get contagem for an item at a specific local
  const getContagem = (item: Item, localId: number): Contagem | undefined =>
    item.contagens?.find((c) => c.local_id === localId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => view === "detail" ? (setView("list"), loadSessoes()) : navigate("/hub")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              title={view === "detail" ? "Voltar para lista" : "Voltar para Hub"}>
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="h-5 w-px bg-border" />
            <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-teal-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-foreground">Inventário</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* ── LIST VIEW ── */}
        {view === "list" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h1 className="text-xl font-bold text-foreground">Sessões de Inventário</h1>
              <div className="flex items-center gap-2">
                <div className="relative inline-block">
                  <select value={sessaoFilter} onChange={(e) => setSessaoFilter(e.target.value)}
                    className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                    <option value="all">Todos os status</option>
                    {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
                <button onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Nova Sessão
                </button>
              </div>
            </div>

            {/* Create modal */}
            {showCreate && (
              <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                <h2 className="text-sm font-semibold text-foreground">Nova Sessão de Inventário</h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Loja</label>
                    <div className="relative inline-block">
                      <select value={newLoja} onChange={(e) => setNewLoja(e.target.value)}
                        className="appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                        {LOJAS_INVENTARIO.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">Nome da Sessão</label>
                    <input type="text" value={newNome} onChange={(e) => setNewNome(e.target.value)}
                      placeholder="Ex: Inventário Mensal Junho 2026"
                      className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Locais de Estoque</label>
                    <input type="number" value={newNumLocais} onChange={(e) => handleNumLocaisChange(Number(e.target.value))}
                      min={1} max={50}
                      className="w-20 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>
                {newNumLocais > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Nomeie os locais de estoque:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {newNomesLocais.slice(0, newNumLocais).map((nome, i) => (
                        <input
                          key={i}
                          type="text"
                          value={nome}
                          onChange={(e) => setNewNomesLocais((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          })}
                          placeholder={`Local ${i + 1}`}
                          className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={creating}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Criar
                  </button>
                  <button onClick={() => setShowCreate(false)} className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-muted transition-colors">Cancelar</button>
                </div>
              </div>
            )}

            {/* Sessions table */}
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filteredSessoes.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/30 px-6 py-12 text-center">
                <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma sessão de inventário encontrada.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">ID</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Loja</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Nome</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Locais</th>
                      <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Itens</th>
                      <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Contados</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Criado Por</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Criado Em</th>
                      <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessoes.map((s) => {
                      const st = STATUS_MAP[s.status] || { label: s.status, color: "bg-gray-400", icon: null };
                      return (
                        <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs">{s.id}</td>
                          <td className="px-4 py-3 text-xs">{s.loja}</td>
                          <td className="px-4 py-3 text-xs font-medium text-foreground">{s.nome}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${st.color}`}>
                              {st.icon} {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-xs">{s.num_locais}</td>
                          <td className="px-4 py-3 text-center text-xs">{s.total_itens}</td>
                          <td className="px-4 py-3 text-center text-xs">{s.total_contados}/{s.total_itens}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{s.criado_por}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(s.criado_em)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => openDetail(s)}
                              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-[10px] font-semibold text-foreground hover:bg-primary/10 transition-colors">
                              <Eye className="w-3 h-3" /> Abrir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DETAIL VIEW ── */}
        {view === "detail" && selectedSessao && (
          <div className="space-y-6">
            {detailLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

            {!detailLoading && (
              <>
                {/* Session header */}
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <h1 className="text-lg font-bold text-foreground">{selectedSessao.nome}</h1>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>Loja: <strong className="text-foreground">{selectedSessao.loja}</strong></span>
                      <span>Locais: <strong className="text-foreground">{locais.length}</strong></span>
                      <span>Criado por: <strong className="text-foreground">{selectedSessao.criado_por}</strong></span>
                      <span>{fmtDate(selectedSessao.criado_em)}</span>
                      {(() => {
                        const st = STATUS_MAP[selectedSessao.status];
                        return st ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${st.color}`}>
                            {st.icon} {st.label}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    {locais.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {locais.map((l) => (
                          <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/30 text-[10px] font-medium text-teal-600">
                            <MapPin className="w-2.5 h-2.5" /> {l.nome}
                          </span>
                        ))}
                        {canEdit && isManager && !showAddLocal && (
                          <button onClick={() => setShowAddLocal(true)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-teal-500/40 text-[10px] font-medium text-teal-600 hover:bg-teal-500/10 transition-colors">
                            <Plus className="w-2.5 h-2.5" /> Adicionar Local
                          </button>
                        )}
                        {canEdit && isManager && showAddLocal && (
                          <div className="flex items-center gap-1">
                            <input type="text" value={newLocalNome} onChange={(e) => setNewLocalNome(e.target.value)}
                              placeholder="Nome do local"
                              onKeyDown={(e) => e.key === "Enter" && handleAddLocal()}
                              autoFocus
                              className="w-32 rounded-full border border-teal-500/40 bg-muted px-2.5 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-500/50" />
                            <button onClick={handleAddLocal} disabled={addingLocal || !newLocalNome.trim()}
                              className="text-teal-600 hover:text-teal-700 disabled:opacity-50">
                              {addingLocal ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            </button>
                            <button onClick={() => { setShowAddLocal(false); setNewLocalNome(""); }}
                              className="text-muted-foreground hover:text-foreground">
                              <XCircle className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {selectedSessao.status === "RASCUNHO" && (
                      <>
                        <button onClick={() => changeStatus("EM_ANDAMENTO")} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
                          <ChevronRight className="w-3 h-3" /> Iniciar Contagem
                        </button>
                        <button onClick={handleDeleteSessao} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors">
                          <Trash2 className="w-3 h-3" /> Excluir
                        </button>
                      </>
                    )}
                    {selectedSessao.status === "EM_ANDAMENTO" && (
                      <button onClick={() => changeStatus("CONCLUIDO")} className="inline-flex items-center gap-1 rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-yellow-700 transition-colors">
                        <PackageCheck className="w-3 h-3" /> Concluir Inventário
                      </button>
                    )}
                    {selectedSessao.status === "CONCLUIDO" && (
                      <button onClick={() => changeStatus("ENVIADO")} className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition-colors">
                        <Send className="w-3 h-3" /> Enviar p/ Aprovação
                      </button>
                    )}
                    {selectedSessao.status === "ENVIADO" && isAdmin && (
                      <>
                        <button onClick={() => changeStatus("APROVADO")} className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors">
                          <CheckCircle2 className="w-3 h-3" /> Aprovar
                        </button>
                        <button onClick={() => setShowFeedback(true)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors">
                          <XCircle className="w-3 h-3" /> Rejeitar
                        </button>
                      </>
                    )}
                    {selectedSessao.status === "REJEITADO" && (
                      <button onClick={() => changeStatus("EM_ANDAMENTO")} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
                        <RotateCcw className="w-3 h-3" /> Retomar Contagem
                      </button>
                    )}
                    <button onClick={() => setShowLogs(!showLogs)} className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${showLogs ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted"}`}>
                      <FileText className="w-3 h-3" /> Logs
                    </button>
                  </div>
                </div>

                {/* Rejection feedback */}
                {selectedSessao.feedback && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <span className="text-xs font-semibold text-red-500">Feedback do Administrador</span>
                    </div>
                    <p className="text-sm text-foreground">{selectedSessao.feedback}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Por {selectedSessao.aprovado_por} em {fmtDate(selectedSessao.aprovado_em)}</p>
                  </div>
                )}

                {/* Feedback modal */}
                {showFeedback && (
                  <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Motivo da Rejeição</h3>
                    <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={3}
                      placeholder="Descreva os ajustes necessários..."
                      className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <div className="flex gap-2">
                      <button onClick={() => { changeStatus("REJEITADO", feedbackText); setShowFeedback(false); setFeedbackText(""); }}
                        disabled={!feedbackText.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                        <XCircle className="w-3 h-3" /> Confirmar Rejeição
                      </button>
                      <button onClick={() => { setShowFeedback(false); setFeedbackText(""); }}
                        className="rounded-lg bg-secondary px-4 py-2 text-xs text-foreground hover:bg-muted transition-colors">Cancelar</button>
                    </div>
                  </div>
                )}

                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-border bg-card p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{itens.length}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Itens</p>
                  </div>
                  <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{totalContados}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Contados</p>
                  </div>
                  <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-center">
                    <p className="text-2xl font-bold text-orange-500">{totalNaoContados}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Não Contados</p>
                  </div>
                  <div className={`rounded-xl border p-4 text-center ${totalDivergentes > 0 ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"}`}>
                    <p className={`text-2xl font-bold ${totalDivergentes > 0 ? "text-red-500" : "text-foreground"}`}>{totalDivergentes}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Divergentes</p>
                    {valorDiferenca !== 0 && <p className={`text-xs font-mono mt-1 ${valorDiferenca < 0 ? "text-red-500" : "text-green-600"}`}>{fmtCurrency(valorDiferenca)}</p>}
                  </div>
                </div>

                {/* Inserir Contagem */}
                {canEditQtd && (
                  <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <PackageCheck className="w-3.5 h-3.5 text-teal-600" /> Inserir Contagem
                      </h3>
                      <button onClick={() => setShowContagem((v) => !v)}
                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                        {showContagem ? "Fechar" : "Abrir"}
                      </button>
                    </div>
                    {showContagem && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input type="text" value={contagemCodigo} onChange={(e) => setContagemCodigo(e.target.value)}
                          placeholder="Código do produto"
                          className="flex-1 min-w-0 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        <select
                          value={contagemLocalId ?? ""}
                          onChange={(e) => setContagemLocalId(e.target.value ? Number(e.target.value) : null)}
                          className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                          <option value="">Selecione o local</option>
                          {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                        </select>
                        <input type="number" value={contagemQtd} onChange={(e) => setContagemQtd(e.target.value)}
                          placeholder="Qtd contada" min="0"
                          onKeyDown={(e) => e.key === "Enter" && handleInsertContagem()}
                          className="w-28 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        <button onClick={handleInsertContagem}
                          disabled={savingContagem || !contagemCodigo.trim() || !contagemLocalId || contagemQtd === ""}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 transition-colors">
                          {savingContagem ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Salvar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Item filters */}
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <div className="flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                    {(["todos", "contados", "nao_contados", "divergentes"] as ItemFilter[]).map((f) => {
                      const labels: Record<ItemFilter, string> = { todos: "Todos", contados: "Contados", nao_contados: "Não Contados", divergentes: "Divergentes" };
                      return (
                        <button key={f} onClick={() => setItemFilter(f)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${itemFilter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted"}`}>
                          {labels[f]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="max-w-xs w-full">
                    <input type="text" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Buscar por código ou descrição..."
                      className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>

                {/* Items table */}
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: `${700 + locais.length * 100}px` }}>
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Código</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Descrição</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Qtd Sistema</th>
                        {locais.map((l) => (
                          <th key={l.id} className="px-3 py-3 text-right text-[10px] uppercase tracking-widest text-teal-600">
                            <span className="flex items-center justify-end gap-1"><MapPin className="w-2.5 h-2.5" />{l.nome}</span>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Total</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("diferenca")}>
                          Diferença {itemSort.col === "diferenca" ? (itemSort.dir === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Custo Fiscal</th>
                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("vlr_diferenca")}>
                          Vlr Diferença {itemSort.col === "vlr_diferenca" ? (itemSort.dir === "desc" ? "▼" : "▲") : ""}
                        </th>
                        {canEdit && <th className="px-3 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedItems.length === 0 ? (
                        <tr><td colSpan={7 + locais.length + (canEdit ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground text-xs">Nenhum item encontrado.</td></tr>
                      ) : pagedItems.map((item) => {
                        const diff = item.qtd_contada !== null ? item.qtd_contada - item.qtd_sistema : null;
                        const valorDiff = diff !== null && item.custo_fiscal !== null ? diff * item.custo_fiscal : null;
                        const isDivergent = diff !== null && diff !== 0;
                        return (
                          <tr key={item.id} className={`border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors ${isDivergent ? "bg-red-500/5" : ""}`}>
                            <td className="px-4 py-2 font-mono text-xs text-foreground">{item.pro_codigo}</td>
                            <td className="px-4 py-2 text-xs text-foreground">{item.descricao || "—"}</td>
                            <td className="px-4 py-2 text-xs text-right tabular-nums">{item.qtd_sistema}</td>
                            {locais.map((l) => {
                              const c = getContagem(item, l.id);
                              return (
                                <td key={l.id} className="px-3 py-2 text-xs text-right tabular-nums">
                                  <span className={c?.qtd_contada === null || c?.qtd_contada === undefined ? "text-muted-foreground" : ""}>
                                    {c?.qtd_contada ?? "—"}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="px-4 py-2 text-xs text-right tabular-nums font-bold">
                              <span className={item.qtd_contada === null ? "text-muted-foreground" : ""}>{item.qtd_contada ?? "—"}</span>
                            </td>
                            <td className={`px-4 py-2 text-xs text-right tabular-nums font-semibold ${isDivergent ? (diff! > 0 ? "text-green-600" : "text-red-500") : "text-muted-foreground"}`}>
                              {diff !== null ? (diff > 0 ? `+${diff}` : diff) : "—"}
                            </td>
                            <td className="px-4 py-2 text-xs text-right tabular-nums">{fmtCurrency(item.custo_fiscal)}</td>
                            <td className={`px-4 py-2 text-xs text-right tabular-nums font-semibold ${valorDiff !== null && valorDiff !== 0 ? (valorDiff > 0 ? "text-green-600" : "text-red-500") : "text-muted-foreground"}`}>
                              {valorDiff !== null ? fmtCurrency(valorDiff) : "—"}
                            </td>
                            {canEdit && (
                              <td className="px-3 py-2 text-center">
                                <button onClick={() => handleDeleteItem(item.id)} className="text-muted-foreground hover:text-red-500" title="Remover item">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {filteredItems.length > ITEMS_PER_PAGE && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Mostrando {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, filteredItems.length)} de {filteredItems.length} itens
                    </p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setItemPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground disabled:opacity-40 disabled:cursor-not-allowed">Anterior</button>
                      <span className="text-xs text-muted-foreground">Página {safePage} de {totalPages}</span>
                      <button onClick={() => setItemPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground disabled:opacity-40 disabled:cursor-not-allowed">Próxima</button>
                    </div>
                  </div>
                )}

                {/* Logs panel */}
                {showLogs && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" /> Logs de Auditoria
                    </h3>
                    {logs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum log registrado.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {logs.map((l) => (
                          <div key={l.id} className="flex gap-3 text-xs py-1 border-b border-border/30 last:border-0">
                            <span className="text-muted-foreground whitespace-nowrap">{fmtDate(l.criado_em)}</span>
                            <span className="font-mono text-primary">{l.usuario}</span>
                            <span className="font-semibold">{l.acao}</span>
                            {l.detalhes && <span className="text-muted-foreground truncate">{l.detalhes}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Recount confirmation modal */}
      {showRecontagem && recontagemInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 mx-4">
            <div className="flex items-center gap-2 text-orange-500">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold">Item já contado</h3>
            </div>
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                O produto <span className="font-semibold text-foreground">{recontagemInfo.item.pro_codigo}</span> — <span className="text-foreground">{recontagemInfo.item.descricao}</span> já possui contagem neste local.
              </p>
              <div className="flex gap-4 rounded-lg bg-muted p-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Contagem atual</p>
                  <p className="text-sm font-bold text-foreground">{recontagemInfo.contagem.qtd_contada}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Nova contagem</p>
                  <p className="text-sm font-bold text-orange-500">{recontagemInfo.novaQtd}</p>
                </div>
              </div>
              <p>Deseja sobrescrever a contagem anterior?</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowRecontagem(false); setRecontagemInfo(null); }}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={confirmRecontagem}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                Confirmar Recontagem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
