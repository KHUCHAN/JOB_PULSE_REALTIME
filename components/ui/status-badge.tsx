import type { ReactElement } from "react";
import { titleCase } from "../../lib/format";

export function StatusBadge({ status }: { status: string }): ReactElement {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  return (
    <span className="status-badge" data-status={normalized}>
      <span className="status-dot" aria-hidden="true" />
      {titleCase(status)}
    </span>
  );
}
