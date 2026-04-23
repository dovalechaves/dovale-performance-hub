import { Building2, MapPin, FileText } from "lucide-react";
import { motion } from "framer-motion";

interface Client {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  bairro: string;
  cep: string;
}

interface ClientCardsProps {
  client: Client;
}

const InfoCard = ({
  icon: Icon,
  label,
  value,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  delay: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
    className="glass-card rounded-lg p-4 space-y-2"
  >
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
    </div>
    <p className="text-sm font-semibold text-foreground">{value}</p>
  </motion.div>
);

const ClientCards = ({ client }: ClientCardsProps) => {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <InfoCard icon={Building2} label="Razão Social" value={client.razaoSocial} delay={0.1} />
      <InfoCard icon={FileText} label="CNPJ" value={client.cnpj} delay={0.2} />
      <InfoCard icon={MapPin} label="Endereço" value={`${client.endereco}, ${client.bairro}, ${client.cep}`} delay={0.3} />
    </div>
  );
};

export default ClientCards;
