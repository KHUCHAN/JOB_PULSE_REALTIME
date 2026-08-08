import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FixtureProvider } from "../../components/fixture-provider";
import { TalentScreen } from "./talent-screen";

it("marks a target blocked with a visible gate reason", async () => {
  const user = userEvent.setup();
  render(
    <FixtureProvider>
      <TalentScreen />
    </FixtureProvider>,
  );
  const blockButtons = await screen.findAllByRole("button", { name: /Mark .* blocked/ });
  await user.click(blockButtons[0]);
  await user.selectOptions(screen.getByLabelText("Blocker reason"), "captcha");
  await user.click(screen.getByRole("button", { name: "Save blocker" }));
  expect(await screen.findByText("CAPTCHA — user action required")).toBeInTheDocument();
});
