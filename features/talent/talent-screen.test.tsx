import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { TalentScreen } from "./talent-screen";

it("provides verified Talent links without running registration in the app", async () => {
  render(
    <FixtureProvider>
      <TalentScreen />
    </FixtureProvider>,
  );
  expect(await screen.findByText("Verified Talent directory")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /Open .* official Talent page/ }).length).toBeGreaterThan(0);
  expect(screen.getByText(/opens the official page and provides a checklist/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Start .* assisted flow/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Mark .* completed/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Mark .* blocked/ })).not.toBeInTheDocument();
});
