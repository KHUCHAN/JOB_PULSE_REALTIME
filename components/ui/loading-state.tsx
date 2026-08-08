import type { ReactElement } from "react";

export function LoadingState({ label = "Loading view" }: { label?: string }): ReactElement {
  return (
    <div className="loading-state" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}
