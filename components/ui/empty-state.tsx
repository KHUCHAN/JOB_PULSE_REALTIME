import { Inbox } from "lucide-react";
import type { ReactElement } from "react";

export function EmptyState({
  title = "Nothing to show",
  detail = "Try another filter or check back after the next run.",
}: {
  title?: string;
  detail?: string;
}): ReactElement {
  return (
    <div className="state-panel" role="status">
      <Inbox aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
