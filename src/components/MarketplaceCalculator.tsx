import { useState, useMemo, useEffect, useCallback } from "react";
import { fetchProduto, fetchTokenSalvo, authToken, simulate, fetchMyItems, fetchCustoOperacional, type SimulateResults } from "@/lib/ecommerce-api";

type Marketplace = "" | "mercadolivre" | "amazon" | "shopee" | "tiktok" | "magalu";
type ListingType = "gold_pro" | "gold_special" | "free";

const TAX_RATE = 0.21; // 21% fixo

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  "": "Selecionar",
  mercadolivre: "Mercado Livre",
  amazon: "Amazon",
  shopee: "Shopee",
  tiktok: "TikTok",
  magalu: "Magalu",
};

const LISTING_FEES: Record<ListingType, number> = {
  gold_pro: 16.5,
  gold_special: 14,
  free: 0,
};

const LISTING_LABELS: Record<ListingType, string> = {
  gold_pro: "Premium (16.5%)",
  gold_special: "Clássico (14%)",
  free: "Grátis (0%)",
};


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
  { max_weight: 30.0, costs: [8.35, 9.65, 11.25, 49.45, 55.45, 63.45, 69.45, 77.15] }
];

function estimateShipping(price: number, weightGrams: number) {
  const weightKg = weightGrams / 1000.0;
  const row = SHIPPING_TABLE_GREEN.find(r => weightKg <= r.max_weight) || SHIPPING_TABLE_GREEN[SHIPPING_TABLE_GREEN.length - 1];
  if (price < 19) return row.costs[0];
  if (price < 49) return row.costs[1];
  if (price < 79) return row.costs[2];
  if (price < 100) return row.costs[3];
  if (price < 120) return row.costs[4];
  if (price < 150) return row.costs[5];
  if (price < 200) return row.costs[6];
  return row.costs[7];
}

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
const AMAZON_ADDITIONAL_PER_KG = [null, null, null, 3.05, 3.05, 3.05, 3.50, 3.50];

function amazonPriceColIndex(price: number): number {
  if (price < 30) return 0;
  if (price < 50) return 1;
  if (price < 79) return 2;
  if (price < 100) return 3;
  if (price < 120) return 4;
  if (price < 150) return 5;
  if (price < 200) return 6;
  return 7;
}

function estimateAmazonShipping(price: number, weightGrams: number): number {
  const col = amazonPriceColIndex(price);
  const row = AMAZON_SHIPPING_TABLE.find((r) => weightGrams <= r.max_weight_g);
  if (row) return row.costs[col] ?? 0;
  const base = AMAZON_SHIPPING_TABLE[AMAZON_SHIPPING_TABLE.length - 1].costs[col] ?? 0;
  const extra = AMAZON_ADDITIONAL_PER_KG[col] ?? 0;
  const extraKg = Math.ceil((weightGrams - 10000) / 1000);
  return base + extra * extraKg;
}

const MAGALU_SHIPPING_TABLE: { max_weight_g: number; base: number }[] = [
  { max_weight_g: 500,   base: 35.90 },
  { max_weight_g: 1000,  base: 40.90 },
  { max_weight_g: 2000,  base: 42.90 },
  { max_weight_g: 5000,  base: 50.90 },
  { max_weight_g: 9000,  base: 77.90 },
  { max_weight_g: 13000, base: 98.90 },
  { max_weight_g: 17000, base: 111.90 },
  { max_weight_g: 23000, base: 134.90 },
  { max_weight_g: 30000, base: 148.90 },
  { max_weight_g: 40000, base: 159.90 },
  { max_weight_g: 50000, base: 189.90 },
];

type MagaluTier = "base" | "silver" | "gold" | "fulfillment";
const MAGALU_TIER_LABELS: Record<MagaluTier, string> = {
  base: "<92% (sem desconto)",
  silver: "92\u201397% (25% desc.)",
  gold: ">97% (50% desc.)",
  fulfillment: "Fulfillment (75% desc.)",
};
const MAGALU_TIER_DISCOUNT: Record<MagaluTier, number> = { base: 0, silver: 0.25, gold: 0.50, fulfillment: 0.75 };

function estimateMagaluShipping(weightGrams: number, tierDiscount: number): number {
  const row = MAGALU_SHIPPING_TABLE.find((r) => weightGrams <= r.max_weight_g)
    ?? MAGALU_SHIPPING_TABLE[MAGALU_SHIPPING_TABLE.length - 1];
  return row.base * (1 - tierDiscount);
}

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

const MarketplaceCalculator = () => {
  // Form state
  const [marketplace, setMarketplace] = useState<Marketplace>("");
  const [codigoProduto, setCodigoProduto] = useState("");
  const [custoProduto, setCustoProduto] = useState("");
  const [taxaPlataforma, setTaxaPlataforma] = useState("");
  const [magaluTier, setMagaluTier] = useState<MagaluTier>("silver");
  
  // New calculation states
  const [precoVenda, setPrecoVenda] = useState("");
  const [desconto, setDesconto] = useState(0);
  const [descontoFrete, setDescontoFrete] = useState(0);
  const [quantidade, setQuantidade] = useState(1);

  // Specific items / attributes
  const [categoriaId, setCategoriaId] = useState("");
  const [itemId, setItemId] = useState("");
  const [myItemsList, setMyItemsList] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [selectedMyItem, setSelectedMyItem] = useState("");

  // ML-specific
  const [listingType, setListingType] = useState<ListingType>("gold_pro");
  const [pesoGramas, setPesoGramas] = useState("500");

  // Auth
  const [mlToken, setMlToken] = useState<string | null>(null);
  const [mlUser, setMlUser] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [isLoadingToken, setIsLoadingToken] = useState(false);

  // Custo operacional do produto buscado
  const [custoOpUnit, setCustoOpUnit] = useState<number | null>(null);
  const [valorParticipacao] = useState(2000000);

  // Product search
  const [isLoadingProduto, setIsLoadingProduto] = useState(false);
  const [produtoNome, setProdutoNome] = useState<string | null>(null);
  const [produtoErro, setProdutoErro] = useState<string | null>(null);

  // ML real simulation
  const [mlSim, setMlSim] = useState<SimulateResults | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simErro, setSimErro] = useState<string | null>(null);

  const isML = marketplace === "mercadolivre";
  const hasFrete = marketplace !== "" && marketplace !== "shopee";

  const effectiveTaxaLabel = useMemo(() => {
    if (isML) return `${LISTING_FEES[listingType]}%`;
    if (marketplace === "amazon") return "11%";
    if (marketplace === "shopee") return "14%~20% + fixo";
    if (marketplace === "tiktok") return "6% + R$4";
    if (marketplace === "magalu") return "14% + R$5";
    return "—";
  }, [marketplace, isML, listingType]);

  // Auto-load ML token on mount
  useEffect(() => {
    setIsLoadingToken(true);
    fetchTokenSalvo()
      .then(async ({ token }) => {
        try {
          const user = await authToken(token);
          setMlToken(token);
          setMlUser(user.nickname);
        } catch {}
      })
      .catch(() => {})
      .finally(() => setIsLoadingToken(false));
  }, []);

  // Reset simulation when inputs change
  useEffect(() => {
    setMlSim(null);
    setSimErro(null);
  }, [marketplace, custoProduto, listingType, pesoGramas, desconto, descontoFrete, precoVenda, quantidade]);

  // Local calculation (always available)
  const results = useMemo(() => {
    const custoBase = parseFloat(custoProduto) || 0;
    const cost = custoBase + (custoOpUnit ?? 0);
    const basePrice = parseFloat(precoVenda) || 0;
    const price = basePrice * (1 - desconto / 100);
    const peso = parseInt(pesoGramas) || 0;
    let taxa = 0;
    let shipping = 0;

    // Taxa (comissão) por marketplace
    if (marketplace === "mercadolivre") {
      taxa = price * (LISTING_FEES[listingType] / 100);
    } else if (marketplace === "amazon") {
      taxa = price * 0.11;
    } else if (marketplace === "shopee") {
      taxa = shopeeFee(price);
    } else if (marketplace === "tiktok") {
      taxa = price * 0.06 + 4;
    } else if (marketplace === "magalu") {
      taxa = price * 0.14 + 5;
    }

    // Frete por marketplace
    if (marketplace === "mercadolivre" && price >= 79) {
      shipping = estimateShipping(price, peso) * (1 - descontoFrete / 100);
    } else if (marketplace === "amazon") {
      shipping = estimateAmazonShipping(price, peso) * (1 - descontoFrete / 100);
    } else if (marketplace === "tiktok") {
      shipping = price * 0.06 * (1 - descontoFrete / 100);
    } else if (marketplace === "magalu") {
      shipping = estimateMagaluShipping(peso, MAGALU_TIER_DISCOUNT[magaluTier]) * (1 - descontoFrete / 100);
    }

    const imposto = price * TAX_RATE;
    const profit = price - taxa - shipping - imposto - cost;
    const calculatedMargin = cost > 0 ? (profit / cost) * 100 : 0;

    return {
      valorFinal: price,
      lucroPorVenda: profit,
      taxa,
      frete: shipping,
      imposto,
      margemCalculada: calculatedMargin,
    };
  }, [precoVenda, desconto, descontoFrete, custoProduto, custoOpUnit, marketplace, isML, listingType, pesoGramas, magaluTier]);

  const buscarProduto = async () => {
    if (!codigoProduto.trim()) return;
    setIsLoadingProduto(true);
    setProdutoErro(null);
    setProdutoNome(null);
    setCustoOpUnit(null);
    try {
      const [data, custoOpData] = await Promise.all([
        fetchProduto(codigoProduto),
        fetchCustoOperacional(valorParticipacao),
      ]);
      const custoFmt = Number(data.custo).toFixed(2);
      setCustoProduto(custoFmt);
      if (data.peso) setPesoGramas(String(data.peso));
      setProdutoNome(data.resumo);
      const item = custoOpData[Number(codigoProduto)];
      setCustoOpUnit(item?.custo_operacional_unit ?? null);
    } catch {
      setProdutoErro("Produto não encontrado");
    } finally {
      setIsLoadingProduto(false);
    }
  };

  const autenticarToken = async () => {
    if (!tokenInput.trim()) return;
    setIsLoadingToken(true);
    try {
      const user = await authToken(tokenInput);
      setMlToken(tokenInput);
      setMlUser(user.nickname);
      setTokenInput("");
    } catch {}
    finally {
      setIsLoadingToken(false);
    }
  };

  const carregarMeusAnuncios = async () => {
    if (!mlToken) return;
    setIsLoadingItems(true);
    try {
      const sellerId = localStorage.getItem("ml_seller_id") || "";
      const items = await fetchMyItems(sellerId, mlToken);
      setMyItemsList(items);
    } catch (e) {
      console.error(e);
      alert("Erro ao carregar anúncios");
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleSelectMyItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedMyItem(id);
    if (!id) return;
    const item = myItemsList.find(i => i.id === id);
    if (item) {
      setItemId(item.id);
      setCategoriaId(item.category_id || "");
      setPrecoVenda(String(item.price || 0));
      setDesconto(0); // Reseta o desconto ao carregar novo produto

      if (item.listing_type_id === "gold_pro" || item.listing_type_id === "gold_special" || item.listing_type_id === "free") {
        setListingType(item.listing_type_id as ListingType);
      }
    }
  };

  const simularML = async () => {
    setIsSimulating(true);
    setSimErro(null);
    try {
      const custo = parseFloat(custoProduto) || 0;
      const basePrice = parseFloat(precoVenda) || 0;
      const finalPrice = basePrice * (1 - desconto / 100);
      const payload: any = {
        price: finalPrice,
        cost: custo,
        quantity: quantidade,
        listing_type_id: listingType,
        weight: parseInt(pesoGramas) || 500,
        tax_rate: 21,
        free_shipping: finalPrice >= 79,
      };

      if (categoriaId) payload.category_id = categoriaId;
      if (itemId) payload.item_id = itemId;
      if (mlToken) {
        const savedSellerId = localStorage.getItem("ml_seller_id");
        if (savedSellerId) payload.seller_id = savedSellerId;
      }

      const data = await simulate(payload, mlToken || undefined);
      setMlSim(data.results);
    } catch {
      setSimErro("Erro ao simular. Verifique se o backend está rodando.");
    } finally {
      setIsSimulating(false);
    }
  };

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 w-full max-w-5xl mx-auto">
      {/* Form */}
      <div className="animate-fade-up-delay-1">
        <div className="bg-card rounded-2xl p-8 shadow-[0_1px_3px_hsl(240_10%_80%/0.3),0_8px_32px_hsl(240_10%_80%/0.12)] transition-shadow duration-300 hover:shadow-[0_2px_6px_hsl(240_10%_80%/0.35),0_12px_40px_hsl(240_10%_80%/0.18)]">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-8 uppercase">
            Calculadora
          </h2>

          {/* Marketplace */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Marketplace</label>
            <div className="relative">
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as Marketplace)}
                className={selectClass}
              >
                {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </div>


          {/* Busca de Produto */}
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
            {produtoNome && (
              <p className="text-xs text-primary font-medium truncate">{produtoNome}</p>
            )}
            {produtoErro && (
              <p className="text-xs text-destructive font-medium">{produtoErro}</p>
            )}
          </div>

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

          {/* Custo Operacional */}
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

          <div className="space-y-2 mb-6">
            <label className={labelClass}>Peso do Produto (g)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={pesoGramas}
              readOnly
              placeholder="500"
              className={`${inputClass} opacity-70 cursor-not-allowed`}
            />
            {custoProduto !== "" && (
              <p className="text-xs text-[#00A650] font-medium mt-1">✅ Peso importado do sistema</p>
            )}
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

          {hasFrete && (
            <div className="space-y-2 mb-6">
              <label className={labelClass}>Desconto no Frete (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={descontoFrete}
                onChange={(e) => setDescontoFrete(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                placeholder="0,0"
                className={inputClass}
              />
            </div>
          )}

          {marketplace === "magalu" && (
            <div className="space-y-2 mb-6">
              <label className={labelClass}>Reputação Magalu</label>
              <div className="relative">
                <select
                  value={magaluTier}
                  onChange={(e) => setMagaluTier(e.target.value as MagaluTier)}
                  className={selectClass}
                >
                  {Object.entries(MAGALU_TIER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <ChevronIcon />
              </div>
            </div>
          )}

          {/* Preço de Venda com Desconto */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Preço Final c/ Desconto (R$)</label>
            <input
              type="text"
              readOnly
              value={fmt((parseFloat(precoVenda) || 0) * (1 - desconto / 100))}
              className={`${inputClass} opacity-70 cursor-not-allowed font-bold text-primary`}
            />
          </div>

          {/* Quantidade */}
          <div className="space-y-2 mb-6">
            <label className={labelClass}>Quantidade</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantidade}
              onChange={(e) => setQuantidade(parseInt(e.target.value) || 1)}
              className={inputClass}
            />
          </div>

          {/* Importar Meus Anúncios */}
          {isML && mlToken && (
            <div className="space-y-2 mb-6">
              <button
                onClick={carregarMeusAnuncios}
                disabled={isLoadingItems}
                className="w-full py-3 bg-secondary text-foreground rounded-lg text-sm font-semibold hover:opacity-80 transition-opacity"
              >
                {isLoadingItems ? "Carregando anúncios..." : "☁️ Importar Meus Anúncios do Mercado Livre"}
              </button>
              {myItemsList.length > 0 && (
                <div className="relative mt-2">
                  <select value={selectedMyItem} onChange={handleSelectMyItem} className={selectClass}>
                    <option value="">Selecione um anúncio...</option>
                    {myItemsList.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id} - {item.title} (R$ {item.price})
                      </option>
                    ))}
                  </select>
                  <ChevronIcon />
                </div>
              )}
            </div>
          )}

          {/* O Resto: Frete, Categoria, Item ID */}
          {isML && (
            <>
              <div className="space-y-2 mb-6">
                <label className={labelClass}>Categoria (Produto Inédito)</label>
                <input
                  type="text"
                  value={categoriaId}
                  readOnly
                  placeholder="MLB1055"
                  className={`${inputClass} opacity-70 cursor-not-allowed`}
                />
              </div>

              <div className="space-y-2 mb-6">
                <label className={labelClass}>Item ID ML (opcional)</label>
                <input type="text" value={itemId} readOnly placeholder="MLB123456789" className={`${inputClass} opacity-70 cursor-not-allowed`} />
              </div>
            </>
          )}

          {/* ML Auth + Simular */}
          {isML && simErro && (
            <div className="border-t border-border pt-6 space-y-4">
              <p className="text-xs text-destructive">{simErro}</p>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="animate-fade-up-delay-2">
        <div className="bg-card rounded-2xl p-8 shadow-[0_1px_3px_hsl(240_10%_80%/0.3),0_8px_32px_hsl(240_10%_80%/0.12)] transition-shadow duration-300 hover:shadow-[0_2px_6px_hsl(240_10%_80%/0.35),0_12px_40px_hsl(240_10%_80%/0.18)]">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground mb-8 uppercase">
            Resultado
          </h2>

          <div className="space-y-5">
            <ResultRow label="Marketplace" value={marketplace ? MARKETPLACE_LABELS[marketplace] : "—"} />
            <ResultRow label="Custo do Produto" value={fmt(parseFloat(custoProduto) || 0)} />
            {custoOpUnit != null && (
              <ResultRow label="Custo Operacional" value={fmt(custoOpUnit)} />
            )}
            {custoOpUnit != null && (
              <ResultRow label="Custo Real" value={fmt((parseFloat(custoProduto) || 0) + custoOpUnit)} accent />
            )}
            <ResultRow label="Preço do Produto" value={fmt(parseFloat(precoVenda) || 0)} />
            <ResultRow label="Desconto" value={`${desconto}%`} />
            <ResultRow label="Quantidade" value={String(quantidade)} />

            {marketplace && (
              <>
                {isML && <ResultRow label="Tipo de Anúncio" value={LISTING_LABELS[listingType]} />}
                <ResultRow label="Taxa da Plataforma" value={effectiveTaxaLabel} />
                <ResultRow label="Taxa (R$)" value={fmt(results.taxa)} />
                <ResultRow label="Imposto (21%)" value={fmt(results.imposto)} />
                <ResultRow label="Peso" value={`${pesoGramas}g`} />
                {hasFrete && <ResultRow label="Desconto no Frete" value={`${descontoFrete}%`} />}
                {marketplace === "magalu" && <ResultRow label="Reputação" value={MAGALU_TIER_LABELS[magaluTier]} />}
                {hasFrete && <ResultRow label="Custo de Frete (Estimado)" value={fmt(results.frete)} />}
              </>
            )}

            <ResultRow 
              label="Margem de Lucro Final" 
              value={`${results.margemCalculada.toFixed(2)}%`} 
              colorClass={results.margemCalculada >= 0 ? "text-[#00A650]" : "text-destructive"} 
            />

            {/* Detalhamento real do ML */}
            {mlSim && (
              <>
                <div className="h-px bg-border" />
                <h3 className="font-bold text-foreground mb-4">📊 Detalhamento Real do ML</h3>

                <div className="flex h-4 w-full rounded-full overflow-hidden mb-4 bg-secondary">
                  <div style={{ width: `${Math.max(0, (mlSim.ml_fee_amount / mlSim.gross_revenue) * 100)}%`, backgroundColor: '#FF7733' }} />
                  <div style={{ width: `${Math.max(0, (mlSim.shipping_cost / mlSim.gross_revenue) * 100)}%`, backgroundColor: '#7B61FF' }} />
                  <div style={{ width: `${Math.max(0, (mlSim.tax_amount / mlSim.gross_revenue) * 100)}%`, backgroundColor: '#FFB800' }} />
                  <div style={{ width: `${Math.max(0, (mlSim.product_cost / mlSim.gross_revenue) * 100)}%`, backgroundColor: '#E02020' }} />
                  <div style={{ width: `${Math.max(0, (Math.max(mlSim.net_profit, 0) / mlSim.gross_revenue) * 100)}%`, backgroundColor: '#00A650' }} />
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-foreground" /> <span>Receita Bruta</span></div>
                    <span className="font-bold text-foreground">{fmt(mlSim.gross_revenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#FF7733'}} /> <span>Taxa ML ({mlSim.ml_fee_percent.toFixed(1)}%)</span></div>
                    <span className="text-destructive">− {fmt(mlSim.ml_fee_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#7B61FF'}} /> <span>Frete</span></div>
                    <span className="text-destructive">− {fmt(mlSim.shipping_cost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#FFB800'}} /> <span>Imposto ({mlSim.tax_rate_percent.toFixed(0)}%)</span></div>
                    <span className="text-destructive">− {fmt(mlSim.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#E02020'}} /> <span>Custo do Produto</span></div>
                    <span className="text-destructive">− {fmt(mlSim.product_cost)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-border mt-2">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#00A650'}} /> <span className="font-bold">Lucro Líquido</span></div>
                    <span className={`font-bold ${mlSim.net_profit >= 0 ? "text-[#00A650]" : "text-destructive"}`}>{fmt(mlSim.net_profit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-muted-foreground ml-5">Margem</span>
                    <span className={`font-bold ${mlSim.margin_percent >= 0 ? "text-[#00A650]" : "text-destructive"}`}>{mlSim.margin_percent.toFixed(1)}%</span>
                  </div>
                </div>
              </>
            )}

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

export default MarketplaceCalculator;
