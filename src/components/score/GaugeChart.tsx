import { motion } from "framer-motion";

interface GaugeChartProps {
  score: number;
  maxScore?: number;
}

function getScoreLevel(score: number): {
  label: string;
  color: "risk" | "warning" | "success";
} {
  if (score < 300) return { label: "Risco de Inadimplência", color: "risk" };
  if (score > 700) return { label: "Cliente Premium", color: "success" };
  return { label: "Score Moderado", color: "warning" };
}

const GaugeChart = ({ score, maxScore = 1000 }: GaugeChartProps) => {
  const percentage = Math.min(score / maxScore, 1);
  const { label, color } = getScoreLevel(score);

  // SVG arc math for semi-circle
  const cx = 150, cy = 150, r = 110;
  const startAngle = Math.PI;
  const endAngle = Math.PI * (1 - percentage);

  const arcX1 = cx + r * Math.cos(startAngle);
  const arcY1 = cy - r * Math.sin(startAngle);
  const arcX2 = cx + r * Math.cos(endAngle);
  const arcY2 = cy - r * Math.sin(endAngle);

  const largeArc = 0;

  const colorMap = {
    risk: "hsl(var(--risk))",
    warning: "hsl(var(--warning))",
    success: "hsl(var(--success))",
  };

  const strokeColor = colorMap[color];

  return (
    <div className="flex flex-col items-center">
      <svg width="300" height="180" viewBox="0 0 300 180">
        {/* Background track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="hsl(var(--gauge-track))"
          strokeWidth="20"
          strokeLinecap="round"
        />
        {/* Score arc */}
        <motion.path
          d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 ${largeArc} 1 ${arcX2} ${arcY2}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="20"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 8px ${strokeColor})` }}
        />
        {/* Score text */}
        <text x={cx} y={cy - 15} textAnchor="middle" className="fill-foreground font-mono text-4xl font-bold" fontSize="42">
          {score}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground text-sm" fontSize="13">
          de {maxScore}
        </text>
      </svg>
      <div
        className={`mt-2 rounded-lg px-4 py-2 text-sm font-semibold ${
          color === "risk"
            ? "bg-destructive/15 text-destructive glow-risk"
            : color === "success"
            ? "bg-success/15 text-success glow-success"
            : "bg-warning/15 text-warning"
        }`}
      >
        {label}
      </div>
    </div>
  );
};

export default GaugeChart;
