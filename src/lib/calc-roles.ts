export type CalcRole = "loja" | "industria";

export const CALC_ROLE_LABELS: Record<CalcRole, string> = {
  loja:      "Loja",
  industria: "Indústria",
};

const STORAGE_KEY = "dovale_calc_roles";

export function getCalcRole(usuario: string): CalcRole {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, CalcRole>;
    return map[usuario] ?? "industria";
  } catch {
    return "industria";
  }
}

export function setCalcRole(usuario: string, role: CalcRole): void {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, CalcRole>;
    map[usuario] = role;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function getAllCalcRoles(): Record<string, CalcRole> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
