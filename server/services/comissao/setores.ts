import sql from 'mssql';

export const SETORES_ATIVOS = [
  'TELEVENDAS',
  'TELEVENDAS MG',
  'DISTRIBUIDORES',
  'FERRAGENS',
] as const;

// Adiciona RVS_NOME IN (...setores ativos...) ao WHERE de um request mssql
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addSetoresGlobais(request: any, where: string): string {
  SETORES_ATIVOS.forEach((s, i) => {
    request.input(`setor_global_${i}`, sql.VarChar, s);
  });
  const placeholders = SETORES_ATIVOS.map((_, i) => `@setor_global_${i}`).join(', ');
  return `${where} AND RVS_NOME IN (${placeholders})`;
}
