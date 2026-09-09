"use client";

/**
 * ScalarsGrid — the headline-numbers grid on the results page (issue #52).
 *
 * A client island: CountUp's from-0 animation needs `requestAnimationFrame`
 * and its `format` prop is a closure, which can't cross the Server → Client
 * boundary as a prop. So this takes the plain, serializable `scalars` record
 * from the server-rendered ResultsContentServer and does the SCALAR_SPECS
 * filtering + CountUp instantiation itself, entirely client-side.
 */

import { SCALAR_SPECS, formatScalar } from "@/lib/scalars";
import { CountUp, Reveal } from "@/components/motion";
import { InfoTip, Surface } from "@/components/ui";
import { useT, useLocale } from "@/components/i18n/LocaleProvider";

export function ScalarsGrid({ scalars }: { scalars: Record<string, number | null> }) {
  const t = useT();
  const { locale } = useLocale();
  const present = (key: string) => key in scalars;
  const primary = SCALAR_SPECS.filter((s) => s.primary && present(s.key));

  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {primary.map((spec, i) => {
        const value = scalars[spec.key];
        const finite = value !== null && Number.isFinite(value);
        return (
          <Reveal key={spec.key} delay={i * 0.08}>
            <Surface className="h-full" innerClassName="flex h-full flex-col gap-3 p-5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                {t(`scalars.${spec.key}`)}
                {spec.term && <InfoTip term={spec.term} />}
              </div>
              <div className="tabular-readout text-3xl font-semibold text-foreground">
                {finite ? (
                  <CountUp value={value} format={(n) => formatScalar(n, spec.unit, locale)} />
                ) : (
                  "—"
                )}
              </div>
            </Surface>
          </Reveal>
        );
      })}
    </section>
  );
}
