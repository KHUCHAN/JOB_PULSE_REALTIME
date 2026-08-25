export class InvalidJobFilterError extends Error {}

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

const validTimestamp = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  return !Number.isNaN(new Date(value).valueOf());
};

const rejectInvalidValues = (
  params: URLSearchParams,
  name: string,
  isValid: (value: string) => boolean,
) => {
  if (params.getAll(name).some((value) => !isValid(value))) {
    throw new InvalidJobFilterError(`Invalid ${name}.`);
  }
};

export const validateExplicitJobFilterValues = (params: URLSearchParams) => {
  rejectInvalidValues(params, "topic", (value) => value.trim().toLocaleLowerCase() === "ai-data");
  rejectInvalidValues(params, "area", (value) => ["ai-ml", "data-analytics", "software-engineering"].includes(value.trim().toLocaleLowerCase()));
  rejectInvalidValues(params, "region", (value) => ["us", "non_us", "mixed", "unknown"].includes(value.trim().toLocaleLowerCase()));
  rejectInvalidValues(params, "page", (value) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= Number.MAX_SAFE_INTEGER,
  );
  rejectInvalidValues(params, "pageSize", (value) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100,
  );
  for (const value of params.getAll("year").flatMap((item) => item.split(","))) {
    if (!/^\d{4}$/.test(value.trim()) || Number(value) < 2000 || Number(value) > 2100) {
      throw new InvalidJobFilterError("Invalid year.");
    }
  }
  for (const name of ["salaryMin", "salaryMax"]) {
    rejectInvalidValues(params, name, (value) =>
      /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)),
    );
  }
  for (const name of ["postedAfter", "postedBefore"]) {
    rejectInvalidValues(params, name, validDate);
  }
  rejectInvalidValues(params, "snapshotAt", validTimestamp);
};
