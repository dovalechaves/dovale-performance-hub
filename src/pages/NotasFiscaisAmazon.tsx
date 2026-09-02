import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Sun,
  Moon,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

interface NotaFiscal {
  ChaveAcesso: string;
  NumeroPedidoAmazon: string | null;
  Numero: string | null;
  Serie: string | null;
  DataEmissao: string | null;
  ValorTotal: number | null;
  Situacao: string;
  DataImportacao: string;
}

interface ResultadoImportacao {
  totalArquivosXml: number;
  notasNovas: number;
  notasDuplicadas: number;
  cancelamentosAplicados: number;
  enviadasParaRelatorioEcommerce: number;
  erros: { arquivo: string; motivo: string }[];
}

type ColunaOrdenavel = "DataEmissao" | "ValorTotal" | "DataImportacao";
interface Ordenacao {
  campo: ColunaOrdenavel;
  direcao: "asc" | "desc";
}

const LIMITE_POR_PAGINA = 25;

export default function NotasFiscaisAmazon() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoImportacao | null>(null);
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [ordenacao, setOrdenacaoState] = useState<Ordenacao>({ campo: "DataImportacao", direcao: "desc" });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const carregar = useCallback((termo: string | undefined, paginaAtual: number, ord: Ordenacao) => {
    setCarregando(true);
    const params = new URLSearchParams({
      pagina: String(paginaAtual),
      limite: String(LIMITE_POR_PAGINA),
      ordenarPor: ord.campo,
      direcao: ord.direcao,
    });
    if (termo) params.set("busca", termo);

    fetch(`${API_BASE}/notas-fiscais-amazon?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error(data?.erro || "Falha ao carregar notas.");
        }
        return r.json();
      })
      .then((data: { dados: NotaFiscal[]; total: number }) => {
        setNotas(data.dados ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((err: Error) => toast.error(err.message || "Falha ao carregar notas."))
      .finally(() => setCarregando(false));
  }, []);

  // Busca com debounce — sempre volta pra página 1 (uma busca nova invalida a página atual)
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      carregar(busca || undefined, 1, ordenacao);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  // Recarrega quando a página ou a ordenação mudam (sem debounce, é ação direta do usuário)
  useEffect(() => {
    carregar(busca || undefined, pagina, ordenacao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, ordenacao]);

  const alternarOrdenacao = (campo: ColunaOrdenavel) => {
    setPagina(1);
    setOrdenacaoState((atual) =>
      atual.campo === campo
        ? { campo, direcao: atual.direcao === "asc" ? "desc" : "asc" }
        : { campo, direcao: "desc" }
    );
  };

  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE_POR_PAGINA));

  const enviarArquivo = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Envie um arquivo .zip exportado do Faturador da Amazon (Reports > Faturador).");
      return;
    }
    setEnviando(true);
    setUltimoResultado(null);
    const form = new FormData();
    form.append("arquivo", file);

    fetch(`${API_BASE}/notas-fiscais-amazon/importar`, {
      method: "POST",
      headers: user ? { "X-Dovale-Usuario": user.usuario } : undefined,
      body: form,
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.erro || "Falha ao importar o arquivo.");
        return data as ResultadoImportacao;
      })
      .then((resultado) => {
        setUltimoResultado(resultado);
        toast.success(`Importação concluída: ${resultado.notasNovas} nova(s), ${resultado.notasDuplicadas} já existiam.`);
        setPagina(1);
        carregar(busca || undefined, 1, ordenacao);
      })
      .catch((err: Error) => toast.error(err.message || "Falha ao importar o arquivo."))
      .finally(() => setEnviando(false));
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setArrastando(false);
    const file = e.dataTransfer.files?.[0];
    if (file) enviarArquivo(file);
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) enviarArquivo(file);
    e.target.value = "";
  };

  const formatarData = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
  };

  const formatarValor = (v: number | null) =>
    v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-gradient-card shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
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
            <FileText className="w-5 h-5 text-blue-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">NOTAS FISCAIS AMAZON</h1>
              <p className="text-[10px] font-mono text-muted-foreground">FBA Classic · Importação manual do Faturador</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}
            <button
              onClick={() => setDark((d) => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-8 space-y-6">
          {/* Upload */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Importar notas do Faturador</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  No Seller Central, vá em <span className="font-medium">Reports → Faturador</span>, filtre o período
                  desejado e baixe o ZIP com os XMLs. Depois arraste o arquivo aqui — notas já importadas (mesma
                  chave de acesso) são ignoradas automaticamente, sem duplicar. O ZIP traz outros tipos de documento
                  além de venda (remessa e retorno simbólico para o CD da Amazon, devolução) — eles são guardados no
                  banco, mas não aparecem na lista abaixo, que mostra só as vendas.
                </p>
              </div>

              <label
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={() => setArrastando(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                  arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                <input type="file" accept=".zip" className="hidden" onChange={onSelectFile} disabled={enviando} />
                {enviando ? (
                  <>
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Importando notas fiscais...</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-foreground font-medium">Arraste o ZIP aqui ou clique para selecionar</p>
                    <p className="text-xs text-muted-foreground">Apenas arquivos .zip do Faturador Amazon</p>
                  </>
                )}
              </label>

              {ultimoResultado && (
                <div className="grid gap-3 sm:grid-cols-5">
                  <ResumoCard icon={<FileText className="w-4 h-4" />} label="XMLs no ZIP" value={ultimoResultado.totalArquivosXml} />
                  <ResumoCard icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Novas" value={ultimoResultado.notasNovas} />
                  <ResumoCard icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} label="Já existiam" value={ultimoResultado.notasDuplicadas} />
                  <ResumoCard icon={<UploadCloud className="w-4 h-4 text-blue-500" />} label="Enviadas p/ relatório" value={ultimoResultado.enviadasParaRelatorioEcommerce} />
                  <ResumoCard icon={<XCircle className="w-4 h-4 text-destructive" />} label="Com erro" value={ultimoResultado.erros.length} />
                </div>
              )}

              {ultimoResultado && ultimoResultado.erros.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  {ultimoResultado.erros.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">
                      <span className="font-mono">{e.arquivo}</span>: {e.motivo}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lista */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <FileText className="h-4 w-4" /> Notas importadas
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Chave de acesso, pedido ou número..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => carregar(busca || undefined, pagina, ordenacao)} disabled={carregando}>
                    <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chave de acesso</TableHead>
                      <TableHead>Pedido Amazon</TableHead>
                      <TableHead>Número/Série</TableHead>
                      <SortableHead campo="DataEmissao" ordenacao={ordenacao} onOrdenar={alternarOrdenacao}>Emissão</SortableHead>
                      <SortableHead campo="ValorTotal" ordenacao={ordenacao} onOrdenar={alternarOrdenacao}>Valor</SortableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Importada em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {carregando ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : notas.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                          Nenhuma nota importada ainda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      notas.map((n) => (
                        <TableRow key={n.ChaveAcesso}>
                          <TableCell className="font-mono text-[11px]">{n.ChaveAcesso}</TableCell>
                          <TableCell className="text-xs">{n.NumeroPedidoAmazon ?? "—"}</TableCell>
                          <TableCell className="text-xs">{n.Numero ?? "—"}{n.Serie ? `/${n.Serie}` : ""}</TableCell>
                          <TableCell className="text-xs">{formatarData(n.DataEmissao)}</TableCell>
                          <TableCell className="text-xs">{formatarValor(n.ValorTotal)}</TableCell>
                          <TableCell>
                            <Badge variant={n.Situacao === "CANCELADA" ? "destructive" : "secondary"} className="text-[10px]">
                              {n.Situacao}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{formatarData(n.DataImportacao)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{total} nota(s) no total</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={pagina <= 1 || carregando} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span>Página {pagina} de {totalPaginas}</span>
                  <Button variant="outline" size="sm" disabled={pagina >= totalPaginas || carregando} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function SortableHead({
  campo,
  ordenacao,
  onOrdenar,
  children,
}: {
  campo: ColunaOrdenavel;
  ordenacao: Ordenacao;
  onOrdenar: (campo: ColunaOrdenavel) => void;
  children: React.ReactNode;
}) {
  const ativo = ordenacao.campo === campo;
  return (
    <TableHead>
      <button
        onClick={() => onOrdenar(campo)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${ativo ? "text-foreground font-semibold" : ""}`}
      >
        {children}
        {ativo ? (
          ordenacao.direcao === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

function ResumoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center gap-3">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-lg font-bold text-foreground leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}
