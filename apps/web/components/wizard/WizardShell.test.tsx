import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { WizardShell } from "./WizardShell";
import { useWizard } from "./WizardProvider";

// Route-owning component for "/" (app/page.tsx just renders <WizardShell />).
// Async Server Components aren't supported by Vitest (see vitest.config.ts),
// but app/page.tsx is a trivial synchronous pass-through, so testing the
// client component it renders gives the same crash-on-mount coverage.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
  };
});

describe("WizardShell (route smoke test — /)", () => {
  it("mounts without crashing and shows the first wizard step", async () => {
    render(
      <AppProviders>
        <WizardShell />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Upload your rocket" }),
    ).toBeInTheDocument();
  });
});

describe("WizardShell — focus follows the step change", () => {
  function StepDriver() {
    const { setExport, next } = useWizard();
    return (
      <button
        type="button"
        onClick={() => {
          setExport("export-1", { name: "acme-1" });
          next();
        }}
      >
        drive-next
      </button>
    );
  }

  it("leaves focus alone on first mount, then moves it to the new step heading", async () => {
    render(
      <AppProviders>
        <StepDriver />
        <WizardShell />
      </AppProviders>,
    );

    const first = await screen.findByRole("heading", { name: "Upload your rocket" });
    expect(first).not.toHaveFocus();

    fireEvent.click(screen.getByText("drive-next"));

    const second = await screen.findByRole("heading", { name: "Where and when?" });
    await waitFor(() => expect(second).toHaveFocus());
  });
});
