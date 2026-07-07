import { Component, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

function Fallback() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f4f8' }}>
      <div
        className="rounded-2xl p-8 text-center shadow-sm max-w-md w-full"
        style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
      >
        <h1 className="text-lg font-bold mb-2" style={{ color: '#00205C' }}>
          Não foi possível carregar o painel
        </h1>
        <p className="text-sm mb-5" style={{ color: '#64748b' }}>
          O serviço de dados do Painel de Comissões (/api/comissao) não respondeu como esperado.
          Verifique se o backend que serve esse módulo está no ar.
        </p>
        <button
          onClick={() => navigate('/hub')}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: '#FFD700', color: '#00205C' }}
        >
          Voltar ao Hub
        </button>
      </div>
    </div>
  );
}

// Error boundary isola o módulo de comissões: um erro de render (ex.: dados ausentes
// enquanto o backend do módulo não está disponível) não derruba o hub inteiro.
export class ComissaoErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[comissao] erro de render:', error);
  }

  render() {
    if (this.state.hasError) return <Fallback />;
    return this.props.children;
  }
}
