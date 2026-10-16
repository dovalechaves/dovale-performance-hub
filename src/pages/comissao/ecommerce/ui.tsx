import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MESES } from '../_shared/format';
import type { EcomFaixa } from '../_shared/commission-ecommerce';

const ROTULOS: Record<string, string> = {
  'MERCADO LIVRE': 'Mercado Livre',
  'SHOPEE': 'Shopee',
  'AMAZON': 'Amazon',
  'MAGALU': 'Magalu',
  'TIKTOK': 'TikTok Shop',
  'LOJA VIRTUAL': 'Loja Virtual',
  'VENDA DIRETA': 'Venda direta',
  'NAO IDENTIFICADA': 'Não identificada',
};
export const rotuloPlataforma = (p: string) => ROTULOS[p] ?? p;

export const fmtPct = (v: number | null, casas = 2) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export const parseNum = (s: string): number => {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** Número -> texto já mascarado (pt-BR, até 2 casas). 0 vira vazio. */
export const numParaInput = (n: number | null | undefined) =>
  n === null || n === undefined || n === 0 ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Máscara de valor em R$ (mesma regra do ValorInput da Configuração): milhar com ponto, vírgula decimal, 2 casas. */
export function maskValor(txt: string): string {
  const limpo = txt.replace(/[^\d,]/g, '');
  const v = limpo.indexOf(',');
  const unica = v === -1 ? limpo : limpo.slice(0, v + 1) + limpo.slice(v + 1).replace(/,/g, '');
  const [inteiroRaw, dec] = unica.split(',');
  const inteiro = inteiroRaw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec !== undefined ? `${inteiro || '0'},${dec.slice(0, 2)}` : inteiro;
}

/** Máscara de percentual: só dígitos e uma vírgula, até 2 casas, sem separador de milhar. */
export function maskPct(txt: string): string {
  const limpo = txt.replace(/[^\d,]/g, '');
  const v = limpo.indexOf(',');
  const unica = v === -1 ? limpo : limpo.slice(0, v + 1) + limpo.slice(v + 1).replace(/,/g, '');
  const [inteiroRaw, dec] = unica.split(',');
  const inteiro = inteiroRaw.replace(/^0+(?=\d)/, '');
  return dec !== undefined ? `${inteiro || '0'},${dec.slice(0, 2)}` : inteiro;
}

export const selecionarTudo = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

/** "5% a 9,99%", "10% a 19,99%", "acima de 20%" — a partir da lista de faixas (cada faixa vale até a próxima). */
export function descreverFaixas(faixas: EcomFaixa[]): Array<EcomFaixa & { texto: string }> {
  const ord = [...faixas].sort((a, b) => a.cresc_min - b.cresc_min);
  return ord.map((f, i) => {
    const prox = ord[i + 1];
    const texto = prox
      ? `${f.cresc_min.toLocaleString('pt-BR')}% a ${(prox.cresc_min - 0.01).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%`
      : `acima de ${f.cresc_min.toLocaleString('pt-BR')}%`;
    return { ...f, texto };
  });
}

export function Card({ titulo, children, className = '' }: { titulo?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl p-5 shadow-sm ${className}`} style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      {titulo && (
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#64748b' }}>{titulo}</p>
      )}
      {children}
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'info' | 'alerta' | 'ok'; children: React.ReactNode }) {
  const cores = {
    info: { bg: '#eff6ff', bd: '#bfdbfe', fg: '#1e3a8a' },
    alerta: { bg: '#fffbeb', bd: '#fde68a', fg: '#92400e' },
    ok: { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#166534' },
  }[tipo];
  return (
    <div className="rounded-lg px-4 py-3 text-sm" style={{ background: cores.bg, border: `1px solid ${cores.bd}`, color: cores.fg }}>
      {children}
    </div>
  );
}

const ANO_ATUAL = new Date().getFullYear();
export const ANOS = [ANO_ATUAL, ANO_ATUAL - 1];

export function PeriodoSelect({ ano, mes, onAno, onMes }: { ano: number; mes: number; onAno: (a: number) => void; onMes: (m: number) => void }) {
  const estilo = { background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' };
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative">
        <select value={mes} onChange={(e) => onMes(parseInt(e.target.value))} aria-label="Mês"
          className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer" style={estilo}>
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
      </div>
      <div className="relative">
        <select value={ano} onChange={(e) => onAno(parseInt(e.target.value))} aria-label="Ano"
          className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer" style={estilo}>
          {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
      </div>
    </div>
  );
}

export const th = 'text-left text-xs font-semibold uppercase tracking-wider py-2 px-2';
export const thR = 'text-right text-xs font-semibold uppercase tracking-wider py-2 px-2';
export const td = 'py-2 px-2 text-sm';
export const tdR = 'py-2 px-2 text-sm text-right tabular-nums';

export interface PeriodoEcom { ano: number; mes: number | null }

/** Período do conteúdo do e-commerce: o da tela onde ele está embutido (se informado) ou um seletor próprio. */
export function usePeriodoEcom(externo?: PeriodoEcom) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  if (externo) return { ano: externo.ano, mes: externo.mes ?? hoje.getMonth() + 1, controlado: true, setAno, setMes };
  return { ano, mes, controlado: false, setAno, setMes };
}
