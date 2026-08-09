"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import type { ReactElement } from "react";
import type { JobFilterOption, JobFilterOptions, JobFilters, JobSeason } from "../../lib/domain";
import { activeFilterCount } from "../../lib/job-filter-query";

type FilterPatch = Partial<JobFilters>;

const optionValues = (options: JobFilterOption[] | undefined): string[] =>
  (options ?? []).map((option) => String(option.value));

function DatalistField({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options?: JobFilterOption[];
  placeholder?: string;
  onChange(value: string): void;
}): ReactElement {
  return (
    <div className="filter-control">
      <label htmlFor={id}>{label}</label>
      <input id={id} list={`${id}-options`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <datalist id={`${id}-options`}>
        {optionValues(options).map((option) => <option key={option} value={option} />)}
      </datalist>
    </div>
  );
}

function CheckboxOption<T extends string>({
  id,
  label,
  value,
  selected,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  selected: T[];
  onChange(values: T[]): void;
}): ReactElement {
  const checked = selected.includes(value);
  return (
    <label className="filter-checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onChange(checked ? selected.filter((item) => item !== value) : [...selected, value])}
      />
      {label}
    </label>
  );
}

export function JobFilterPanel({
  filters,
  options,
  search,
  advancedOpen,
  onSearchChange,
  onChange,
  onAdvancedOpenChange,
}: {
  filters: JobFilters;
  options?: JobFilterOptions;
  search: string;
  advancedOpen: boolean;
  onSearchChange(value: string): void;
  onChange(patch: FilterPatch): void;
  onAdvancedOpenChange(open: boolean): void;
}): ReactElement {
  const companies = filters.companies ?? [];
  const employmentTypes = filters.employmentTypes ?? [];
  const programTypes = filters.programTypes ?? [];
  const seasons = filters.seasons ?? [];
  const recruitingYears = [...new Set(["2027", ...optionValues(options?.recruitingYears), ...(filters.recruitingYears ?? []).map(String)])];
  const setTextArray = (key: keyof JobFilters, value: string) => onChange({ [key]: value.trim() ? [value] : [] });

  return (
    <section className="job-filter-panel" aria-label="Job filters">
      <div className="filter-bar job-filter-common">
        <div className="filter-search">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="job-search">Search jobs</label>
          <input id="job-search" type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Role, company, or keyword" />
        </div>
        <DatalistField id="job-company" label="Company" value={companies[0] ?? ""} options={options?.companies} placeholder="Any company" onChange={(value) => setTextArray("companies", value)} />
        <DatalistField id="job-location" label="Location" value={filters.location} options={options?.locations} placeholder="Any location" onChange={(location) => onChange({ location })} />
        <div className="filter-control">
          <label htmlFor="job-status">Job status</label>
          <select id="job-status" value={filters.status} onChange={(event) => onChange({ status: event.target.value as JobFilters["status"] })}>
            <option value="all">All statuses</option><option value="new">New</option><option value="saved">Saved</option><option value="hidden">Hidden</option><option value="applied">Applied</option>
          </select>
        </div>
        <div className="filter-control">
          <label htmlFor="arrangement">Work arrangement</label>
          <select id="arrangement" value={filters.arrangement} onChange={(event) => onChange({ arrangement: event.target.value as JobFilters["arrangement"] })}>
            <option value="all">Any arrangement</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option>
          </select>
        </div>
        <div className="filter-control">
          <label htmlFor="employment-type">Employment type</label>
          <select id="employment-type" value={employmentTypes[0] ?? ""} onChange={(event) => setTextArray("employmentTypes", event.target.value)}>
            <option value="">Any employment type</option>
            {optionValues(options?.employmentTypes).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <button className="button secondary more-filters-button" type="button" aria-expanded={advancedOpen} onClick={() => onAdvancedOpenChange(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" /> More filters{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ""}
        </button>
      </div>

      {advancedOpen ? (
        <aside className="filter-sheet" role="dialog" aria-modal="false" aria-label="More filters">
          <header>
            <div><span>Structured search</span><h2>More filters</h2></div>
            <button className="icon-button" type="button" aria-label="Close more filters" onClick={() => onAdvancedOpenChange(false)}><X aria-hidden="true" /></button>
          </header>
          <div className="filter-sheet-body">
            <div className="advanced-filter-grid">
              <div className="filter-control">
                <label htmlFor="recruiting-year">Recruiting year</label>
                <select id="recruiting-year" value={filters.recruitingYears?.[0]?.toString() ?? ""} onChange={(event) => onChange({ recruitingYears: event.target.value ? [Number(event.target.value)] : [] })}>
                  <option value="">Any recruiting year</option>
                  {recruitingYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
              <fieldset className="filter-fieldset"><legend>Program type</legend><div className="filter-check-grid">
                <CheckboxOption id="program-internship" label="Internship" value="internship" selected={programTypes} onChange={(values) => onChange({ programTypes: values })} />
                <CheckboxOption id="program-coop" label="Co-op" value="coop" selected={programTypes} onChange={(values) => onChange({ programTypes: values })} />
                <CheckboxOption id="program-regular" label="Regular role" value="regular" selected={programTypes} onChange={(values) => onChange({ programTypes: values })} />
              </div></fieldset>
              <fieldset className="filter-fieldset"><legend>Season</legend><div className="filter-check-grid">
                {(["spring", "summer", "fall", "winter"] as JobSeason[]).map((season) => <CheckboxOption key={season} id={`season-${season}`} label={season[0].toUpperCase() + season.slice(1)} value={season} selected={seasons} onChange={(values) => onChange({ seasons: values })} />)}
              </div></fieldset>
              <div className="filter-control"><label htmlFor="posted-after">Posted after</label><input id="posted-after" type="date" value={filters.postedAfter ?? ""} onChange={(event) => onChange({ postedAfter: event.target.value })} /></div>
              <div className="filter-control"><label htmlFor="posted-before">Posted before</label><input id="posted-before" type="date" value={filters.postedBefore ?? ""} onChange={(event) => onChange({ postedBefore: event.target.value })} /></div>
              <DatalistField id="department" label="Department" value={filters.departments?.[0] ?? ""} options={options?.departments} onChange={(value) => setTextArray("departments", value)} />
              <DatalistField id="team" label="Team" value={filters.teams?.[0] ?? ""} options={options?.teams} onChange={(value) => setTextArray("teams", value)} />
              <DatalistField id="business-unit" label="Business unit" value={filters.businessUnits?.[0] ?? ""} options={options?.businessUnits} onChange={(value) => setTextArray("businessUnits", value)} />
              <DatalistField id="job-family" label="Job family" value={filters.jobFamilies?.[0] ?? ""} options={options?.jobFamilies} onChange={(value) => setTextArray("jobFamilies", value)} />
              <DatalistField id="job-function" label="Job function" value={filters.jobFunctions?.[0] ?? ""} options={options?.jobFunctions} onChange={(value) => setTextArray("jobFunctions", value)} />
              <DatalistField id="industry" label="Industry" value={filters.industries?.[0] ?? ""} options={options?.industries} onChange={(value) => setTextArray("industries", value)} />
              <DatalistField id="office" label="Office" value={filters.offices?.[0] ?? ""} options={options?.offices} onChange={(value) => setTextArray("offices", value)} />
              <DatalistField id="skill" label="Skill" value={filters.skills?.[0] ?? ""} options={options?.skills} onChange={(value) => setTextArray("skills", value)} />
              <DatalistField id="experience-level" label="Experience level" value={filters.experienceLevels?.[0] ?? ""} options={options?.experienceLevels} onChange={(value) => setTextArray("experienceLevels", value)} />
              <div className="filter-control"><label htmlFor="salary-min">Minimum salary</label><input id="salary-min" type="number" min="0" value={filters.salaryMin ?? ""} onChange={(event) => onChange({ salaryMin: event.target.value ? Number(event.target.value) : undefined })} /></div>
              <div className="filter-control"><label htmlFor="salary-max">Maximum salary</label><input id="salary-max" type="number" min="0" value={filters.salaryMax ?? ""} onChange={(event) => onChange({ salaryMax: event.target.value ? Number(event.target.value) : undefined })} /></div>
              <DatalistField id="salary-currency" label="Salary currency" value={filters.salaryCurrencies?.[0] ?? ""} options={options?.salaryCurrencies} onChange={(value) => setTextArray("salaryCurrencies", value)} />
              <DatalistField id="salary-interval" label="Salary interval" value={filters.salaryIntervals?.[0] ?? ""} options={options?.salaryIntervals} onChange={(value) => setTextArray("salaryIntervals", value)} />
              <DatalistField id="education" label="Education" value={filters.educationRequirements?.[0] ?? ""} options={options?.educationRequirements} onChange={(value) => setTextArray("educationRequirements", value)} />
              <DatalistField id="shift" label="Shift" value={filters.shiftSchedules?.[0] ?? ""} options={options?.shiftSchedules} onChange={(value) => setTextArray("shiftSchedules", value)} />
              <DatalistField id="travel" label="Travel" value={filters.travelRequirements?.[0] ?? ""} options={options?.travelRequirements} onChange={(value) => setTextArray("travelRequirements", value)} />
              <DatalistField id="clearance" label="Security clearance" value={filters.securityClearances?.[0] ?? ""} options={options?.securityClearances} onChange={(value) => setTextArray("securityClearances", value)} />
              <DatalistField id="language" label="Language" value={filters.languages?.[0] ?? ""} options={options?.languages} onChange={(value) => setTextArray("languages", value)} />
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
