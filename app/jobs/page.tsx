import { JobsScreen } from "../../features/jobs/jobs-screen";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  return <JobsScreen initialQuery={rawQuery ?? ""} />;
}
