import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";
import { FixtureProvider } from "./fixture-provider";

describe("AppShell", () => {
  it("shows every route and runs a demo-only crawl", async () => {
    const user = userEvent.setup();
    render(
      <FixtureProvider>
        <AppShell>
          <div>Route body</div>
        </AppShell>
      </FixtureProvider>,
    );

    for (const name of [
      "Overview",
      "Jobs",
      "Sources",
      "Alerts",
      "Talent Harness",
      "Activity",
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crawl now" }));
    expect(await screen.findByText(/simulated crawl completed/i)).toBeInTheDocument();
  });
});
