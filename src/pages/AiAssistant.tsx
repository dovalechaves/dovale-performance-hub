import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Sun, Moon, Send, RotateCcw, Copy, Download, Loader2,
  CheckCircle2, Bot, User, MessageSquare, FolderOpen, Clock, ChevronLeft,
  FileCheck, AlertCircle, SendHorizonal, Calendar, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

interface Message {
  role: "user" | "bot";
  content: string;
  timestamp: string;
}

interface ChatState {
  conversationId: string | null;
  messages: Message[];
  completed: boolean;
  prd: string | null;
  stage: number;
  totalStages: number;
}

type View = "chat" | "projects" | "detail";

interface Project {
  id: number;
  conversation_id: string;
  usuario: string;
  display_name: string;
  titulo: string;
  status: string;
  prd_content: string;
  prazo_entrega: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
  created_at: string;
  updated_at: string;
  comments?: Comment[];
  trello_card_id?: string;
  trello_url?: string;
  trello_status?: { list: string; board: string } | null;
}

interface Comment {
  id: number;
  request_id: number;
  usuario: string;
  display_name: string;
  content: string;
  tipo: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  em_analise_ti: { label: "Em Analise TI", color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30", icon: Clock },
  feedback_ti: { label: "Feedback TI", color: "bg-orange-500/15 text-orange-600 border-orange-500/30", icon: AlertCircle },
  aprovado: { label: "Aprovado", color: "bg-green-500/15 text-green-600 border-green-500/30", icon: CheckCircle2 },
};

export default function AiAssistant() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState<ChatState>({
    conversationId: null,
    messages: [],
    completed: false,
    prd: null,
    stage: 0,
    totalStages: 8,
  });

  const [view, setView] = useState<View>("chat");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [submitTitle, setSubmitTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [prazoDate, setPrazoDate] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isIT = user?.apps.assistente.role === "admin" || user?.apps.assistente.role === "manager";
  const isOwner = (p: Project | null) => p?.usuario === user?.usuario;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading, chat.messages]);

  // Start conversation on mount
  useEffect(() => {
    startConversation();
  }, []);

  const startConversation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/ai-assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: user?.usuario }),
      });
      const data = await res.json();
      setChat({
        conversationId: data.conversation_id,
        messages: data.messages ?? [],
        completed: data.completed ?? false,
        prd: data.prd ?? null,
        stage: data.stage ?? 0,
        totalStages: data.totalStages ?? 8,
      });
    } catch {
      setChat((prev) => ({
        ...prev,
        messages: [{ role: "bot", content: "Erro ao iniciar conversa. Tente novamente.", timestamp: new Date().toISOString() }],
      }));
    } finally {
      setLoading(false);
    }
  }, [user]);

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading || chat.completed) return;

    setInput("");
    setLoading(true);

    // Optimistic user message
    setChat((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: "user", content: msg, timestamp: new Date().toISOString() }],
    }));

    try {
      const res = await fetch(`${BASE}/ai-assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: chat.conversationId,
          message: msg,
          usuario: user?.usuario,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setChat({
        conversationId: data.conversation_id,
        messages: data.messages ?? [],
        completed: data.completed ?? false,
        prd: data.prd ?? null,
        stage: data.stage ?? 0,
        totalStages: data.totalStages ?? 8,
      });
    } catch (err: any) {
      setChat((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: "bot", content: `Erro: ${err.message || "Falha ao processar mensagem."}`, timestamp: new Date().toISOString() },
        ],
      }));
    } finally {
      setLoading(false);
    }
  }, [input, loading, chat.conversationId, chat.completed, user]);

  const handleRestart = useCallback(async () => {
    setLoading(true);
    setCopied(false);
    try {
      const res = await fetch(`${BASE}/ai-assistant/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: chat.conversationId, usuario: user?.usuario }),
      });
      const data = await res.json();
      setChat({
        conversationId: data.conversation_id,
        messages: data.messages ?? [],
        completed: false,
        prd: null,
        stage: 0,
        totalStages: data.totalStages ?? 8,
      });
      setInput("");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [chat.conversationId, user]);

  const handleCopy = useCallback(() => {
    if (chat.prd) {
      navigator.clipboard.writeText(chat.prd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [chat.prd]);

  const handleExport = useCallback(async () => {
    if (!chat.conversationId) return;
    try {
      const res = await fetch(`${BASE}/ai-assistant/export/${chat.conversationId}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `requisitos-${chat.conversationId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, [chat.conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const role = isIT ? "admin" : "viewer";
      const res = await fetch(`${BASE}/ai-assistant/projects?usuario=${user?.usuario}&role=${role}`);
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* ignore */ } finally { setProjectsLoading(false); }
  }, [user, isIT]);

  const openProject = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${BASE}/ai-assistant/projects/${id}`);
      const data = await res.json();
      if (data.error) return;
      setSelectedProject(data);
      setView("detail");
      setCommentText("");
      setFeedbackText("");
      setPrazoDate("");
    } catch { /* ignore */ }
  }, []);

  const submitProject = useCallback(async () => {
    if (!chat.prd || !user || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/ai-assistant/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: chat.conversationId,
          usuario: user.usuario,
          display_name: user.displayName,
          titulo: submitTitle || "Novo Requisito",
          prd_content: chat.prd,
        }),
      });
      const data = await res.json();
      if (data.id) {
        await fetchProjects();
        await openProject(data.id);
      }
    } catch { /* ignore */ } finally { setSubmitting(false); }
  }, [chat, user, submitTitle, submitting, fetchProjects, openProject]);

  const changeStatus = useCallback(async (projectId: number, status: string, comment?: string) => {
    if (!user) return;
    setSubmitting(true);
    try {
      await fetch(`${BASE}/ai-assistant/projects/${projectId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          usuario: user.usuario,
          display_name: user.displayName,
          comment,
          prazo_entrega: status === "aprovado" && prazoDate ? prazoDate : undefined,
        }),
      });
      await openProject(projectId);
      await fetchProjects();
    } catch { /* ignore */ } finally { setSubmitting(false); }
  }, [user, prazoDate, openProject, fetchProjects]);

  const addComment = useCallback(async (projectId: number) => {
    if (!user || !commentText.trim()) return;
    try {
      await fetch(`${BASE}/ai-assistant/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: user.usuario,
          display_name: user.displayName,
          content: commentText.trim(),
        }),
      });
      setCommentText("");
      await openProject(projectId);
    } catch { /* ignore */ }
  }, [user, commentText, openProject]);

  useEffect(() => { if (view === "projects") fetchProjects(); }, [view, fetchProjects]);

  const progress = chat.totalStages > 0 ? Math.round((chat.stage / chat.totalStages) * 100) : 0;

  const generatePDF = (proj: Project) => {
    const w = window.open("", "_blank");
    if (!w) return;

    const prd = proj.prd_content || "";
    const solicitante = proj.display_name || proj.usuario;
    const dataAprovacao = proj.aprovado_em ? new Date(proj.aprovado_em).toLocaleDateString("pt-BR") : "—";
    const dataCriacao = new Date(proj.created_at).toLocaleDateString("pt-BR");
    const prazo = proj.prazo_entrega ? new Date(proj.prazo_entrega).toLocaleDateString("pt-BR") : "—";
    const aprovador = proj.aprovado_por || "—";

    const parseSections = (text: string) => {
      const lines = text.split("\n");
      let html = "";
      let inList = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { if (inList) { html += "</ul>"; inList = false; } html += "<br/>"; continue; }
        if (trimmed.startsWith("# ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h1 class="sec-title">${trimmed.slice(2)}</h1>`; continue; }
        if (trimmed.startsWith("## ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h2 class="sec-subtitle">${trimmed.replace(/^##\s*/, "")}</h2>`; continue; }
        if (trimmed.startsWith("### ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h3 class="sec-sub2">${trimmed.replace(/^###\s*/, "")}</h3>`; continue; }
        if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
          if (!inList) { html += '<ul class="checklist">'; inList = true; }
          const checked = trimmed.startsWith("- [x]");
          html += `<li>${checked ? "☑" : "☐"} ${trimmed.slice(6)}</li>`;
          continue;
        }
        if (trimmed.startsWith("- ")) {
          if (!inList) { html += "<ul>"; inList = true; }
          html += `<li>${trimmed.slice(2)}</li>`;
          continue;
        }
        if (inList) { html += "</ul>"; inList = false; }
        html += `<p>${trimmed}</p>`;
      }
      if (inList) html += "</ul>";
      return html;
    };

    const prdHtml = parseSections(prd);

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Documento de Requisitos: ${proj.titulo}</title>
<style>
  @page { margin: 20mm 18mm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.55; }
  .header { background: linear-gradient(135deg, #0d3b66 0%, #1a5276 100%); color: #fff; padding: 28px 32px; margin-bottom: 0; }
  .header h1 { font-size: 20pt; font-weight: 700; margin: 0; letter-spacing: -0.3px; }
  .header .subtitle { font-size: 10pt; opacity: .75; margin-top: 4px; }
  .form-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  .form-table td, .form-table th { border: 1px solid #ccc; padding: 7px 12px; font-size: 10pt; }
  .form-table th { background: #f0f4f8; font-weight: 600; text-align: left; width: 170px; color: #2c3e50; }
  .form-table td { color: #333; }
  .sec-title { font-size: 15pt; font-weight: 700; color: #0d3b66; margin: 24px 0 8px 0; padding-bottom: 4px; border-bottom: 2.5px solid #0d3b66; }
  .sec-subtitle { font-size: 12pt; font-weight: 600; color: #1a5276; margin: 18px 0 6px 0; }
  .sec-sub2 { font-size: 11pt; font-weight: 600; color: #2c3e50; margin: 14px 0 4px 0; }
  ul { margin: 4px 0 8px 22px; }
  li { margin: 3px 0; }
  ul.checklist { list-style: none; margin-left: 8px; }
  ul.checklist li { margin: 4px 0; }
  p { margin: 4px 0; }
  .content { padding: 24px 32px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1.5px solid #ccc; font-size: 9pt; color: #888; }
  .badge { display: inline-block; background: #27ae60; color: #fff; font-size: 9pt; font-weight: 600; padding: 2px 10px; border-radius: 10px; }
  @media print { .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div class="header">
    <h1>Documento de Requisitos: ${proj.titulo}</h1>
    <div class="subtitle">Dovale Performance Hub &mdash; AI Requirement Assistant</div>
  </div>
  <div class="content">
    <table class="form-table">
      <tr><th>Solicitante</th><td>${solicitante}</td></tr>
      <tr><th>Data da Solicitação</th><td>${dataCriacao}</td></tr>
      <tr><th>Status</th><td><span class="badge">Aprovado</span></td></tr>
      <tr><th>Aprovado por</th><td>${aprovador} em ${dataAprovacao}</td></tr>
      <tr><th>Prazo de Entrega</th><td>${prazo}</td></tr>
    </table>
    ${prdHtml}
    <div class="footer">
      Gerado automaticamente pelo Dovale AI Assistant em ${new Date().toLocaleString("pt-BR")}
    </div>
  </div>
</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

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
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-0 scale-90 blur-sm rotate-3" : "opacity-100 scale-100 blur-0 rotate-0"}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-100 scale-100 blur-0 rotate-0" : "opacity-0 scale-90 blur-sm -rotate-3"}`} />
          </button>
          <div className="h-5 w-px bg-border" />

          {/* Tabs */}
          <div className="flex items-center gap-1">
            <button onClick={() => setView("chat")} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === "chat" ? "bg-cyan-500/15 text-cyan-600" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              <MessageSquare className="w-3.5 h-3.5" /> Nova Solicitacao
            </button>
            <button onClick={() => setView("projects")} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === "projects" ? "bg-cyan-500/15 text-cyan-600" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              <FolderOpen className="w-3.5 h-3.5" /> Projetos
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {view === "chat" && !chat.completed && chat.messages.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-cyan-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">{chat.stage}/{chat.totalStages}</span>
              </div>
            )}
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* ─── CHAT VIEW ─── */}
        {view === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="container mx-auto max-w-3xl px-4 py-6 space-y-4">
                {chat.messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "bot" && (<div className="shrink-0 w-8 h-8 rounded-full bg-cyan-500/15 flex items-center justify-center"><Bot className="w-4 h-4 text-cyan-500" /></div>)}
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted text-foreground rounded-bl-md"}`}>
                      {renderContent(msg.content)}
                    </div>
                    {msg.role === "user" && (<div className="shrink-0 w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>)}
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3 justify-start">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-cyan-500/15 flex items-center justify-center"><Bot className="w-4 h-4 text-cyan-500" /></div>
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {chat.completed && (
              <div className="border-t border-border bg-gradient-card">
                <div className="container mx-auto max-w-3xl px-4 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input type="text" value={submitTitle} onChange={(e) => setSubmitTitle(e.target.value)} placeholder="Titulo do projeto (ex: Automacao de pedidos)" className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={submitProject} disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-600 transition-colors disabled:opacity-40">
                      {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
                      Aprovar e Enviar para TI
                    </button>
                    <button onClick={handleRestart} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
                      <RotateCcw className="w-3.5 h-3.5" /> Nova conversa
                    </button>
                    <button onClick={handleCopy} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
                      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copiado!" : "Copiar PRD"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!chat.completed && (
              <div className="border-t border-border bg-gradient-card shrink-0">
                <div className="container mx-auto max-w-3xl px-4 py-3">
                  <div className="flex items-end gap-2">
                    <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Digite sua resposta..." disabled={loading} rows={1}
                      className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-40 max-h-32"
                      style={{ minHeight: "44px" }}
                      onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 128) + "px"; }}
                    />
                    <button onClick={sendMessage} disabled={loading || !input.trim()} className="w-10 h-10 rounded-xl bg-cyan-500 text-white flex items-center justify-center hover:bg-cyan-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[9px]">Enter</kbd> enviar · <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[9px]">Shift+Enter</kbd> quebrar linha
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── PROJECTS LIST VIEW ─── */}
        {view === "projects" && !selectedProject && (
          <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto max-w-5xl px-4 py-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">{isIT ? "Todos os Projetos" : "Meus Projetos"}</h2>
                <button onClick={fetchProjects} disabled={projectsLoading} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                  <RotateCcw className={`w-3.5 h-3.5 ${projectsLoading ? "animate-spin" : ""}`} /> Atualizar
                </button>
              </div>

              {projectsLoading && projects.length === 0 ? (
                <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
              ) : projects.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">Nenhum projeto encontrado.</div>
              ) : (
                <div className="space-y-2">
                  {projects.map((p) => {
                    const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG.em_analise_ti;
                    const Icon = sc.icon;
                    return (
                      <button key={p.id} onClick={() => openProject(p.id)} className="w-full text-left rounded-xl border border-border bg-gradient-card p-4 hover:border-cyan-500/40 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-foreground truncate">{p.titulo}</h3>
                            <p className="text-[11px] text-muted-foreground mt-1">por {p.display_name} · {new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border shrink-0 ${sc.color}`}>
                            <Icon className="w-3 h-3" /> {sc.label}
                          </span>
                        </div>
                        {p.prazo_entrega && (
                          <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                            <Calendar className="w-3 h-3" /> Prazo: {new Date(p.prazo_entrega).toLocaleDateString("pt-BR")}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── PROJECT DETAIL VIEW ─── */}
        {(view === "detail" || (view === "projects" && selectedProject)) && selectedProject && (
          <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto max-w-4xl px-4 py-6 space-y-6">
              {/* Back + title */}
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedProject(null); setView("projects"); }} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground truncate">{selectedProject.titulo}</h2>
                  <p className="text-[11px] text-muted-foreground">por {selectedProject.display_name} · {new Date(selectedProject.created_at).toLocaleDateString("pt-BR")}</p>
                </div>
                {(() => { const sc = STATUS_CONFIG[selectedProject.status] || STATUS_CONFIG.em_analise_ti; const Icon = sc.icon; return (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${sc.color}`}><Icon className="w-3.5 h-3.5" /> {sc.label}</span>
                ); })()}
              </div>

              {/* Trello status */}
              {selectedProject.trello_status && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 14H5V7h7v10zm8-4h-6V7h6v6z"/></svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Trello: <span className="text-blue-500">{selectedProject.trello_status.list}</span></p>
                      <p className="text-[10px] text-muted-foreground">{selectedProject.trello_status.board}</p>
                    </div>
                  </div>
                  {selectedProject.trello_url && (
                    <a href={selectedProject.trello_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-600 transition-colors">
                      <ExternalLink className="w-3 h-3" /> Abrir no Trello
                    </a>
                  )}
                </div>
              )}

              {/* PRD content */}
              <div className="rounded-xl border border-border bg-muted/30 p-6">
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {renderContent(selectedProject.prd_content || "")}
                </div>
              </div>

              {/* Action buttons based on status + role */}
              {selectedProject.status === "em_analise_ti" && (isIT || !isOwner(selectedProject)) && (
                <div className="rounded-xl border border-border bg-gradient-card p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Acao do TI</h3>
                  <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Comentario opcional (obrigatorio para feedback)..." rows={3} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none" />
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-[11px] text-muted-foreground whitespace-nowrap">Prazo:</label>
                      <input type="date" value={prazoDate} onChange={(e) => setPrazoDate(e.target.value)} className="rounded-lg border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50" />
                    </div>
                    <button onClick={() => changeStatus(selectedProject.id, "aprovado", feedbackText || undefined)} disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-40">
                      {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />} Aprovar
                    </button>
                    <button onClick={() => { if (!feedbackText.trim()) return alert("Escreva o feedback antes de enviar."); changeStatus(selectedProject.id, "feedback_ti", feedbackText); }} disabled={submitting || !feedbackText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-40">
                      <AlertCircle className="w-3.5 h-3.5" /> Enviar Feedback
                    </button>
                  </div>
                </div>
              )}

              {selectedProject.status === "feedback_ti" && isOwner(selectedProject) && (
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-orange-600">O TI enviou feedback — responda abaixo</h3>
                  <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Sua resposta ao feedback do TI..." rows={3} className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none" />
                  <button onClick={() => { if (!feedbackText.trim()) return; changeStatus(selectedProject.id, "em_analise_ti", feedbackText); }} disabled={submitting || !feedbackText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-600 transition-colors disabled:opacity-40">
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />} Enviar para TI
                  </button>
                </div>
              )}

              {selectedProject.status === "aprovado" && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-sm font-semibold">Projeto Aprovado</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Aprovado por {selectedProject.aprovado_por} em {selectedProject.aprovado_em ? new Date(selectedProject.aprovado_em).toLocaleDateString("pt-BR") : "—"}
                    {selectedProject.prazo_entrega && ` · Prazo: ${new Date(selectedProject.prazo_entrega).toLocaleDateString("pt-BR")}`}
                  </p>
                  <button onClick={() => generatePDF(selectedProject)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                    <Download className="w-3.5 h-3.5" /> Gerar PDF
                  </button>
                </div>
              )}

              {/* Comments thread */}
              {selectedProject.comments && selectedProject.comments.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Historico</h3>
                  {selectedProject.comments.map((c) => {
                    const tipoColors: Record<string, string> = { sistema: "border-l-muted-foreground", aprovacao: "border-l-green-500", feedback: "border-l-orange-500", comentario: "border-l-cyan-500", status: "border-l-yellow-500" };
                    return (
                      <div key={c.id} className={`border-l-2 ${tipoColors[c.tipo] || "border-l-border"} pl-4 py-2`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{c.display_name}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</span>
                        </div>
                        <div className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap">{renderContent(c.content)}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add comment */}
              {!["aprovado"].includes(selectedProject.status) && (
                <div className="flex items-end gap-2">
                  <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Adicionar comentario..." rows={2} className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none" />
                  <button onClick={() => addComment(selectedProject.id)} disabled={!commentText.trim()} className="w-9 h-9 rounded-lg bg-cyan-500 text-white flex items-center justify-center hover:bg-cyan-600 transition-colors disabled:opacity-40 shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** Simple markdown-like rendering for bold */
function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}
