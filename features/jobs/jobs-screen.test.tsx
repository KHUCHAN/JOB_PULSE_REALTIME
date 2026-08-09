import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { JobsScreen } from "./jobs-screen";

describe("JobsScreen", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/jobs");
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
});
