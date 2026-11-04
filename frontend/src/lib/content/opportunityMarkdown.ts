import type { ContentBrief, ContentOpportunity } from '@/types';
import {
  formatEstimateRange,
  snapshotVolumeEstimate,
  type VolumeEstimate,
} from '@/lib/volumeEstimate';

/** `blog_post` → `Blog post`. */
function humanize(slug: string): string {
  const words = slug.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** One line of an opportunity's write-up. */
export type OpportunityLine =
  | { kind: 'field'; label: string; value: string }
  | { kind: 'item'; text: string }
  | { kind: 'step'; n: number; text: string; points: string[] }
  | { kind: 'text'; text: string };

/** A part of the write-up; the opening facts have no heading. */
export interface OpportunitySection {
  title: string | null;
  lines: OpportunityLine[];
}

/**
 * Everything the opportunity detail shows, in page order: what Copy All Data
 * writes as Markdown and Export writes as CSV, Excel or Word. Empty sections
 * are left out.
 */
export interface OpportunityDocument {
  title: string;
  description: string | null;
  sections: OpportunitySection[];
}

type Maybe<T> = T | null | undefined | false | '' | 0;

const field = (label: string, value: Maybe<string | number>): OpportunityLine | null =>
  value || value === 0 ? { kind: 'field', label, value: String(value) } : null;
const item = (text: string): OpportunityLine => ({ kind: 'item', text });

function section(title: string | null, lines: Maybe<OpportunityLine>[]): OpportunitySection {
  return { title, lines: lines.filter((l): l is OpportunityLine => !!l) };
}

/**
 * The AI volume an opportunity kept when it was made, its question's, as a
 * low estimate (PROMPT-013): what shows when its question's current estimate
 * can't be read. Null when it kept none.
 */
export function keptVolume(opportunity: ContentOpportunity): VolumeEstimate | null {
  const sd = opportunity.sourceData;
  // Its question's volume; a single prompt's sum is that prompt's. A group's
  // older sum is no question's volume, so nothing is kept for it.
  const kept = sd.questionVolume ?? (opportunity.clusterId ? undefined : sd.estAiVolume);
  return kept && kept > 0 ? snapshotVolumeEstimate(kept) : null;
}

export function opportunityDocument(
  opportunity: ContentOpportunity,
  brief: ContentBrief | null,
  fanoutQueries: { query: string }[] = [],
  /** An asset's type as the page names it (useAssetTypeLabel); else its key, humanized. */
  assetTypeLabel: (type: string) => string | null = () => null,
  /**
   * Its prompts' current AI volume, summed (PROMPT-013); else the volume kept
   * when it was made or last updated, as an estimate too.
   */
  volume?: VolumeEstimate | null,
): OpportunityDocument {
  const sd = opportunity.sourceData;
  const estimate = volume ?? keptVolume(opportunity);
  const sections: OpportunitySection[] = [];

  sections.push(
    section(null, [
      field('Type', humanize(opportunity.type)),
      field('Impact', humanize(opportunity.impact)),
      field('Status', humanize(opportunity.status)),
      field('Score', String(Math.round(opportunity.opportunityScore))),
      field('Created', opportunity.createdAt.slice(0, 10)),
      opportunity.decision && field('Decision', humanize(opportunity.decision)),
    ]),
  );

  // Sent from an Action Center task (AC-004): what the task says to do.
  const task = sd.fromAction?.task;
  sections.push(
    section(
      sd.fromAction?.actionNo != null
        ? `From a task in AC-${sd.fromAction.actionNo}`
        : 'From an Action Center task',
      [
        task?.url && field('URL', task.url),
        task?.where && field('Where', task.where),
        task?.why && field('Why', task.why),
        task?.change &&
          field(
            'Change',
            task.change.before
              ? `Before: ${task.change.before} → After: ${task.change.after}`
              : `Add: ${task.change.after}`,
          ),
        ...(task?.how ?? []).map((step, i): OpportunityLine => ({
          kind: 'step',
          n: i + 1,
          text: step,
          points: [],
        })),
        task?.doneWhen && field('Done when', task.doneWhen),
        (task?.effort || task?.role) &&
          field('Effort', [task?.effort, task?.role].filter(Boolean).join(' · ')),
      ],
    ),
  );

  sections.push(
    section(
      'Target pages',
      (sd.targetPages ?? []).map((p) => item(`${p.title ? `${p.title}: ` : ''}${p.url}`)),
    ),
  );

  sections.push(
    section(
      'Recommended assets',
      (sd.assets ?? []).map((a) =>
        item(
          `${a.title} (${assetTypeLabel(a.type) ?? humanize(a.type)}, ${humanize(a.channel)}, ${humanize(a.decision)})`,
        ),
      ),
    ),
  );

  const sc = sd.scoreComponents;
  sections.push(
    section('Score breakdown', [
      sc && field('Demand', String(Math.round(sc.demand))),
      sc && field('Visibility gap', String(Math.round(sc.visibilityGap))),
      sc && field('Competitor gap', String(Math.round(sc.competitorGap))),
      sc && field('Intent', String(Math.round(sc.intent))),
    ]),
  );

  const queries = sd.queries?.top.map((q) => q.query) ?? fanoutQueries.map((q) => q.query);
  sections.push(
    section('Source data', [
      field('Related prompt', sd.promptText),
      field('Cluster', sd.clusterLabel),
      field('Topic', sd.topicName),
      estimate && field('Est. AI volume', `${formatEstimateRange(estimate)}/mo`),
      estimate &&
        field(
          'Volume type',
          estimate.basis === 'snapshot'
            ? 'Estimate, kept when it was made or last updated'
            : 'Estimate',
        ),
      estimate && field('Volume confidence', humanize(estimate.confidence)),
      // An opportunity's volume is its question's (questionVolume.ts).
      estimate &&
        field(
          'Volume of',
          (sd.prompts?.length ?? 0) > 1
            ? `Its related prompt, one of ${sd.prompts!.length} prompts`
            : 'Its related prompt',
        ),
      sd.visibilityScore != null && field('Visibility', `${Math.round(sd.visibilityScore)}%`),
      sd.competitorGap != null && field('Competitor gap', `${Math.round(sd.competitorGap)}%`),
      field('Intent', sd.intent),
      !!sd.keywords?.length && field('Keywords', sd.keywords.join(', ')),
      !!sd.competitorsCited?.length && field('Competitors cited', sd.competitorsCited.join(', ')),
    ]),
  );

  sections.push(section('Prompts', (sd.prompts ?? []).map(item)));
  sections.push(section('Fan-out queries', queries.map(item)));

  if (brief) {
    sections.push(
      section('Content brief', [
        field('Suggested title', brief.suggestedTitle),
        field('Content type', brief.contentType),
        field('Target word count', fmt(brief.targetWordCount)),
        brief.targetKeywords.length > 0 && field('Keywords', brief.targetKeywords.join(', ')),
        field('CTA', brief.callToAction),
      ]),
    );
    sections.push(
      section(
        'Brief outline',
        brief.outline.map((s, i): OpportunityLine => ({
          kind: 'step',
          n: i + 1,
          text: s.heading,
          points: s.keyPoints,
        })),
      ),
    );
    sections.push(
      section('Competitor insights', [
        brief.competitorInsights && { kind: 'text', text: brief.competitorInsights },
      ]),
    );
  }

  return {
    title: opportunity.title,
    description: opportunity.description || null,
    sections: sections.filter((s) => s.lines.length > 0),
  };
}

function markdownLine(line: OpportunityLine): string {
  switch (line.kind) {
    case 'field':
      return `- ${line.label}: ${line.value}`;
    case 'item':
      return `- ${line.text}`;
    case 'step':
      return `${line.n}. ${line.text}${line.points.map((p) => `\n   - ${p}`).join('')}`;
    case 'text':
      return line.text;
  }
}

/**
 * Everything the opportunity detail shows, as Markdown in page order, for the
 * Copy All Data button. Empty sections are left out.
 */
export function opportunityToMarkdown(
  opportunity: ContentOpportunity,
  brief: ContentBrief | null,
  fanoutQueries: { query: string }[] = [],
  /** An asset's type as the page names it (useAssetTypeLabel); else its key, humanized. */
  assetTypeLabel: (type: string) => string | null = () => null,
  volume?: VolumeEstimate | null,
): string {
  const doc = opportunityDocument(opportunity, brief, fanoutQueries, assetTypeLabel, volume);
  const parts = [
    [`# ${doc.title}`, doc.description].filter(Boolean).join('\n\n'),
    ...doc.sections.map((s) => {
      const body = s.lines.map(markdownLine).join('\n');
      return s.title ? `## ${s.title}\n\n${body}` : body;
    }),
  ];
  return parts.join('\n\n') + '\n';
}
