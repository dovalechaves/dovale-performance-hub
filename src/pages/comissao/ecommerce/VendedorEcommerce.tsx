import ResumoEcommerce from './ResumoEcommerce';
import { PeriodoSelect, usePeriodoEcom, type PeriodoEcom } from './ui';

// Conteúdo do setor E-commerce na tela "Vendedor" (a própria vendedora, ou ADM/gestor olhando uma vendedora).
export default function VendedorEcommerce({ periodo, vendedora }: { periodo?: PeriodoEcom; vendedora?: string }) {
  const p = usePeriodoEcom(periodo);
  return (
    <div className="space-y-6">
      {!p.controlado && (
        <div className="flex justify-end"><PeriodoSelect ano={p.ano} mes={p.mes} onAno={p.setAno} onMes={p.setMes} /></div>
      )}
      <ResumoEcommerce ano={p.ano} mes={p.mes} modo="vendedora" vendedora={vendedora} />
    </div>
  );
}
