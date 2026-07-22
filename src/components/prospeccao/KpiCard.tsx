import type { ReactNode } from "react";

type Tone = "primary" | "success" | "gold" | "slate";

// Tile de KPI: chip de ícone tintado + valor grande + legenda, em superfície glass.
export function KpiCard({
  icon,
  label,
  value,
  tone = "primary",
  trend,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: Tone;
  trend?: string;
}) {
  const tones: Record<Tone, string> = {
    primary: "text-primary bg-primary/10",
    success: "text-success bg-success/[0.12]",
    gold: "text-gold bg-gold/[0.16]",
    slate: "text-muted-foreground bg-muted-foreground/[0.12]",
  };
  const trendColor: Record<Tone, string> = {
    primary: "text-primary",
    success: "text-success",
    gold: "text-gold",
    slate: "text-muted-foreground",
  };
  return (
    <div className="glass-card rounded-xl p-4 flex items-center gap-3.5">
      <div className={`h-11 w-11 shrink-0 rounded-md flex items-center justify-center ${tones[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-extrabold text-foreground leading-none tracking-tight">{value}</span>
          {trend != null && <span className={`text-xs font-semibold ${trendColor[tone]}`}>{trend}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}
