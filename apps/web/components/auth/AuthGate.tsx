"use client";

/**
 * AuthGate — the HTTP Basic login boundary for the whole app.
 *
 * The API protects every route with Basic auth. We don't have a session
 * endpoint, so "logging in" means: store the credentials, then make one real
 * call (GET /api/scenario/template) to verify them. Wrong credentials come
 * back as 401 → we clear them and show the error.
 *
 * Children may call `useAuth().logout()` (e.g. when a later request 401s) to
 * drop back to the login screen without a full reload.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ApiError,
  clearCredentials,
  getScenarioTemplate,
  hasCredentials,
  setCredentials,
} from "@/lib/api";
import { Button, Callout, Card, Eyebrow, Field, Spinner, TextInput } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/components/i18n/LocaleProvider";
import { AppNav } from "@/components/AppNav";

interface AuthContextValue {
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthGate>");
  return ctx;
}

/** Credentials live in sessionStorage (client-only). We expose them to React as
 * an external store so reads are SSR-safe: `getServerSnapshot` returns false so
 * the server and first client paint agree (no hydration mismatch), then React
 * re-reads the real value. login/logout call `notifyAuthChange` to re-sync. */
const AUTH_EVENT = "icaro-auth-change";

function subscribeAuth(onChange: () => void): () => void {
  window.addEventListener(AUTH_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AUTH_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function notifyAuthChange(): void {
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function AuthGate({ children }: { children: ReactNode }) {
  const authed = useSyncExternalStore(
    subscribeAuth,
    hasCredentials,
    () => false,
  );

  const logout = useCallback(() => {
    clearCredentials();
    notifyAuthChange();
  }, []);

  if (!authed) {
    return <LoginScreen onSuccess={notifyAuthChange} />;
  }

  return (
    <AuthContext.Provider value={{ logout }}>
      <AppNav />
      {children}
    </AuthContext.Provider>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCredentials(user, pass);
    try {
      await getScenarioTemplate(); // real call to verify the credentials
      onSuccess();
    } catch (err) {
      clearCredentials();
      if (err instanceof ApiError && err.isUnauthorized) {
        setError(t("auth.errorWrongCredentials"));
      } else if (err instanceof ApiError && err.status === 0) {
        setError(t("auth.errorUnreachable"));
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
            <Field label={t("auth.username")} htmlFor="user">
              <TextInput
                id="user"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
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
