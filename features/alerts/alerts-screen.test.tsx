import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { AlertsScreen } from "./alerts-screen";

it("adds a keyword rule in demo mode", async () => {
  const user = userEvent.setup();
  render(
    <FixtureProvider>
      <AlertsScreen />
    </FixtureProvider>,
  );
  await user.type(screen.getByLabelText("Rule name"), "Graph ML");
  await user.type(screen.getByLabelText("Include terms"), "graph neural network, GNN");
  await user.click(screen.getByRole("button", { name: "Add keyword rule" }));
  expect(await screen.findByText("Graph ML")).toBeInTheDocument();
  expect(screen.getByText(/Demo data.*not persisted/i)).toBeInTheDocument();
});
