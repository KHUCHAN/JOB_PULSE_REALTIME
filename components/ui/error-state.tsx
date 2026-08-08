import { TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";

export function ErrorState({ retry }: { retry(): void }): ReactElement {
  return (
    <div className="state-panel" role="alert">
      <TriangleAlert aria-hidden="true" />
      <strong>Couldn&apos;t load this view</strong>
      <span>The preview data is still safe. Try the query again.</span>
      <button className="button secondary" type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
