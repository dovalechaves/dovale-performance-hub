import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, LogIn, Loader2, Sun, Moon } from "lucide-react";
import logoWhite from "@/assets/logo-white.png";
import logoBlue from "@/assets/logo-blue.png";
import { useAuth } from "@/context/AuthContext";
import { API_BASE } from "@/services/api";

export default function Login() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);
  const { login } = useAuth();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");

    if (!usuario.trim() || !senha.trim()) {
      setErro("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data?.error || data?.mensagem || data?.message || "Usuário ou senha inválidos.");
        return;
      }

      const data = await res.json().catch(() => ({}));
      const token = data?.token || data?.access_token || "authenticated";
      login(
        usuario,
        token,
        data?.role,
        data?.loja,
        data?.can_access_dashboard !== false,
        data?.can_access_hub !== false,
        data?.apps
      );
      navigate("/");
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background scanline flex items-center justify-center px-4">
      <button
        onClick={() => setDark(!dark)}
        className="fixed top-4 right-4 w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
      >
        {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <img src={logoWhite} alt="Dovale" className="h-10 w-auto dark:block hidden" />
          <img src={logoBlue} alt="Dovale" className="h-10 w-auto dark:hidden block" />
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Painel de Vendas
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-gradient-card metal-texture p-6 space-y-5">
          <h1 className="text-lg font-semibold text-foreground text-center">Entrar</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Usuário */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Usuário
              </label>
              <input
                type="text"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoComplete="username"
                disabled={loading}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                placeholder="seu usuário"
              />
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Erro */}
            {erro && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-red-400 text-center"
              >
                {erro}
              </motion.p>
            )}

            {/* Botão */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Dovale · +30 anos no mercado de chaves e ferragens
        </p>
      </motion.div>
    </div>
  );
}
