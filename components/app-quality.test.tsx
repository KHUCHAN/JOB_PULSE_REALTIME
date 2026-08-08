import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "./fixture-provider";
import { JobsScreen } from "../features/jobs/jobs-screen";
import { SourcesScreen } from "../features/sources/sources-screen";

it("provides labeled controls and visible demo boundaries", async () => {
  const { rerender } = render(
    <FixtureProvider>
      <JobsScreen />
    </FixtureProvider>,
  );
  expect(await screen.findByRole("searchbox", { name: "Search jobs" })).toBeInTheDocument();
  expect(screen.getByLabelText("Job status")).toBeInTheDocument();
  expect(screen.getByText("Demo data")).toBeInTheDocument();

  rerender(
    <FixtureProvider>
      <SourcesScreen />
    </FixtureProvider>,
  );
  expect(await screen.findByLabelText("Source health")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Monitored sources" })).toBeInTheDocument();
});
