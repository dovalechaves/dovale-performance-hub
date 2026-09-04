import { BarChart3, Calculator, Send, Archive, Bot, Database, ClipboardList, UserPlus, PackageSearch, ShieldCheck, BellRing, ShoppingCart, Sparkles, Compass, TrendingDown, Coins, Search, PackageSearch as PackageSearchIcon, AlertTriangle, FileText } from "lucide-react";
import type { AuthManagedUser } from "@/services/api";
import type { Role } from "@/lib/rbac";

export const CALC_LOJAS = [
  { value: "fast", label: "Fast" },
  { value: "santana", label: "Santana" },
  { value: "rj", label: "Rio de Janeiro" },
];

export const INVENTARIO_LOJAS_DEFAULT = [
  { value: "fortaleza", label: "Fortaleza" },
];

// Lista de lojas usada pelo Fechamento de Estoque
export const FECHAMENTO_LOJAS = ["CAMPINAS", "FORTALEZA", "BELO HORIZONTE", "RIO DE JANEIRO", "SANTANA", "UBERLANDIA"];

// Lista de lojas usada pelo Sales Compass
export const SALES_COMPASS_LOJAS = [
  { value: "l3", label: "RJ" },
  { value: "l2", label: "Santana" },
  { value: "bh", label: "BH" },
  { value: "campinas", label: "Campinas" },
  { value: "riopreto", label: "Rio Preto" },
  { value: "fortaleza", label: "Fortaleza" },
];

export interface AppCard {
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  color: string;
  external?: boolean; // app fora do SPA (aberto via SSO em nova aba)
}

// Setores do Painel de Comissões (RVS_NOME) — usados na config do Gestor
export const PAINEL_SETORES = ["TELEVENDAS", "TELEVENDAS MG", "DISTRIBUIDORES", "FERRAGENS"];
export const PAINEL_ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gestor",
  viewer: "Vendedor",
};

export const APPS: AppCard[] = [
  {
    title: "Painel de Vendas",
    description: "Acompanhe o desempenho dos vendedores e gerencie metas em tempo real.",
    icon: <BarChart3 className="w-8 h-8" />,
    route: "/dashboard",
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30 hover:border-blue-500/60",
  },
  {
    title: "Calculadora de Marketplace",
    description: "Simule preços, taxas e margem de lucro para Mercado Livre, Shopee e mais.",
    icon: <Calculator className="w-8 h-8" />,
    route: "/calculadora",
    color: "from-green-500/20 to-green-600/10 border-green-500/30 hover:border-green-500/60",
  },
  {
    title: "Disparo em Massa",
    description: "Dispare mensagens WhatsApp via Meta API com integração Chatwoot.",
    icon: <Send className="w-8 h-8" />,
    route: "/disparo",
    color: "from-purple-500/20 to-purple-600/10 border-purple-500/30 hover:border-purple-500/60",
  },
  {
    title: "Fechamento Estoque",
    description: "Acompanhe o fechamento mensal de estoque, vendas e recebimentos por loja.",
    icon: <Archive className="w-8 h-8" />,
    route: "/fechamento",
    color: "from-orange-500/20 to-orange-600/10 border-orange-500/30 hover:border-orange-500/60",
  },
  {
    title: "Bot de Demandas",
    description: "Colete requisitos com IA e gere documentos de especificação automaticamente.",
    icon: <Bot className="w-8 h-8" />,
    route: "/ai-assistant",
    color: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 hover:border-cyan-500/60",
  },
  {
    title: "Multi-Preço",
    description: "Sincronize preços da loja SJC para todas as filiais Firebird e MySQL.",
    icon: <Database className="w-8 h-8" />,
    route: "/multi-preco",
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/30 hover:border-amber-500/60",
  },
  {
    title: "Inventário",
    description: "Gerencie inventários de estoque por loja com contagem, aprovação e auditoria.",
    icon: <ClipboardList className="w-8 h-8" />,
    route: "/inventario",
    color: "from-teal-500/20 to-teal-600/10 border-teal-500/30 hover:border-teal-500/60",
  },
  {
    title: "Onboarding",
    description: "Crie usuários no Active Directory automaticamente para novos funcionários.",
    icon: <UserPlus className="w-8 h-8" />,
    route: "/onboarding",
    color: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30 hover:border-indigo-500/60",
  },
  {
    title: "Score de Crédito",
    description: "Consulte histórico financeiro do cliente e limite de crédito ajustado por score.",
    icon: <ShieldCheck className="w-8 h-8" />,
    route: "/score",
    color: "from-rose-500/20 to-rose-600/10 border-rose-500/30 hover:border-rose-500/60",
  },
  {
    title: "Cobrança Automatizada",
    description: "Disparo automático de mensagens WhatsApp para clientes com boletos vencidos ou a vencer.",
    icon: <BellRing className="w-8 h-8" />,
    route: "/cobranca",
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 hover:border-emerald-500/60",
  },
  {
    title: "Relatórios Ecommerce",
    description: "Acompanhe KPIs de vendas online e simule envios diários e mensais via WhatsApp.",
    icon: <ShoppingCart className="w-8 h-8" />,
    route: "/ecommerce-disparo",
    color: "from-sky-500/20 to-emerald-600/10 border-sky-500/30 hover:border-sky-500/60",
  },
  {
    title: "Sugestão de Compras",
    description: "Calcule sugestões de reposição por loja com base no histórico de vendas Microsys.",
    icon: <Sparkles className="w-8 h-8" />,
    route: "/sugestao-compras",
    color: "from-violet-500/20 to-violet-600/10 border-violet-500/30 hover:border-violet-500/60",
  },
  {
    title: "Sales Compass",
    description: "CRM de carteira de clientes com metas por vendedor, categorias A-D e histórico de contatos.",
    icon: <Compass className="w-8 h-8" />,
    route: "/sales-compass",
    color: "from-fuchsia-500/20 to-pink-600/10 border-fuchsia-500/30 hover:border-fuchsia-500/60",
  },
  {
    title: "Relatório de Custos",
    description: "Custo dos templates de WhatsApp por setor, com filtro por mês (USD e BRL).",
    icon: <TrendingDown className="w-8 h-8" />,
    route: "/relatorio-custos",
    color: "from-red-500/20 to-red-600/10 border-red-500/30 hover:border-red-500/60",
  },
  {
    title: "Painel de Comissões",
    description: "Metas, bônus e comissões por setor e vendedor, consolidando vendas de todas as lojas.",
    icon: <Coins className="w-8 h-8" />,
    route: "/comissao",
    color: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30 hover:border-yellow-500/60",
  },
  {
    title: "Primeira Movimentação",
    description: "Monitore produtos com primeira movimentação no mês e notifique via Chatwoot.",
    icon: <PackageSearch className="w-8 h-8" />,
    route: "/primeira-movimentacao",
    color: "from-lime-500/20 to-lime-600/10 border-lime-500/30 hover:border-lime-500/60",
  },
  {
    title: "Inventário FULL API",
    description: "Verifique estoques FULL nos marketplaces (ML, Shopee, Amazon) e gere inventário.",
    icon: <PackageSearchIcon className="w-8 h-8" />,
    route: "/inventario-full-api",
    color: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30 hover:border-indigo-500/60",
  },
  {
    title: "Prospecção",
    description: "Consulte a cobertura da base por região: % de clientes na base e oportunidades por estado e cidade.",
    icon: <Search className="w-8 h-8" />,
    route: "/prospeccao",
    color: "from-teal-500/20 to-cyan-600/10 border-teal-500/30 hover:border-teal-500/60",
  },
  {
    title: "Estoque Mínimo",
    description: "Alerta de produtos da base SJC com saldo abaixo do estoque mínimo cadastrado no Microsys.",
    icon: <AlertTriangle className="w-8 h-8" />,
    route: "/estoque-minimo",
    color: "from-amber-500/20 to-red-600/10 border-amber-500/30 hover:border-amber-500/60",
  },
  {
    title: "Notas Fiscais Amazon",
    description: "Importe o ZIP do Faturador Amazon FBA Classic e concilie as notas fiscais com os pedidos.",
    icon: <FileText className="w-8 h-8" />,
    route: "/notas-fiscais-amazon",
    color: "from-blue-500/20 to-indigo-600/10 border-blue-500/30 hover:border-blue-500/60",
  },
];

export const APP_BY_ROUTE: Record<string, keyof AuthManagedUser["apps"]> = {
  "/dashboard": "dashboard",
  "/calculadora": "calculadora",
  "/disparo": "disparo",
  "/fechamento": "fechamento",
  "/ai-assistant": "assistente",
  "/multi-preco": "multipreco",
  "/inventario": "inventario",
  "/onboarding": "onboarding",
  "/score": "score",
  "/cobranca": "cobranca",
  "/ecommerce-disparo": "ecommercedisparo",
  "/sugestao-compras": "sugestaocompras",
  "/sales-compass": "salescompass",
  "/relatorio-custos": "relatoriocustos",
  "/comissao": "painelcomissao",
  "/primeira-movimentacao": "primeiramov",
  "/inventario-full-api": "invfull",
  "/prospeccao": "prospeccao",
  "/estoque-minimo": "estoqueminimo",
  "/notas-fiscais-amazon": "notasfiscaisamazon",
};
