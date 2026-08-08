import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { OverviewScreen } from "./overview-screen";

describe("OverviewScreen", () => {
  it("renders operational metrics and recent work", async () => {
    render(
      <FixtureProvider>
        <OverviewScreen />
      </FixtureProvider>,
    );

    expect(await screen.findByText("New matching jobs")).toBeInTheDocument();
    expect(screen.getByText("Latest matching jobs")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });
});
