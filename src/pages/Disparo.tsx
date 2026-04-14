import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { ArrowLeft, Upload, Send, Pause, Play, X, Sun, Moon, FileText, Settings, RefreshCw, Loader2, Check, ShieldX, ChevronDown, ChevronRight, Image, Video, File, Clock, CheckCircle2, XCircle, AlertCircle, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import * as api from "@/lib/disparo-api";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

export default function Disparo() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("disparos");

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [listaId, setListaId] = useState<number | null>(null);
  const [totalContatos, setTotalContatos] = useState(0);

  // Templates
  const [templates, setTemplates] = useState<api.TemplateMeta[]>([]);
  const [templatesGerenciar, setTemplatesGerenciar] = useState<api.TemplateGerenciar[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [templateDetalhe, setTemplateDetalhe] = useState<Record<string, any> | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);
  const [criarDialogOpen, setCriarDialogOpen] = useState(false);
  const [criarLoading, setCriarLoading] = useState(false);
  const [novoTemplate, setNovoTemplate] = useState({
    name: "", category: "MARKETING", language_code: "pt_BR",
    header_type: "NONE", header_text: "", header_media_example_url: "",
    body_text: "", footer_text: "", etiqueta: "",
  });
  const [templateMediaFile, setTemplateMediaFile] = useState<File | null>(null);
  const [templateMediaUploading, setTemplateMediaUploading] = useState(false);
  const [etiquetasChatwoot, setEtiquetasChatwoot] = useState<string[]>([]);
  const [templateEtiquetas, setTemplateEtiquetas] = useState<Record<string, string>>({});
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [inboxId, setInboxId] = useState("1");

  // Disparo status
  const [disparoId, setDisparoId] = useState<number | null>(null);
  const [disparoStatus, setDisparoStatus] = useState("");
  const [enviados, setEnviados] = useState(0);
  const [falhas, setFalhas] = useState(0);
  const [progresso, setProgresso] = useState(0);
  const [disparoLoading, setDisparoLoading] = useState(false);

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const aprovacaoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Socket
  const socketRef = useRef<Socket | null>(null);

  const addLog = useCallback((text: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${text}`;
    setLogs((prev) => [line, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Auto-exchange Hub token for a disparo JWT on mount
  useEffect(() => {
    if (!user) return;
    const exchange = async () => {
      try {
        if (api.isLoggedIn()) {
          setIsAdmin(api.isDisparoAdmin());
          setReady(true);
          return;
        }
        await api.exchangeHubToken(user.usuario, user.displayName);
        setIsAdmin(api.isDisparoAdmin());
        setReady(true);
      } catch {
        toast.error("Falha ao autenticar no módulo de disparo");
        navigate("/hub");
      }
    };
    exchange();
  }, [user, navigate]);

  // Listen for session expiry (when auto-re-exchange also fails)
  useEffect(() => {
    const handler = () => {
      toast.error("Sessão expirada. Redirecionando...");
      api.logout();
      navigate("/hub");
    };
    window.addEventListener("disparo-session-expired", handler);
    return () => window.removeEventListener("disparo-session-expired", handler);
  }, [navigate]);

  // Socket.IO connection
  useEffect(() => {
    if (!ready) return;
    const socket = io(api.getSocketUrl(), { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => addLog("Socket conectado"));
    socket.on("disconnect", () => addLog("Socket desconectado"));
    socket.on("status_disparo", (data: any) => {
      const lblMap: Record<string, string> = { AWAITING_APPROVAL: "Aguardando Aprovação", PROCESSING: "Processando", COMPLETED: "Concluído", PAUSING: "Pausando", PAUSED: "Pausado", REJECTED: "Negado", FAILED: "Falhou" };
      addLog(`Status disparo #${data.id}: ${lblMap[data.status] ?? data.status}`);
      setDisparoStatus(data.status);
    });
    socket.on("progresso_disparo", (data: any) => {
      setProgresso(data.progresso);
      setEnviados(data.enviados);
      setFalhas(data.falhas);
      addLog(`Progresso: ${data.progresso}% — ${data.enviados} enviados, ${data.falhas} falhas`);
    });

    return () => { socket.disconnect(); };
  }, [ready, addLog]);

  // Fetch templates + active dispatch once ready
  useEffect(() => {
    if (!ready) return;
    api.fetchTemplates().then(setTemplates).catch((e) => { console.error("[disparo] fetchTemplates:", e); toast.error("Falha ao carregar templates"); });
    api.fetchTemplatesGerenciar().then(setTemplatesGerenciar).catch((e) => { console.error("[disparo] fetchTemplatesGerenciar:", e); });
    api.fetchEtiquetasChatwoot().then(setEtiquetasChatwoot).catch(() => {});
    api.fetchTemplateEtiquetas().then(setTemplateEtiquetas).catch(() => {});
    api.fetchDisparoAtivo().then((d) => {
      if (d.ativo) {
        setDisparoId(d.disparo_id);
        setDisparoStatus(d.status);
        setEnviados(d.enviados);
        setFalhas(d.falhas);
        setProgresso(d.progresso);
        addLog(`Disparo ativo encontrado: #${d.disparo_id} (${d.status})`);
      }
    }).catch(() => {});
  }, [ready, addLog]);

  // Approval polling
  useEffect(() => {
    if (disparoStatus !== "AWAITING_APPROVAL" || !disparoId) {
      if (aprovacaoRef.current) { clearInterval(aprovacaoRef.current); aprovacaoRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const r = await api.fetchAprovacao(disparoId);
        if (r.status === "aprovado") {
          setDisparoStatus("PROCESSING");
          addLog("Disparo APROVADO! Processando...");
          toast.success("Disparo aprovado!");
        } else if (r.status === "negado" || r.status === "expirado") {
          setDisparoStatus("REJECTED");
          addLog(`Disparo ${r.status}: ${r.motivo ?? ""}`);
          toast.error(`Disparo ${r.status}`);
        }
      } catch {}
    };
    aprovacaoRef.current = setInterval(poll, 5000);
    return () => { if (aprovacaoRef.current) clearInterval(aprovacaoRef.current); };
  }, [disparoStatus, disparoId, addLog]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadLoading(true);
    try {
      const r = await api.uploadContatos(uploadFile);
      setListaId(r.lista_id);
      setTotalContatos(r.total);
      const descMsg = r.descartados > 0 ? ` (${r.descartados} descartados por número inválido)` : "";
      addLog(`Lista importada: ${r.total} contatos${descMsg} (ID ${r.lista_id})`);
      toast.success(`${r.total} contatos importados!${descMsg}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleUploadMidia = async () => {
    if (!mediaFile) return;
    try {
      const r = await api.uploadMidia(mediaFile);
      setMediaUrl(r.media_url);
      addLog(`Mídia enviada: ${r.media_url}`);
      toast.success("Mídia enviada!");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDisparar = async () => {
    if (!listaId || !selectedTemplate) {
      toast.error("Selecione lista e template");
      return;
    }
    setDisparoLoading(true);
    try {
      const tmpl = templates.find((t) => t.name === selectedTemplate);
      const cfg: Record<string, unknown> = {};
      if (mediaUrl && tmpl?.requires_media) cfg.media_url = mediaUrl;
      if (tmpl?.header_format) cfg.header_format = tmpl.header_format;

      const r = await api.iniciarDisparo({
        lista_id: listaId,
        template_nome: selectedTemplate,
        inbox_id: Number(inboxId) || 1,
        configuracao: cfg,
      });
      setDisparoId(r.disparo_id);
      setDisparoStatus("AWAITING_APPROVAL");
      setProgresso(0);
      setEnviados(0);
      setFalhas(0);
      addLog(`Disparo #${r.disparo_id} criado — aguardando aprovação`);
      toast.info("Aguardando aprovação do disparo");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDisparoLoading(false);
    }
  };

  const handlePausar = async () => {
    if (!disparoId) return;
    try { await api.pausarDisparo(disparoId); addLog("Pausa solicitada"); } catch (e: any) { toast.error(e.message); }
  };
  const handleRetomar = async () => {
    if (!disparoId) return;
    try { await api.retomarDisparo(disparoId); addLog("Retomando disparo..."); } catch (e: any) { toast.error(e.message); }
  };
  const handleCancelar = async () => {
    if (!disparoId) return;
    try { await api.cancelarDisparo(disparoId); setDisparoStatus("REJECTED"); addLog("Disparo cancelado"); } catch (e: any) { toast.error(e.message); }
  };
  const handleAprovar = async () => {
    if (!disparoId) return;
    try {
      await api.aprovarDisparo(disparoId, "aprovar");
      setDisparoStatus("PROCESSING");
      addLog("Disparo APROVADO manualmente! Processando...");
      toast.success("Disparo aprovado!");
    } catch (e: any) { toast.error(e.message); }
  };
  const handleNegar = async () => {
    if (!disparoId) return;
    try {
      await api.aprovarDisparo(disparoId, "negar");
      setDisparoStatus("REJECTED");
      addLog("Disparo NEGADO manualmente");
      toast.error("Disparo negado");
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Template expand/detail ──────────────────────────────────────────────────

  const handleToggleTemplate = async (t: api.TemplateGerenciar) => {
    const key = `${t.name}__${t.language}`;
    if (expandedTemplate === key) {
      setExpandedTemplate(null);
      setTemplateDetalhe(null);
      return;
    }
    setExpandedTemplate(key);
    setTemplateDetalhe(null);
    setDetalheLoading(true);
    try {
      const det = await api.fetchTemplateDetalhe(t.name, t.language);
      setTemplateDetalhe(det);
    } catch {
      setTemplateDetalhe(null);
    } finally {
      setDetalheLoading(false);
    }
  };

  const statusBadge = (status: string) => {
    const s = status?.toUpperCase() ?? "";
    if (s === "APPROVED") return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" />Aprovado</Badge>;
    if (s === "PENDING") return <Badge className="bg-yellow-500 text-white gap-1"><Clock className="h-3 w-3" />Pendente</Badge>;
    if (s === "REJECTED") return <Badge className="bg-red-600 text-white gap-1"><XCircle className="h-3 w-3" />Rejeitado</Badge>;
    if (s === "PAUSED") return <Badge className="bg-gray-500 text-white gap-1"><AlertCircle className="h-3 w-3" />Pausado</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  const headerIcon = (fmt: string) => {
    const f = (fmt ?? "").toUpperCase();
    if (f === "IMAGE") return <Image className="h-4 w-4 text-blue-500" />;
    if (f === "VIDEO") return <Video className="h-4 w-4 text-purple-500" />;
    if (f === "DOCUMENT") return <File className="h-4 w-4 text-orange-500" />;
    return null;
  };

  // ── Create template ─────────────────────────────────────────────────────────

  const updateNovo = (field: string, value: string) =>
    setNovoTemplate((prev) => ({ ...prev, [field]: value }));

  const handleCriarTemplate = async () => {
    setCriarLoading(true);
    try {
      // Lê o estado mais recente para evitar closure stale
      const current = await new Promise<typeof novoTemplate>((resolve) =>
        setNovoTemplate((prev) => { resolve(prev); return prev; })
      );
      console.log("[Disparo] criarTemplate payload:", JSON.stringify(current));
      await api.criarTemplate(current);
      toast.success("Template enviado para aprovação na Meta!");
      setCriarDialogOpen(false);
      setTemplateMediaFile(null);
      setNovoTemplate({
        name: "", category: "MARKETING", language_code: "pt_BR",
        header_type: "NONE", header_text: "", header_media_example_url: "",
        body_text: "", footer_text: "", etiqueta: "",
      });
      api.fetchTemplatesGerenciar().then(setTemplatesGerenciar);
      api.fetchTemplates().then(setTemplates);
      api.fetchTemplateEtiquetas().then(setTemplateEtiquetas);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCriarLoading(false);
    }
  };

  // ── Loading while exchanging token ──────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // ── Main App ────────────────────────────────────────────────────────────────

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      AWAITING_APPROVAL: "Aguardando Aprovação",
      PROCESSING: "Processando",
      COMPLETED: "Concluído",
      PAUSING: "Pausando",
      PAUSED: "Pausado",
      REJECTED: "Negado",
      FAILED: "Falhou",
    };
    return map[s] ?? s;
  };

  const statusColor = (s: string) => {
    if (["COMPLETED"].includes(s)) return "bg-green-500";
    if (["PROCESSING"].includes(s)) return "bg-blue-500 animate-pulse";
    if (["AWAITING_APPROVAL", "PAUSING"].includes(s)) return "bg-yellow-500";
    if (["PAUSED"].includes(s)) return "bg-orange-500";
    if (["REJECTED", "FAILED"].includes(s)) return "bg-red-500";
    return "bg-gray-400";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <button
            onClick={() => navigate("/hub")}
            className="relative h-9 w-36 overflow-hidden"
            title="Ir para o Hub"
          >
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
          </button>
          <div className="h-5 w-px bg-border" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Disparo em Massa
          </span>

          <div className="flex items-center gap-2 ml-auto">
            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-foreground leading-tight">{user.displayName}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary">{user.roleLabel}</span>
              </div>
            )}
            <button
              onClick={() => setDark(d => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="Alternar tema"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Status bar */}
          {disparoId && (
            <Card>
              <CardContent className="py-3 flex items-center gap-4 flex-wrap">
                <Badge className={statusColor(disparoStatus)}>{statusLabel(disparoStatus) || "—"}</Badge>
                <span className="text-sm">Disparo #{disparoId}</span>
                <div className="flex-1 min-w-[200px]">
                  <Progress value={progresso} className="h-2" />
                </div>
                <span className="text-sm font-mono">{progresso}%</span>
                <span className="text-xs text-muted-foreground">{enviados} enviados · {falhas} falhas</span>
                <div className="flex gap-1">
                  {disparoStatus === "PROCESSING" && (
                    <Button size="sm" variant="outline" onClick={handlePausar}><Pause className="h-3 w-3 mr-1" />Pausar</Button>
                  )}
                  {disparoStatus === "PAUSED" && (
                    <Button size="sm" variant="outline" onClick={handleRetomar}><Play className="h-3 w-3 mr-1" />Retomar</Button>
                  )}
                  {(disparoStatus === "PAUSING" || disparoStatus === "PAUSED") && isAdmin && (
                    <Button size="sm" variant="destructive" onClick={handleCancelar}><XCircle className="h-3 w-3 mr-1" />Cancelar</Button>
                  )}
                  {disparoStatus === "AWAITING_APPROVAL" && isAdmin && (
                    <>
                      <Button size="sm" variant="default" onClick={handleAprovar}><Check className="h-3 w-3 mr-1" />Aprovar</Button>
                      <Button size="sm" variant="destructive" onClick={handleNegar}><ShieldX className="h-3 w-3 mr-1" />Negar</Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              <TabsTrigger value="disparos"><Send className="h-4 w-4 mr-1" />Disparos</TabsTrigger>
              <TabsTrigger value="templates"><FileText className="h-4 w-4 mr-1" />Templates</TabsTrigger>
              <TabsTrigger value="logs"><Settings className="h-4 w-4 mr-1" />Logs</TabsTrigger>
            </TabsList>

            {/* ── Tab: Disparos ──────────────────────────────────────────── */}
            <TabsContent value="disparos" className="space-y-4">
              {/* Upload */}
              <Card>
                <CardHeader><CardTitle className="text-base">1. Importar Contatos</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Input type="file" accept=".csv,.xls,.xlsx" className="cursor-pointer" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                  <Button className="cursor-pointer" onClick={handleUpload} disabled={!uploadFile || uploadLoading}>
                    <Upload className="h-4 w-4 mr-2" />{uploadLoading ? "Enviando..." : "Importar Lista"}
                  </Button>
                  {listaId && (
                    <p className="text-sm text-green-600">Lista #{listaId} — {totalContatos} contatos</p>
                  )}
                </CardContent>
              </Card>

              {/* Config */}
              <Card>
                <CardHeader><CardTitle className="text-base">2. Configurar Disparo</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                      <Label>Template</Label>
                      <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={`${t.name}-${t.language_code}`} value={t.name}>
                              {t.name} ({t.language_code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                  {templates.find((t) => t.name === selectedTemplate)?.requires_media && (
                    <div className="space-y-2">
                      <Label>Mídia (imagem/vídeo)</Label>
                      <div className="flex gap-2">
                        <Input type="file" accept="image/*,video/mp4,video/3gpp" className="cursor-pointer" onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)} />
                        <Button variant="outline" onClick={handleUploadMidia} disabled={!mediaFile}>Upload</Button>
                      </div>
                      {mediaUrl && <p className="text-xs text-green-600 break-all">{mediaUrl}</p>}
                    </div>
                  )}

                  <Button onClick={handleDisparar} disabled={!listaId || !selectedTemplate || disparoLoading} className="w-full">
                    <Send className="h-4 w-4 mr-2" />{disparoLoading ? "Iniciando..." : "Iniciar Disparo"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab: Templates ─────────────────────────────────────────── */}
            <TabsContent value="templates">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Templates da Meta</CardTitle>
                    <div className="flex gap-1">
                      <Button size="sm" variant="default" onClick={() => setCriarDialogOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" />Criar Template
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        api.fetchTemplatesGerenciar().then(setTemplatesGerenciar);
                        api.fetchTemplates().then(setTemplates);
                      }}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {templatesGerenciar.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum template encontrado</p>
                  ) : (
                    <div className="space-y-2">
                      {templatesGerenciar.map((t) => {
                        const key = `${t.name}__${t.language}`;
                        const isExpanded = expandedTemplate === key;
                        return (
                          <div key={key} className="rounded border overflow-hidden">
                            <button
                              onClick={() => handleToggleTemplate(t)}
                              className="w-full flex items-center justify-between p-3 text-sm hover:bg-muted/50 transition-colors cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                {headerIcon(t.header_format)}
                                <span className="font-medium truncate">{t.name}</span>
                                <span className="text-muted-foreground shrink-0">({t.language})</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                {templateEtiquetas[t.name] && (
                                  <Badge className="bg-indigo-600 text-white text-xs">{templateEtiquetas[t.name]}</Badge>
                                )}
                                <Badge variant="outline" className="text-xs">{t.category}</Badge>
                                {statusBadge(t.status)}
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="border-t bg-muted/30 p-4 space-y-3">
                                {detalheLoading ? (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando detalhes...
                                  </div>
                                ) : templateDetalhe ? (
                                  <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                      <div>
                                        <span className="text-muted-foreground block">ID</span>
                                        <span className="font-mono">{templateDetalhe.id}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground block">Categoria</span>
                                        <span>{templateDetalhe.category}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground block">Idioma</span>
                                        <span>{templateDetalhe.language_code}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground block">Header</span>
                                        <span className="flex items-center gap-1">{headerIcon(templateDetalhe.header_type)} {templateDetalhe.header_type || "Nenhum"}</span>
                                      </div>
                                    </div>

                                    {templateDetalhe.header_text && (
                                      <div className="space-y-1">
                                        <span className="text-xs font-medium text-muted-foreground">Cabeçalho (Texto)</span>
                                        <div className="bg-background rounded p-2 text-sm border">{templateDetalhe.header_text}</div>
                                      </div>
                                    )}

                                    {templateDetalhe.header_media_example_url && (
                                      <div className="space-y-1">
                                        <span className="text-xs font-medium text-muted-foreground">Mídia de Exemplo</span>
                                        <img src={templateDetalhe.header_media_example_url} alt="Header media" className="max-h-40 rounded border object-contain" />
                                      </div>
                                    )}

                                    {templateDetalhe.body_text && (
                                      <div className="space-y-1">
                                        <span className="text-xs font-medium text-muted-foreground">Corpo</span>
                                        <div className="bg-background rounded p-2 text-sm border whitespace-pre-wrap">{templateDetalhe.body_text}</div>
                                      </div>
                                    )}

                                    {templateDetalhe.footer_text && (
                                      <div className="space-y-1">
                                        <span className="text-xs font-medium text-muted-foreground">Rodapé</span>
                                        <div className="bg-background rounded p-2 text-xs border text-muted-foreground italic">{templateDetalhe.footer_text}</div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground">Não foi possível carregar os detalhes</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab: Logs ──────────────────────────────────────────────── */}
            <TabsContent value="logs">
              <Card>
                <CardHeader><CardTitle className="text-base">Logs em Tempo Real</CardTitle></CardHeader>
                <CardContent>
                  <div className="bg-muted rounded p-3 h-[400px] overflow-y-auto font-mono text-xs space-y-0.5">
                    {logs.length === 0 ? (
                      <p className="text-muted-foreground">Aguardando eventos...</p>
                    ) : (
                      logs.map((line, i) => <div key={i}>{line}</div>)
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* ── Dialog: Criar Template ──────────────────────────────────────── */}
      <Dialog open={criarDialogOpen} onOpenChange={setCriarDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome *</Label>
                <Input
                  placeholder="meu_template"
                  value={novoTemplate.name}
                  onChange={(e) => updateNovo("name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                />
                <span className="text-xs text-muted-foreground">Minúsculas, números e _</span>
              </div>
              <div>
                <Label>Categoria *</Label>
                <Select value={novoTemplate.category} onValueChange={(v) => updateNovo("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utility</SelectItem>
                    <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Idioma</Label>
                <Select value={novoTemplate.language_code} onValueChange={(v) => updateNovo("language_code", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo de Header</Label>
                <Select value={novoTemplate.header_type} onValueChange={(v) => updateNovo("header_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhum</SelectItem>
                    <SelectItem value="TEXT">Texto</SelectItem>
                    <SelectItem value="IMAGE">Imagem</SelectItem>
                    <SelectItem value="VIDEO">Vídeo</SelectItem>
                    <SelectItem value="DOCUMENT">Documento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {novoTemplate.header_type === "TEXT" && (
              <div>
                <Label>Texto do Header *</Label>
                <Input
                  placeholder="Ex: Olá {{1}}!"
                  value={novoTemplate.header_text}
                  onChange={(e) => updateNovo("header_text", e.target.value)}
                />
              </div>
            )}

            {["IMAGE", "VIDEO", "DOCUMENT"].includes(novoTemplate.header_type) && (
              <div className="space-y-2">
                <Label>Mídia de Exemplo *</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="file"
                    accept={novoTemplate.header_type === "VIDEO" ? "video/mp4,video/3gpp" : novoTemplate.header_type === "IMAGE" ? "image/*" : "*/*"}
                    className="cursor-pointer"
                    onChange={(e) => setTemplateMediaFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button" variant="outline" size="sm"
                    disabled={!templateMediaFile || templateMediaUploading}
                    onClick={async () => {
                      if (!templateMediaFile) return;
                      setTemplateMediaUploading(true);
                      try {
                        const r = await api.uploadMidia(templateMediaFile);
                        updateNovo("header_media_example_url", r.media_url);
                        toast.success("Mídia enviada!");
                      } catch (e: any) { toast.error(e.message); }
                      finally { setTemplateMediaUploading(false); }
                    }}
                  >
                    {templateMediaUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
                {novoTemplate.header_media_example_url && (
                  <p className="text-xs text-green-600 break-all">{novoTemplate.header_media_example_url}</p>
                )}
                <span className="text-xs text-muted-foreground">Ou cole uma URL pública:</span>
                <Input
                  placeholder="https://exemplo.com/video.mp4"
                  value={novoTemplate.header_media_example_url}
                  onChange={(e) => updateNovo("header_media_example_url", e.target.value)}
                />
              </div>
            )}

            <div>
              <Label>Corpo da Mensagem *</Label>
              <Textarea
                placeholder={"Olá {{1}}, sua compra #{{2}} foi confirmada!"}
                rows={4}
                value={novoTemplate.body_text}
                onChange={(e) => updateNovo("body_text", e.target.value)}
              />
              <span className="text-xs text-muted-foreground">Use {"{{1}}"}, {"{{2}}"}, etc. para parâmetros dinâmicos</span>
            </div>

            <div>
              <Label>Rodapé (opcional)</Label>
              <Input
                placeholder="Ex: Dovale Indústria"
                value={novoTemplate.footer_text}
                onChange={(e) => updateNovo("footer_text", e.target.value)}
              />
            </div>

            <div>
              <Label>Setor *</Label>
              {etiquetasChatwoot.length > 0 ? (
                <Select value={novoTemplate.etiqueta} onValueChange={(v) => updateNovo("etiqueta", v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione o setor..." /></SelectTrigger>
                  <SelectContent>
                    {etiquetasChatwoot.map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Ex: comercial, marketing, pós-venda"
                  value={novoTemplate.etiqueta}
                  onChange={(e) => updateNovo("etiqueta", e.target.value)}
                />
              )}
              <span className="text-xs text-muted-foreground">Etiqueta do Chatwoot — identifica o setor responsável pelas respostas</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCriarDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCriarTemplate} disabled={criarLoading || !novoTemplate.name || !novoTemplate.body_text || !novoTemplate.etiqueta}>
              {criarLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando...</> : <><Plus className="h-4 w-4 mr-2" />Criar Template</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
