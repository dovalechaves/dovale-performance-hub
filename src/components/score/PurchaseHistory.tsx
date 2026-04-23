import { motion } from "framer-motion";

interface Purchase {
  id: string;
  date: string;
  description: string;
  value: number;
  dueDate: string;
  delayDays: number;
  status: "paid" | "pending" | "overdue";
}

interface PurchaseHistoryProps {
  purchases: Purchase[];
}

const PurchaseHistory = ({ purchases }: PurchaseHistoryProps) => {
  const avgDelay =
    purchases.filter((p) => p.status === "paid").reduce((acc, p) => acc + Math.max(0, p.delayDays), 0) /
    Math.max(purchases.filter((p) => p.status === "paid").length, 1);

  const statusStyles = {
    paid: "bg-success/15 text-success",
    pending: "bg-warning/15 text-warning",
    overdue: "bg-destructive/15 text-destructive",
  };

  const statusLabels = {
    paid: "Pago",
    pending: "Pendente",
    overdue: "Vencido",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.5 }}
      className="glass-card rounded-lg overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          Histórico de Compras
        </h3>
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5">
          <span className="text-xs text-muted-foreground">Atraso Médio:</span>
          <span
            className={`font-mono text-sm font-bold ${
              Math.abs(avgDelay) > 5 ? "text-destructive" : Math.abs(avgDelay) > 0 ? "text-warning" : "text-success"
            }`}
          >
            {avgDelay.toFixed(1)} dias
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30 text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3 text-left font-medium">Data</th>
              <th className="px-6 py-3 text-left font-medium">Descrição</th>
              <th className="px-6 py-3 text-right font-medium">Valor</th>
              <th className="px-6 py-3 text-center font-medium">Vencimento</th>
              <th className="px-6 py-3 text-center font-medium">Atraso</th>
              <th className="px-6 py-3 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-b border-border/20 transition-colors hover:bg-muted/30">
                <td className="px-6 py-3 font-mono text-muted-foreground">{p.date}</td>
                <td className="px-6 py-3 text-foreground">{p.description}</td>
                <td className="px-6 py-3 text-right font-mono text-foreground">
                  R$ {p.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-6 py-3 text-center font-mono text-muted-foreground">{p.dueDate}</td>
                <td className="px-6 py-3 text-center">
                  <span
                    className={`font-mono font-semibold ${
                      Math.abs(p.delayDays) > 5 ? "text-destructive" : Math.abs(p.delayDays) > 0 ? "text-warning" : "text-success"
                    }`}
                  >
                    {p.delayDays > 0 ? `+${p.delayDays}` : p.delayDays} dias
                  </span>
                </td>
                <td className="px-6 py-3 text-center">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[p.status]}`}>
                    {statusLabels[p.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

export default PurchaseHistory;
