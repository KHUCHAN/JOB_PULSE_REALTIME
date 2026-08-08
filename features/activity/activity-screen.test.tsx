import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { ActivityScreen } from "./activity-screen";

it("reveals technical details on demand", async () => {
  const user = userEvent.setup();
  render(
    <FixtureProvider>
      <ActivityScreen />
    </FixtureProvider>,
  );
  const button = (await screen.findAllByRole("button", { name: "Show technical details" }))[0];
  await user.click(button);
  expect(screen.getByText(/event-/)).toBeInTheDocument();
});
