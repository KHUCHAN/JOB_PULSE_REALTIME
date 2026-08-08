import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { JobsScreen } from "./jobs-screen";

describe("JobsScreen", () => {
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
});
