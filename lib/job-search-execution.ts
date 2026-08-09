import type { JobSearchPlan } from "./job-search-sql";

type BindableStatement<T> = {
  bind(...values: unknown[]): T;
};

export function bindJobSearchStatements<T extends BindableStatement<T>>(
  prepare: (sql: string) => T,
  plan: JobSearchPlan,
): { page: T; count: T } {
  return {
    page: prepare(plan.pageSql).bind(...plan.bindings, plan.limit, plan.offset),
    count: prepare(plan.countSql).bind(...plan.bindings),
  };
}
