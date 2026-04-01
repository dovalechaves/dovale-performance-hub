import { useState, useEffect } from "react";
import { X, Users } from "lucide-react";
import { STATIC_USER_ROLES, ROLE_LABELS } from "@/lib/rbac";
import { CalcRole, CALC_ROLE_LABELS, getCalcRole, setCalcRole } from "@/lib/calc-roles";

interface Props {
  onClose: () => void;
}

const ALL_USERS = Object.entries(STATIC_USER_ROLES).map(([usuario, role]) => ({ usuario, role }));

export default function GerenciamentoCalc({ onClose }: Props) {
  const [calcRoles, setCalcRoles] = useState<Record<string, CalcRole>>({});

  useEffect(() => {
    const map: Record<string, CalcRole> = {};
    for (const { usuario } of ALL_USERS) {
      map[usuario] = getCalcRole(usuario);
    }
    setCalcRoles(map);
  }, []);

  const handleChange = (usuario: string, role: CalcRole) => {
    setCalcRole(usuario, role);
    setCalcRoles(prev => ({ ...prev, [usuario]: role }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-fade-up-delay-1">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
              Permissões da Calculadora
            </h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-widest">
              Admin
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-destructive/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-3">
          <p className="text-xs text-muted-foreground mb-4">
            Define qual calculadora cada usuário acessa. Administradores sempre veem ambas.
          </p>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Usuário</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Calculadora</th>
                </tr>
              </thead>
              <tbody>
                {ALL_USERS.map(({ usuario, role }) => {
                  const isAdmin = role === "admin";
                  return (
                    <tr
                      key={usuario}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{usuario}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest
                          ${role === "admin"   ? "bg-primary/15 text-primary" :
                            role === "manager" ? "bg-blue-500/15 text-blue-400" :
                            "bg-muted text-muted-foreground"}`}>
                          {ROLE_LABELS[role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isAdmin ? (
                          <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">
                            Ambas
                          </span>
                        ) : (
                          <div className="inline-flex rounded-lg border border-border overflow-hidden">
                            {(Object.entries(CALC_ROLE_LABELS) as [CalcRole, string][]).map(([cr, label]) => (
                              <button
                                key={cr}
                                onClick={() => handleChange(usuario, cr)}
                                className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors
                                  ${calcRoles[usuario] === cr
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                                  }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground pt-1">
            * Alterações têm efeito imediato no próximo acesso do usuário.
          </p>
        </div>
      </div>
    </div>
  );
}
