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

interface AuthContextValue {
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthGate>");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  // Lazy initial state — sessionStorage is only available client-side.
  const [authed, setAuthed] = useState<boolean>(() => hasCredentials());

  const logout = useCallback(() => {
    clearCredentials();
    setAuthed(false);
  }, []);

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />;
  }

  return <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
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
        setError("Wrong username or password.");
      } else if (err instanceof ApiError && err.status === 0) {
        setError("Could not reach the API. Is the server running?");
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-1 items-center justify-center px-4 py-16">
      <Reveal className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <Eyebrow>Rocket simulation</Eyebrow>
          <h1 className="bg-gradient-to-br from-white to-white/55 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
            icaro
          </h1>
          <p className="max-w-xs text-sm text-muted">
            Turn your OpenRocket design into a full 6-DOF flight simulation.
          </p>
        </div>
        <Card innerClassName="p-6 sm:p-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Username" htmlFor="user">
              <TextInput
                id="user"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="pass">
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
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
      </Reveal>
    </div>
  );
}
