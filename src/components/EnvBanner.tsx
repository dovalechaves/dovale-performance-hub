/**
 * Faixa de ambiente. Só aparece quando o build foi feito com
 * VITE_APP_ENV="homologacao" (ver Dockerfile.frontend). Em produção a
 * variável fica vazia e o componente não renderiza nada.
 *
 * Objetivo: deixar inequívoco para quem estiver testando que aquilo NÃO é
 * produção, evitando ações reais por engano.
 */
export default function EnvBanner() {
  const env = import.meta.env.VITE_APP_ENV;
  if (env !== "homologacao") return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-500/60 bg-amber-500/95 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-950 shadow-lg">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-950" />
        Homologação — dados de produção, sem efeitos reais
      </div>
    </div>
  );
}
