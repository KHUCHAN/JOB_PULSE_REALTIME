"use client";

import { useEffect, useEffectEvent, useState } from "react";

export function useRepositoryQuery<T>(
  loader: () => Promise<T>,
  dependencies: readonly unknown[],
): { data: T | null; loading: boolean; error: Error | null; retry(): void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const dependencyKey = JSON.stringify(dependencies);
  const load = useEffectEvent(loader);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError(null);

      load()
        .then((result) => {
          if (active) setData(result);
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(reason instanceof Error ? reason : new Error("Unable to load data"));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
    };
  }, [dependencyKey, retryKey]);

  return {
    data,
    loading,
    error,
    retry: () => setRetryKey((current) => current + 1),
  };
}
