'use client';

import { useState } from 'react';
import { Sigma } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { POSITION_SUPPORT_ANSWERS, VISIBILITY_SCORE_WEIGHTS } from '@/lib/visibilityScore';

const PCT = {
  mention: Math.round(VISIBILITY_SCORE_WEIGHTS.mention * 100),
  citation: Math.round(VISIBILITY_SCORE_WEIGHTS.citation * 100),
  position: Math.round(VISIBILITY_SCORE_WEIGHTS.position * 100),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-sm text-muted-foreground space-y-1.5">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
      {children}
    </div>
  );
}

/**
 * "Formulas" header button + dialog explaining how every metric on the
 * Insights page is computed. The Visibility weights are read from the
 * shared score module so this stays correct if the blend is ever tuned.
 */
export function FormulaDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Sigma className="h-4 w-4" />
        Formulas
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How metrics are calculated</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <Section title="Visibility (0–100)">
              <p>
                A single score for how visible your brand is across all AI answers matching the
                current filters. Every answer counts — including ones where you don&apos;t appear —
                so growing the score means showing up more, being cited more, and being named
                earlier.
              </p>
              <Formula>
                Visibility = 100 × ({VISIBILITY_SCORE_WEIGHTS.mention} × mention rate +{' '}
                {VISIBILITY_SCORE_WEIGHTS.citation} × citation rate +{' '}
                {VISIBILITY_SCORE_WEIGHTS.position} × position factor × confidence)
                <br />
                confidence = answers mentioning you ÷ (answers mentioning you +{' '}
                {POSITION_SUPPORT_ANSWERS})
              </Formula>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <span className="font-medium text-foreground">Mention rate ({PCT.mention}%)</span>{' '}
                  — share of AI answers that mention your brand by name.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Citation rate ({PCT.citation}%)
                  </span>{' '}
                  — share of answers that cite your website as a source.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Position factor ({PCT.position}%)
                  </span>{' '}
                  — how early you&apos;re named in the answers that mention you: named first = 1,
                  second = 0.5, third = 0.33, and so on, averaged. The confidence factor weights it
                  by how many answers actually mention the brand, so a perfect position in a handful
                  of answers can&apos;t outrank brands that consistently show up.
                </li>
              </ul>
              <p>
                Competitors on the leaderboard are scored with the exact same formula over the same
                set of answers, so the numbers are directly comparable.
              </p>
            </Section>

            <Section title="Visibility trend chart">
              <p>
                Each point is the Visibility computed over the selected time window ending on that
                day (a rolling window). That&apos;s why the newest point always matches the
                Visibility card above. With &quot;All time&quot; selected, each point covers
                everything up to that day.
              </p>
            </Section>

            <Section title="Mentions">
              <p>Total number of times your brand was referenced by name in AI answers.</p>
            </Section>

            <Section title="Citations">
              <p>
                Total number of times your website was linked as a source in AI answers. Mentions
                count your name; citations count your domain.
              </p>
            </Section>

            <Section title="Net sentiment">
              <p>
                Of the answers that name you, the share that is positive minus the share that is
                negative, in points. Answers that only cite your site aren&apos;t counted: they are
                always neutral. Sentiment is shown alongside Visibility but is not part of the
                score.
              </p>
              <Formula>
                Net sentiment = positive answers % − negative answers % (of answers naming you, as
                on the Mentions page)
              </Formula>
            </Section>

            <Section title="Avg. position">
              <p>
                Where you&apos;re named in the answers that mention you, averaged. Lower is better:
                #1 means you&apos;re usually named first.
              </p>
              <Formula>Avg. position = sum of your positions ÷ answers that name you</Formula>
            </Section>

            <Section title="Citation rate">
              <p>The share of AI answers that link to your website as a source.</p>
              <Formula>Citation rate = answers citing your domain ÷ all answers × 100</Formula>
            </Section>

            <Section title="Share of Voice">
              <p>
                Your slice of the total brand conversation: of all brand mentions in AI answers —
                yours plus your tracked competitors&apos; — the share that are yours.
              </p>
              <Formula>SOV = your mentions ÷ (your mentions + competitor mentions) × 100</Formula>
            </Section>

            <Section title="Coverage">
              <p>
                The share of tracked prompts where you showed up (named or cited) at least once in
                the selected period, against all prompts that produced results.
              </p>
              <Formula>Coverage = prompts you appeared in ÷ prompts answered × 100</Formula>
            </Section>

            <Section title="Changes">
              <p>
                Each card&apos;s change compares the selected period with the period of the same
                length just before it, over the prompts answered in both periods only, so adding
                prompts doesn&apos;t inflate it; the numbers themselves still cover every prompt.
                With &quot;All time&quot; there is no earlier period, so no change is shown.
              </p>
            </Section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
