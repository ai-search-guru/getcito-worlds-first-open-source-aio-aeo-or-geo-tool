/**
 * The demo brand's Action Center (demo-workflows): its signals, the actions
 * the nightly engine raised from them over the month with their tasks,
 * trail and measured outcomes, the KPI framework, a task waiting for review
 * and Getting started.
 *
 * Each signal is what the detectors would have recorded from the demo's own
 * answers: its numbers are counted from core's rows (stats.js), its shape is
 * the detectors' own (group, single), and the classifiers that decide a
 * slipping engine or a source gap are the real ones. Each
 * action is then built as generate.js builds one: the definition's payload
 * from its signals, planTasks for its tasks, scorePriority for its priority;
 * a closed one is measured as validate.js measures it, on the same windows,
 * with basketValues and deriveOutcome.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { BASKET_KPIS, basketValues } from '../action-center/basketMetrics.js';
import { loadDefinitions } from '../action-center/definitions/index.js';
import {
  actionTargets,
  combinedTasks,
  initialTaskStatus,
  OPPORTUNITY_ACTION_KIND,
  opportunityAssets,
  WHOLE,
} from '../action-center/fromOpportunity.js';
import { priorityColumns, scorePriority } from '../action-center/priority.js';
import { planTasks } from '../action-center/tasks/plan.js';
import { deriveOutcome, MEASUREMENT_WINDOW_DAYS } from '../action-center/validate.js';
import { KIND_META } from '../signals/record.js';
import { classifyRateFall, classifySource } from '../signals/library/classify.js';
import { group, promptTarget, single } from '../signals/library/detect.js';
import { BRAND, SOURCES } from './brewline.js';
import { contentRows, SENT_OPPORTUNITY } from './content.js';
import { demoId } from './random.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import * as S from './stats.js';

const { library: T } = resolve();
const AI = ['ai_results'];

/** What the demo brand has, as resolveBrandSources would find it (core's data). */
export const DEMO_SOURCES = new Set(['tracking', 'competitors', 'topics', 'volumes']);

/** The engine's own measured KPIs and their units (validate.js MEASURABLE_KPIS). */
const BRAND_KPI_UNITS = {
  ai_visibility: 'percent',
  citations: 'count',
  mentions: 'count',
  share_of_voice: 'percent',
};

/** The latest week of answers as of one run: that run and the two before it. */
const weekTo = (ctx, run) =>
  S.runResults(
    ctx.rows.results,
    [run - 2, run - 1, run].filter((r) => r >= 0),
  );

/** A prompt finding's rows, as the prompts family groups them: most demand first. */
function promptRows(ctx, keys) {
  return keys
    .map((key) => ctx.promptId(key))
    .map((id) => ({ prompt_id: id, volume: ctx.volume(id)?.est_ai_volume ?? 0 }))
    .sort((a, b) => b.volume - a.volume);
}

const texts = (ctx) => new Map(ctx.rows.prompts.map((p) => [p.id, p.text]));

/** Per-platform answers and mentions over a set of answers (dims.platforms). */
function platformRows(results) {
  return [...S.groupBy(results, 'platform')].map(([key, rows]) => ({
    key,
    answers: rows.length,
    mentions: rows.filter((r) => r.mention_count > 0).length,
  }));
}

/** Third-party domains cited in a set of answers, as ae_citation_sources counts them. */
function citedSources(results) {
  const own = new Set([BRAND.domain]);
  const byDomain = new Map();
  for (const r of results) {
    const domains = new Set((r.citations ?? []).map((c) => new URL(c.url).hostname));
    for (const domain of domains) {
      const d = byDomain.get(domain) ?? {
        domain,
        owned: own.has(domain),
        results: 0,
        with_brand: 0,
        competitor_only: 0,
        prompts: new Set(),
      };
      d.results += 1;
      if (r.mention_count > 0) d.with_brand += 1;
      else if ((r.competitor_mentions ?? []).some((c) => c.mention_count > 0)) {
        d.competitor_only += 1;
      }
      d.prompts.add(r.prompt_id);
      byDomain.set(domain, d);
    }
  }
  return [...byDomain.values()]
    .map((d) => ({ ...d, prompts: d.prompts.size }))
    .sort((a, b) => b.results - a.results || a.domain.localeCompare(b.domain));
}

const publisher = (domain) => SOURCES.publishers.some((p) => p.domain === domain);

/**
 * The demo's signals, keyed for the actions below: each `candidate` in the
 * detectors' shape, found at run `run` (the night after it) and last seen
 * at `seen`.
 */
export function signalCandidates(ctx) {
  const latest = ctx.starts.length - 1;
  const found = {};

  // The strongest rival out-mentions Brewline this week (competitors family).
  {
    const week = weekTo(ctx, latest);
    const brand = S.brandStats(week).mentionAnswers;
    const leader = [...S.competitorStats(week).values()].sort(
      (a, b) => b.mentionAnswers - a.mentionAnswers,
    )[0];
    found.leads = {
      run: latest - 2,
      seen: latest,
      candidate: single(
        'competitor_leads',
        leader.id,
        'competitors',
        { id: leader.id, label: leader.name },
        AI,
        { previous: brand, current: leader.mentionAnswers, change: leader.mentionAnswers - brand },
        { competitorName: leader.name, competitorId: leader.id },
      ),
    };
  }

  // An engine whose mention rate fell against the week before (dimensions family).
  {
    const prev = new Map(platformRows(weekTo(ctx, latest - 4)).map((p) => [p.key, p]));
    const slipping = platformRows(weekTo(ctx, latest - 1))
      .map((cur) => {
        const before = prev.get(cur.key);
        const row = {
          key: cur.key,
          prev_mentions: before.mentions,
          prev_answers: before.answers,
          cur_mentions: cur.mentions,
          cur_answers: cur.answers,
        };
        return {
          row,
          kind: classifyRateFall(row, T, { slip: 'platform_slipping', drop: 'platform_drop' }),
        };
      })
      .filter((p) => p.kind)
      .sort(
        (a, b) => a.row.cur_mentions / a.row.cur_answers - b.row.cur_mentions / b.row.cur_answers,
      )[0];
    if (slipping) {
      const { row, kind } = slipping;
      const prev1 = Math.round((row.prev_mentions / row.prev_answers) * 1000) / 10;
      const cur1 = Math.round((row.cur_mentions / row.cur_answers) * 1000) / 10;
      found.platformSlip = {
        run: latest - 1,
        seen: latest - 1,
        candidate: single(
          kind,
          row.key,
          'platforms',
          { id: row.key, label: row.key },
          AI,
          { previous: prev1, current: cur1, change: Math.round((cur1 - prev1) * 10) / 10 },
          { platform: row.key },
        ),
      };
    }
  }

  // A publisher cited often, mostly beside rivals (sources family): this
  // week's, and the one the brand set aside early in the month.
  const sourceSignal = (run, skip) => {
    const d = citedSources(weekTo(ctx, run)).find(
      (x) => publisher(x.domain) && x.domain !== skip && classifySource(x, T),
    );
    if (!d) return null;
    return {
      run,
      seen: run,
      candidate: single(
        classifySource(d, T),
        d.domain,
        'sources',
        { id: d.domain, label: d.domain },
        AI,
        { current: d.results, previous: d.with_brand, change: d.competitor_only },
        { domain: d.domain, prompts: d.prompts, results: d.results },
      ),
    };
  };
  found.source = sourceSignal(latest, null);
  found.oldSource = sourceSignal(2, found.source?.candidate.payload.domain);

  // Early in the month: prompts that stopped naming Brewline from one run to
  // the next (prompts family), and its visibility slipping (Daily Pulse).
  {
    const before = S.groupBy(S.runResults(ctx.rows.results, [0]), 'prompt_id');
    const after = S.groupBy(S.runResults(ctx.rows.results, [1]), 'prompt_id');
    const lost = [...after]
      .filter(
        ([id, rows]) =>
          S.brandStats(rows).mentionAnswers === 0 &&
          S.brandStats(before.get(id)).mentionAnswers > 0,
      )
      .map(([id]) => ctx.promptKey(id));
    found.lostMentions = {
      run: 1,
      seen: 1,
      candidate: group(
        'lost_mentions',
        'prompts',
        promptRows(ctx, lost),
        promptTarget(texts(ctx)),
        AI,
      ),
    };

    const rate = (run) => {
      const b = S.brandStats(S.runResults(ctx.rows.results, [run]));
      return Math.round((b.visibleAnswers / b.answers) * 1000) / 10;
    };
    const from = rate(0);
    const to = rate(1);
    found.visibilitySlip = {
      run: 1,
      seen: 1,
      candidate: {
        kind: 'visibility_slipping',
        dedupKey: 'visibility_slipping',
        source: AI,
        payload: {},
        previousValue: from,
        currentValue: to,
        changeValue: -Math.round((from - to) * 10) / 10,
      },
    };
  }

  // Two of the weakest prompts a week later (prompts family).
  found.weakPrompts = {
    run: 3,
    seen: 3,
    candidate: group(
      'prompt_visibility_gap',
      'prompts',
      promptRows(ctx, ['best-subscriptions', 'low-acid']),
      promptTarget(texts(ctx)),
      AI,
    ),
  };

  // A prompt that came alive from one run to the next (Daily Pulse prompt_gain).
  {
    const id = ctx.promptId('fair-trade');
    const rateAt = (run) => {
      const rows = S.runResults(ctx.rows.results, [run]).filter((r) => r.prompt_id === id);
      return Math.round((S.brandStats(rows).mentionAnswers / rows.length) * 100);
    };
    const run = latest - 2;
    found.gain = {
      run,
      seen: run,
      candidate: {
        kind: 'prompt_gain',
        dedupKey: `prompt_gain:${id}`,
        source: AI,
        payload: { promptText: ctx.promptText(id), promptId: id },
        previousValue: null,
        currentValue: null,
        changeValue: rateAt(run) - rateAt(run - 1),
      },
    };
  }

  return Object.fromEntries(Object.entries(found).filter(([, s]) => s));
}

/**
 * The actions, as the nights raised them. `created`, `started` and `closed`
 * are [run, hours after that run started]; `done` is how many of its tasks
 * are completed while it is in progress; `review` adds a task waiting for
 * review (AC-010).
 */
export const ACTION_PLAN = [
  {
    key: 'lost-mentions',
    signals: ['lostMentions'],
    created: [1, 1],
    started: [1, 4],
    closed: [2, 6],
    status: 'completed',
  },
  {
    key: 'visibility-slip',
    signals: ['visibilitySlip'],
    created: [1, 1],
    started: [2, 3],
    closed: [3, 6],
    status: 'completed',
  },
  {
    key: 'weak-prompts',
    signals: ['weakPrompts'],
    created: [3, 1],
    started: [3, 5],
    closed: [4, 6],
    status: 'completed',
  },
  {
    key: 'old-source',
    signals: ['oldSource'],
    created: [2, 1],
    closed: [3, 3],
    status: 'dismissed',
  },
  {
    key: 'competitor-gap',
    signals: ['leads'],
    created: [7, 1],
    started: [8, 4],
    status: 'in_progress',
    done: 2,
    review: true,
  },
  {
    key: 'emerging',
    signals: ['gain'],
    created: [7, 1],
    started: [7, 6],
    closed: [8, 6],
    status: 'completed',
  },
  { key: 'platform-slip', signals: ['platformSlip'], created: [8, 1], status: 'new' },
  { key: 'source', signals: ['source'], created: [9, 1], status: 'new' },
];

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

function groupByKind(signals) {
  const byKind = new Map();
  for (const signal of signals)
    byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);
  return byKind;
}

/** The measured values of a set of answers for a basket (opportunity_basket_metrics). */
function basketOf(results) {
  const brand = S.brandStats(results);
  const rivals = [...S.competitorStats(results).values()];
  return basketValues(
    {
      cells: brand.answers,
      visible: brand.mentionAnswers,
      competitor_visible_total: rivals.reduce((s, c) => s + c.mentionAnswers, 0),
      top_competitor_visible: Math.max(0, ...rivals.map((c) => c.mentionAnswers)),
      mention_answers: brand.mentionAnswers,
    },
    { pageCount: 0 },
  );
}

/** The brand-wide KPIs over a set of answers (measureKpis). */
function brandKpis(results) {
  const b = S.brandStats(results);
  return {
    ai_visibility: b.score,
    citations: b.citations,
    mentions: b.mentions,
    share_of_voice: S.shareOfVoice(results),
  };
}

/**
 * What validate.js stores for a closed action once its after window is
 * over: on its prompts when it names some, the brand-wide KPIs beside.
 */
function measure(ctx, action, signalRows, closedAt) {
  const beforeWindow = S.windowBefore(new Date(action.created_at), MEASUREMENT_WINDOW_DAYS);
  const afterWindow = S.windowAfter(closedAt, MEASUREMENT_WINDOW_DAYS);
  const measuredAt = new Date(`${afterWindow.to}T00:00:00.000Z`);
  measuredAt.setUTCDate(measuredAt.getUTCDate() + 1);
  measuredAt.setUTCHours(7, 30, 0, 0);
  if (measuredAt > ctx.now) return null;

  const window = ({ from, to }) => S.between(ctx.rows.results, from, to);
  const counts = { total: signalRows.length, ended: 0, replaced: 0, dismissed: 0, open: 0 };
  for (const s of signalRows) {
    if (s.status === 'resolved') counts.ended += 1;
    else if (s.status === 'dismissed') counts.dismissed += 1;
    else counts.open += 1;
  }
  const kpiKeys = action.kpi_keys.filter((k) => k in BRAND_KPI_UNITS);
  const brandBefore = brandKpis(window(beforeWindow));
  const brandAfter = brandKpis(window(afterWindow));
  const brandWide = kpiKeys.map((metric) => ({
    metric,
    unit: BRAND_KPI_UNITS[metric],
    before: brandBefore[metric] ?? null,
    after: brandAfter[metric] ?? null,
  }));

  const promptIds =
    action.payload.targetEntity === 'prompts'
      ? (action.payload.targets ?? []).map((t) => t.id).filter(Boolean)
      : [];
  let validation;
  let metrics;
  if (promptIds.length) {
    const ids = new Set(promptIds);
    const asked = action.kpi_keys.filter((k) => k in BASKET_KPIS);
    const keys = asked.length ? asked : Object.keys(BASKET_KPIS);
    const before = basketOf(window(beforeWindow).filter((r) => ids.has(r.prompt_id)));
    const after = basketOf(window(afterWindow).filter((r) => ids.has(r.prompt_id)));
    metrics = keys.map((metric) => ({
      metric,
      unit: BASKET_KPIS[metric],
      before: before[metric] ?? null,
      after: after[metric] ?? null,
    }));
    validation = {
      measuredAt: measuredAt.toISOString(),
      beforeWindow,
      afterWindow,
      metrics,
      scope: { kind: 'targets', entity: 'prompts', prompts: promptIds.length, pages: 0 },
      ...(brandWide.length ? { brandWide } : {}),
    };
  } else {
    metrics = brandWide;
    validation = { measuredAt: measuredAt.toISOString(), beforeWindow, afterWindow, metrics };
  }
  return {
    validation: { ...validation, signals: counts },
    outcome: deriveOutcome(metrics),
    measuredAt,
  };
}

/**
 * Every Action Center row of the demo brand, built in memory. Deterministic
 * but for the dates, which follow core's runs.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export async function actionCenterRows({ brandId, now }) {
  const ctx = S.demoContext(brandId, now);
  const id = (key) => demoId(brandId, key);
  const at = ([run, hours]) => S.afterRun(ctx.starts, run, hours);
  const latestScore = at([ctx.starts.length - 1, 1]);
  const definitions = await loadDefinitions();
  const demand = new Map(
    ctx.rows.volumes.map((v) => [v.prompt_id, { volume: v.est_ai_volume, intent: v.intent }]),
  );
  const found = signalCandidates(ctx);

  const signals = [];
  const actions = [];
  const tasks = [];
  const events = [];
  const links = [];
  const reviews = [];

  for (const plan of ACTION_PLAN) {
    const picked = plan.signals.map((key) => ({ key, ...found[key] })).filter((s) => s.candidate);
    if (picked.length === 0) continue;
    const definition = definitions.find((d) => d.signalKinds.includes(picked[0].candidate.kind));
    const actionId = id(`action:${plan.key}`);
    const createdAt = at(plan.created);
    const closedAt = plan.closed ? at(plan.closed) : null;
    const open = plan.status === 'new' || plan.status === 'in_progress';

    // The signals behind it, as the recorder wrote them and as they stand now.
    const signalRows = picked.map(({ key, run, seen, candidate }) => {
      const meta = KIND_META[candidate.kind];
      const detectedAt = S.afterRun(ctx.starts, run, 0.5);
      const lastAt = S.afterRun(ctx.starts, seen, 0.5);
      // A closed cycle's findings ended once the work landed; a dismissed one's were set aside.
      const status = open
        ? plan.status === 'new'
          ? 'new'
          : 'acknowledged'
        : plan.status === 'dismissed'
          ? 'dismissed'
          : 'resolved';
      const resolvedAt =
        status === 'resolved' ? S.afterRun(ctx.starts, plan.closed[0] + 1, 0.5) : null;
      return {
        id: id(`signal:${key}`),
        brand_id: brandId,
        category: meta.category,
        kind: candidate.kind,
        impact: meta.impact,
        status,
        source: candidate.source,
        dedup_key: candidate.dedupKey,
        detected_at: detectedAt.toISOString(),
        last_detected_at: lastAt.toISOString(),
        resolved_at: resolvedAt?.toISOString() ?? null,
        previous_value: candidate.previousValue,
        current_value: candidate.currentValue,
        change_value: candidate.changeValue,
        payload: candidate.payload,
        kpi_keys: meta.kpiKeys,
        action_id: actionId,
        created_at: detectedAt.toISOString(),
        updated_at: (resolvedAt ?? (plan.status === 'dismissed' ? closedAt : lastAt)).toISOString(),
      };
    });
    signals.push(...signalRows);

    const impact = signalRows
      .map((s) => s.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const payload = {
      signalCount: signalRows.length,
      ...definition.payload(groupByKind(signalRows)),
    };
    const action = {
      id: actionId,
      brand_id: brandId,
      category: definition.category,
      kind: definition.id,
      definition_version: definition.version,
      impact,
      status: plan.status,
      payload,
      kpi_keys: [...new Set(signalRows.flatMap((s) => s.kpi_keys))],
      baseline: {
        capturedAt: createdAt.toISOString(),
        signals: signalRows.map((s) => ({
          id: s.id,
          kind: s.kind,
          previousValue: s.previous_value,
          currentValue: s.current_value,
          changeValue: s.change_value,
        })),
      },
      dedup_key: definition.id,
      created_at: createdAt.toISOString(),
      updated_at: (closedAt ?? (plan.started ? at(plan.started) : createdAt)).toISOString(),
      completed_at: plan.status === 'completed' ? closedAt.toISOString() : null,
      outcome: 'pending_measurement',
    };
    // Scored as the engine last scored it: tonight for an open one, on the
    // night it closed for a closed one, from the evidence open then.
    const scoredAt = open ? latestScore : closedAt;
    Object.assign(
      action,
      priorityColumns(
        scorePriority(
          {
            action,
            signals: signalRows.map((s) => ({ ...s, detected_at: s.detected_at })),
            prompts: demand,
          },
          scoredAt,
        ),
        scoredAt,
      ),
    );

    // Its tasks, as planTasks lays them out for what the brand has.
    const plannedTasks = planTasks(definition, { sources: DEMO_SOURCES, payload });
    const done =
      plan.status === 'completed'
        ? plannedTasks.length
        : plan.status === 'in_progress'
          ? (plan.done ?? 0)
          : 0;
    const taskTimes = (i) => {
      const from = (plan.started ? at(plan.started) : createdAt).getTime();
      const to = (closedAt ?? latestScore).getTime();
      return new Date(from + ((to - from) * (i + 1)) / (plannedTasks.length + 1));
    };
    plannedTasks.forEach((item, i) => {
      const status =
        i < done
          ? 'completed'
          : plan.status === 'in_progress' && i === done
            ? 'in_progress'
            : 'todo';
      const updatedAt = status === 'todo' ? createdAt : taskTimes(i);
      tasks.push({
        id: id(`task:${plan.key}:${item.taskKey}`),
        action_id: actionId,
        position: item.position,
        task_key: item.taskKey,
        task_version: item.version,
        mode: item.mode,
        permission: item.permission,
        depends_on: item.dependsOn,
        title_params: item.titleParams,
        details: item.details,
        status,
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      });
      if (status === 'completed') {
        events.push({
          id: id(`event:${plan.key}:task:${item.taskKey}`),
          action_id: actionId,
          event: 'task_status',
          data: { taskId: id(`task:${plan.key}:${item.taskKey}`), to: 'completed' },
          actor_id: null,
          created_at: updatedAt.toISOString(),
        });
      }
    });

    // The trail: raised, worked on, closed, measured.
    const event = (name, when, data) =>
      events.push({
        id: id(`event:${plan.key}:${name}`),
        action_id: actionId,
        event: name,
        data,
        actor_id: null,
        created_at: when.toISOString(),
      });
    event('created', createdAt, {
      impact,
      signalCount: signalRows.length,
      definitionVersion: definition.version,
      taskCount: plannedTasks.length,
    });
    if (plan.started) event('status_changed', at(plan.started), { to: 'in_progress' });
    if (plan.status === 'completed' || plan.status === 'dismissed') {
      events.push({
        id: id(`event:${plan.key}:closed`),
        action_id: actionId,
        event: 'status_changed',
        data: { to: plan.status },
        actor_id: null,
        created_at: closedAt.toISOString(),
      });
    }
    if (plan.status === 'completed') {
      const measured = measure(ctx, action, signalRows, closedAt);
      if (measured) {
        Object.assign(action, {
          validation: measured.validation,
          outcome: measured.outcome,
          validated_at: measured.measuredAt.toISOString(),
        });
        event('outcome_measured', measured.measuredAt, { outcome: measured.outcome });
      }
    }

    for (const s of signalRows) {
      links.push({ action_id: actionId, signal_id: s.id, linked_at: createdAt.toISOString() });
    }

    // A task the agent wrote without the page or its Done when (AC-010).
    if (plan.review) {
      reviews.push({
        id: id(`review:${plan.key}`),
        action_id: actionId,
        title: 'Publish a Brewline vs Northbound Roasters comparison page',
        details: {
          why: 'Northbound Roasters is named in more answers to the subscription prompts, and answers comparing the two cite its pages, not Brewline’s.',
          how: [
            'Compare roast dates, delivery schedules and pause or skip options side by side.',
            'Answer the questions people ask before switching subscriptions.',
          ],
        },
        missing: ['url', 'doneWhen'],
        source: 'ai',
        created_at: at(plan.started).toISOString(),
        updated_at: at(plan.started).toISOString(),
      });
    }

    actions.push(action);
  }

  // An opportunity someone sent over from Content, now being written in the Editor.
  const sent = sentOpportunityAction(ctx, { demand, scoredAt: latestScore });
  actions.push(sent.action);
  tasks.push(...sent.tasks);
  events.push(...sent.events);

  return {
    signals,
    actions,
    tasks,
    events: events.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    links,
    reviews,
    kpis: kpiRows(ctx, brandId),
    ...gettingStartedRows(ctx, brandId),
  };
}

/** The KPIs an action sent from Content is judged by (fromOpportunity.js). */
const OPPORTUNITY_KPI_KEYS = ['ai_visibility', 'citations', 'mentions'];

/**
 * The action sendToActionCenter makes of the whole opportunity: its assets'
 * work (combinedTasks), its prompts kept, scored as priorityOnCreate scores
 * a hand-sent action. Its brief is done and the Content Agent's draft is
 * being worked on in the Editor (content.js links the draft to it).
 */
function sentOpportunityAction(ctx, { demand, scoredAt }) {
  const { brandId } = ctx;
  const id = (key) => demoId(brandId, key);
  const rows = contentRows({ brandId, now: ctx.now });
  const opportunity = rows.opportunities.find(
    (o) => o.id === id(`opportunity:${SENT_OPPORTUNITY}`),
  );
  const chosen = opportunityAssets(opportunity);
  const promptIds = rows.members
    .filter((m) => m.cluster_id === opportunity.cluster_id)
    .map((m) => m.prompt_id);
  const payload = {
    source: OPPORTUNITY_ACTION_KIND,
    opportunityId: opportunity.id,
    assetKey: null,
    title: opportunity.title,
    decision: chosen[0].decision,
    assets: chosen.map(({ key, type, channel, decision, title }) => ({
      key,
      type,
      channel,
      decision,
      title,
    })),
    pages: [...new Set(chosen.flatMap((a) => (a.pages || []).map((p) => p.url)))],
    promptIds,
    targetEntity: 'prompts',
    ...actionTargets(promptIds, opportunity.source_data.prompts),
    contentExists: chosen.some((a) => a.decision !== 'create'),
  };
  const createdAt = S.afterRun(ctx.starts, 8, 3);
  const startedAt = S.afterRun(ctx.starts, 8, 4);
  const actionId = id(`action:opportunity:${SENT_OPPORTUNITY}`);
  const base = {
    kind: OPPORTUNITY_ACTION_KIND,
    category: 'growth',
    impact: opportunity.impact,
    payload,
    created_at: createdAt.toISOString(),
  };
  const action = {
    id: actionId,
    brand_id: brandId,
    ...base,
    definition_version: 1,
    status: 'in_progress',
    kpi_keys: OPPORTUNITY_KPI_KEYS,
    baseline: {},
    dedup_key: `opportunity:${opportunity.id}:${WHOLE}`,
    updated_at: startedAt.toISOString(),
    completed_at: null,
    outcome: 'pending_measurement',
    ...priorityColumns(
      scorePriority({ action: base, signals: [], prompts: demand }, scoredAt),
      scoredAt,
    ),
  };

  const planned = planTasks(
    { id: OPPORTUNITY_ACTION_KIND, tasks: combinedTasks(chosen) },
    { sources: DEMO_SOURCES, payload },
  );
  // The brief came with the agent's draft; the draft is the work under way.
  const progress = { create_content_brief: 'completed', create_content_draft: 'in_progress' };
  const tasks = planned.map((item) => ({
    id: id(`task:opportunity:${item.taskKey}`),
    action_id: actionId,
    position: item.position,
    task_key: item.taskKey,
    task_version: item.version,
    mode: item.mode,
    permission: item.permission,
    depends_on: item.dependsOn,
    title_params: item.titleParams,
    details: item.details,
    status: progress[item.taskKey] ?? initialTaskStatus(item.taskKey, opportunity),
    created_at: createdAt.toISOString(),
    updated_at: (progress[item.taskKey] ? startedAt : createdAt).toISOString(),
  }));
  const event = (name, when, data) => ({
    id: id(`event:opportunity:${name}`),
    action_id: actionId,
    event: name,
    data,
    actor_id: null,
    created_at: when.toISOString(),
  });
  const events = [
    event('created', createdAt, {
      source: OPPORTUNITY_ACTION_KIND,
      opportunityId: opportunity.id,
      assetKey: null,
      impact: opportunity.impact,
      taskCount: planned.length,
    }),
    event('status_changed', startedAt, { to: 'in_progress' }),
    ...tasks
      .filter((t) => t.status === 'completed')
      .map((t) => ({
        ...event(`task:${t.task_key}`, startedAt, { taskId: t.id, to: 'completed' }),
        event: 'task_status',
      })),
  ];
  return { action, tasks, events };
}

/**
 * The ready-made KPIs the KPI tab sets up for a brand that has none
 * (frontend/src/lib/kpis/presets.ts PRESET_KPIS; AI Referral Traffic only with
 * Analytics, which the demo's core has not).
 */
export const PRESET_KPIS = [
  'ai_visibility',
  'mentions',
  'citations',
  'share_of_voice',
  'positive_sentiment',
];
const PERCENT_KPIS = new Set(['ai_visibility', 'share_of_voice', 'positive_sentiment']);

/** A preset's target: its month 20% up (presets.ts presetTarget). */
export function presetTarget(key, value) {
  const raised = value * 1.2;
  if (PERCENT_KPIS.has(key)) return Math.min(100, Math.max(0.1, Math.round(raised * 10) / 10));
  return Math.ceil(raised);
}

/**
 * The brand's KPI framework (00078), as seed_kpi_presets (00163) leaves it:
 * the ready-made set, each target its month 20% up. Built in advance, so the
 * KPI tab finds the brand set up and never seeds it (a demo brand can't be
 * written to from the page).
 */
function kpiRows(ctx, brandId) {
  const month = ctx.rows.results;
  const b = S.brandStats(month);
  const setAt = gettingStartedDay(ctx, 0, 1).toISOString();
  const values = {
    ai_visibility: b.score,
    mentions: b.mentions,
    citations: b.citations,
    share_of_voice: S.shareOfVoice(month),
    positive_sentiment: Math.round((b.positive / b.mentionAnswers) * 1000) / 10,
  };
  return PRESET_KPIS.map((key) => ({
    id: demoId(brandId, `kpi:${key}`),
    brand_id: brandId,
    kpi_key: key,
    target: presetTarget(key, values[key]),
    timeframe: 'monthly',
    is_active: true,
    created_at: setAt,
    updated_at: setAt,
  }));
}

/** A moment `n` days after the brand was set up. */
function gettingStartedDay(ctx, n, hours = 10) {
  return new Date(Date.parse(ctx.rows.brand.created_at) + n * S.DAY_MS + hours * S.HOUR_MS);
}

/**
 * The explore steps that are done once their page is opened
 * (frontend/src/lib/getting-started/steps.ts PAGE_STEPS), all opened already:
 * getting_started_page_opened then has nothing to record on a visit.
 */
export const PAGE_STEPS = ['visibility', 'answers', 'mentions', 'citations', 'traffic'];

/**
 * Getting started (00196) under way: the brand started it when it was set
 * up, set its KPIs and has opened every page an explore step asks for.
 */
function gettingStartedRows(ctx, brandId) {
  const since = new Date(ctx.rows.brand.created_at);
  const steps = [
    ['kpis', 'done', gettingStartedDay(ctx, 0, 1)],
    ...PAGE_STEPS.map((step, i) => [step, 'opened', gettingStartedDay(ctx, 5 + i, 10)]),
  ];
  return {
    kpiSetupAt: gettingStartedDay(ctx, 0, 1).toISOString(),
    gettingStarted: [
      {
        brand_id: brandId,
        started_at: since.toISOString(),
        confirmed_at: since.toISOString(),
        dismissed_at: null,
      },
    ],
    gettingStartedSteps: steps.map(([step, state, when]) => ({
      brand_id: brandId,
      step,
      state,
      updated_at: when.toISOString(),
    })),
  };
}

/** Its tables' key columns where a row has no `id` of its own. */
const KEYS = {
  getting_started: 'brand_id',
  getting_started_steps: 'brand_id,step',
  action_signals: 'action_id,signal_id',
};
/** Its tables without a brand_id, found through their action. */
const SCOPES = {
  action_signals: ['action_id', 'actions'],
  action_tasks: ['action_id', 'actions'],
  action_events: ['action_id', 'actions'],
  action_task_reviews: ['action_id', 'actions'],
};

/**
 * The Action Center module. Tasks, events, signal links and task reviews
 * hang off the actions (no brand_id of their own) and go with them; the
 * actions' entity lists (00244) are written by their insert trigger.
 */
export const actionCenter = {
  name: 'actionCenter',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  scopes: SCOPES,
  tables: ['kpi_definitions', 'getting_started', 'getting_started_steps', 'actions', 'signals'],

  /**
   * Each step's independent tables side by side, through the build's
   * writer (a writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild, keys: KEYS, scopes: SCOPES }).write,
  }) {
    const rows = await actionCenterRows({ brandId, now });
    // Set up when its KPIs were: the KPI tab reads the brand as set up and
    // Getting started its KPI step as done, without writing either.
    const { error } = await db
      .from('brands')
      .update({ kpi_setup_at: rows.kpiSetupAt })
      .eq('id', brandId);
    if (error) throw new Error(`demo brand kpi setup: ${error.message}`);
    await allSettledOrThrow([
      write('kpi_definitions', rows.kpis),
      // A new brand's trigger has started Getting started: written over by brand.
      write('getting_started', rows.gettingStarted),
      write('getting_started_steps', rows.gettingStartedSteps),
      write('actions', rows.actions),
    ]);
    // Signals, tasks, events and reviews point at their action; the links at
    // both an action and a signal.
    await allSettledOrThrow([
      write('signals', rows.signals),
      write('action_tasks', rows.tasks),
      write('action_events', rows.events),
      write('action_task_reviews', rows.reviews),
    ]);
    await write('action_signals', rows.links);
    return {
      signals: rows.signals.length,
      actions: rows.actions.length,
      tasks: rows.tasks.length,
    };
  },
};
