import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { WizardShell } from "./WizardShell";

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
