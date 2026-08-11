"use client";

import type { ReactElement } from "react";
import type { JobFilters } from "../../lib/domain";

type Chip = { key: keyof JobFilters; value?: string | number; label: string };

const arrayLabels: Array<[keyof JobFilters, string]> = [
  ["companies", "Company"], ["cities", "City"], ["states", "State"], ["countries", "Country"], ["employmentTypes", "Employment type"],
  ["departments", "Department"], ["teams", "Team"], ["businessUnits", "Business unit"], ["jobFamilies", "Job family"], ["jobFunctions", "Job function"], ["industries", "Industry"], ["offices", "Office"], ["skills", "Skill"], ["experienceLevels", "Experience level"], ["salaryCurrencies", "Salary currency"], ["salaryIntervals", "Salary interval"], ["educationRequirements", "Education"], ["shiftSchedules", "Shift"], ["travelRequirements", "Travel"], ["securityClearances", "Security clearance"], ["languages", "Language"],
];

const areaLabels: Record<string, string> = {
  "ai-ml": "AI / ML",
  "data-analytics": "Data / Analytics / Quant",
  "software-engineering": "Software Engineering",
};

const regionLabels: Record<string, string> = {
  us: "United States",
  non_us: "Outside U.S.",
  mixed: "U.S. / international",
  unknown: "Unknown region",
};

export function ActiveFilterChips({
  filters,
  onRemove,
  onClear,
}: {
  filters: JobFilters;
  onRemove(key: keyof JobFilters, value?: string | number): void;
  onClear(): void;
}): ReactElement | null {
  const chips: Chip[] = [];
  if (filters.query.trim()) chips.push({ key: "query", label: `Search: ${filters.query.trim()}` });
  if (filters.status !== "all") chips.push({ key: "status", label: `Job status: ${filters.status}` });
  if (filters.arrangement !== "all") chips.push({ key: "arrangement", label: `Work arrangement: ${filters.arrangement}` });
  if (filters.location.trim()) chips.push({ key: "location", label: `Location: ${filters.location.trim()}` });
  if (filters.resumeMatchProfile === "chanyoung-resume") chips.push({ key: "resumeMatchProfile", label: "My Resume Match" });
  for (const topic of filters.topics ?? []) {
    if (topic === "ai-data") chips.push({ key: "topics", value: topic, label: "Topic: AI & Data Science" });
  }
  for (const area of filters.areas ?? []) chips.push({ key: "areas", value: area, label: `Area: ${areaLabels[area] ?? area}` });
  for (const region of filters.regions ?? []) chips.push({ key: "regions", value: region, label: `Region: ${regionLabels[region] ?? region}` });
  for (const year of filters.recruitingYears ?? []) chips.push({ key: "recruitingYears", value: year, label: `Recruiting year: ${year}` });
  for (const program of filters.programTypes ?? []) chips.push({ key: "programTypes", value: program, label: `Program type: ${program === "coop" ? "Co-op" : program === "internship" ? "Internship" : "Regular role"}` });
  for (const season of filters.seasons ?? []) chips.push({ key: "seasons", value: season, label: `Season: ${season}` });
  if (filters.postedAfter) chips.push({ key: "postedAfter", label: `Posted after: ${filters.postedAfter}` });
  if (filters.postedBefore) chips.push({ key: "postedBefore", label: `Posted before: ${filters.postedBefore}` });
  if (filters.salaryMin !== undefined) chips.push({ key: "salaryMin", label: `Minimum salary: ${filters.salaryMin}` });
  if (filters.salaryMax !== undefined) chips.push({ key: "salaryMax", label: `Maximum salary: ${filters.salaryMax}` });
  for (const [key, label] of arrayLabels) {
    for (const value of (filters[key] as string[] | undefined) ?? []) chips.push({ key, value, label: `${label}: ${value}` });
  }
  if (!chips.length) return null;

  return (
    <div className="active-filter-chips" aria-label="Active filters">
      <span>Active filters</span>
      <div>{chips.map((chip) => <button key={`${chip.key}-${chip.value ?? ""}`} className="filter-chip" type="button" aria-label={`Remove ${chip.label}`} onClick={() => onRemove(chip.key, chip.value)}>{chip.label} ×</button>)}</div>
      <button className="clear-filters" type="button" onClick={onClear}>Clear all filters</button>
    </div>
  );
}
