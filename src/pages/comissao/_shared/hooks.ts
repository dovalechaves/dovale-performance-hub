import { useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE } from '@/services/api';

export type Cargo = 'ADM' | 'GESTOR' | 'VENDEDOR';

export interface ComissaoCtx {
  usuario: string;
  nome: string;
  cargo: Cargo;
  setores: string[];
  nome_vendedor: string | null;
}

// Deriva o usuário do Painel de Comissões a partir do AuthContext do hub.
// Mesmo mapeamento role→cargo do backend (server/services/comissao/permissions.ts):
//   role=admin -> ADM; role=manager -> GESTOR; senao VENDEDOR.
// Tipo inclui 'loading' | null para manter compatível o código portado do painel.
export function useComissaoUser(): ComissaoCtx | null | 'loading' {
  const { user } = useAuth();
  const painelComissao = user?.apps.painelcomissao;
  const usuario = user?.usuario ?? '';
  const displayName = user?.displayName ?? '';
  const role = painelComissao?.role;
  const setores = painelComissao?.config?.setores;
  const nomeVendedor = painelComissao?.config?.nome_vendedor ?? null;

  return useMemo(() => {
    if (!usuario) return null;
    const cargo: Cargo =
      role === 'admin' ? 'ADM'
      : role === 'manager' ? 'GESTOR'
      : 'VENDEDOR';
    return {
      usuario,
      nome: displayName.trim() ? displayName : usuario,
      cargo,
      setores: setores ?? [],
      nome_vendedor: nomeVendedor,
    };
  }, [usuario, displayName, role, setores, nomeVendedor]);
}

// fetch para o backend do hub (/api/comissao/*), injetando o header X-Dovale-Usuario.
// Uso: const api = useComissaoApi(); api('/dashboard?ano=2025')
// Blinda r.json(): se a resposta vier vazia ou não-JSON (ex.: 404/erro), devolve {}
// em vez de estourar "Unexpected end of JSON input".
export function useComissaoApi() {
  const { user } = useAuth();
  const usuario = user?.usuario ?? '';
  return useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('X-Dovale-Usuario', usuario);
      const res = await fetch(`${API_BASE}/comissao${path}`, { ...init, headers });
      (res as unknown as { json: () => Promise<unknown> }).json = async () => {
        const texto = await res.text();
        if (!texto) return {};
        try { return JSON.parse(texto); } catch { return {}; }
      };
      return res;
    },
    [usuario]
  );
}
