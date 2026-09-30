const boundedInteger = (value, fallback, minimum, maximum) => {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
};

export function productionCrawlLimits(env = process.env) {
  return {
    maximumMinutes: boundedInteger(env.JOB_PULSE_MAX_RUN_MINUTES, 120, 1, 120),
    // Extending the collection window must not increase D1 writer pressure.
    requestConcurrency: boundedInteger(env.JOB_PULSE_REQUEST_CONCURRENCY, 2, 1, 2),
  };
}
