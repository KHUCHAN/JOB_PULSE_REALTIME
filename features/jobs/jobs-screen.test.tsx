import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { createFixtureRepository } from "../../lib/fixture-repository";
import { JobsScreen } from "./jobs-screen";

describe("JobsScreen", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/jobs");
  });

  it("renders job results while global filter options are still pending", async () => {
    const base = createFixtureRepository();
    const getJobFilterOptions = vi.fn(() => new Promise<never>(() => undefined));
    const repository = { ...base, getJobFilterOptions };

    render(
      <FixtureProvider repository={repository}>
        <JobsScreen initialQuery="" />
      </FixtureProvider>,
    );

    expect((await screen.findAllByText("Senior Data Scientist, Fraud")).length).toBeGreaterThan(0);
    await waitFor(() => expect(getJobFilterOptions).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Loading jobs")).not.toBeInTheDocument();
  });

  it("server-renders the same structured URL filters that hydrate on the client", () => {
    const html = renderToString(
      <FixtureProvider>
        <JobsScreen initialSearchParams="year=2027&program=internship&program=coop" />
      </FixtureProvider>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(".more-filters-button")?.textContent).toContain("More filters (2)");
    expect(html).toContain("Remove Recruiting year: 2027");
    expect(html).toContain("Remove Program type: Co-op");
  });

  it("toggles the AI & Data Science preset through URL state and a removable chip", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
    const preset = screen.getByRole("button", { name: "AI & Data Science" });

    expect(preset).toHaveAttribute("aria-pressed", "false");
    await user.click(preset);
    await waitFor(() => expect(window.location.search).toBe("?topic=ai-data"));
    expect(preset).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove Topic: AI & Data Science" })).toBeInTheDocument();
    expect(screen.queryAllByText("Fraud Strategy Analyst")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Remove Topic: AI & Data Science" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(preset).toHaveAttribute("aria-pressed", "false");
  });

  it("applies the one-click 2027 AI/Data internship preset", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
    const preset = screen.getByRole("button", { name: "2027 AI/Data Internships" });

    expect(preset).toHaveAttribute("aria-pressed", "false");
    await user.click(preset);
    await waitFor(() => expect(window.location.search)
      .toBe("?topic=ai-data&year=2027&program=internship&program=coop"));
    expect(preset).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove Recruiting year: 2027" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Program type: Internship" })).toBeInTheDocument();
  });

  it("presents Company and Role as separate desktop columns and mobile fields", async () => {
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
    const table = await screen.findByRole("table", { name: "Matching jobs" });

    expect(within(table).getByRole("columnheader", { name: "Company" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Company:/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^Role:/).length).toBeGreaterThan(0);
  });

  it("filters jobs and opens match details", async () => {
    const user = userEvent.setup();
    render(
      <FixtureProvider>
        <JobsScreen initialQuery="" />
      </FixtureProvider>,
    );
    await screen.findByRole("heading", { name: "Jobs" });

    await user.type(screen.getByRole("searchbox", { name: "Search jobs" }), "fraud");
    const rows = await screen.findAllByRole("button", { name: /View .* details/ });
    expect(rows.length).toBeGreaterThan(0);
    await user.click(rows[0]);
    expect(screen.getByRole("dialog", { name: "Job details" })).toBeInTheDocument();
    expect(screen.getByText("Why it matched")).toBeInTheDocument();
  });

  it("applies 2027 internship and co-op filters and exposes removable chips", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);

    await screen.findByRole("heading", { name: "Jobs" });
    await user.click(screen.getByRole("button", { name: /More filters/ }));
    await user.selectOptions(screen.getByLabelText("Recruiting year"), "2027");
    await user.click(screen.getByLabelText("Internship"));
    await user.click(screen.getByLabelText("Co-op"));

    expect(await screen.findByText(/roles found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Recruiting year: 2027" })).toBeInTheDocument();
  });

  it("writes canonical URL state, resets a removed chip to page one, and clears all controls", async () => {
    window.history.replaceState({}, "", "/jobs?status=saved&year=2027&page=2");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);

    await screen.findByRole("button", { name: "Remove Recruiting year: 2027" });
    await user.click(screen.getByRole("button", { name: "Remove Recruiting year: 2027" }));
    await waitFor(() => expect(window.location.search).toBe("?status=saved"));
    expect(replaceState).toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Job status"), "applied");
    await waitFor(() => expect(window.location.search).toBe("?status=applied"));
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getByLabelText("Job status")).toHaveValue("all");
  });

  it("requests stable pages from previous and next controls", async () => {
    window.history.replaceState({}, "", "/jobs?pageSize=1");
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);

    expect(await screen.findByText("Page 1 of 12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(window.location.search).toBe("?page=2&pageSize=1"));
    expect(screen.getByText("Page 2 of 12")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(window.location.search).toBe("?pageSize=1"));
    expect(screen.getByText("Page 1 of 12")).toBeInTheDocument();
  });

  it("writes structured city, state, and country filters to the URL", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);

    await user.click(screen.getByRole("button", { name: /More filters/ }));
    await user.type(screen.getByLabelText("City"), "San Francisco");
    await user.type(screen.getByLabelText("State"), "CA");
    await user.type(screen.getByLabelText("Country"), "US");

    await waitFor(() => expect(window.location.search).toBe("?city=San+Francisco&state=CA&country=US"));
  });

  it("focuses the advanced sheet and returns focus after Escape", async () => {
    const user = userEvent.setup();
    render(<FixtureProvider><JobsScreen initialQuery="" /></FixtureProvider>);
    const moreFilters = screen.getByRole("button", { name: /More filters/ });

    moreFilters.focus();
    await user.click(moreFilters);
    const close = await screen.findByRole("button", { name: "Close more filters" });
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More filters" })).not.toBeInTheDocument());
    expect(moreFilters).toHaveFocus();
  });
});
