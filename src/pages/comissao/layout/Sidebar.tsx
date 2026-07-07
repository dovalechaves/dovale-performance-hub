import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  User,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Calculator,
  ArrowLeft,
} from 'lucide-react';
import { useState } from 'react';
import logoWhite from '@/assets/logo-white.png';
import { useComissaoUser, type Cargo } from '../_shared/hooks';

const ALL_NAV = [
  { href: '/comissao',            icon: LayoutDashboard, label: 'Dashboard',   cargos: ['ADM'] as Cargo[] },
  { href: '/comissao/vendedor',    icon: User,            label: 'Vendedor',    cargos: ['ADM', 'GESTOR', 'VENDEDOR'] as Cargo[] },
  { href: '/comissao/gestor',      icon: Users,           label: 'Gestor',      cargos: ['ADM', 'GESTOR'] as Cargo[] },
  { href: '/comissao/simulacao',   icon: Calculator,      label: 'Simulação',   cargos: ['ADM', 'GESTOR', 'VENDEDOR'] as Cargo[] },
  { href: '/comissao/configuracao',icon: Settings,        label: 'Configuração',cargos: ['ADM', 'GESTOR'] as Cargo[] },
];

const CARGO_LABEL: Record<Cargo, string> = {
  ADM: 'Administrador',
  GESTOR: 'Gestor',
  VENDEDOR: 'Vendedor',
};

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const usuario = useComissaoUser();

  const cargo = usuario && usuario !== 'loading' ? usuario.cargo : null;
  const navItems = cargo
    ? ALL_NAV.filter((item) => item.cargos.includes(cargo))
    : [];

  return (
    <aside
      className="flex flex-col transition-all duration-300 shrink-0"
      style={{
        width: collapsed ? 64 : 220,
        background: '#0a1628',
        borderRight: '1px solid #1a3a6e',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: '1px solid #1a3a6e' }}
      >
        <div
          className="shrink-0"
          style={{ width: collapsed ? 40 : 64, height: collapsed ? 40 : 64, position: 'relative' }}
        >
          <img
            src={logoWhite}
            alt="Dovale"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
        {!collapsed && (
          <div>
            <p
              className="font-semibold tracking-widest uppercase"
              style={{ color: '#FFD700', letterSpacing: '0.15em', fontSize: '10px' }}
            >
              Comissões
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = location.pathname === href;
          return (
            <Link
              key={href}
              to={href}
              title={collapsed ? label : undefined}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all"
              style={{
                background: active ? '#FFD700' : 'transparent',
                color: active ? '#00205C' : '#94a3b8',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = '#1a3a6e';
                  (e.currentTarget as HTMLElement).style.color = '#ffffff';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#94a3b8';
                }
              }}
            >
              <Icon size={18} strokeWidth={active ? 2.5 : 2} />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}

        {/* Voltar ao Hub */}
        <button
          onClick={() => navigate('/hub')}
          title={collapsed ? 'Voltar ao Hub' : undefined}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all mt-2"
          style={{ background: 'transparent', color: '#94a3b8' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = '#1a3a6e';
            (e.currentTarget as HTMLElement).style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#94a3b8';
          }}
        >
          <ArrowLeft size={18} strokeWidth={2} />
          {!collapsed && <span>Voltar ao Hub</span>}
        </button>
      </nav>

      {/* User info + Toggle */}
      <div style={{ borderTop: '1px solid #1a3a6e' }}>
        {!collapsed && usuario && usuario !== 'loading' && (
          <div className="px-4 py-3">
            <p className="text-xs font-semibold truncate" style={{ color: '#ffffff' }}>
              {usuario.nome}
            </p>
            <p className="text-xs" style={{ color: '#FFD700' }}>
              {CARGO_LABEL[usuario.cargo]}
            </p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center py-2.5 w-full transition-colors"
          style={{ color: '#64748b' }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.color = '#FFD700')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.color = '#64748b')
          }
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
