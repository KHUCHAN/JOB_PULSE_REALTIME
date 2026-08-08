import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { SourcesScreen } from "./sources-screen";

it("filters blocked sources", async () => {
  const user = userEvent.setup();
  render(
    <FixtureProvider>
      <SourcesScreen />
    </FixtureProvider>,
  );
  await user.selectOptions(screen.getByLabelText("Source health"), "blocked");
  const badges = await screen.findAllByText("Blocked");
  expect(badges.length).toBeGreaterThan(0);
  expect(screen.queryByText("Healthy", { selector: "[data-status]" })).not.toBeInTheDocument();
});
