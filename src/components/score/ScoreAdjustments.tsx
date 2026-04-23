import { TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

interface Adjustment {
  reason: string;
  points: number;
  limiteChange: number;
}

const ScoreAdjustments = ({ adjustments }: { adjustments: Adjustment[] }) => {
  if (adjustments.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.4 }}
      className="glass-card rounded-lg p-5 space-y-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Ajustes do Motor de Score
      </h3>
      <div className="space-y-2">
        {adjustments.slice(0, 6).map((a, i) => (
          <div key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              {a.points < 0 ? (
                <TrendingDown className="h-4 w-4 text-destructive" />
              ) : (
                <TrendingUp className="h-4 w-4 text-success" />
              )}
              <span className="text-foreground">{a.reason}</span>
            </div>
            <div className="flex items-center gap-4">
              {a.points !== 0 && (
                <span className={`font-mono font-semibold ${a.points < 0 ? "text-destructive" : "text-success"}`}>
                  {a.points > 0 ? "+" : ""}
                  {a.points} pts
                </span>
              )}
              {a.limiteChange !== 0 && (
                <span className={`font-mono text-xs ${a.limiteChange < 0 ? "text-destructive" : "text-success"}`}>
                  {a.limiteChange > 0 ? "+" : ""}R$ {Math.abs(a.limiteChange).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default ScoreAdjustments;
