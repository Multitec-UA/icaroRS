import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";

const { getIdentityMock, apiLogoutMock, sendPasswordResetMock, firebaseSignOutMock } = vi.hoisted(
  () => ({
    getIdentityMock: vi.fn(),
    apiLogoutMock: vi.fn(),
    sendPasswordResetMock: vi.fn(),
    firebaseSignOutMock: vi.fn(),
  }),
);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getIdentity: getIdentityMock, logout: apiLogoutMock };
});

vi.mock("@/lib/firebase", () => ({
  signInWithPassword: vi.fn(),
  signOut: firebaseSignOutMock,
  sendPasswordReset: sendPasswordResetMock,
}));

const IDENTITY = { user_id: "u1", org_id: "multitec", email: "pilot@multitec.dev" };

function renderSignedIn(identity: typeof IDENTITY | Omit<typeof IDENTITY, "email"> & { email: null } = IDENTITY) {
  getIdentityMock.mockResolvedValue(identity);
  apiLogoutMock.mockResolvedValue(undefined);
  firebaseSignOutMock.mockResolvedValue(undefined);
  render(
    <AppProviders>
      <div />
    </AppProviders>,
  );
}

async function openMenu() {
  const trigger = await screen.findByRole("button", { name: "Account" });
  fireEvent.click(trigger);
  return trigger;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AccountMenu", () => {
  it("is a round avatar button in the nav, closed until clicked", async () => {
    renderSignedIn();

    const trigger = await screen.findByRole("button", { name: "Account" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("pilot@multitec.dev")).not.toBeInTheDocument();
  });

  it("opens a panel with the user's email and organization", async () => {
    renderSignedIn();

    const trigger = await openMenu();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("pilot@multitec.dev")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("multitec")).toBeInTheDocument();
  });

  it("offers the language switch inside the panel", async () => {
    renderSignedIn();
    await openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Español" }));

    expect(await screen.findByText("Organización")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cuenta" })).toBeInTheDocument();
  });

  it("sends Firebase's password reset email to the signed-in address, in the current language", async () => {
    sendPasswordResetMock.mockResolvedValue(undefined);
    renderSignedIn();
    await openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText("We sent a link to change your password to pilot@multitec.dev."),
    ).toBeInTheDocument();
    expect(sendPasswordResetMock).toHaveBeenCalledWith("pilot@multitec.dev", "en");
  });

  it("says so when the reset email could not be sent", async () => {
    sendPasswordResetMock.mockRejectedValue(new Error("auth/too-many-requests"));
    renderSignedIn();
    await openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText("Could not send the email. Try again in a few minutes."),
    ).toBeInTheDocument();
  });

  it("cannot request a password change for an account without an email", async () => {
    renderSignedIn({ ...IDENTITY, email: null });
    await openMenu();

    expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  });

  it("signs out and returns to the login screen", async () => {
    renderSignedIn();
    await openMenu();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(apiLogoutMock).toHaveBeenCalled();
    expect(firebaseSignOutMock).toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to the avatar", async () => {
    renderSignedIn();
    const trigger = await openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByText("pilot@multitec.dev")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when clicking outside the panel", async () => {
    renderSignedIn();
    const trigger = await openMenu();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });
});
