import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Store,
  Calendar,
  Search,
  RotateCcw,
  TrendingUp,
  Package,
  ShoppingCart,
  Loader2,
  Download,
  ArrowLeft,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge"; // usado nas linhas da tabela (sugestão)
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import * as XLSX from "xlsx";
import { API_BASE } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

type Periodo = 30 | 90 | 180;

interface Loja {
  id: string;
  nome: string;
}

interface SugestaoItem {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string;
  estoqueAtual: number;
  estoqueSjc: number;
  mediaDiaria: number;
  sugestao30: number;
  sugestao90: number;
  sugestao180: number;
  precoUnitario: number;
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function SugestaoCompras() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaId, setLojaId] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [busca, setBusca] = useState("");
  const [ajustes, setAjustes] = useState<Record<string, number>>({});
  const [itens, setItens] = useState<SugestaoItem[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [alerta, setAlerta] = useState<{
    aberto: boolean;
    titulo: string;
    itens: { id: string; codigo: string; solicitado: number; disponivelSjc: number; disponivelMg: number }[];
  }>({ aberto: false, titulo: "", itens: [] });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    fetch(`${API_BASE}/sugestao-compras/lojas`)
      .then((r) => r.json())
      .then((data: Loja[]) => {
        setLojas(data);
        if (data.length > 0) setLojaId(data[0].id);
      })
      .catch(() => toast.error("Falha ao carregar lojas."));
  }, []);

  const consultarBanco = async () => {
    if (!lojaId) { toast.warning("Selecione uma loja primeiro."); return; }
    setCarregando(true);
    try {
      const r = await fetch(`${API_BASE}/sugestao-compras/sugestoes?loja=${lojaId}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).error || "Erro ao buscar dados do servidor");
      }
      const data: SugestaoItem[] = await r.json();
      setItens(data);
      setSelecionados(new Set(data.slice(0, 100).map((i) => i.id)));
      setAjustes({});
      toast.success("Consulta finalizada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Falha ao carregar sugestões.");
    } finally {
      setCarregando(false);
    }
  };

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

  const qtdSugerida = (i: SugestaoItem) =>
    periodo === 30 ? i.sugestao30 : periodo === 90 ? i.sugestao90 : i.sugestao180;

  const qtdFinal = (i: SugestaoItem) => ajustes[i.id] ?? qtdSugerida(i);

  const totais = useMemo(() => {
    const ativos = itens.filter((i) => selecionados.has(i.id));
    const totalItens = ativos.reduce((s, i) => s + qtdFinal(i), 0);
    const totalValor = ativos.reduce((s, i) => s + qtdFinal(i) * i.precoUnitario, 0);
    const skusAtivos = ativos.filter((i) => qtdFinal(i) > 0).length;
    return { totalItens, totalValor, skusAtivos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, ajustes, periodo, selecionados]);

  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTodos = (checked: boolean | "indeterminate") => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (checked === true) itensFiltrados.forEach((i) => next.add(i.id));
      else itensFiltrados.forEach((i) => next.delete(i.id));
      return next;
    });
  };

  const setAjuste = (id: string, valor: number) => {
    setAjustes((prev) => ({ ...prev, [id]: Math.max(0, Math.floor(valor || 0)) }));
  };

  const resetAjustes = () => {
    setAjustes({});
    toast.info("Quantidades restauradas para a sugestão original.");
  };

  const desmarcarItensSemSaldo = () => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      alerta.itens.forEach((item) => next.delete(item.id));
      return next;
    });
    setAlerta({ ...alerta, aberto: false });
    toast.info("Itens sem saldo desmarcados.");
  };

  const exportarExcel = async () => {
    const ativos = itensFiltrados.filter((i) => selecionados.has(i.id));
    if (ativos.length === 0) { toast.warning("Nenhum item selecionado para exportar."); return; }

    setCarregando(true);
    try {
      const codigos = ativos.map((i) => i.codigo);
      const r = await fetch(`${API_BASE}/sugestao-compras/verificar-estoques`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigos }),
      });
      if (!r.ok) throw new Error("Erro ao consultar bases de estoque.");

      const { sjc: estoqueSjc, mg: estoqueMg } = await r.json();

      const itensSemEstoque: { id: string; codigo: string; solicitado: number; disponivelSjc: number; disponivelMg: number }[] = [];
      for (const item of ativos) {
        const final = qtdFinal(item);
        const disponivelSjc = estoqueSjc[item.codigo] || 0;
        const disponivelMg = estoqueMg[item.codigo] || 0;
        if (final > disponivelSjc) {
          itensSemEstoque.push({ id: item.id, codigo: item.codigo, solicitado: final, disponivelSjc, disponivelMg });
        }
      }

      if (itensSemEstoque.length > 0) {
        setAlerta({ aberto: true, titulo: "Saldo insuficiente na base SJC", itens: itensSemEstoque });
        return;
      }

      const dados = ativos.map((i) => [i.codigo, qtdFinal(i), i.precoUnitario]);
      const worksheet = XLSX.utils.aoa_to_sheet(dados);

      if (worksheet["!ref"]) {
        const range = XLSX.utils.decode_range(worksheet["!ref"]);
        for (let row = range.s.r; row <= range.e.r; row++) {
          for (let col = 1; col <= 2; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (worksheet[cellRef] && worksheet[cellRef].t === "n") {
              worksheet[cellRef].z = "#,##0.00";
            }
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sugestoes");
      const lojaNome = lojas.find((l) => l.id === lojaId)?.nome || "Loja";
      XLSX.writeFile(workbook, `Sugestoes_${lojaNome}.xls`, { bookType: "biff8" });
      toast.success("Arquivo XLS gerado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Falha ao verificar estoque antes de exportar.");
    } finally {
      setCarregando(false);
    }
  };

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
            <ShoppingCart className="w-5 h-5 text-violet-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">SUGESTÃO DE COMPRAS</h1>
              <p className="text-[10px] font-mono text-muted-foreground">Integração Microsys · Dpto. Administrativo</p>
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
          <CardContent className="p-5 grid gap-4 md:grid-cols-[1fr_1fr_2fr_auto] items-end">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5" /> Loja
              </label>
              <Select value={lojaId} onValueChange={setLojaId} disabled={carregando}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {lojas.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Período de cobertura
              </label>
              <ToggleGroup
                type="single"
                value={String(periodo)}
                onValueChange={(v) => v && setPeriodo(Number(v) as Periodo)}
                disabled={carregando}
                className="justify-start"
              >
                <ToggleGroupItem value="30" className="px-5">30 dias</ToggleGroupItem>
                <ToggleGroupItem value="90" className="px-5">90 dias</ToggleGroupItem>
                <ToggleGroupItem value="180" className="px-5">180 dias</ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" /> Buscar item
              </label>
              <Input
                placeholder="Código, descrição ou categoria..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                disabled={carregando}
              />
            </div>

            <Button
              onClick={consultarBanco}
              disabled={carregando || !lojaId}
              className="h-9"
            >
              {carregando ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analisando...</>
              ) : (
                "Consultar Base"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            icon={<Package className="h-4 w-4" />}
            label="Itens sugeridos"
            value={String(totais.skusAtivos)}
            hint={`${selecionados.size} de ${itens.length} selecionados`}
          />
          <KpiCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Unidades totais"
            value={totais.totalItens.toLocaleString("pt-BR")}
            hint={`Cobertura ${periodo} dias`}
          />
          <KpiCard
            icon={<ShoppingCart className="h-4 w-4" />}
            label="Valor estimado"
            value={formatBRL(totais.totalValor)}
            hint="Pré-envio Microsys"
            highlight
          />
        </div>

        {/* Tabela */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 bg-muted/30">
            <div>
              <CardTitle className="text-base">Itens sugeridos</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Ajuste as quantidades antes de submeter ao Microsys.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetAjustes}>
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </Button>
              <Button
                size="sm"
                onClick={exportarExcel}
                disabled={totais.skusAtivos === 0 || carregando}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={
                          itensFiltrados.length > 0 &&
                          itensFiltrados.every((i) => selecionados.has(i.id))
                        }
                        onCheckedChange={toggleTodos}
                      />
                    </TableHead>
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Média/dia</TableHead>
                    <TableHead className="text-right">Sugestão</TableHead>
                    <TableHead className="text-right w-32">Quantidade</TableHead>
                    <TableHead className="text-right">Est. SJC</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carregando ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-72 text-center">
                        <div className="flex flex-col items-center justify-center space-y-4">
                          <Loader2 className="h-10 w-10 animate-spin text-primary" />
                          <div className="space-y-1">
                            <p className="text-base font-medium">Analisando histórico de vendas e calculando sugestões...</p>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                              Esta consulta processa um grande volume de dados e pode levar alguns minutos.
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : itensFiltrados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        {itens.length === 0
                          ? "Clique em \"Consultar Base\" para carregar os dados."
                          : `Nenhum item encontrado para "${busca}".`}
                      </TableCell>
                    </TableRow>
                  ) : (
                    itensFiltrados.map((i) => {
                      const sugerido = qtdSugerida(i);
                      const final = qtdFinal(i);
                      const ajustado = ajustes[i.id] !== undefined && ajustes[i.id] !== sugerido;
                      const selecionado = selecionados.has(i.id);
                      return (
                        <TableRow
                          key={i.id}
                          className={!selecionado ? "opacity-50 bg-muted/5 hover:bg-muted/10" : ""}
                        >
                          <TableCell className="text-center">
                            <Checkbox
                              checked={selecionado}
                              onCheckedChange={() => toggleSelecionado(i.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{i.codigo}</TableCell>
                          <TableCell>
                            <div className="font-medium">{i.descricao}</div>
                            <div className="text-xs text-muted-foreground">{i.categoria}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{i.estoqueAtual}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {i.mediaDiaria.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Badge variant="secondary" className="font-mono">{sugerido}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              value={final}
                              onChange={(e) => setAjuste(i.id, Number(e.target.value))}
                              className={`h-9 text-right tabular-nums ${ajustado ? "border-primary ring-1 ring-primary/30" : ""}`}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {i.estoqueSjc}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatBRL(final * i.precoUnitario)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      </div>
      {/* Modal de alerta de estoque */}
      {alerta.aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border shadow-lg rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold mb-4">{alerta.titulo}</h2>
            <div className="max-h-[40vh] overflow-y-auto mb-6 pr-2 space-y-2">
              <p className="text-sm text-muted-foreground mb-2">Os seguintes itens excedem a quantidade disponível:</p>
              {alerta.itens.map((item, idx) => (
                <div key={idx} className="text-sm p-3 bg-muted/50 rounded-lg border border-border/50 flex flex-col gap-1">
                  <span className="font-semibold">Item: {item.codigo}</span>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Solicitado: <strong className="text-foreground">{item.solicitado}</strong></span>
                    <span>SJC: <strong className="text-destructive">{item.disponivelSjc}</strong></span>
                  </div>
                  {item.disponivelMg >= item.solicitado && (
                    <div className="mt-1 text-right">
                      <span className="text-emerald-600 dark:text-emerald-500 font-medium">
                        ✓ Possui {item.disponivelMg} na base MG
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={desmarcarItensSemSaldo}>Desmarcar sem saldo</Button>
              <Button onClick={() => setAlerta({ ...alerta, aberto: false })}>OK</Button>
            </div>
          </div>
        </div>
      )}
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
    <Card className={highlight ? "bg-primary text-primary-foreground border-transparent" : ""}>
      <CardContent className="p-5">
        <div className={`flex items-center gap-2 text-xs font-medium ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {icon}
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className={`mt-1 text-xs ${highlight ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {hint}
        </div>
      </CardContent>
    </Card>
  );
}
