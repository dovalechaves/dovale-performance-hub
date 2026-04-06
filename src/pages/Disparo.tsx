import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { ArrowLeft, Upload, Send, Pause, Play, X, Sun, Moon, FileText, Settings, RefreshCw, Loader2, Check, ShieldX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import * as api from "@/lib/disparo-api";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

export default function Disparo() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("disparos");

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [listaId, setListaId] = useState<number | null>(null);
  const [totalContatos, setTotalContatos] = useState(0);

  // Templates
  const [templates, setTemplates] = useState<api.TemplateMeta[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
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
          setReady(true);
          return;
        }
        await api.exchangeHubToken(user.usuario, user.displayName);
        setReady(true);
      } catch {
        toast.error("Falha ao autenticar no módulo de disparo");
        navigate("/hub");
      }
    };
    exchange();
  }, [user, navigate]);

  // Socket.IO connection
  useEffect(() => {
    if (!ready) return;
    const socket = io(api.getSocketUrl(), { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => addLog("Socket conectado"));
    socket.on("disconnect", () => addLog("Socket desconectado"));
    socket.on("status_disparo", (data: any) => {
      addLog(`Status disparo ${data.id}: ${data.status}`);
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
    api.fetchTemplates().then(setTemplates).catch(() => {});
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
      addLog(`Lista importada: ${r.total} contatos (ID ${r.lista_id})`);
      toast.success(`${r.total} contatos importados!`);
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

  // ── Loading while exchanging token ──────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // ── Main App ────────────────────────────────────────────────────────────────

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
                <Badge className={statusColor(disparoStatus)}>{disparoStatus || "—"}</Badge>
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
                  {disparoStatus === "AWAITING_APPROVAL" && (
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
                        <Input type="file" accept="image/*" className="cursor-pointer" onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)} />
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
                    <Button size="sm" variant="ghost" onClick={() => api.fetchTemplates().then(setTemplates)}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {templates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum template encontrado</p>
                  ) : (
                    <div className="space-y-2">
                      {templates.map((t) => (
                        <div key={`${t.id}`} className="flex items-center justify-between p-2 rounded border text-sm">
                          <div>
                            <span className="font-medium">{t.name}</span>
                            <span className="text-muted-foreground ml-2">({t.language_code})</span>
                          </div>
                          <div className="flex gap-2">
                            {t.requires_media && <Badge variant="outline">Mídia</Badge>}
                            {t.body_params_count > 0 && <Badge variant="secondary">{t.body_params_count} params</Badge>}
                          </div>
                        </div>
                      ))}
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
    </div>
  );
}
