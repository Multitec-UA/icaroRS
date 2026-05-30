"use client";

/**
 * Step 5 — Results dashboard. Renders the serialized Flight: headline numbers as
 * cards, the rest in a details table, a plot gallery, and a warnings banner
 * (e.g. when a real forecast fell back to standard atmosphere).
 *
 * Reads the result from the wizard if it's the run we just produced; otherwise
 * (deep link / refresh) fetches it from /api/results/{runId}.
 *
 * Plot PNGs sit behind Basic auth, so each is fetched with the auth header and
 * shown via an object URL (a bare <img src> couldn't carry the credentials).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  fetchImageObjectUrl,
  getResult,
  type SimulateResult,
} from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { SCALAR_SPECS, formatScalar, plotTitle } from "@/lib/scalars";
import { Button, Callout, InfoTip, Spinner } from "@/components/ui";

export function ResultsDashboard({ runId }: { runId: string }) {
  const { state, goto, reset } = useWizard();
  const { logout } = useAuth();
  const router = useRouter();

  const fromWizard = state.result?.run_id === runId ? state.result : null;
  const [result, setResult] = useState<SimulateResult | null>(fromWizard);
  const [loading, setLoading] = useState<boolean>(!fromWizard);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fromWizard) return;
    let active = true;
    // `loading` already starts true when not served from the wizard, so no
    // synchronous setState is needed here.
    getResult(runId)
      .then((env) => active && setResult(env.result))
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.isUnauthorized) return logout();
        setError(err instanceof Error ? err.message : "Could not load results.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-500">
        <Spinner /> Loading results…
      </div>
    );
  }
  if (error || !result) {
    return (
      <div className="py-12">
        <Callout tone="error" title="Results unavailable">
          {error ?? "This run could not be found."}
        </Callout>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => router.push("/")}>
            ← Back to start
          </Button>
        </div>
      </div>
    );
  }

  const present = (key: string) => key in result.scalars;
  const primary = SCALAR_SPECS.filter((s) => s.primary && present(s.key));
  const details = SCALAR_SPECS.filter((s) => !s.primary && present(s.key));

  function simulateAgain() {
    goto("basics");
    router.push("/");
  }
  function newRocket() {
    reset();
    router.push("/");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Flight results
          </h1>
          <p className="text-sm text-slate-500">Run {runId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={simulateAgain}>
            Simulate again
          </Button>
          <Button variant="ghost" onClick={newRocket}>
            New rocket
          </Button>
        </div>
      </header>

      {result.warnings.length > 0 && (
        <Callout tone="warning" title="Heads up">
          <ul className="list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {primary.map((spec) => (
          <div key={spec.key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              {spec.label}
              {spec.term && <InfoTip term={spec.term} />}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {formatScalar(result.scalars[spec.key], spec.unit)}
            </div>
          </div>
        ))}
      </section>

      {/* Plot gallery */}
      {result.plot_urls.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Plots
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {result.plot_urls.map((url) => {
              const stem = url.split("/").pop()?.replace(/\.png$/, "") ?? "plot";
              return <PlotCard key={url} url={url} title={plotTitle(stem)} />;
            })}
          </div>
        </section>
      )}

      {/* Details table */}
      {details.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            More numbers
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {details.map((spec) => (
                  <tr key={spec.key} className="border-t border-slate-100 first:border-0">
                    <td className="px-4 py-2.5 text-slate-600">{spec.label}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                      {formatScalar(result.scalars[spec.key], spec.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PlotCard({ url, title }: { url: string; title: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fetchImageObjectUrl(url)
      .then((u) => {
        if (active) {
          objectUrl = u;
          setSrc(u);
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <figcaption className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
        {title}
      </figcaption>
      <div className="flex min-h-48 items-center justify-center bg-slate-50 p-2">
        {failed ? (
          <span className="text-sm text-slate-400">Couldn&apos;t load this plot.</span>
        ) : src ? (
          // Object URL from an authenticated fetch — next/image can't handle blob: URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={title} className="w-full" />
        ) : (
          <Spinner className="text-slate-400" />
        )}
      </div>
    </figure>
  );
}
