import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
}): ReactElement {
  return (
    <article className="metric-card">
      <div className="metric-icon" aria-hidden="true">
        <Icon size={19} strokeWidth={1.8} />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}
