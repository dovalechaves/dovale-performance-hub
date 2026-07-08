import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import Hub from "./pages/Hub.tsx";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Gestao from "./pages/Gestao.tsx";
import Calculadora from "./pages/Calculadora.tsx";
import NotFound from "./pages/NotFound.tsx";
import Disparo from "./pages/Disparo.tsx";
import Fechamento from "./pages/Fechamento.tsx";
import AiAssistant from "./pages/AiAssistant.tsx";
import MultiPreco from "./pages/MultiPreco.tsx";
import Inventario from "./pages/Inventario.tsx";
import Onboarding from "./pages/Onboarding.tsx";
import Score from "./pages/Score.tsx";
import Cobranca from "./pages/Cobranca.tsx";
import EcommerceDisparo from "./pages/EcommerceDisparo.tsx";
import SugestaoCompras from "./pages/SugestaoCompras.tsx";
import SalesCompass from "./pages/SalesCompass.tsx";
import RelatorioCustos from "./pages/RelatorioCustos.tsx";
import ComissaoDashboard from "./pages/comissao/Dashboard.tsx";
import ComissaoVendedor from "./pages/comissao/Vendedor.tsx";
import ComissaoGestor from "./pages/comissao/Gestor.tsx";
import ComissaoSimulacao from "./pages/comissao/Simulacao.tsx";
import ComissaoConfiguracao from "./pages/comissao/Configuracao.tsx";
import { ComissaoErrorBoundary } from "./pages/comissao/ComissaoErrorBoundary.tsx";
import React from "react";

const queryClient = new QueryClient();

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function DashboardRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.dashboard.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function CalculadoraRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.calculadora.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function DisparoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.disparo.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function FechamentoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.fechamento.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function AssistenteRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.assistente.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function MultiPrecoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.multipreco.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function InventarioRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.inventario.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.onboarding.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function ScoreRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.score.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function CobrancaRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.cobranca.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function EcommerceDisparoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.ecommercedisparo?.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function SugestaoComprasRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.sugestaocompras.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function SalesCompassRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.salescompass?.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

// Relatório de Custos usa os mesmos dados do Disparo (Meta/WhatsApp + etiquetas);
// reutiliza o acesso do app de Disparo.
function RelatorioCustosRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.disparo.canAccess) return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

function ComissaoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  if (!user.apps.painelcomissao?.canAccess) return <Navigate to="/hub" replace />;
  const painelRole = user.apps.painelcomissao.role;
  const allowedByRole: Record<string, string[]> = {
    admin: ["/comissao", "/comissao/vendedor", "/comissao/gestor", "/comissao/simulacao", "/comissao/configuracao"],
    manager: ["/comissao/vendedor", "/comissao/gestor", "/comissao/simulacao", "/comissao/configuracao"],
    viewer: ["/comissao/vendedor", "/comissao/simulacao"],
  };
  const allowed = allowedByRole[painelRole] ?? allowedByRole.viewer;
  if (!allowed.includes(location.pathname)) {
    const fallback = painelRole === "manager" ? "/comissao/gestor" : "/comissao/vendedor";
    return <Navigate to={fallback} replace />;
  }
  return <ComissaoErrorBoundary>{children}</ComissaoErrorBoundary>;
}

function AdminManagerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.canAccessHub) return <Navigate to="/login" replace />;
  const dashboardRole = user.apps.dashboard.role;
  if (dashboardRole !== "admin" && dashboardRole !== "manager") return <Navigate to="/hub" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/hub" replace />} />
            <Route path="/hub" element={<PrivateRoute><Hub /></PrivateRoute>} />
            <Route path="/dashboard" element={<DashboardRoute><Index /></DashboardRoute>} />
            <Route path="/gestao" element={<AdminManagerRoute><Gestao /></AdminManagerRoute>} />
            <Route path="/calculadora" element={<CalculadoraRoute><Calculadora /></CalculadoraRoute>} />
            <Route path="/disparo" element={<DisparoRoute><Disparo /></DisparoRoute>} />
            <Route path="/fechamento" element={<FechamentoRoute><Fechamento /></FechamentoRoute>} />
            <Route path="/ai-assistant" element={<AssistenteRoute><AiAssistant /></AssistenteRoute>} />
            <Route path="/multi-preco" element={<MultiPrecoRoute><MultiPreco /></MultiPrecoRoute>} />
            <Route path="/inventario" element={<InventarioRoute><Inventario /></InventarioRoute>} />
            <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
            <Route path="/score" element={<ScoreRoute><Score /></ScoreRoute>} />
            <Route path="/cobranca" element={<CobrancaRoute><Cobranca /></CobrancaRoute>} />
            <Route path="/ecommerce-disparo" element={<EcommerceDisparoRoute><EcommerceDisparo /></EcommerceDisparoRoute>} />
            <Route path="/sugestao-compras" element={<SugestaoComprasRoute><SugestaoCompras /></SugestaoComprasRoute>} />
            <Route path="/sales-compass" element={<SalesCompassRoute><SalesCompass /></SalesCompassRoute>} />
            <Route path="/relatorio-custos" element={<RelatorioCustosRoute><RelatorioCustos /></RelatorioCustosRoute>} />
            <Route path="/comissao" element={<ComissaoRoute><ComissaoDashboard /></ComissaoRoute>} />
            <Route path="/comissao/vendedor" element={<ComissaoRoute><ComissaoVendedor /></ComissaoRoute>} />
            <Route path="/comissao/gestor" element={<ComissaoRoute><ComissaoGestor /></ComissaoRoute>} />
            <Route path="/comissao/simulacao" element={<ComissaoRoute><ComissaoSimulacao /></ComissaoRoute>} />
            <Route path="/comissao/configuracao" element={<ComissaoRoute><ComissaoConfiguracao /></ComissaoRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
