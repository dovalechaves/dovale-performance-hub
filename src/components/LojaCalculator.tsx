import { useState, useMemo, useEffect, useRef } from "react";
import { fetchProdutoLoja, fetchContasPagar, fetchCustoOperacional, type LojaCalc, type CustoOperacionalItem } from "@/lib/ecommerce-api";
import { useAuth } from "@/context/AuthContext";

const TAX_RATE = 0.08; // 8% para lojas
const ML_FEE = 0.165;  // 16.5% Mercado Livre

const LOJA_LABELS: Record<LojaCalc, string> = {
  fast: "Fast",
  santana: "Santana",
  rj: "Rio de Janeiro",
};

const inputClass =
  "w-full bg-secondary border-0 rounded-lg px-4 py-3.5 text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-200";
const labelClass = "text-xs font-semibold uppercase tracking-widest text-muted-foreground";
const selectClass =
  "w-full appearance-none bg-secondary border-0 rounded-lg px-4 py-3.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-200 cursor-pointer";

const ChevronIcon = () => (
  <svg
    className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ResultRow = ({ label, value, accent, colorClass }: { label: string; value: string; accent?: boolean; colorClass?: string }) => (
  <div className="flex items-center justify-between py-1">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className={`text-sm font-semibold tabular-nums ${colorClass ? colorClass : accent ? "text-primary" : "text-foreground"}`}>
      {value}
    </span>
  </div>
);

const LojaCalculator = () => {
  const { user } = useAuth();
  const isAdmin = user?.apps.calculadora.role === "admin";
  const fixedLoja = user?.apps.calculadora.loja as LojaCalc | null;
  const [loja, setLoja] = useState<LojaCalc>(fixedLoja ?? "fast");
  const [codigoProduto, setCodigoProduto] = useState("");
  const [custoProduto, setCustoProduto] = useState("");
  const [precoVenda, setPrecoVenda] = useState("");
  const [desconto, setDesconto] = useState(0);
  const [pesoGramas, setPesoGramas] = useState("500");

  const [isLoadingProduto, setIsLoadingProduto] = useState(false);
  const [produtoNome, setProdutoNome] = useState<string | null>(null);
  const [produtoErro, setProdutoErro] = useState<string | null>(null);

  // Contas a pagar (total do mês = valor_participacao para rateio)
  const [contasPagar, setContasPagar] = useState<number | null>(null);
  const [contasPagarLoading, setContasPagarLoading] = useState(false);
  const contasPagarRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custo operacional rateado por produto (mesma lógica da indústria)
  const [custoOpUnit, setCustoOpUnit] = useState<number | null>(null);
  const [custoOpData, setCustoOpData] = useState<Record<number, CustoOperacionalItem>>({});
  const custoOpRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Busca contas a pagar quando loja muda
  useEffect(() => {
    if (contasPagarRef.current) clearTimeout(contasPagarRef.current);
    contasPagarRef.current = setTimeout(() => {
      setContasPagarLoading(true);
      fetchContasPagar(loja)
        .then((d) => setContasPagar(d.total))
        .catch(() => setContasPagar(null))
        .finally(() => setContasPagarLoading(false));
    }, 300);
    return () => { if (contasPagarRef.current) clearTimeout(contasPagarRef.current); };
  }, [loja]);

  // 2. Quando contas a pagar mudar, busca custo operacional rateado
  useEffect(() => {
    if (contasPagar == null || contasPagar <= 0) { setCustoOpData({}); return; }
    if (custoOpRef.current) clearTimeout(custoOpRef.current);
    custoOpRef.current = setTimeout(() => {
      fetchCustoOperacional(contasPagar)
        .then((data) => setCustoOpData(data))
        .catch(() => setCustoOpData({}));
    }, 300);
    return () => { if (custoOpRef.current) clearTimeout(custoOpRef.current); };
  }, [contasPagar]);

  // 3. Quando produto ou custoOpData mudar, atualiza custoOpUnit
  useEffect(() => {
    if (!codigoProduto.trim()) { setCustoOpUnit(null); return; }
    const cod = Number(codigoProduto);
    const item = custoOpData[cod];
    setCustoOpUnit(item?.custo_operacional_unit ?? null);
  }, [codigoProduto, custoOpData]);

  const buscarProduto = async () => {
    if (!codigoProduto.trim()) return;
    setIsLoadingProduto(true);
    setProdutoErro(null);
    setProdutoNome(null);
    setCustoOpUnit(null);
    try {
      const data = await fetchProdutoLoja(codigoProduto, loja);
      setCustoProduto(Number(data.custo).toFixed(2));
      if (data.peso) setPesoGramas(String(data.peso));
      setProdutoNome(data.resumo);
      // Atualiza custo op do produto
      const cod = Number(codigoProduto);
      const item = custoOpData[cod];
      setCustoOpUnit(item?.custo_operacional_unit ?? null);
    } catch {
      setProdutoErro("Produto não encontrado");
    } finally {
      setIsLoadingProduto(false);
    }
  };

  const results = useMemo(() => {
    const custoBase = parseFloat(custoProduto) || 0;
    const basePrice = parseFloat(precoVenda) || 0;
    const price = basePrice * (1 - desconto / 100);

    const taxa = price * ML_FEE;
    const imposto = price * TAX_RATE;
    const opCost = custoOpUnit ?? 0;
    const cost = custoBase + opCost;
    const profit = price - taxa - imposto - cost;
    const calculatedMargin = cost > 0 ? (profit / cost) * 100 : 0;

    return {
      valorFinal: price,
      lucroPorVenda: profit,
      taxa,
      imposto,
      custoOp: opCost,
      margemCalculada: calculatedMargin,
    };
  }, [precoVenda, desconto, custoProduto, custoOpUnit]);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 w-full max-w-5xl mx-auto">
      {/* Form */}
      <div className="animate-fade-up-delay-1">
        <div className="bg-card rounded-2xl p-8 shadow-[0_1px_3px_hsl(240_10%_80%/0.3),0_8px_32px_hsl(240_10%_80%/0.12)] transition-shadow duration-300 hover:shadow-[0_2px_6px_hsl(240_10%_80%/0.35),0_12px_40px_hsl(240_10%_80%/0.18)]">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-8 uppercase">
            Calculadora Loja
          </h2>

          {/* Loja */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Loja</label>
            <div className="relative">
              <select
                value={loja}
                onChange={(e) => setLoja(e.target.value as LojaCalc)}
                className={selectClass}
                disabled={!isAdmin && !!fixedLoja}
              >
                {isAdmin || !fixedLoja
                  ? Object.entries(LOJA_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))
                  : <option value={fixedLoja}>{LOJA_LABELS[fixedLoja]}</option>
                }
              </select>
              <ChevronIcon />
            </div>
            <p className="text-xs text-primary font-medium">Imposto: 8% · ML: 16,5% · Custo Op.: contas a pagar do mês</p>
          </div>

          {/* Código do Produto */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Código do Produto</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={codigoProduto}
                onChange={(e) => setCodigoProduto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buscarProduto()}
                placeholder="Ex: 12345"
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={buscarProduto}
                disabled={isLoadingProduto || !codigoProduto.trim()}
                className="px-4 py-3.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
              >
                {isLoadingProduto ? "..." : "Buscar"}
              </button>
            </div>
            {produtoNome && <p className="text-xs text-primary font-medium truncate">{produtoNome}</p>}
            {produtoErro && <p className="text-xs text-destructive font-medium">{produtoErro}</p>}
          </div>

          {/* Preço do Produto */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Preço do Produto (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={precoVenda}
              onChange={(e) => setPrecoVenda(e.target.value)}
              placeholder="0,00"
              className={inputClass}
            />
          </div>

          {/* Custo do Produto */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Custo do Produto (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={custoProduto}
              readOnly
              placeholder="0,00"
              className={`${inputClass} opacity-70 cursor-not-allowed`}
            />
            {custoProduto !== "" && (
              <p className="text-xs text-[#00A650] font-medium mt-1">✅ Custo importado do sistema</p>
            )}
          </div>

          {/* Contas a Pagar (total mês) */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Contas a Pagar do Mês (R$)</label>
            <input
              type="text"
              readOnly
              value={contasPagarLoading ? "Carregando..." : contasPagar != null ? fmt(contasPagar) : "—"}
              placeholder="—"
              className={`${inputClass} opacity-70 cursor-not-allowed`}
            />
            {contasPagar != null && (
              <p className="text-xs text-muted-foreground mt-1">Total {LOJA_LABELS[loja]} — usado como base de rateio</p>
            )}
          </div>

          {/* Custo Operacional Rateado */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Custo Operacional (R$)</label>
            <input
              type="text"
              readOnly
              value={custoOpUnit != null ? fmt(custoOpUnit) : "—"}
              placeholder="—"
              className={`${inputClass} opacity-70 cursor-not-allowed`}
            />
          </div>

          {/* Custo Real */}
          <div className="space-y-2 mb-6">
            <label className={`${labelClass} text-primary`}>Custo Real (R$)</label>
            <input
              type="text"
              readOnly
              value={custoProduto !== "" ? fmt((parseFloat(custoProduto) || 0) + (custoOpUnit ?? 0)) : "—"}
              placeholder="—"
              className={`${inputClass} opacity-70 cursor-not-allowed text-primary font-bold`}
            />
          </div>

          {/* Desconto */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Desconto Aplicado</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={desconto}
                  onChange={(e) => setDesconto(Number(e.target.value))}
                  className="w-20 bg-secondary border-0 rounded-lg px-2 py-1 text-sm font-medium text-right focus:ring-2 focus:ring-primary outline-none"
                />
                <span className="text-sm font-bold text-primary tabular-nums">%</span>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={desconto}
              onChange={(e) => setDesconto(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-secondary accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Preço Final c/ Desconto */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Preço Final c/ Desconto (R$)</label>
            <input
              type="text"
              readOnly
              value={fmt((parseFloat(precoVenda) || 0) * (1 - desconto / 100))}
              className={`${inputClass} opacity-70 cursor-not-allowed font-bold text-primary`}
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="animate-fade-up-delay-2">
        <div className="bg-card rounded-2xl p-8 shadow-[0_1px_3px_hsl(240_10%_80%/0.3),0_8px_32px_hsl(240_10%_80%/0.12)] transition-shadow duration-300 hover:shadow-[0_2px_6px_hsl(240_10%_80%/0.35),0_12px_40px_hsl(240_10%_80%/0.18)]">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-8 uppercase">
            Resultado
          </h2>

          <div className="space-y-5">
            <ResultRow label="Loja" value={LOJA_LABELS[loja]} />
            <ResultRow label="Marketplace" value="Mercado Livre" />
            <ResultRow label="Custo do Produto" value={fmt(parseFloat(custoProduto) || 0)} />
            {contasPagar != null && (
              <ResultRow label={`Contas a Pagar (${LOJA_LABELS[loja]})`} value={fmt(contasPagar)} />
            )}
            {custoOpUnit != null && (
              <ResultRow label="Custo Operacional" value={fmt(custoOpUnit)} />
            )}
            {custoOpUnit != null && (
              <ResultRow label="Custo Real" value={fmt((parseFloat(custoProduto) || 0) + custoOpUnit)} accent />
            )}
            <ResultRow label="Preço do Produto" value={fmt(parseFloat(precoVenda) || 0)} />
            <ResultRow label="Desconto" value={`${desconto}%`} />

            <ResultRow label="Taxa ML (16,5%)" value={fmt(results.taxa)} />
            <ResultRow label="Imposto (8%)" value={fmt(results.imposto)} />

            <ResultRow
              label="Margem de Lucro Final"
              value={`${results.margemCalculada.toFixed(2)}%`}
              colorClass={results.margemCalculada >= 0 ? "text-[#00A650]" : "text-destructive"}
            />

            <div className="h-px bg-border" />

            {/* Big results */}
            <div className="bg-primary rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary-foreground/70 uppercase tracking-wide">
                  Valor Final
                </span>
                <span className="text-2xl font-bold text-primary-foreground tabular-nums">
                  {fmt(results.valorFinal)}
                </span>
              </div>
              <div className="h-px bg-primary-foreground/15" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary-foreground/70 uppercase tracking-wide">
                  Lucro por Venda
                </span>
                <span className={`text-2xl font-bold tabular-nums ${results.lucroPorVenda >= 0 ? "text-[#00A650]" : "text-destructive"}`}>
                  {fmt(results.lucroPorVenda)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LojaCalculator;
