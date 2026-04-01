import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ProductsTable from "@/components/ProductsTable";

export default function ProdutosEcommerce() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <h1 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            Produtos E-commerce
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">
        <ProductsTable />
      </main>
    </div>
  );
}
