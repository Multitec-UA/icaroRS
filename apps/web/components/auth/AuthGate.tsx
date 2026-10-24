"use client";

/**
 * AuthGate — the Identity Platform login boundary for the whole app.
 *
 * "Logging in" means: sign in against Identity Platform with the Firebase
 * client SDK, exchange the resulting ID token for our own httpOnly session
 * cookie (POST /api/auth/session), then confirm it with GET /api/auth/me.
 * The cookie is httpOnly, so — unlike the old sessionStorage credential —
 * the client can never read it directly; `getIdentity()` is the only way to
 * ask "am I signed in?".
 *
 * Children may call `useAuth().logout()` (e.g. when a later request 401s)
 * to drop back to the login screen without a full reload.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ApiError, createSession, getIdentity, logout as apiLogout, type Identity } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/query-client";
import {
  sendPasswordReset,
  signInWithPassword,
  signOut as firebaseSignOut,
} from "@/lib/firebase";
import { Button, Callout, Card, Eyebrow, Field, Spinner, TextInput } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { Reveal } from "@/components/motion";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { AppNav } from "@/components/AppNav";

interface AuthContextValue {
  identity: Identity;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthGate>");
  return ctx;
}

type Status = "checking" | "authed" | "anonymous";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [status, setStatus] = useState<Status>("checking");
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let active = true;
    getIdentity()
      .then((id) => {
        if (active) {
          setIdentity(id);
          setStatus("authed");
        }
      })
      .catch(() => active && setStatus("anonymous"));
    return () => {
      active = false;
    };
  }, []);

  const onSignedIn = useCallback((id: Identity) => {
    setIdentity(id);
    setStatus("authed");
  }, []);

  const logout = useCallback(() => {
    setStatus("anonymous");
    setIdentity(null);
    void apiLogout();
    void firebaseSignOut();
  }, []);

  // Every query/mutation run through the shared QueryClient (lib/query-client.ts)
  // reports a 401 here, instead of each consumer repeating
  // `if (err.isUnauthorized) logout()`. `logout` is stable (useCallback, no
  // deps), so this registers once and is torn down on unmount.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  if (status === "checking") {
    return (
      <div className="flex min-h-[100dvh] flex-1 items-center justify-center">
        <Spinner className="text-slate-400" />
      </div>
    );
  }

  if (status === "anonymous" || !identity) {
    return <LoginScreen onSuccess={onSignedIn} />;
  }

  return (
    <AuthContext.Provider value={{ identity, logout }}>
      {/* Skip link: visually hidden until focused, first in tab order so
          keyboard users can jump past the nav straight to the page content. */}
      <a
        href="#main"
        className={cn(
          "sr-only rounded-full bg-foreground px-4 py-2 text-sm font-medium text-[#050505] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50",
          focusRing,
        )}
      >
        {t("common.skipToContent")}
      </a>
      <AppNav />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </AuthContext.Provider>
  );
}

/**
 * Forgot-password outcome. "requested" is shown whatever Firebase answers
 * about the account itself, so the screen never reveals whether an email has
 * an account (Identity Platform's email enumeration protection does the same
 * server-side). Only failures unrelated to the account are reported.
 */
type ResetState = "idle" | "needEmail" | "sending" | "requested" | "failed";

/** Firebase errors that say nothing about the account: the request itself did not go through. */
const RESET_DELIVERY_ERRORS = new Set(["auth/network-request-failed", "auth/too-many-requests"]);

function LoginScreen({ onSuccess }: { onSuccess: (identity: Identity) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<ResetState>("idle");

  async function forgotPassword() {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setReset("needEmail");
      return;
    }
    setReset("sending");
    try {
      await sendPasswordReset(address, locale);
      setReset("requested");
    } catch (err) {
      const code = isFirebaseAuthError(err) ? (err as { code: string }).code : "";
      setReset(RESET_DELIVERY_ERRORS.has(code) ? "failed" : "requested");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithPassword(email, pass);
      await createSession(idToken);
      const identity = await getIdentity();
      onSuccess(identity);
    } catch (err) {
      void firebaseSignOut();
      if (err instanceof ApiError && (err.isUnauthorized || err.status === 403)) {
        setError(t("auth.errorWrongCredentials"));
      } else if (err instanceof ApiError && err.status === 0) {
        setError(t("auth.errorUnreachable"));
      } else if (isFirebaseAuthError(err)) {
        setError(t("auth.errorWrongCredentials"));
      } else {
        setError(t("auth.errorGeneric"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-1 items-center justify-center px-4 py-16">
      <div className="absolute right-4 top-4">
        <LanguageSwitch />
      </div>
      <Reveal className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <Eyebrow>{t("auth.eyebrow")}</Eyebrow>
          <h1 className="bg-gradient-to-br from-white to-white/55 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
            {t("auth.title")}
          </h1>
          <p className="max-w-xs text-sm text-muted">
            {t("auth.subtitle")}
          </p>
        </div>
        <Card innerClassName="p-6 sm:p-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={t("auth.email")} htmlFor="email">
              <TextInput
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label={t("auth.password")} htmlFor="pass">
              <TextInput
                id="pass"
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
              />
            </Field>
            <div className="-mt-1 flex flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={forgotPassword}
                disabled={reset === "sending"}
                className="text-xs text-muted underline-offset-4 transition-colors duration-300 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
              >
                {t("auth.forgotPassword")}
              </button>
              {reset === "needEmail" && (
                <p role="status" className="text-right text-xs text-muted">
                  {t("auth.forgotPasswordNeedEmail")}
                </p>
              )}
              {reset === "requested" && (
                <p role="status" className="text-right text-xs text-emerald-400">
                  {t("auth.forgotPasswordRequested")}
                </p>
              )}
              {reset === "failed" && (
                <p role="alert" className="text-right text-xs text-rose-400">
                  {t("auth.forgotPasswordFailed")}
                </p>
              )}
            </div>
            {error && <Callout tone="error">{error}</Callout>}
            <Button type="submit" disabled={busy} className="mt-1 w-full" withArrow={!busy}>
              {busy && <Spinner />}
              {busy ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>
        </Card>
      </Reveal>
    </div>
  );
}

function isFirebaseAuthError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err
    && typeof (err as { code: unknown }).code === "string"
    && (err as { code: string }).code.startsWith("auth/");
}
