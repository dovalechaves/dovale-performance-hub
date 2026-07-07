export interface VendaRecord {
  EMP: string;
  PDV_DATA: Date;
  ETA_DESCRICAO: string;
  USU_NOME: string;
  SUBGRUPO: string;
  FAMILIA: string;
  QTDE: number;
  SUM: number;
  GRUPO: string;
  REP_CODIGO: number | null;
  RVS_NOME: string;
}

export interface ResumoVendedor {
  vendedor: string;
  setor: string;
  empresa: string;
  total_vendas: number;
  total_qtde: number;
  total_registros: number;
  comissao_estimada?: number;
}

export interface ResumoSetor {
  setor: string;
  total_vendas: number;
  total_qtde: number;
  total_registros: number;
}

export interface ResumoEmpresa {
  empresa: string;
  total_vendas: number;
  total_qtde: number;
}

export interface TendenciaMensal {
  ano: number;
  mes: number;
  total_vendas: number;
  total_qtde: number;
}

export interface ComissaoConfig {
  id?: number;
  setor: string;
  percentual: number;
  meta_mensal: number;
  ativo: boolean;
}

export type Cargo = 'ADM' | 'GESTOR' | 'VENDEDOR';

export interface UsuarioPermissao {
  id: number;
  email: string;
  nome: string;
  cargo: Cargo;
  setores: string[];
  nome_vendedor: string | null;
  ativo: boolean;
  criado_em?: string;
}

export interface DashboardSummary {
  total_vendas: number;
  total_vendas_mes: number;
  total_vendedores: number;
  total_setores: number;
  top_vendedores: ResumoVendedor[];
  vendas_por_setor: ResumoSetor[];
  vendas_por_empresa: ResumoEmpresa[];
  tendencia_mensal: TendenciaMensal[];
  total_pa_televendas: number;
  total_recebimentos_televendas: number;
  total_comissao_televendas: number;
}
