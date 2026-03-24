export interface Seller {
  id: string;
  name: string;
  category: string;
  sales: number;
  goal: number;
  avatar?: string;
  goalReached: boolean;
}

export const MOCK_SELLERS: Seller[] = [
  { id: "1", name: "Carlos Silva", category: "Chaves Yale", sales: 87500, goal: 100000, goalReached: false, avatar: "CS" },
  { id: "2", name: "Ana Rodrigues", category: "Fechaduras", sales: 112000, goal: 95000, goalReached: true, avatar: "AR" },
  { id: "3", name: "Pedro Santos", category: "Dobradiças", sales: 45000, goal: 80000, goalReached: false, avatar: "PS" },
  { id: "4", name: "Mariana Costa", category: "Puxadores", sales: 68000, goal: 70000, goalReached: false, avatar: "MC" },
  { id: "5", name: "Roberto Lima", category: "Cadeados", sales: 93000, goal: 85000, goalReached: true, avatar: "RL" },
  { id: "6", name: "Juliana Ferreira", category: "Ferragens Gerais", sales: 55000, goal: 90000, goalReached: false, avatar: "JF" },
  { id: "7", name: "Diego Almeida", category: "Cilindros", sales: 78000, goal: 75000, goalReached: true, avatar: "DA" },
  { id: "8", name: "Fernanda Oliveira", category: "Trincos", sales: 31000, goal: 60000, goalReached: false, avatar: "FO" },
];
