import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { fetchProdutos, fetchCustoOperacional, CustoOperacionalItem } from "@/lib/ecommerce-api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";

interface Product {
  codigo: string;
  descricao: string;
  percentualDesconto: number;
  precoFinal: number;
  custo: number;
  peso: number;
}

type Marketplace = "mercadolivre" | "amazon" | "shopee";

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  mercadolivre: "Mercado Livre",
  amazon: "Amazon",
  shopee: "Shopee",
};

const MARKETPLACE_FEES: Record<Marketplace, number> = {
  mercadolivre: 16.5,
  amazon: 11,
  shopee: 0,
};

function shopeeFee(price: number): number {
  if (price <= 79.99) return price * 0.20 + 4;
  if (price <= 99.99) return price * 0.14 + 16;
  if (price <= 199.99) return price * 0.14 + 20;
  if (price <= 499.99) return price * 0.14 + 26;
  return price * 0.14 + 26;
}

const AMAZON_SHIPPING_TABLE: { max_weight_g: number; costs: (number | null)[] }[] = [
  { max_weight_g: 100,  costs: [null, null, null, 10.05, 12.05, 14.05, 15.05, 15.55] },
  { max_weight_g: 200,  costs: [null, null, null, 10.45, 12.45, 14.45, 15.45, 16.05] },
  { max_weight_g: 300,  costs: [null, null, null, 10.95, 12.95, 14.95, 15.95, 16.55] },
  { max_weight_g: 400,  costs: [null, null, null, 11.45, 13.45, 15.45, 16.95, 17.15] },
  { max_weight_g: 500,  costs: [null, null, null, 11.95, 13.95, 15.95, 17.05, 17.85] },
  { max_weight_g: 750,  costs: [null, null, null, 12.05, 14.05, 16.05, 18.45, 18.55] },
  { max_weight_g: 1000, costs: [null, null, null, 12.45, 14.45, 16.45, 19.05, 19.25] },
  { max_weight_g: 1500, costs: [5.65, 5.85, 6.05, 12.95, 14.95, 16.95, 19.45, 20.35] },
  { max_weight_g: 2000, costs: [null, null, null, 13.05, 15.05, 17.05, 19.95, 21.35] },
  { max_weight_g: 3000, costs: [null, null, null, 14.05, 16.05, 18.05, 20.05, 22.35] },
  { max_weight_g: 4000, costs: [null, null, null, 15.05, 17.05, 19.05, 21.95, 23.35] },
  { max_weight_g: 5000, costs: [null, null, null, 16.05, 18.05, 20.05, 22.95, 24.35] },
  { max_weight_g: 6000, costs: [null, null, null, 24.05, 27.05, 29.05, 30.05, 30.35] },
  { max_weight_g: 7000, costs: [null, null, null, 25.05, 28.05, 30.05, 31.05, 33.35] },
  { max_weight_g: 8000, costs: [null, null, null, 26.05, 29.05, 31.05, 32.05, 35.35] },
  { max_weight_g: 9000, costs: [null, null, null, 27.05, 30.05, 32.05, 33.05, 37.35] },
  { max_weight_g: 10000,costs: [null, null, null, 35.05, 40.05, 46.05, 51.05, 51.35] },
];

// Adicional por kg acima de 10kg (por faixa de preço)
const AMAZON_ADDITIONAL_PER_KG = [null, null, null, 3.05, 3.05, 3.05, 3.50, 3.50];

function amazonPriceColIndex(price: number): number {
  if (price < 30)    return 0;
  if (price < 50)    return 1;
  if (price < 79)    return 2;
  if (price < 100)   return 3;
  if (price < 120)   return 4;
  if (price < 150)   return 5;
  if (price < 200)   return 6;
  return 7;
}

function estimateAmazonShipping(price: number, weightGrams: number): number {
  const col = amazonPriceColIndex(price);
  const row = AMAZON_SHIPPING_TABLE.find((r) => weightGrams <= r.max_weight_g);
  if (row) {
    return row.costs[col] ?? 0;
  }
  const base = AMAZON_SHIPPING_TABLE[AMAZON_SHIPPING_TABLE.length - 1].costs[col] ?? 0;
  const extra = AMAZON_ADDITIONAL_PER_KG[col] ?? 0;
  const extraKg = Math.ceil((weightGrams - 10000) / 1000);
  return base + extra * extraKg;
}

const SHIPPING_TABLE_GREEN = [
  { max_weight: 0.3, costs: [5.65, 6.55, 7.75, 12.35, 14.35, 16.45, 18.45, 20.95] },
  { max_weight: 0.5, costs: [5.95, 6.65, 7.85, 13.25, 15.45, 17.65, 19.85, 22.55] },
  { max_weight: 1.0, costs: [6.05, 6.75, 7.95, 13.85, 16.15, 18.45, 20.75, 23.65] },
  { max_weight: 1.5, costs: [6.15, 6.85, 8.05, 14.15, 16.45, 18.85, 21.15, 24.65] },
  { max_weight: 2.0, costs: [6.25, 6.95, 8.15, 14.45, 16.85, 19.25, 21.65, 24.65] },
  { max_weight: 3.0, costs: [6.35, 7.15, 8.35, 15.75, 18.35, 21.05, 23.65, 26.25] },
  { max_weight: 4.0, costs: [6.45, 7.35, 8.55, 17.05, 19.85, 22.75, 25.65, 28.35] },
  { max_weight: 5.0, costs: [6.55, 7.55, 8.75, 18.45, 21.55, 24.65, 27.75, 30.75] },
  { max_weight: 9.0, costs: [6.85, 7.95, 9.15, 25.45, 28.55, 32.65, 35.75, 39.75] },
  { max_weight: 13.0, costs: [8.35, 9.65, 11.25, 41.25, 46.25, 52.95, 57.95, 64.35] },
  { max_weight: 17.0, costs: [8.35, 9.65, 11.25, 45.95, 51.55, 58.95, 64.55, 71.65] },
  { max_weight: 30.0, costs: [8.35, 9.65, 11.25, 49.45, 55.45, 63.45, 69.45, 77.15] },
];

function estimateShipping(price: number, weightGrams: number) {
  const weightKg = weightGrams / 1000.0;
  const row =
    SHIPPING_TABLE_GREEN.find((r) => weightKg <= r.max_weight) ||
    SHIPPING_TABLE_GREEN[SHIPPING_TABLE_GREEN.length - 1];
  if (price < 19) return row.costs[0];
  if (price < 49) return row.costs[1];
  if (price < 79) return row.costs[2];
  if (price < 100) return row.costs[3];
  if (price < 120) return row.costs[4];
  if (price < 150) return row.costs[5];
  if (price < 200) return row.costs[6];
  return row.costs[7];
}

const selectClass =
  "appearance-none bg-secondary border-0 rounded-lg px-4 py-3.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-200 cursor-pointer w-full";
const labelClass = "text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 block";

const roundCurrency = (value: number) => Math.round(value * 100) / 100;
const ITEMS_PER_PAGE = 20;

const ChevronIcon = () => (
  <svg
    className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ProductsTable = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [is2xlScreen, setIs2xlScreen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1536px)").matches : true
  );

  const [custoOp, setCustoOp] = useState<Record<number, CustoOperacionalItem>>({});
  const [custoOpError, setCustoOpError] = useState<string | null>(null);
  const [valorParticipacaoInput, setValorParticipacaoInput] = useState("2000000");
  const valorParticipacao = parseFloat(valorParticipacaoInput) || 0;
  const [custoOpLoading, setCustoOpLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchProdutos()
      .then((data) => {
        setProducts(
          data.map((p) => ({
            codigo: String(p.pro_codigo),
            descricao: p.resumo,
            percentualDesconto: 0,
            precoFinal: roundCurrency(p.preco ?? 0),
            custo: p.custo ?? 0,
            peso: p.peso ?? 0,
          }))
        );
      })
      .catch(() => setLoadError("Não foi possível carregar os produtos. Verifique se o backend está rodando."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1536px)");
    const onChange = (event: MediaQueryListEvent) => setIs2xlScreen(event.matches);

    setIs2xlScreen(media.matches);
    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  // Busca custo operacional; re-executa com debounce quando valorParticipacao muda
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCustoOpLoading(true);
      setCustoOpError(null);
      fetchCustoOperacional(valorParticipacao)
        .then((data) => { setCustoOp(data); setCustoOpError(null); })
        .catch((e: Error) => { setCustoOp({}); setCustoOpError(e.message); })
        .finally(() => setCustoOpLoading(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [valorParticipacao]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [marketplace, setMarketplace] = useState<Marketplace>("mercadolivre");
  const [descontoFrete, setDescontoFrete] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const effectiveFeeRate = useMemo(() => {
    if (marketplace === "mercadolivre") {
      return 0.165;
    }
    return MARKETPLACE_FEES[marketplace] / 100;
  }, [marketplace]);

  const taxRate = 0.21;

  const getCalculatedValues = useCallback(
    (product: Product) => {
      const recebimento = product.precoFinal * (1 - product.percentualDesconto / 100);
      const taxa = marketplace === "shopee" ? shopeeFee(recebimento) : recebimento * effectiveFeeRate;

      const freteBase =
        marketplace === "mercadolivre" && recebimento >= 79
          ? estimateShipping(recebimento, product.peso)
          : marketplace === "amazon"
            ? estimateAmazonShipping(recebimento, product.peso)
            : 0;
      const frete = freteBase * (1 - descontoFrete / 100);

      const imposto = recebimento * taxRate;

      const custoOpUnit = custoOp[Number(product.codigo)]?.custo_operacional_unit ?? 0;
      const custoReal = product.custo + custoOpUnit;

      const lucro = recebimento - taxa - frete - imposto - custoReal;

      const margem = recebimento > 0 ? ((recebimento - taxa - frete - custoReal) / recebimento) * 100 : 0;
      const margemComImposto = custoReal > 0 ? (lucro / custoReal) * 100 : 0;

      return { recebimento, taxa, frete, imposto, custoReal, lucro, margem, margemComImposto };
    },
    [effectiveFeeRate, marketplace, taxRate, custoOp, descontoFrete]
  );

  const updateProduct = useCallback((codigo: string, updates: Partial<Product>) => {
    setProducts((prev) => {
      const index = prev.findIndex((item) => item.codigo === codigo);
      if (index < 0) return prev;

      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, []);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return products;

    return products.filter((product) => {
      const matchesSearch =
        product.codigo.includes(query) ||
        product.descricao.toLowerCase().includes(query);

      return matchesSearch;
    });
  }, [products, searchQuery]);

  const visibleRows = useMemo(() => {
    return filteredProducts.map((product) => {
      const values = getCalculatedValues(product);
      const custoOpUnit = custoOp[Number(product.codigo)]?.custo_operacional_unit ?? null;

      return {
        product,
        values,
        custoOpUnit,
      };
    });
  }, [filteredProducts, getCalculatedValues, custoOp]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const pageRows = useMemo(
    () => visibleRows.slice(pageStart, pageStart + ITEMS_PER_PAGE),
    [visibleRows, pageStart]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const getMarginBadge = (margem: number) => {
    if (margem >= 0) return <Badge className="bg-green-100 text-green-800">{margem.toFixed(1)}%</Badge>;
    return <Badge className="bg-red-100 text-red-800">{margem.toFixed(1)}%</Badge>;
  };

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const exportToExcel = () => {
    const showFrete = marketplace === "mercadolivre" || marketplace === "amazon";
    const headers = [
      "Código", "Descrição", "% Desc", "Preço Final", "Preço c/ Desc",
      `Taxa (${MARKETPLACE_LABELS[marketplace]})`,
      ...(showFrete ? ["Frete (est.)"] : []),
      "Imposto (21%)", "Custo", "Custo Op.", "Custo Real",
      "Lucro R$", "Margem c/ Imp. (%)", "Peso (g)",
    ];

    const rows = visibleRows.map(({ product, values, custoOpUnit }) => {
      return [
        product.codigo,
        product.descricao,
        product.percentualDesconto,
        product.precoFinal,
        values.recebimento,
        values.taxa,
        ...(showFrete ? [values.frete] : []),
        values.imposto,
        product.custo,
        custoOpUnit ?? "",
        values.custoReal,
        values.lucro,
        parseFloat(values.margemComImposto.toFixed(2)),
        product.peso,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    XLSX.writeFile(wb, `produtos_${MARKETPLACE_LABELS[marketplace].toLowerCase().replace(" ", "_")}.xlsx`);
  };

  const taxaLabel =
    marketplace === "mercadolivre"
      ? "Taxa ML (Premium 16,5%)"
      : marketplace === "amazon"
        ? "Amazon (11%)"
        : "Shopee (14%~20% + fixo)";

  return (
    <div className="bg-card rounded-2xl p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground uppercase">
            Tabela de Produtos
          </h2>
          <button
            onClick={exportToExcel}
            disabled={filteredProducts.length === 0}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Exportar Excel
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          {/* Busca */}
          <div>
            <label className={labelClass}>Buscar</label>
            <Input
              type="text"
              placeholder="Código ou descrição..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Marketplace */}
          <div>
            <label className={labelClass}>Marketplace</label>
            <div className="relative">
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as Marketplace)}
                className={selectClass}
              >
                {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </div>

          {/* Valor de Participação */}
          <div>
            <label className={labelClass}>
              Valor de Participação (R$)
              {custoOpLoading && (
                <span className="ml-2 text-primary font-normal normal-case tracking-normal">calculando...</span>
              )}
              {custoOpError && (
                <span className="ml-2 text-destructive font-normal normal-case tracking-normal" title={custoOpError}>
                  erro ao carregar
                </span>
              )}
            </label>
            <Input
              type="number"
              min="0"
              step="100000"
              value={valorParticipacaoInput}
              onChange={(e) => setValorParticipacaoInput(e.target.value)}
              className="w-full bg-secondary border-0 rounded-lg px-4 py-3.5 text-sm"
            />
          </div>

          {/* Desconto no Frete */}
          <div>
            <label className={labelClass}>Desconto no Frete (%)</label>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={descontoFrete}
              onChange={(e) => setDescontoFrete(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
              className="w-full bg-secondary border-0 rounded-lg px-4 py-3.5 text-sm"
            />
          </div>
        </div>

        {/* Tabela completa (somente telas muito largas) */}
        {is2xlScreen && <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                <th className="px-2 py-2 text-left font-semibold text-foreground uppercase tracking-wider">Código</th>
                <th className="px-2 py-2 text-left font-semibold text-foreground uppercase tracking-wider">Descrição</th>
                <th className="px-2 py-2 text-center font-semibold text-foreground uppercase tracking-wider">% Desc</th>
                <th className="px-2 py-2 text-right font-semibold text-foreground uppercase tracking-wider">Preço Final</th>
                <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">Preço</th>
                <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">{taxaLabel}</th>
                {(marketplace === "mercadolivre" || marketplace === "amazon") && (
                  <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">Frete (est.)</th>
                )}
                <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">Imposto</th>
                <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">Custo</th>
                <th className="px-2 py-2 text-right font-semibold text-muted-foreground uppercase tracking-wider">Custo Op.</th>
                <th className="px-2 py-2 text-right font-semibold text-primary uppercase tracking-wider">Custo Real</th>
                <th className="px-2 py-2 text-right font-semibold text-foreground uppercase tracking-wider">Lucro R$</th>
                <th className="px-2 py-2 text-right font-semibold text-primary uppercase tracking-wider">Margem c/ Imp.</th>
                <th className="px-2 py-2 text-right font-semibold text-foreground uppercase tracking-wider">Peso</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ product, values, custoOpUnit }) => {

                return (
                  <tr key={product.codigo} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    <td className="px-2 py-2 text-foreground font-medium">{product.codigo}</td>
                    <td className="px-2 py-2 text-foreground font-medium break-words" title={product.descricao}>{product.descricao}</td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={product.percentualDesconto}
                        onChange={(e) => updateProduct(product.codigo, { percentualDesconto: parseFloat(e.target.value) || 0 })}
                        className="w-14 bg-secondary border-0 rounded px-1.5 py-1 text-xs text-center text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={product.precoFinal}
                        onChange={(e) => updateProduct(product.codigo, { precoFinal: roundCurrency(parseFloat(e.target.value) || 0) })}
                        className="w-20 bg-secondary border-0 rounded px-1.5 py-1 text-xs text-right text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmt(values.recebimento)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmt(values.taxa)}</td>
                    {(marketplace === "mercadolivre" || marketplace === "amazon") && (
                      <td className="px-2 py-2 text-right text-muted-foreground">{fmt(values.frete)}</td>
                    )}
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmt(values.imposto)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmt(product.custo)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {custoOpUnit == null ? <span>—</span> : fmt(custoOpUnit)}
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-primary">
                      {fmt(values.custoReal)}
                    </td>
                    <td className={`px-2 py-2 text-right font-bold ${values.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmt(values.lucro)}
                    </td>
                    <td className="px-2 py-2 text-right">{getMarginBadge(values.margemComImposto)}</td>
                    <td className="px-2 py-2 text-right text-foreground">{product.peso} g</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}

        {/* Cards responsivos (sem scroll horizontal) */}
        {!is2xlScreen && <div className="space-y-3">
          {pageRows.map(({ product, values, custoOpUnit }) => {

            return (
              <article key={product.codigo} className="rounded-xl border border-border/60 bg-background/70 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Código {product.codigo}</p>
                    <h3 className="text-sm font-semibold text-foreground leading-snug break-words">{product.descricao}</h3>
                  </div>
                  <div className={`shrink-0 text-sm font-bold ${values.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt(values.lucro)}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">% Desc</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={product.percentualDesconto}
                      onChange={(e) => updateProduct(product.codigo, { percentualDesconto: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-secondary border-0 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">Preço Final</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={product.precoFinal}
                      onChange={(e) => updateProduct(product.codigo, { precoFinal: roundCurrency(parseFloat(e.target.value) || 0) })}
                      className="w-full bg-secondary border-0 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Peso</p>
                    <p className="text-sm font-medium text-foreground">{product.peso} g</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Preço</p>
                    <p className="text-sm text-foreground">{fmt(values.recebimento)}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{taxaLabel}</p>
                    <p className="text-sm text-foreground">{fmt(values.taxa)}</p>
                  </div>

                  {(marketplace === "mercadolivre" || marketplace === "amazon") && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Frete (est.)</p>
                      <p className="text-sm text-foreground">{fmt(values.frete)}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Imposto</p>
                    <p className="text-sm text-foreground">{fmt(values.imposto)}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Custo</p>
                    <p className="text-sm text-foreground">{fmt(product.custo)}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Custo Op.</p>
                    <p className="text-sm text-foreground">{custoOpUnit == null ? "—" : fmt(custoOpUnit)}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Custo Real</p>
                    <p className="text-sm font-semibold text-primary">{fmt(values.custoReal)}</p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Margem c/ Imp.</p>
                    <div>{getMarginBadge(values.margemComImposto)}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>}

        {isLoading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Carregando produtos...</p>
          </div>
        )}
        {loadError && !isLoading && (
          <div className="text-center py-12">
            <p className="text-destructive text-sm">{loadError}</p>
          </div>
        )}
        {!isLoading && !loadError && filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Nenhum produto encontrado com os filtros aplicados</p>
          </div>
        )}

        {!isLoading && !loadError && filteredProducts.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Mostrando {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, filteredProducts.length)} de {filteredProducts.length} produtos
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                Página {safeCurrentPage} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
    </div>
  );
};

export default ProductsTable;
