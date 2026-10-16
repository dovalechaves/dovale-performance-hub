import ResumoEcommerce from './ResumoEcommerce';
import { PeriodoSelect, usePeriodoEcom, type PeriodoEcom } from './ui';

// Conteúdo do setor E-commerce na tela "Gestor": tudo do setor, por filial e por plataforma, e a divisão entre vendedoras.
export default function GestorEcommerce({ periodo }: { periodo?: PeriodoEcom }) {
  const p = usePeriodoEcom(periodo);
  return (
    <div className="space-y-6">
      {!p.controlado && (
        <div className="flex justify-end"><PeriodoSelect ano={p.ano} mes={p.mes} onAno={p.setAno} onMes={p.setMes} /></div>
      )}
      <ResumoEcommerce ano={p.ano} mes={p.mes} modo="gestor" />
    </div>
  );
}
