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
import { signInWithPassword, signOut as firebaseSignOut } from "@/lib/firebase";
import { Button, Callout, Card, Eyebrow, Field, Spinner, TextInput } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/components/i18n/LocaleProvider";
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
      <AppNav />
      {children}
    </AuthContext.Provider>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: (identity: Identity) => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <Field label={t("auth.username")} htmlFor="email">
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
