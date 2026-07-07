interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent?: boolean;
  trend?: { value: number; label: string };
}

export default function KPICard({
  title,
  value,
  subtitle,
  icon,
  accent = false,
  trend,
}: KPICardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3 shadow-sm"
      style={{
        background: accent ? '#FFD700' : '#ffffff',
        border: accent ? 'none' : '1px solid #e2e8f0',
      }}
    >
      <div className="flex items-start justify-between">
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: accent ? '#00205C' : '#64748b' }}
        >
          {title}
        </p>
        <div
          className="flex items-center justify-center rounded-lg"
          style={{
            width: 36,
            height: 36,
            background: accent ? '#00205C' : '#0a1628',
            color: accent ? '#FFD700' : '#ffffff',
          }}
        >
          {icon}
        </div>
      </div>

      <div>
        <p
          className="text-2xl font-bold leading-tight"
          style={{ color: accent ? '#00205C' : '#0a1628' }}
        >
          {value}
        </p>
        {subtitle && (
          <p
            className="text-xs mt-0.5"
            style={{ color: accent ? '#1a3a6e' : '#94a3b8' }}
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
