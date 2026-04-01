import { TrendingUp, Target, Users, Award } from "lucide-react";
import { motion } from "framer-motion";
import { Seller } from "@/data/sellers";

interface StatsBarProps {
  sellers: Seller[];
  canViewTotalSales?: boolean;
}

export function StatsBar({ sellers, canViewTotalSales = true }: StatsBarProps) {
  const totalSales = sellers.reduce((s, v) => s + v.sales, 0);
  const totalGoal = sellers.reduce((s, v) => s + v.goal, 0);
  const hasOverallBase = Number.isFinite(totalSales) && Number.isFinite(totalGoal) && totalGoal > 0;
  const overallPct = hasOverallBase ? `${((totalSales / totalGoal) * 100).toFixed(1)}%` : "Sem vendas";
  const goalsReached = sellers.filter((s) => s.sales >= s.goal).length;

  const stats = [
    ...(canViewTotalSales ? [{
      label: "Total Vendas",
      value: new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(totalSales),
      icon: TrendingUp,
      accent: "text-primary",
    }] : []),
    {
      label: "Meta Geral",
      value: overallPct,
      icon: Target,
      accent: "text-primary",
    },
    {
      label: "Vendedores",
      value: sellers.length.toString(),
      icon: Users,
      accent: "text-foreground",
    },
    {
      label: "Metas Batidas",
      value: goalsReached.toString(),
      icon: Award,
      accent: "text-gold",
    },
  ];

  return (
    <div className={`grid gap-3 ${stats.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}>
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="rounded-xl border border-border bg-gradient-card metal-texture p-4 hover:border-primary/20 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={`w-4 h-4 ${stat.accent}`} />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground dark:text-slate-300">{stat.label}</span>
          </div>
          <p className={`font-mono text-2xl font-bold ${stat.accent}`}>{stat.value}</p>
        </motion.div>
      ))}
    </div>
  );
}
