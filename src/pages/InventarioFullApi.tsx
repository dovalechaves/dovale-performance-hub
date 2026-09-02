import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { 
  ArrowLeft, RefreshCw, Plus, Search, CheckCircle, AlertCircle, 
  ShoppingCart, Store, Check, X, Sun, Moon, Loader2
} from "lucide-react";
import { API_BASE } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { io, Socket } from "socket.io-client";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Erro ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const api = {
  get: async <T = any>(path: string) => ({ data: await requestJson<T>(path) }),
  post: async <T = any>(path: string, body?: unknown) => ({
    data: await requestJson<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  }),
  patch: async <T = any>(path: string, body?: unknown) => ({
    data: await requestJson<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  }),
};

interface Sessao {
  id: number;
  nome: string;
  status: "RASCUNHO" | "VERIFICADO" | "APROVADO";
  criado_por: string;
  criado_em: string;
  verificado_em?: string;
  enviado_em?: string;
  aprovado_por?: string;
  aprovado_em?: string;
  total_itens: number;
  total_mapeados: number;
  total_pendentes: number;
  itens_count?: number;
  mapeados_count?: number;
}

interface Marketplace {
  id: number;
  codigo: string;
  nome: string;
  ordem: number;
}

interface Estoque {
  codigo: string;
  qtd_api: number;
}

interface Item {
  id: number;
  sku_marketplace: string;
  titulo: string;
  pro_codigo: string | null;
  descricao_interna: string | null;
  mapeado: boolean;
  mapeado_por: string | null;
  mapeado_em: string | null;
  estoques: Estoque[];
}

interface Produto {
  PRO_CODIGO: number;
  PRO_RESUMO: string;
}

export default function InventarioFullApiPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [loading, setLoading] = useState(false);
  const [novaSessaoOpen, setNovaSessaoOpen] = useState(false);
  const [novaSessaoNome, setNovaSessaoNome] = useState("");
  
  // Detalhe
  const [sessaoAtual, setSessaoAtual] = useState<Sessao | null>(null);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [verificando, setVerificando] = useState(false);
  const [progress, setProgress] = useState({ step: "", message: "", pct: 0 });
  
  // Mapeamento
  const [mapearOpen, setMapearOpen] = useState(false);
  const [itemParaMapear, setItemParaMapear] = useState<Item | null>(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [produtosBusca, setProdutosBusca] = useState<Produto[]>([]);
  const [loadingBusca, setLoadingBusca] = useState(false);
  
  // Aprovação
  const [aprovarOpen, setAprovarOpen] = useState(false);
  const [telefoneAprovacao, setTelefoneAprovacao] = useState("");

  const socketRef = useMemo<Socket | null>(() => {
    const s = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    return s;
  }, []);

  // Carregar sessoes
  const carregarSessoes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/inventario-full-api/sessoes");
      setSessoes(r.data);
    } catch (e: any) {
      toast.error("Erro ao carregar sessões");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarSessoes();
    return () => { socketRef?.disconnect(); };
  }, [carregarSessoes, socketRef]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Socket events
  useEffect(() => {
    if (!socketRef) return;
    socketRef.on("connect", () => console.log("[Socket] Conectado"));
    socketRef.on("inv_full_progress", (data: any) => {
      if (data.sessao_id === sessaoAtual?.id) {
        setProgress({ step: data.step, message: data.message, pct: data.pct || 0 });
      }
    });
    return () => { socketRef.off("inv_full_progress"); };
  }, [socketRef, sessaoAtual]);

  // Criar sessao
  async function criarSessao() {
    const usuario = user?.usuario || "";
    if (!novaSessaoNome || !usuario) {
      toast.error("Nome e usuário são obrigatórios");
      return;
    }
    try {
      await api.post("/inventario-full-api/sessoes", { nome: novaSessaoNome, criado_por: usuario });
      toast.success("Sessão criada!");
      setNovaSessaoOpen(false);
      setNovaSessaoNome("");
      carregarSessoes();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao criar sessão");
    }
  }

  // Ver detalhes
  async function verDetalhes(sessao: Sessao) {
    setSessaoAtual(sessao);
    try {
      const r = await api.get(`/inventario-full-api/sessoes/${sessao.id}`);
      setMarketplaces(r.data.marketplaces || []);
      setItens(r.data.itens || []);
    } catch (e: any) {
      toast.error("Erro ao carregar detalhes");
    }
  }

  // Verificar (buscar APIs)
  async function verificarApis() {
    if (!sessaoAtual || !socketRef) return;
    setVerificando(true);
    setProgress({ step: "inicio", message: "Iniciando...", pct: 0 });
    try {
      await api.post(`/inventario-full-api/sessoes/${sessaoAtual.id}/verificar`, {
        socket_id: socketRef.id
      });
      toast.success("Verificação concluída!");
      verDetalhes(sessaoAtual);
      carregarSessoes();
    } catch (e: any) {
      toast.error(e?.message || "Erro na verificação");
    } finally {
      setVerificando(false);
      setProgress({ step: "", message: "", pct: 0 });
    }
  }

  // Buscar produtos para mapeamento
  async function buscarProdutos() {
    if (!buscaProduto || buscaProduto.length < 3) {
      setProdutosBusca([]);
      return;
    }
    setLoadingBusca(true);
    try {
      const r = await api.get(`/inventario-full-api/produtos/buscar?q=${encodeURIComponent(buscaProduto)}`);
      setProdutosBusca(r.data || []);
    } catch {
      setProdutosBusca([]);
    } finally {
      setLoadingBusca(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(buscarProdutos, 300);
    return () => clearTimeout(t);
  }, [buscaProduto]);

  // Mapear item
  async function mapearItem(proCodigo: string) {
    const usuario = user?.usuario || "";
    if (!itemParaMapear) return;
    try {
      await api.patch(`/inventario-full-api/itens/${itemParaMapear.id}/mapear`, {
        pro_codigo: proCodigo,
        mapeado_por: usuario
      });
      toast.success("Item mapeado com sucesso!");
      setMapearOpen(false);
      setItemParaMapear(null);
      setBuscaProduto("");
      setProdutosBusca([]);
      if (sessaoAtual) verDetalhes(sessaoAtual);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao mapear");
    }
  }

  // Aprovar
  async function aprovar() {
    const usuario = user?.usuario || "";
    if (!sessaoAtual) return;
    try {
      const r = await api.post(`/inventario-full-api/sessoes/${sessaoAtual.id}/aprovar`, {
        aprovado_por: usuario,
        telefone_destino: telefoneAprovacao || undefined
      });
      toast.success(`Aprovado! ${r.data.itens_gerados} itens gerados.`);
      setAprovarOpen(false);
      setTelefoneAprovacao("");
      verDetalhes({ ...sessaoAtual, status: "APROVADO" });
      carregarSessoes();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao aprovar");
    }
  }

  // Badge status
  function statusBadge(status: string) {
    if (status === "RASCUNHO") return <Badge variant="secondary">Rascunho</Badge>;
    if (status === "VERIFICADO") return <Badge variant="default" className="bg-blue-600">Verificado</Badge>;
    if (status === "APROVADO") return <Badge variant="default" className="bg-green-600">Aprovado</Badge>;
    return <Badge>{status}</Badge>;
  }

  // Calcular totais
  function calcularTotal(item: Item): number {
    return item.estoques.reduce((sum, e) => sum + (e.qtd_api || 0), 0);
  }

  function fmtDate(dateStr?: string | null): string {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  }

  // Render lista de sessoes
  if (!sessaoAtual) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-gradient-card">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/hub")}
                className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
                title="Voltar para Hub"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="h-5 w-px bg-border" />
              <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
                <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
                <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
              </button>
              <div className="h-5 w-px bg-border" />
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-widest">Inventário FULL API</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDark((d) => !d)}
                className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
                title="Alternar tema"
              >
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-6 py-8">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold">Sessões de Inventário FULL API</h1>
                <p className="text-xs text-muted-foreground mt-1">Verificação automática de estoque em marketplaces FULL.</p>
              </div>
              <Dialog open={novaSessaoOpen} onOpenChange={setNovaSessaoOpen}>
                <DialogTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Nova Sessão
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nova Sessão de Verificação</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nome da sessão</Label>
                      <Input
                        placeholder="Ex: Verificação Abril 2024"
                        value={novaSessaoNome}
                        onChange={(e) => setNovaSessaoNome(e.target.value)}
                      />
                    </div>
                    <Button onClick={criarSessao} className="w-full">Criar Sessão</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : sessoes.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/30 px-6 py-12 text-center">
                <ShoppingCart className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma sessão criada. Clique em "Nova Sessão" para começar.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border bg-muted/50">
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">ID</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Nome</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Itens</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Mapeados</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Pendentes</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Criado em</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessoes.map((s) => (
                      <TableRow key={s.id} className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors" onClick={() => verDetalhes(s)}>
                        <TableCell className="font-mono text-xs">#{s.id}</TableCell>
                        <TableCell className="font-medium text-xs">{s.nome}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell className="text-xs">{s.total_itens || s.itens_count || 0}</TableCell>
                        <TableCell className="text-xs text-emerald-600">{s.total_mapeados || s.mapeados_count || 0}</TableCell>
                        <TableCell className={`text-xs ${s.total_pendentes > 0 ? "text-amber-600 font-semibold" : ""}`}>{s.total_pendentes || 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(s.criado_em)}</TableCell>
                        <TableCell>
                          <button
                            onClick={(e) => { e.stopPropagation(); verDetalhes(s); }}
                            className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-[10px] font-semibold hover:bg-primary/10 transition-colors"
                          >
                            Ver
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Render detalhes da sessão
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSessaoAtual(null)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              title="Voltar para lista"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="h-5 w-px bg-border" />
            <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-bold uppercase tracking-widest">{sessaoAtual.nome}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDark((d) => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              title="Alternar tema"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-foreground">{sessaoAtual.nome}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{statusBadge(sessaoAtual.status)}</span>
                <span>Itens: <strong className="text-foreground">{itens.length}</strong></span>
                <span>Mapeados: <strong className="text-emerald-600">{itens.filter((i) => i.mapeado).length}</strong></span>
                <span>Pendentes: <strong className={itens.filter((i) => !i.mapeado).length > 0 ? "text-amber-600" : "text-foreground"}>{itens.filter((i) => !i.mapeado).length}</strong></span>
              </div>
            </div>
            <div className="flex gap-2">
              {sessaoAtual.status === "RASCUNHO" && (
                <button
                  onClick={verificarApis}
                  disabled={verificando}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verificando ? "animate-spin" : ""}`} />
                  {verificando ? "Verificando..." : "Verificar Agora"}
                </button>
              )}
              {sessaoAtual.status === "VERIFICADO" && (
                <button
                  onClick={() => setAprovarOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Aprovar e Gerar Inventário
                </button>
              )}
            </div>
          </div>

        {/* Progresso */}
          {verificando && (
            <Card className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20">
              <CardContent className="py-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{progress.message}</span>
                    <span className="text-muted-foreground">{progress.pct}%</span>
                  </div>
                  <Progress value={progress.pct} className="h-2" />
                </div>
              </CardContent>
            </Card>
          )}

        {/* Marketplaces badges */}
          <div className="flex flex-wrap gap-2">
            {marketplaces.map((mp) => (
              <Badge key={mp.id} variant="outline" className="gap-1">
                {mp.codigo === "ML" && <span className="text-blue-600 font-bold">ML</span>}
                {mp.codigo === "SHOPEE" && <span className="text-orange-600 font-bold">Shopee</span>}
                {mp.codigo === "AMAZON" && <span className="text-amber-600 font-bold">Amazon</span>}
                <span className="text-muted-foreground">{mp.nome}</span>
              </Badge>
            ))}
          </div>

        {/* Tabela de itens */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Itens Encontrados</CardTitle>
              {itens.filter((i) => !i.mapeado).length > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {itens.filter((i) => !i.mapeado).length} pendentes de mapeamento
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted/50">
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">SKU Marketplace</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Título</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Código Interno</TableHead>
                    <TableHead className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">ML</TableHead>
                    <TableHead className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">Shopee</TableHead>
                    <TableHead className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">Amazon</TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">Total</TableHead>
                    <TableHead className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest text-muted-foreground">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map(item => {
                    const estoqueML = item.estoques.find(e => e.codigo === "ML");
                    const estoqueSH = item.estoques.find(e => e.codigo === "SHOPEE");
                    const estoqueAZ = item.estoques.find(e => e.codigo === "AMAZON");
                    const total = calcularTotal(item);
                    return (
                      <TableRow key={item.id} className={`${!item.mapeado ? "bg-amber-50/60 dark:bg-amber-950/10" : ""} border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors`}>
                        <TableCell className="font-mono text-xs">{item.sku_marketplace}</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.titulo}>{item.titulo}</TableCell>
                        <TableCell>
                          {item.mapeado ? (
                            <div className="flex items-center gap-1">
                              <span className="font-mono font-medium">{item.pro_codigo}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {item.descricao_interna}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{estoqueML?.qtd_api ?? "-"}</TableCell>
                        <TableCell className="text-center">{estoqueSH?.qtd_api ?? "-"}</TableCell>
                        <TableCell className="text-center">{estoqueAZ?.qtd_api ?? "-"}</TableCell>
                        <TableCell className="text-right font-medium">{total > 0 ? total : "-"}</TableCell>
                        <TableCell className="text-center">
                          {item.mapeado ? (
                            <Badge variant="default" className="bg-green-600 gap-1">
                              <Check className="h-3 w-3" />
                              OK
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <X className="h-3 w-3" />
                              Pendente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!item.mapeado && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => { setItemParaMapear(item); setMapearOpen(true); }}
                            >
                              Mapear
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Dialog Mapear */}
      <Dialog open={mapearOpen} onOpenChange={setMapearOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mapear SKU para Código Interno</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 p-3 rounded text-sm">
              <p><strong>SKU Marketplace:</strong> {itemParaMapear?.sku_marketplace}</p>
              <p><strong>Título:</strong> {itemParaMapear?.titulo}</p>
            </div>
            <div className="space-y-2">
              <Label>Buscar produto por descrição ou código</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Digite para buscar..." 
                  value={buscaProduto}
                  onChange={e => setBuscaProduto(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {loadingBusca ? (
                <div className="p-4 text-center text-muted-foreground">Buscando...</div>
              ) : produtosBusca.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {buscaProduto.length >= 3 ? "Nenhum produto encontrado" : "Digite pelo menos 3 caracteres"}
                </div>
              ) : (
                <div className="divide-y">
                  {produtosBusca.map(p => (
                    <button
                      key={p.PRO_CODIGO}
                      className="w-full text-left p-3 hover:bg-muted/40 flex items-center justify-between"
                      onClick={() => mapearItem(String(p.PRO_CODIGO))}
                    >
                      <div>
                        <span className="font-mono font-medium">{p.PRO_CODIGO}</span>
                        <span className="mx-2">-</span>
                        <span className="text-sm">{p.PRO_RESUMO}</span>
                      </div>
                      <Check className="h-4 w-4 text-green-600 opacity-0 hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Aprovar */}
      <Dialog open={aprovarOpen} onOpenChange={setAprovarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar e Gerar Inventário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Isso irá gerar o inventário no sistema interno com os estoques dos marketplaces.
              Uma planilha de divergências será enviada via WhatsApp.
            </p>
            <div className="space-y-2">
              <Label>Telefone para notificação WhatsApp (opcional)</Label>
              <Input 
                placeholder="5511999999999" 
                value={telefoneAprovacao}
                onChange={e => setTelefoneAprovacao(e.target.value)}
              />
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded text-sm">
              <strong>Resumo:</strong>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                <li>• {itens.length} itens totais</li>
                <li>• {itens.filter(i => i.mapeado).length} itens mapeados (serão gerados)</li>
                <li>• {itens.filter(i => !i.mapeado).length} itens pendentes (ignorados)</li>
              </ul>
            </div>
            <Button onClick={aprovar} className="w-full gap-2">
              <CheckCircle className="h-4 w-4" />
              Confirmar Aprovação
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
