import { useEffect, useMemo, useState } from "react";
import { coverageColor, pctOf } from "./coverage";

interface MapStateData {
  nome?: string;
  naBase: number;
  foraBase: number;
}

const NOME_SIGLA: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA",
  ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
  para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP",
  sergipe: "SE", tocantins: "TO",
};
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function siglaFromProps(p: any): string | null {
  if (!p) return null;
  const direct = p.sigla || p.SIGLA || p.uf || p.UF || p.postal;
  if (direct && String(direct).length === 2) return String(direct).toUpperCase();
  const nm = norm(p.name || p.NAME_1 || p.nome || p.Estado || p.estado);
  return NOME_SIGLA[nm] || null;
}

// Web Mercator (lng/lat graus) → plano unitário
function project([lng, lat]: [number, number]): [number, number] {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// Coroplético interativo das 27 UFs. Projeta o GeoJSON sozinho (sem lib de mapa);
// hover, seleção (múltipla), rampa de cor e o desenho animado ficam sob controle.
export function BrazilCoverageMap({
  data = {},
  selected = null,
  onSelect,
  onHover,
  width = 720,
  height = 520,
  geojsonUrl = "/br-states.json",
}: {
  data: Record<string, MapStateData>;
  selected?: string | string[] | null;
  onSelect?: (sigla: string) => void;
  onHover?: (sigla: string | null) => void;
  width?: number;
  height?: number;
  geojsonUrl?: string;
}) {
  const [geo, setGeo] = useState<any>(null);
  const [err, setErr] = useState(false);
  const [hoverSigla, setHoverSigla] = useState<string | null>(null);
  const [tip, setTip] = useState<{ nome: string; pct: number; x: number; y: number } | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(geojsonUrl)
      .then((r) => r.json())
      .then((j) => alive && setGeo(j))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [geojsonUrl]);

  useEffect(() => {
    if (!geo) return;
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [geo]);

  const shapes = useMemo(() => {
    if (!geo) return null;
    const feats = geo.features || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const raw = feats.map((f: any) => {
      const sigla = siglaFromProps(f.properties);
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const rings: [number, number][][] = [];
      polys.forEach((poly: any) => {
        poly.forEach((ring: any) => {
          const pts = ring.map((c: [number, number]) => {
            const [x, y] = project(c);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            return [x, y] as [number, number];
          });
          rings.push(pts);
        });
      });
      return { sigla, rings };
    });
    const pad = 12;
    const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
    const offX = pad + (width - pad * 2 - (maxX - minX) * scale) / 2;
    const offY = pad + (height - pad * 2 - (maxY - minY) * scale) / 2;
    const tx = (x: number) => offX + (x - minX) * scale;
    const ty = (y: number) => offY + (y - minY) * scale;
    return raw.map((f: any) => ({
      sigla: f.sigla,
      d: f.rings.map((r: [number, number][]) => "M" + r.map((p) => `${tx(p[0]).toFixed(1)},${ty(p[1]).toFixed(1)}`).join("L") + "Z").join(" "),
    }));
  }, [geo, width, height]);

  if (err)
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Não foi possível carregar o mapa.
      </div>
    );
  if (!shapes)
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Carregando mapa…
      </div>
    );

  const selArr = Array.isArray(selected) ? selected : selected ? [selected] : [];

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block overflow-visible"
        onMouseLeave={() => {
          setHoverSigla(null);
          setTip(null);
          onHover?.(null);
        }}
      >
        <defs>
          <filter id="mapShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="hsl(240 55% 18%)" floodOpacity="0.25" />
          </filter>
        </defs>
        {shapes.map((s: any, i: number) => {
          const st = s.sigla ? data[s.sigla] : null;
          const semDados = !st;
          const pct = st ? pctOf(st.naBase, st.foraBase) : 0;
          const isSel = selArr.includes(s.sigla);
          const isHover = hoverSigla === s.sigla;
          const dim = selArr.length > 0 && !isSel;
          return (
            <path
              key={s.sigla || i}
              d={s.d}
              fill={coverageColor(pct, semDados)}
              stroke={isSel || isHover ? "hsl(var(--foreground))" : "hsl(var(--card))"}
              strokeWidth={isSel ? 2 : isHover ? 1.5 : 0.8}
              strokeLinejoin="round"
              filter={isSel || isHover ? "url(#mapShadow)" : undefined}
              onMouseEnter={(e) => {
                if (!st) return;
                setHoverSigla(s.sigla);
                setTip({ nome: st.nome || s.sigla, pct, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
                onHover?.(s.sigla);
              }}
              onMouseMove={(e) => st && setTip((t) => (t ? { ...t, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY } : t))}
              onClick={() => st && onSelect?.(s.sigla)}
              style={{
                cursor: st ? "pointer" : "default",
                opacity: drawn ? (dim ? 0.4 : semDados ? 0.5 : 1) : 0,
                transform: isSel || isHover ? "translateY(-1px)" : "none",
                transformOrigin: "center",
                transition: `opacity 700ms ${EASE} ${i * 12}ms, stroke-width 150ms ease, transform 150ms ease`,
              }}
            />
          );
        })}
      </svg>
      {tip && (
        <div
          className="absolute pointer-events-none z-20 rounded-md border border-border bg-popover text-popover-foreground px-2.5 py-1.5 shadow-lg text-xs"
          style={{ left: tip.x + 14, top: tip.y + 14 }}
        >
          <div className="font-bold">{tip.nome}</div>
          <div className="text-muted-foreground">
            cobertura <span className="font-mono" style={{ color: coverageColor(tip.pct) }}>{tip.pct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
