import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";

const { sendPasswordResetMock, signInMock } = vi.hoisted(() => ({
  sendPasswordResetMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    // No session: AuthGate settles on the login screen.
    getIdentity: vi.fn().mockRejectedValue(new actual.ApiError(401, "no session")),
  };
});

vi.mock("@/lib/firebase", () => ({
  signInWithPassword: signInMock,
  signOut: vi.fn().mockResolvedValue(undefined),
  sendPasswordReset: sendPasswordResetMock,
}));

const NEUTRAL = "If an account exists for that email, you will receive a link to reset your password.";

function firebaseError(code: string) {
  return Object.assign(new Error(code), { code });
}

async function renderLogin() {
  render(
    <AppProviders>
      <div />
    </AppProviders>,
  );
  await screen.findByRole("button", { name: "Forgot your password?" });
}

/**
 * Looked up at click time: the login screen is rebuilt once early in the
 * mount, so an element captured right after it first appears can be stale.
 */
function forgotLink() {
  return screen.getByRole("button", { name: "Forgot your password?" });
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginScreen — forgot password", () => {
  it("offers a forgot-password link that does not submit the sign-in form", async () => {
    await renderLogin();
    typeEmail("pilot@multitec.dev");

    fireEvent.click(forgotLink());

    expect(forgotLink()).toHaveAttribute("type", "button");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("asks for the email first when the field is empty or not an email", async () => {
    await renderLogin();

    fireEvent.click(forgotLink());
    expect(await screen.findByText("Type your email above to get a reset link.")).toBeInTheDocument();

    typeEmail("not-an-email");
    fireEvent.click(forgotLink());
    expect(screen.getByText("Type your email above to get a reset link.")).toBeInTheDocument();
    expect(sendPasswordResetMock).not.toHaveBeenCalled();
  });

  it("sends Firebase's reset email to the typed address, in the current language, without echoing it", async () => {
    sendPasswordResetMock.mockResolvedValue(undefined);
    await renderLogin();
    typeEmail("pilot@multitec.dev");

    fireEvent.click(forgotLink());

    const message = await screen.findByText(NEUTRAL);
    expect(sendPasswordResetMock).toHaveBeenCalledWith("pilot@multitec.dev", "en");
    expect(message).not.toHaveTextContent("pilot@multitec.dev");
  });

  it.each(["auth/user-not-found", "auth/user-disabled", "auth/invalid-email", "auth/internal-error"])(
    "shows the same neutral message when Firebase answers %s, so it never hints whether the account exists",
    async (code) => {
      sendPasswordResetMock.mockRejectedValue(firebaseError(code));
      await renderLogin();
      typeEmail("someone@example.com");

      fireEvent.click(forgotLink());

      expect(await screen.findByText(NEUTRAL)).toBeInTheDocument();
      expect(screen.queryByText(/could not send/i)).not.toBeInTheDocument();
    },
  );

  it.each(["auth/network-request-failed", "auth/too-many-requests"])(
    "says the email could not be sent on %s, which is unrelated to the account",
    async (code) => {
      sendPasswordResetMock.mockRejectedValue(firebaseError(code));
      await renderLogin();
      typeEmail("someone@example.com");

      fireEvent.click(forgotLink());

      expect(
        await screen.findByText("Could not send the email. Try again in a few minutes."),
      ).toBeInTheDocument();
      expect(screen.queryByText(NEUTRAL)).not.toBeInTheDocument();
    },
  );

  it("still shows the login's own error for a failed sign-in", async () => {
    signInMock.mockRejectedValue(firebaseError("auth/invalid-credential"));
    await renderLogin();
    typeEmail("pilot@multitec.dev");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Wrong email or password.")).toBeInTheDocument();
  });
});
