import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";
import { FixtureProvider } from "./fixture-provider";

describe("AppShell", () => {
  it("shows every route and the automatic two-hour crawl cadence", () => {
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
    expect(screen.getByText("Automatic · every 2 hours")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crawl now" })).not.toBeInTheDocument();
  });
});
