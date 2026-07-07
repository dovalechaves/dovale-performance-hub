import Sidebar from './Sidebar';
import { useComissaoUser } from '../_shared/hooks';
import '../comissao.css';

export default function AppShell({ children, loading }: { children: React.ReactNode; loading?: boolean }) {
  const usuario = useComissaoUser();

  if (usuario === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f4f8' }}>
        <div className="text-sm" style={{ color: '#64748b' }}>Carregando...</div>
      </div>
    );
  }

  if (!usuario) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f4f8' }}>
        <div
          className="rounded-2xl p-10 text-center shadow-sm max-w-sm w-full"
          style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
        >
          <div
            className="mx-auto mb-6 flex items-center justify-center rounded-full"
            style={{ width: 64, height: 64, background: '#0a1628' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#00205C' }}>Acesso Restrito</h1>
          <p className="text-sm" style={{ color: '#64748b' }}>
            Você não tem permissão para acessar este painel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="comissao-scope flex h-screen overflow-hidden"
      style={{ background: '#f0f4f8', color: '#00205C' }}
    >
      <Sidebar />
      <main className="flex-1 overflow-auto relative" style={{ background: '#f0f4f8' }}>
        {children}
        {loading && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16,
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              border: '4px solid rgba(255,215,0,0.2)',
              borderTopColor: '#FFD700',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#FFD700', fontWeight: 600, fontSize: 14, letterSpacing: 1 }}>
              Carregando...
            </span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </main>
    </div>
  );
}
