import { JobsScreen } from "../../features/jobs/jobs-screen";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialSearchParams = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    for (const value of Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue]) {
      initialSearchParams.append(key, value);
    }
  }
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  return <JobsScreen initialQuery={rawQuery ?? ""} initialSearchParams={initialSearchParams.toString()} />;
}
