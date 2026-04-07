import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
