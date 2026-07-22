import { useEffect, useState } from "react";

// Rampa de cobertura: vermelho (oportunidade) → verde (bem coberto).
export function coverageColor(pct: number, semDados = false): string {
  if (semDados) return "#cbd5e1";
  if (pct < 20) return "#ef4444";
  if (pct < 40) return "#f59e0b";
  if (pct < 60) return "#eab308";
  if (pct < 80) return "#84cc16";
  return "#22c55e";
}

export const pctOf = (na: number, fora: number): number => {
  const t = na + fora;
  return t === 0 ? 0 : Math.round((na / t) * 100);
};

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// Barra rotulada com preenchimento colorido pela rampa; anima a largura ao montar.
export function CoverageBar({
  label,
  pct = 0,
  meta,
  onClick,
}: {
  label: string;
  pct?: number;
  meta?: string;
  onClick?: () => void;
}) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`block w-full text-left ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-foreground">{label}</span>
        {meta != null && <span className="text-muted-foreground font-mono text-[11px]">{meta}</span>}
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${w}%`, background: coverageColor(pct), transition: `width 800ms ${EASE}` }}
        />
      </div>
    </Tag>
  );
}

const RAMP = [
  { label: "< 20%", pct: 10 },
  { label: "20–40%", pct: 30 },
  { label: "40–60%", pct: 50 },
  { label: "60–80%", pct: 70 },
  { label: "≥ 80%", pct: 90 },
];

export function CoverageLegend({ title = "Cobertura" }: { title?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</span>
      {RAMP.map((r) => (
        <span key={r.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: coverageColor(r.pct) }} />
          {r.label}
        </span>
      ))}
    </div>
  );
}
