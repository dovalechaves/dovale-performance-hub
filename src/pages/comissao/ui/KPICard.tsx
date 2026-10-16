interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  extra?: string;
  icon: React.ReactNode;
  accent?: boolean;
  /** destaque em verde (ex.: o valor que a pessoa vai receber) */
  green?: boolean;
  trend?: { value: number; label: string };
}

export default function KPICard({
  title,
  value,
  subtitle,
  extra,
  icon,
  accent = false,
  green = false,
  trend,
}: KPICardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3 shadow-sm"
      style={{
        background: green ? '#15803d' : accent ? '#FFD700' : '#ffffff',
        border: accent || green ? 'none' : '1px solid #e2e8f0',
      }}
    >
      <div className="flex items-start justify-between">
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: green ? '#dcfce7' : accent ? '#00205C' : '#64748b' }}
        >
          {title}
        </p>
        <div
          className="flex items-center justify-center rounded-lg"
          style={{
            width: 36,
            height: 36,
            background: green ? '#14532d' : accent ? '#00205C' : '#0a1628',
            color: green ? '#ffffff' : accent ? '#FFD700' : '#ffffff',
          }}
        >
          {icon}
        </div>
      </div>

      <div>
        <p
          className={`${green ? 'text-3xl' : 'text-2xl'} font-bold leading-tight`}
          style={{ color: green ? '#ffffff' : accent ? '#00205C' : '#0a1628' }}
        >
          {value}
        </p>
        {extra && (
          <p
            className="text-xs mt-1 font-medium"
            style={{ color: green ? '#f0fdf4' : accent ? '#00205C' : '#64748b' }}
          >
            {extra}
          </p>
        )}
        {subtitle && (
          <p
            className="text-xs mt-0.5"
            style={{ color: green ? '#dcfce7' : accent ? '#1a3a6e' : '#94a3b8' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {trend && (
        <div className="flex items-center gap-1">
          <span
            className="text-xs font-semibold"
            style={{ color: trend.value >= 0 ? '#16a34a' : '#dc2626' }}
          >
            {trend.value >= 0 ? '▲' : '▼'}{' '}
            {Math.abs(trend.value).toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: accent ? '#1a3a6e' : '#94a3b8' }}>
            {trend.label}
          </span>
        </div>
      )}
    </div>
  );
}
