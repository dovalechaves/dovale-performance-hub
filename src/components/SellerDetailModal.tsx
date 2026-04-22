import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin } from "lucide-react";
import { Seller } from "@/data/sellers";

interface SellerDetailModalProps {
  seller: Seller | null;
  onClose: () => void;
}

export function SellerDetailModal({ seller, onClose }: SellerDetailModalProps) {
  if (!seller) return null;

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const detalhes = seller.detalhes ?? [];
  const hasMultiDb = detalhes.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-bold text-sm">
                {seller.avatar}
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{seller.name}</h3>
                <p className="text-xs text-muted-foreground">{seller.category}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-destructive/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total vendas</span>
              <span className="font-mono font-bold text-lg text-foreground">{fmt(seller.sales)}</span>
            </div>

            {seller.goal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Meta</span>
                <span className="font-mono font-semibold text-muted-foreground">{fmt(seller.goal)}</span>
              </div>
            )}

            {/* Detalhes por loja */}
            {hasMultiDb && (
              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                  Vendas por unidade
                </p>
                {detalhes.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-primary" />
                      <span className="text-sm font-medium text-foreground">{d.db}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground">{fmt(d.total)}</span>
                  </div>
                ))}

                {/* Soma de conferência */}
                <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-2.5 mt-1">
                  <span className="text-sm font-semibold text-primary">Soma</span>
                  <span className="font-mono text-sm font-bold text-primary">
                    {fmt(detalhes.reduce((acc, d) => acc + d.total, 0))}
                  </span>
                </div>
              </div>
            )}

            {!hasMultiDb && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground text-center py-3">
                  Vendas somente na unidade principal.
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
