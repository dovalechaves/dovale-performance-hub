import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Settings2, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { API_BASE, LOJAS, getAuthUsers, updateAuthUserRole, type AuthManagedUser } from "@/services/api";
import { ROLE_LABELS, HUB_ROLE_LABELS, type HubRole, type Role } from "@/lib/rbac";
import {
  APPS,
  APP_BY_ROUTE,
  CALC_LOJAS,
  FECHAMENTO_LOJAS,
  INVENTARIO_LOJAS_DEFAULT,
  SALES_COMPASS_LOJAS,
  PAINEL_SETORES,
  PAINEL_ROLE_LABELS,
  type AppCard,
} from "./appsConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AppKey = keyof AuthManagedUser["apps"];

const ALL_APP_KEYS = APPS.map((a) => APP_BY_ROUTE[a.route]) as AppKey[];
const TOTAL_APPS = ALL_APP_KEYS.length;
const SPECIAL_KEYS = new Set<AppKey>(["dashboard", "calculadora", "fechamento", "inventario", "salescompass", "painelcomissao"]);

const USERS_PER_PAGE = 20;

function smallIcon(icon: React.ReactNode) {
  return isValidElement(icon) ? cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "w-4 h-4" }) : icon;
}

function cascadeHubAccess(u: AuthManagedUser, enabled: boolean): AuthManagedUser {
  const apps: any = { ...u.apps };
  for (const key of ALL_APP_KEYS) {
    apps[key] = { ...apps[key], can_access: enabled ? apps[key].can_access : false };
  }
  return {
    ...u,
    can_access_hub: enabled,
    apps: apps as AuthManagedUser["apps"],
    can_access_dashboard: enabled ? u.apps.dashboard.can_access : false,
  };
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function RoleSelect({
  value,
  disabled,
  onChange,
  labels = ROLE_LABELS,
}: {
  value: Role;
  disabled: boolean;
  onChange: (r: Role) => void;
  labels?: Record<Role, string>;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className="h-8 w-[118px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(labels) as Role[]).map((r) => (
          <SelectItem key={r} value={r} className="text-xs">
            {labels[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LojaSelect({
  value,
  options,
  disabled,
  onChange,
  noneLabel = "— Nenhuma —",
}: {
  value: string | null;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (v: string | null) => void;
  noneLabel?: string;
}) {
  return (
    <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)} disabled={disabled}>
      <SelectTrigger className="h-8 w-[150px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs text-muted-foreground">
          {noneLabel}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AppRowShell({
  icon,
  title,
  children,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {extra && <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">{extra}</div>}
    </div>
  );
}

// ─── Rep Selector (Sales Compass) ────────────────────────────────────────────
const scVendCache: Record<string, { rep_codigo: number; rep_nome: string }[]> = {};

function RepSelectorCell({
  lojaKey,
  value,
  onChange,
  disabled,
}: {
  lojaKey: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
}) {
  const [options, setOptions] = useState<{ rep_codigo: number; rep_nome: string }[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentName = options.find((o) => o.rep_codigo === value)?.rep_nome ?? "";

  useEffect(() => {
    setQuery(value && currentName ? currentName : "");
  }, [value, currentName]);

  useEffect(() => {
    if (!lojaKey) { setOptions([]); return; }
    if (scVendCache[lojaKey]) { setOptions(scVendCache[lojaKey]); return; }
    setLoading(true);
    fetch(`${API_BASE}/sales-compass/vendedores?loja=${encodeURIComponent(lojaKey)}`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        scVendCache[lojaKey] = list;
        setOptions(list);
      })
      .catch((err) => console.error("[RepSelectorCell] falha ao buscar vendedores:", err))
      .finally(() => setLoading(false));
  }, [lojaKey]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value && currentName ? currentName : "");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [value, currentName]);

  const filtered = query
    ? options.filter((o) =>
        o.rep_nome.toLowerCase().includes(query.toLowerCase()) ||
        String(o.rep_codigo).includes(query)
      )
    : options;

  return (
    <div ref={containerRef} className="relative w-44">
      <input
        type="text"
        value={query}
        disabled={disabled || !lojaKey}
        placeholder={loading ? "Carregando..." : lojaKey ? "Buscar rep..." : "— sem loja —"}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className="w-full rounded-lg border border-border bg-muted px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          <li
            onMouseDown={() => { onChange(null); setQuery(""); setOpen(false); }}
            className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            — Nenhum —
          </li>
          {filtered.map((o) => (
            <li
              key={o.rep_codigo}
              onMouseDown={() => { onChange(o.rep_codigo); setQuery(o.rep_nome); setOpen(false); }}
              className={`cursor-pointer px-3 py-1.5 text-xs hover:bg-muted ${value === o.rep_codigo ? "font-semibold text-primary" : "text-foreground"}`}
            >
              {o.rep_nome}
              <span className="ml-1.5 text-[10px] text-muted-foreground">#{o.rep_codigo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SimpleAppKey =
  | "disparo" | "assistente" | "multipreco" | "onboarding" | "score" | "cobranca"
  | "ecommercedisparo" | "sugestaocompras" | "relatoriocustos" | "primeiramov"
  | "invfull" | "prospeccao" | "estoqueminimo" | "notasfiscaisamazon";

function SimpleAppRow({
  appKey, title, icon, u, disabled, onUpdate,
}: {
  appKey: SimpleAppKey;
  title: string;
  icon: React.ReactNode;
  u: AuthManagedUser;
  disabled: boolean;
  onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void;
}) {
  const state = u.apps[appKey];
  return (
    <AppRowShell icon={icon} title={title}>
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            apps: { ...cur.apps, [appKey]: { ...cur.apps[appKey], role } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, [appKey]: { ...cur.apps[appKey], can_access: checked } },
        }))}
      />
    </AppRowShell>
  );
}

function DashboardAppRow({ app, u, disabled, onUpdate }: { app: AppCard; u: AuthManagedUser; disabled: boolean; onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void }) {
  const state = u.apps.dashboard;
  return (
    <AppRowShell
      icon={smallIcon(app.icon)}
      title={app.title}
      extra={state.can_access && state.role === "manager" && (
        <>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Loja</span>
          <LojaSelect
            value={state.loja}
            options={LOJAS}
            disabled={disabled}
            onChange={(loja) => onUpdate((cur) => ({
              ...cur,
              loja: loja ?? cur.loja,
              apps: { ...cur.apps, dashboard: { ...cur.apps.dashboard, loja } },
            }))}
          />
        </>
      )}
    >
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            role,
            loja: role === "manager" ? (cur.loja ?? "bh") : null,
            apps: { ...cur.apps, dashboard: { ...cur.apps.dashboard, role, loja: role === "manager" ? (cur.apps.dashboard.loja ?? cur.loja ?? "bh") : null } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, dashboard: { ...cur.apps.dashboard, can_access: checked } },
          can_access_dashboard: checked,
        }))}
      />
    </AppRowShell>
  );
}

function CalculadoraAppRow({ app, u, disabled, onUpdate }: { app: AppCard; u: AuthManagedUser; disabled: boolean; onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void }) {
  const state = u.apps.calculadora;
  return (
    <AppRowShell
      icon={smallIcon(app.icon)}
      title={app.title}
      extra={state.can_access && state.role === "manager" && (
        <>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Loja</span>
          <LojaSelect
            value={state.loja}
            options={CALC_LOJAS}
            disabled={disabled}
            onChange={(loja) => onUpdate((cur) => ({
              ...cur,
              apps: { ...cur.apps, calculadora: { ...cur.apps.calculadora, loja } },
            }))}
          />
        </>
      )}
    >
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            apps: { ...cur.apps, calculadora: { ...cur.apps.calculadora, role, loja: role === "manager" ? (cur.apps.calculadora.loja ?? "fast") : null } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, calculadora: { ...cur.apps.calculadora, can_access: checked } },
        }))}
      />
    </AppRowShell>
  );
}

function FechamentoAppRow({ app, u, disabled, onUpdate }: { app: AppCard; u: AuthManagedUser; disabled: boolean; onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void }) {
  const state = u.apps.fechamento;
  const lojaOptions = FECHAMENTO_LOJAS.map((l) => ({ value: l, label: l }));
  return (
    <AppRowShell
      icon={smallIcon(app.icon)}
      title={app.title}
      extra={state.can_access && state.role === "manager" && (
        <>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Loja</span>
          <LojaSelect
            value={state.loja}
            options={lojaOptions}
            disabled={disabled}
            onChange={(loja) => onUpdate((cur) => ({
              ...cur,
              apps: { ...cur.apps, fechamento: { ...cur.apps.fechamento, loja } },
            }))}
          />
        </>
      )}
    >
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            apps: { ...cur.apps, fechamento: { ...cur.apps.fechamento, role, loja: role === "manager" ? (cur.apps.fechamento.loja ?? cur.loja ?? "CAMPINAS") : null } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, fechamento: { ...cur.apps.fechamento, can_access: checked } },
        }))}
      />
    </AppRowShell>
  );
}

function InventarioAppRow({ app, u, disabled, inventarioLojas, fbUsers, onUpdate }: {
  app: AppCard; u: AuthManagedUser; disabled: boolean;
  inventarioLojas: { value: string; label: string }[];
  fbUsers: { codigo: number; nome: string }[];
  onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void;
}) {
  const state = u.apps.inventario;
  return (
    <AppRowShell
      icon={smallIcon(app.icon)}
      title={app.title}
      extra={state.can_access && (
        <>
          {state.role === "manager" && (
            <>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Loja</span>
              <LojaSelect
                value={state.loja}
                options={inventarioLojas}
                disabled={disabled}
                noneLabel="Todas"
                onChange={(loja) => onUpdate((cur) => ({
                  ...cur,
                  apps: { ...cur.apps, inventario: { ...cur.apps.inventario, loja } },
                }))}
              />
            </>
          )}
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Usuário no sistema</span>
          <Select
            value={state.usu_codigo_sistema != null ? String(state.usu_codigo_sistema) : "__none__"}
            onValueChange={(v) => onUpdate((cur) => ({
              ...cur,
              apps: { ...cur.apps, inventario: { ...cur.apps.inventario, usu_codigo_sistema: v === "__none__" ? null : Number(v) } },
            }))}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">—</SelectItem>
              {fbUsers.map((fb) => (
                <SelectItem key={fb.codigo} value={String(fb.codigo)} className="text-xs">
                  {fb.codigo} - {fb.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    >
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            apps: { ...cur.apps, inventario: { ...cur.apps.inventario, role, loja: role === "manager" ? (cur.apps.inventario.loja ?? inventarioLojas[0]?.value ?? "fortaleza") : null } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, inventario: { ...cur.apps.inventario, can_access: checked } },
        }))}
      />
    </AppRowShell>
  );
}

function SalesCompassAppRow({ app, u, disabled, onUpdate }: { app: AppCard; u: AuthManagedUser; disabled: boolean; onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void }) {
  const state = u.apps.salescompass;
  return (
    <AppRowShell
      icon={smallIcon(app.icon)}
      title={app.title}
      extra={state.can_access && (
        <>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Loja</span>
          <LojaSelect
            value={state.loja}
            options={SALES_COMPASS_LOJAS}
            disabled={disabled}
            onChange={(loja) => onUpdate((cur) => ({
              ...cur,
              apps: { ...cur.apps, salescompass: { ...cur.apps.salescompass, loja } },
            }))}
          />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Representante</span>
          <RepSelectorCell
            lojaKey={state.loja ?? ""}
            value={state.usu_codigo_sistema ?? null}
            disabled={disabled}
            onChange={(val) => onUpdate((cur) => ({
              ...cur,
              apps: { ...cur.apps, salescompass: { ...cur.apps.salescompass, usu_codigo_sistema: val } },
            }))}
          />
        </>
      )}
    >
      {state.can_access && (
        <RoleSelect
          value={state.role}
          disabled={disabled}
          onChange={(role) => onUpdate((cur) => ({
            ...cur,
            apps: { ...cur.apps, salescompass: { ...cur.apps.salescompass, role } },
          }))}
        />
      )}
      <Switch
        checked={state.can_access}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: { ...cur.apps, salescompass: { ...cur.apps.salescompass, can_access: checked } },
        }))}
      />
    </AppRowShell>
  );
}

function PainelComissaoAppRow({ app, u, disabled, onUpdate, onOpenModal }: {
  app: AppCard; u: AuthManagedUser; disabled: boolean;
  onUpdate: (updater: (u: AuthManagedUser) => AuthManagedUser) => void;
  onOpenModal: () => void;
}) {
  const state = u.apps.painelcomissao;
  return (
    <AppRowShell icon={smallIcon(app.icon)} title={app.title}>
      {state.can_access && (
        <Button type="button" variant="secondary" size="sm" className="h-8 text-xs" onClick={onOpenModal}>
          <Settings2 className="w-3.5 h-3.5" />
          {PAINEL_ROLE_LABELS[state.role ?? "viewer"]}
        </Button>
      )}
      <Switch
        checked={state.can_access ?? false}
        disabled={disabled}
        onCheckedChange={(checked) => onUpdate((cur) => ({
          ...cur,
          apps: {
            ...cur.apps,
            painelcomissao: {
              ...cur.apps.painelcomissao,
              app_key: "painelcomissao",
              role: cur.apps.painelcomissao?.role ?? "viewer",
              loja: null,
              can_access: checked,
              config: cur.apps.painelcomissao?.config ?? { setores: [], nome_vendedor: null },
            },
          },
        }))}
      />
    </AppRowShell>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user } = useAuth();
  const [managedUsers, setManagedUsers] = useState<AuthManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [appUserFilter, setAppUserFilter] = useState<"all" | AppKey>("all");
  const [userPage, setUserPage] = useState(1);
  const [fbUsers, setFbUsers] = useState<{ codigo: number; nome: string }[]>([]);
  const [inventarioLojas, setInventarioLojas] = useState(INVENTARIO_LOJAS_DEFAULT);
  const [detailUsuario, setDetailUsuario] = useState<string | null>(null);
  const [appSearch, setAppSearch] = useState("");
  const [painelModal, setPainelModal] = useState<AuthManagedUser | null>(null);
  const [painelForm, setPainelForm] = useState<{ role: Role; setores: string[]; nome_vendedor: string }>({
    role: "viewer", setores: [], nome_vendedor: "",
  });

  const loadManagedUsers = useCallback(async () => {
    if (!user || user.hubRole !== "admin") return;
    setUsersLoading(true);
    setUsersError("");
    try {
      const data = await getAuthUsers(user.usuario);
      setManagedUsers(data);
    } catch (e: unknown) {
      setUsersError(e instanceof Error ? e.message : "Erro ao carregar usuários");
    } finally {
      setUsersLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user?.hubRole !== "admin") return;
    loadManagedUsers();
    fetch(`${API_BASE}/inventario/lojas`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data) && data.length) setInventarioLojas(data); })
      .catch(() => {});
    fetch(`${API_BASE}/inventario/usuarios-sistema`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setFbUsers(data); })
      .catch(() => {});
  }, [user?.hubRole, loadManagedUsers]);

  const persistUser = async (next: AuthManagedUser) => {
    if (!user) return;
    setSavingUser(next.usuario);
    setUsersError("");
    try {
      await updateAuthUserRole({
        actor_usuario: user.usuario,
        usuario: next.usuario,
        can_access_hub: next.can_access_hub,
        hub_role: next.hub_role,
        apps: next.apps,
      });
      setSavedUser(next.usuario);
      setTimeout(() => setSavedUser(null), 2000);
    } catch (e: unknown) {
      setUsersError(e instanceof Error ? e.message : "Erro ao salvar usuário");
    } finally {
      setSavingUser(null);
    }
  };

  const updateManagedUser = (usuario: string, updater: (u: AuthManagedUser) => AuthManagedUser) => {
    setManagedUsers((prev) => prev.map((u) => (u.usuario === usuario ? updater(u) : u)));
  };

  const applyAndPersist = (usuario: string, updater: (u: AuthManagedUser) => AuthManagedUser) => {
    const current = managedUsers.find((x) => x.usuario === usuario);
    if (!current) return;
    const next = updater(current);
    updateManagedUser(usuario, () => next);
    void persistUser(next);
  };

  const openPainelModal = (u: AuthManagedUser) => {
    const cfg = u.apps.painelcomissao?.config ?? { setores: [], nome_vendedor: null };
    setPainelForm({
      role: u.apps.painelcomissao?.role ?? "viewer",
      setores: Array.isArray(cfg.setores) ? cfg.setores : [],
      nome_vendedor: cfg.nome_vendedor ?? "",
    });
    setPainelModal(u);
  };

  const savePainelConfig = async () => {
    if (!painelModal) return;
    const u = painelModal;
    const next: AuthManagedUser = {
      ...u,
      apps: {
        ...u.apps,
        painelcomissao: {
          ...u.apps.painelcomissao,
          app_key: "painelcomissao",
          role: painelForm.role,
          loja: null,
          can_access: u.apps.painelcomissao?.can_access ?? false,
          config: {
            setores: painelForm.role === "manager" ? painelForm.setores : [],
            nome_vendedor: painelForm.role === "viewer" ? (painelForm.nome_vendedor.trim() || null) : null,
          },
        },
      },
    };
    updateManagedUser(u.usuario, () => next);
    setPainelModal(null);
    await persistUser(next);
  };

  const appFilterOptions = APPS
    .map((app) => {
      const appKey = APP_BY_ROUTE[app.route];
      return appKey ? { key: appKey, label: app.title } : null;
    })
    .filter((item): item is { key: AppKey; label: string } => item !== null);

  const filteredManagedUsers = useMemo(() => managedUsers.filter((u) => {
    const term = userSearch.trim().toLowerCase();
    const matchesSearch = !term || (
      u.usuario.toLowerCase().includes(term) ||
      u.displayname.toLowerCase().includes(term) ||
      u.department.toLowerCase().includes(term)
    );

    if (appUserFilter === "all") return matchesSearch;

    return u.can_access_hub && u.apps[appUserFilter].can_access && matchesSearch;
  }), [managedUsers, userSearch, appUserFilter]);

  const userTotalPages = Math.max(1, Math.ceil(filteredManagedUsers.length / USERS_PER_PAGE));
  const safeUserPage = Math.min(userPage, userTotalPages);
  const userPageStart = (safeUserPage - 1) * USERS_PER_PAGE;
  const pagedUsers = useMemo(
    () => filteredManagedUsers.slice(userPageStart, userPageStart + USERS_PER_PAGE),
    [filteredManagedUsers, userPageStart]
  );

  useEffect(() => { setUserPage(1); }, [userSearch, appUserFilter]);

  const detailUser = managedUsers.find((u) => u.usuario === detailUsuario) ?? null;
  const visibleApps = useMemo(() => {
    const term = appSearch.trim().toLowerCase();
    if (!term) return APPS;
    return APPS.filter((a) => a.title.toLowerCase().includes(term));
  }, [appSearch]);

  return (
    <section className="mt-12 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
            Gerenciamento de Usuários e Apps
          </h2>
        </div>
        <Button variant="secondary" size="sm" onClick={loadManagedUsers} disabled={usersLoading}>
          <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {usersError && <p className="text-xs text-destructive">{usersError}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Pesquisar por usuário, nome ou departamento"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <Select value={appUserFilter} onValueChange={(v) => setAppUserFilter(v as "all" | AppKey)}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos os usuários</SelectItem>
            {appFilterOptions.map((app) => (
              <SelectItem key={app.key} value={app.key} className="text-xs">{app.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[10px] uppercase tracking-widest">Usuário</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Departamento</TableHead>
              <TableHead className="text-center text-[10px] uppercase tracking-widest">Acesso Hub</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Role Hub</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Apps liberados</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-widest">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto w-5 h-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filteredManagedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                  {appUserFilter === "all"
                    ? "Nenhum usuário encontrado para a busca informada."
                    : "Nenhum usuário habilitado no Hub e no app selecionado."}
                </TableCell>
              </TableRow>
            ) : (
              pagedUsers.map((u) => {
                const grantedCount = ALL_APP_KEYS.filter((k) => u.apps[k]?.can_access).length;
                const disabled = savingUser === u.usuario;
                return (
                  <TableRow key={u.usuario} className="cursor-pointer" onClick={() => setDetailUsuario(u.usuario)}>
                    <TableCell>
                      <div className="font-medium text-foreground">{u.displayname || "—"}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{u.usuario}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.department || "—"}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={u.can_access_hub}
                        disabled={disabled}
                        onCheckedChange={(checked) => applyAndPersist(u.usuario, (cur) => cascadeHubAccess(cur, checked))}
                      />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={u.hub_role}
                        disabled={disabled || !u.can_access_hub}
                        onValueChange={(v) => applyAndPersist(u.usuario, (cur) => ({ ...cur, hub_role: v as HubRole }))}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(HUB_ROLE_LABELS) as HubRole[]).map((r) => (
                            <SelectItem key={r} value={r} className="text-xs">{HUB_ROLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={grantedCount > 0 ? "secondary" : "outline"} className="font-normal">
                        {grantedCount} de {TOTAL_APPS} apps
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {savingUser === u.usuario && <span className="text-muted-foreground">Salvando...</span>}
                      {savedUser === u.usuario && <span className="font-semibold text-primary">Salvo</span>}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDetailUsuario(u.usuario)}>
                        Gerenciar acessos
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filteredManagedUsers.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Mostrando {userPageStart + 1}–{Math.min(userPageStart + USERS_PER_PAGE, filteredManagedUsers.length)} de {filteredManagedUsers.length} usuários
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={safeUserPage === 1} onClick={() => setUserPage((p) => Math.max(1, p - 1))}>
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">Página {safeUserPage} de {userTotalPages}</span>
            <Button variant="secondary" size="sm" disabled={safeUserPage === userTotalPages} onClick={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}>
              Próxima
            </Button>
          </div>
        </div>
      )}

      <Sheet open={!!detailUser} onOpenChange={(open) => { if (!open) { setDetailUsuario(null); setAppSearch(""); } }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {detailUser && (
            <>
              <SheetHeader>
                <SheetTitle>{detailUser.displayname || detailUser.usuario}</SheetTitle>
                <SheetDescription>
                  {detailUser.usuario} · {detailUser.department || "sem departamento"}
                  {savingUser === detailUser.usuario && <span className="ml-2 text-muted-foreground">Salvando...</span>}
                  {savedUser === detailUser.usuario && <span className="ml-2 font-semibold text-primary">Salvo</span>}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Acesso ao Hub</p>
                      <p className="text-xs text-muted-foreground">Controla se o usuário consegue entrar no Hub.</p>
                    </div>
                    <Switch
                      checked={detailUser.can_access_hub}
                      disabled={savingUser === detailUser.usuario}
                      onCheckedChange={(checked) => applyAndPersist(detailUser.usuario, (cur) => cascadeHubAccess(cur, checked))}
                    />
                  </div>
                  {detailUser.can_access_hub && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Papel no Hub</span>
                      <Select
                        value={detailUser.hub_role}
                        disabled={savingUser === detailUser.usuario}
                        onValueChange={(v) => applyAndPersist(detailUser.usuario, (cur) => ({ ...cur, hub_role: v as HubRole }))}
                      >
                        <SelectTrigger className="h-8 w-[160px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(HUB_ROLE_LABELS) as HubRole[]).map((r) => (
                            <SelectItem key={r} value={r} className="text-xs">{HUB_ROLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Aplicativos</p>
                    <span className="text-[11px] text-muted-foreground">
                      {ALL_APP_KEYS.filter((k) => detailUser.apps[k]?.can_access).length} de {TOTAL_APPS} liberados
                    </span>
                  </div>
                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={appSearch}
                      onChange={(e) => setAppSearch(e.target.value)}
                      placeholder="Filtrar aplicativos..."
                      className="h-9 pl-8 text-xs"
                    />
                  </div>

                  {!detailUser.can_access_hub && (
                    <p className="mb-3 text-[11px] text-muted-foreground">
                      Ative o acesso ao Hub acima para liberar aplicativos individuais.
                    </p>
                  )}

                  <div className="space-y-2">
                    {visibleApps.map((app) => {
                      const appKey = APP_BY_ROUTE[app.route];
                      const disabled = savingUser === detailUser.usuario || !detailUser.can_access_hub;
                      const onUpdate = (updater: (u: AuthManagedUser) => AuthManagedUser) => applyAndPersist(detailUser.usuario, updater);

                      if (appKey === "dashboard") return <DashboardAppRow key={appKey} app={app} u={detailUser} disabled={disabled} onUpdate={onUpdate} />;
                      if (appKey === "calculadora") return <CalculadoraAppRow key={appKey} app={app} u={detailUser} disabled={disabled} onUpdate={onUpdate} />;
                      if (appKey === "fechamento") return <FechamentoAppRow key={appKey} app={app} u={detailUser} disabled={disabled} onUpdate={onUpdate} />;
                      if (appKey === "inventario") return <InventarioAppRow key={appKey} app={app} u={detailUser} disabled={disabled} inventarioLojas={inventarioLojas} fbUsers={fbUsers} onUpdate={onUpdate} />;
                      if (appKey === "salescompass") return <SalesCompassAppRow key={appKey} app={app} u={detailUser} disabled={disabled} onUpdate={onUpdate} />;
                      if (appKey === "painelcomissao") return <PainelComissaoAppRow key={appKey} app={app} u={detailUser} disabled={disabled} onUpdate={onUpdate} onOpenModal={() => openPainelModal(detailUser)} />;
                      return (
                        <SimpleAppRow
                          key={appKey}
                          appKey={appKey as SimpleAppKey}
                          title={app.title}
                          icon={smallIcon(app.icon)}
                          u={detailUser}
                          disabled={disabled}
                          onUpdate={onUpdate}
                        />
                      );
                    })}
                    {visibleApps.length === 0 && (
                      <p className="py-6 text-center text-xs text-muted-foreground">Nenhum aplicativo encontrado.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!painelModal} onOpenChange={(open) => { if (!open) setPainelModal(null); }}>
        <DialogContent className="max-w-md">
          {painelModal && (
            <>
              <DialogHeader>
                <DialogTitle>Painel de Comissões</DialogTitle>
                <p className="text-xs text-muted-foreground">{painelModal.displayname || painelModal.usuario}</p>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Cargo no painel</label>
                  <Select value={painelForm.role} onValueChange={(v) => setPainelForm((f) => ({ ...f, role: v as Role }))}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAINEL_ROLE_LABELS) as Role[]).map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">{PAINEL_ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Administrador vê tudo · Gestor vê seus setores · Vendedor vê apenas as próprias vendas.
                  </p>
                </div>

                {painelForm.role === "manager" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Setores do gestor</label>
                    <div className="flex flex-wrap gap-2">
                      {PAINEL_SETORES.map((s) => {
                        const on = painelForm.setores.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setPainelForm((f) => ({
                              ...f,
                              setores: on ? f.setores.filter((x) => x !== s) : [...f.setores, s],
                            }))}
                            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${on ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted text-muted-foreground hover:text-foreground"}`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    {painelForm.setores.length === 0 && (
                      <p className="mt-1 text-[10px] text-destructive">Selecione ao menos um setor.</p>
                    )}
                  </div>
                )}

                {painelForm.role === "viewer" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Nome do vendedor no sistema</label>
                    <Input
                      value={painelForm.nome_vendedor}
                      onChange={(e) => setPainelForm((f) => ({ ...f, nome_vendedor: e.target.value }))}
                      placeholder="Ex: FERRAGENS ANESIA"
                      className="text-xs"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Nome canônico exatamente como aparece nas vendas (após os vínculos). O vendedor verá tudo ligado a esse nome, em qualquer loja.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setPainelModal(null)}>Cancelar</Button>
                <Button onClick={savePainelConfig} disabled={painelForm.role === "manager" && painelForm.setores.length === 0}>
                  Salvar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
