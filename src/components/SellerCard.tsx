import { motion } from "framer-motion";
import { Seller } from "@/data/sellers";
import { Trophy, TrendingUp, Key } from "lucide-react";

interface SellerCardProps {
  seller: Seller;
  rank: number;
  showValues?: boolean;
}

export function SellerCard({ seller, rank, showValues = true }: SellerCardProps) {
  const rawPercentage = seller.goal > 0 ? (seller.sales / seller.goal) * 100 : 0;
  const isGoalReached = rawPercentage >= 100;
  const isOverGoal = rawPercentage > 100;
  const isTopPerformer = rank <= 3 && isGoalReached;
  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const barColor = isGoalReached
    ? isOverGoal
      ? "bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500"
      : "bg-amber-400"
    : rawPercentage >= 90
      ? "bg-emerald-500"
      : "bg-red-500/70";

  const textColor = isGoalReached
    ? "text-amber-400"
    : rawPercentage >= 90
      ? "text-emerald-400"
      : "text-red-400";

  const badgeBg = isGoalReached
    ? "bg-amber-400/20 text-amber-400"
    : rawPercentage >= 90
      ? "bg-emerald-500/20 text-emerald-400"
      : "bg-red-500/15 text-red-400";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      whileHover={{ scale: 1.01, y: -2 }}
      className={`
        relative overflow-hidden rounded-xl border px-6 transition-colors
        bg-gradient-card metal-texture
        ${isOverGoal ? "py-6" : "py-4"}
        ${isOverGoal
          ? "border-amber-400/60 shadow-[0_0_24px_-4px_rgba(251,191,36,0.5)]"
          : rawPercentage >= 90
            ? "border-emerald-500/40 shadow-[0_0_20px_-4px_rgba(16,185,129,0.3)]"
            : "border-red-500/30"
        }
      `}
    >
      <div className="flex items-center gap-6">

        {/* Rank */}
        <div className={`
          shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono text-sm font-bold
          ${badgeBg}
        `}>
          #{rank}
        </div>

        {/* Avatar + Nome */}
        <div className="flex items-center gap-3 w-44 shrink-0">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0
            ${badgeBg}
          `}>
            {seller.avatar}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground leading-tight truncate">{seller.name}</h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Key className="w-3 h-3 shrink-0" />
              <span className="truncate">{seller.category}</span>
            </div>
          </div>
        </div>

        {/* Vendas + Meta — visível só com permissão */}
        {showValues && (
          <>
            <div className="shrink-0 w-36">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Vendas</p>
              <p className="font-mono text-sm font-semibold text-foreground">{fmt(seller.sales)}</p>
            </div>
            <div className="shrink-0 w-36">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Meta</p>
              <p className="font-mono text-sm font-medium text-muted-foreground">{fmt(seller.goal)}</p>
            </div>
          </>
        )}

        {/* Percentual em destaque — só quando valores ocultos (manager) */}
        {!showValues && (
          <div className="shrink-0 flex flex-col items-center justify-center w-28">
            <span className={`font-mono text-3xl font-black leading-none ${textColor} ${isOverGoal ? "drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]" : ""}`}>
              {rawPercentage.toFixed(0)}%
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground dark:text-slate-300 mt-1">da meta</span>
          </div>
        )}

        {/* Barra de progresso */}
        <div className="flex-1 min-w-0">
          {showValues && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="w-3 h-3" />
                Progresso
              </div>
              <span className={`font-mono text-sm font-bold ${textColor} ${isOverGoal ? "drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]" : ""}`}>
                {rawPercentage.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="relative h-12">
            {/* Barra — alinhada no fundo */}
            <div className="absolute bottom-0 left-0 right-0 h-2 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(rawPercentage, 100)}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
                className={`h-full rounded-full ${barColor} ${isOverGoal ? "animate-pulse" : ""}`}
              />
            </div>
            {/* Mascote — pés na barra */}
            <motion.div
              initial={{ left: "0%" }}
              animate={{ left: `${Math.min(rawPercentage, 97)}%` }}
              transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
              className="absolute bottom-1.5 -translate-x-1/2"
            >
              <motion.img
                src="/image-removebg-preview%20%283%29.png"
                alt="mascot"
                className="w-10 h-auto"
                animate={isOverGoal ? { y: [0, -4, 0] } : {}}
                transition={isOverGoal ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : {}}
                style={isOverGoal ? { filter: "drop-shadow(0 0 6px rgba(251,191,36,0.7))" } : {}}
              />
            </motion.div>
          </div>
        </div>

        {/* Badge META BATIDA */}
        {isGoalReached && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
            className="shrink-0"
          >
            <div className="flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
              <Trophy className="w-3 h-3" />
              META BATIDA
            </div>
          </motion.div>
        )}
      </div>

      {isTopPerformer && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer bg-[length:200%_100%] pointer-events-none" />
      )}
    </motion.div>
  );
}
