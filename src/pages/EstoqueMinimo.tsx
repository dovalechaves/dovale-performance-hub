import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface ProdutoAbaixoMinimo {
  codigo: string;
  descricao: string;
  categoria: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  diferenca: number;
}

export default function EstoqueMinimo() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [itens, setItens] = useState<ProdutoAbaixoMinimo[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const carregar = () => {
    setCarregando(true);
    fetch(`${API_BASE}/estoque-minimo/produtos`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error(data?.error || "Falha ao carregar produtos.");
        }
        return r.json();
      })
      .then((data: ProdutoAbaixoMinimo[]) => {
        setItens(data);
        setUltimaAtualizacao(new Date());
      })
      .catch((err: Error) => toast.error(err.message || "Falha ao carregar produtos."))
      .finally(() => setCarregando(false));
  };

  const atualizar = () => {
    setCarregando(true);
    toast.info("Consultando estoque atual na base SJC — isso pode levar até 1 minuto...");
    fetch(`${API_BASE}/estoque-minimo/produtos/atualizar`, { method: "POST" })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error(data?.error || "Falha ao atualizar produtos.");
        }
        return r.json();
      })
      .then((data: ProdutoAbaixoMinimo[]) => {
        setItens(data);
        setUltimaAtualizacao(new Date());
        toast.success("Estoque atualizado com sucesso!");
      })
      .catch((err: Error) => toast.error(err.message || "Falha ao atualizar produtos."))
      .finally(() => setCarregando(false));
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itensFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(
      (i) =>
        i.descricao.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.categoria.toLowerCase().includes(q)
    );
  }, [itens, busca]);

  const totalFaltante = useMemo(
    () => itens.reduce((s, i) => s + Math.max(0, i.diferenca), 0),
    [itens]
  );

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
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">ESTOQUE MÍNIMO</h1>
              <p className="text-[10px] font-mono text-muted-foreground">Integração Microsys · Base SJC</p>
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
          {/* Filtros */}
          <Card>
            <CardContent className="p-5 grid gap-4 md:grid-cols-[2fr_auto] items-end">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5" /> Buscar item
                </label>
                <Input
                  placeholder="Código, descrição ou categoria..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <Button onClick={atualizar} disabled={carregando} variant="outline" className="h-9">
                {carregando ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Atualizando...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />Atualizar agora</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Produtos abaixo do mínimo"
              value={String(itens.length)}
              hint="Base SJC · filial 1"
              highlight={itens.length > 0}
            />
            <KpiCard
              icon={<Package className="h-4 w-4" />}
              label="Unidades faltantes"
              value={totalFaltante.toLocaleString("pt-BR")}
              hint="Soma da diferença (mínimo − atual)"
            />
            <KpiCard
              icon={<RefreshCw className="h-4 w-4" />}
              label="Última atualização"
              value={ultimaAtualizacao ? ultimaAtualizacao.toLocaleTimeString("pt-BR") : "—"}
              hint={ultimaAtualizacao ? ultimaAtualizacao.toLocaleDateString("pt-BR") : "Aguardando consulta"}
            />
          </div>

          {/* Tabela */}
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 bg-muted/30">
              <div>
                <CardTitle className="text-base">Produtos abaixo do estoque mínimo</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Ordenado pelos mais críticos primeiro (maior diferença entre mínimo e atual).
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableHead className="w-28">Código</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Estoque atual</TableHead>
                      <TableHead className="text-right">Estoque mínimo</TableHead>
                      <TableHead className="text-right w-32">Faltam</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {carregando && itens.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-56 text-center">
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Consultando estoque na base SJC...</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : itensFiltrados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                          {itens.length === 0
                            ? "Nenhum produto abaixo do estoque mínimo no momento."
                            : `Nenhum item encontrado para "${busca}".`}
                        </TableCell>
                      </TableRow>
                    ) : (
                      itensFiltrados.map((i) => (
                        <TableRow key={i.codigo}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{i.codigo}</TableCell>
                          <TableCell>
                            <div className="font-medium">{i.descricao}</div>
                            <div className="text-xs text-muted-foreground">{i.categoria}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{i.estoqueAtual}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {i.estoqueMinimo}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="destructive" className="font-mono">
                              {Math.max(0, i.diferenca)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "bg-destructive text-destructive-foreground border-transparent" : ""}>
      <CardContent className="p-5">
        <div className={`flex items-center gap-2 text-xs font-medium ${highlight ? "text-destructive-foreground/80" : "text-muted-foreground"}`}>
          {icon}
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className={`mt-1 text-xs ${highlight ? "text-destructive-foreground/70" : "text-muted-foreground"}`}>
          {hint}
        </div>
      </CardContent>
    </Card>
  );
}
