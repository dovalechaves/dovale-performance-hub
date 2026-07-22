import { useEffect, useRef, useState } from "react";

export interface DonutDatum {
  name: string;
  value: number;
  color: string; // hex ou hsl(...)
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// Donut interativo e animado, SVG puro (sem lib de gráfico). Segmentos entram
// varrendo no mount, destacam no hover e alimentam o texto central.
export function DonutChart({
  data = [],
  size = 220,
  thickness = 26,
  gap = 3,
  centerValue,
  centerLabel = "total",
  activeIndex,
  onHover,
  formatValue = (n: number) => n.toLocaleString("pt-BR"),
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  gap?: number;
  centerValue?: string;
  centerLabel?: string;
  activeIndex?: number | null;
  onHover?: (i: number | null) => void;
  formatValue?: (n: number) => string;
}) {
  const [mounted, setMounted] = useState(false);
  const [internalHover, setInternalHover] = useState<number | null>(null);
  const raf = useRef<number>();

  useEffect(() => {
    raf.current = requestAnimationFrame(() => setMounted(true));
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, []);

  const hover = activeIndex != null ? activeIndex : internalHover;
  const setHover = (i: number | null) => {
    setInternalHover(i);
    onHover?.(i);
  };

  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const r = rOuter - thickness / 2;
  const circ = 2 * Math.PI * r;

  let acc = 0;
  const arcs = data.map((d, i) => {
    const frac = (d.value || 0) / total;
    const dash = Math.max(0, frac * circ - gap);
    const offset = -acc * circ;
    acc += frac;
    return { ...d, i, frac, dash, offset };
  });

  const hovered = hover != null ? arcs[hover] : null;
  const bigValue = centerValue != null ? centerValue : hovered ? `${Math.round(hovered.frac * 100)}%` : formatValue(total);
  const bigLabel = hovered ? hovered.name : centerLabel;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thickness} opacity={0.5} />
        {arcs.map((a) => {
          const isActive = hover === a.i;
          const dim = hover != null && !isActive;
          return (
            <circle
              key={a.name}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={isActive ? thickness + 6 : thickness}
              strokeLinecap="butt"
              strokeDasharray={`${mounted ? a.dash : 0} ${circ}`}
              strokeDashoffset={a.offset}
              onMouseEnter={() => setHover(a.i)}
              onMouseLeave={() => setHover(null)}
              style={{
                opacity: dim ? 0.4 : 1,
                cursor: "pointer",
                transition: `stroke-dasharray 900ms ${EASE}, stroke-width 200ms ease, opacity 200ms ease`,
              }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-extrabold text-foreground leading-none" style={{ fontSize: size * 0.16 }}>
          {bigValue}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 text-center" style={{ maxWidth: size * 0.7 }}>
          {bigLabel}
        </span>
      </div>
    </div>
  );
}
