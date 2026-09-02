import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check } from "lucide-react";

export interface MultiOption {
  value: string;
  label: string;
  hint?: string; // ex.: sigla da UF, exibida em mono
}

// Combobox de múltipla seleção com busca (compartilhado por CNAE e Estado).
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder,
  manyLabel,
  searchPlaceholder,
  className = "",
  disabled = false,
}: {
  options: MultiOption[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  manyLabel: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("pt-BR");
    const base = t
      ? options.filter(
          (o) =>
            o.label.toLocaleLowerCase("pt-BR").includes(t) ||
            (o.hint || "").toLocaleLowerCase("pt-BR").includes(t),
        )
      : options;
    return base.slice(0, 300);
  }, [options, q]);

  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const one = values.length === 1 ? options.find((o) => o.value === values[0])?.label : null;
  const label = values.length === 0 ? placeholder : values.length === 1 ? one ?? placeholder : `${values.length} ${manyLabel}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 h-11 rounded-md border border-input bg-background px-3.5 text-left text-sm hover:border-primary/50 transition-colors disabled:opacity-60"
      >
        <span className={`flex-1 truncate ${values.length ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        {values.length > 1 && (
          <span className="text-[11px] font-bold text-primary bg-primary/[0.12] rounded-full px-1.5 py-px">{values.length}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[250px] rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 h-[42px] text-muted-foreground">
            <Search className="w-[15px] h-[15px]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            />
            {values.length > 0 && (
              <button onClick={() => onChange([])} className="text-[11px] text-primary whitespace-nowrap">
                limpar
              </button>
            )}
          </div>
          <div className="max-h-[264px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhum resultado.</p>
            ) : (
              filtered.map((o) => {
                const on = values.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={`w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-sm text-[13px] leading-snug transition-colors ${
                      on ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded flex items-center justify-center ${
                        on ? "bg-primary text-primary-foreground" : "border-[1.5px] border-muted-foreground/50"
                      }`}
                    >
                      {on && <Check className="w-[11px] h-[11px]" strokeWidth={3} />}
                    </span>
                    {o.hint && <span className="font-mono text-[11px] opacity-60 shrink-0">{o.hint}</span>}
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
            {options.length > filtered.length && q.trim() === "" && (
              <p className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                digite para buscar entre {options.length} itens
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
