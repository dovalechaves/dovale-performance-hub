import { motion } from "framer-motion";
import { Seller } from "@/data/sellers";
import { Trophy, TrendingUp, Key } from "lucide-react";

interface SellerCardProps {
  seller: Seller;
  rank: number;
}

export function SellerCard({ seller, rank }: SellerCardProps) {
  const percentage = Math.min((seller.sales / seller.goal) * 100, 150);
  const isGoalReached = seller.sales >= seller.goal;
  const isTopPerformer = rank <= 3 && isGoalReached;
  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      whileHover={{ scale: 1.02, y: -4 }}
      className={`
        relative overflow-hidden rounded-xl border p-5 transition-colors
        bg-gradient-card metal-texture
        ${isTopPerformer
          ? "border-primary/50 glow-gold"
          : isGoalReached
            ? "border-primary/30 glow-primary"
            : "border-border hover:border-primary/20"
        }
      `}
    >
      {/* Rank */}
      <div className={`
        absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center font-mono text-sm font-bold
        ${rank <= 3 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}
      `}>
        #{rank}
      </div>

      {/* Goal seal */}
      {isGoalReached && (
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
          className="absolute top-3 left-3"
        >
          <div className="flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
            <Trophy className="w-3 h-3" />
            META BATIDA
          </div>
        </motion.div>
      )}

      <div className="mt-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold
            ${isGoalReached ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}
          `}>
            {seller.avatar}
          </div>
          <div>
            <h3 className="font-semibold text-foreground leading-tight">{seller.name}</h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Key className="w-3 h-3" />
              {seller.category}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Vendas</p>
            <p className="font-mono text-sm font-semibold text-foreground">{fmt(seller.sales)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Meta</p>
            <p className="font-mono text-sm font-medium text-muted-foreground">{fmt(seller.goal)}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3" />
              Progresso
            </div>
            <span className={`font-mono text-sm font-bold ${
              isGoalReached ? "text-primary" : percentage >= 80 ? "text-foreground" : "text-muted-foreground"
            }`}>
              {percentage.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(percentage, 100)}%` }}
              transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
              className={`h-full rounded-full ${
                isGoalReached
                  ? "bg-primary"
                  : percentage >= 80
                    ? "bg-foreground/40"
                    : "bg-muted-foreground/30"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Shimmer for top performers */}
      {isTopPerformer && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer bg-[length:200%_100%] pointer-events-none" />
      )}
    </motion.div>
  );
}
