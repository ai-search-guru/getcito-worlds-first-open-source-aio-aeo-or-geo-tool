/**
 * The demo brand's Chat (demo Chat): a few chats each person of the
 * organization finds in Chat's menu, as if they had asked them on the demo
 * brand. Each answer comes with the reads Chat made (its steps), the "Data
 * used" chips and, under the latest answer, the next moves, and its figures
 * are counted from the demo's own answers (stats.js), so they match the
 * pages they link to. Sending in them, a next move included, opens the plans
 * (the demo brand runs nothing; precedence's demo_brand).
 *
 * A chat is its author's (CHAT-20 §16c): each person of the organization
 * gets their own when the demo is built; someone who joins later gets theirs
 * at the next rebuild (DEMO_MAX_AGE_MS). Once the demo brand is hidden its
 * chats go (hideDemoChats), and a rebuild brings them back when it is shown.
 */

import supabaseAdmin from '../../config/supabase.js';
import { IMPROVE_PLATFORM_LABELS } from '../promptImprove.js';
import { actionCenterRows } from './actionCenter.js';
import { BRAND, BRAND_TRAITS, COMPETITORS, PLATFORMS, PROMPTS, TOPICS } from './brewline.js';
import { DRAFTS } from './contentPages.js';
import { RUNS } from './core.js';
import { demoId } from './random.js';
import { demoWriter } from './write.js';
import * as S from './stats.js';

/** The most people of one organization given the demo's chats. */
export const MAX_PEOPLE = 50;

const MINUTE_MS = 60 * 1000;
const LATEST = RUNS - 1;
const ROWS = (n) => `${n} ${n === 1 ? 'row' : 'rows'}`;
const pct = (n) => `${n}%`;
/** "up from", "down from" or "the same as" the figure before. */
const trend = (now, before) =>
  now > before ? 'up from' : now < before ? 'down from' : 'the same as';
const platformName = (id) => IMPROVE_PLATFORM_LABELS[id] ?? id;
const ALL_PLATFORMS = PLATFORMS.map((p) => platformName(p.id));

/** The actions' titles as the Action Center words them (actionTexts.{kind}.title). */
const ACTION_TITLES = {
  close_competitor_gap: (t) => `Close the visibility gap with ${t}`,
  protect_platform_visibility: (t) => `Protect visibility on ${t}`,
  earn_third_party_citations: (t) => `Target ${t} for citations of your pages`,
};

function actionTitle(action) {
  if (action.payload?.title) return action.payload.title;
  const targets = (action.payload?.targets ?? [])
    .map((t) => (action.payload?.targetEntity === 'platforms' ? platformName(t.label) : t.label))
    .join(', ');
  return ACTION_TITLES[action.kind]?.(targets) ?? null;
}

const actionHref = (action) => `/dashboard/action-center/actions/${action.id}`;

/** A read step, as the engine words one: "Read Visibility", "Last 7 days · ChatGPT, … · 216 rows". */
function read(label, { dateRange, platforms = ALL_PLATFORMS, rows, subject, tool }) {
  return {
    kind: 'read',
    label,
    detail: [dateRange, platforms.join(', '), rows !== undefined ? ROWS(rows) : null]
      .filter(Boolean)
      .join(' · '),
    scope: {
      ...(subject ? { subject } : {}),
      dateRange,
      platforms,
      brand: BRAND.name,
    },
    rows,
    tool,
  };
}

/** A table in the answer's markdown. */
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

/**
 * The chats, worded from the demo's numbers: each `{ key, title, origin,
 * originPage?, turns: [{ question, at, steps, answer, workingMs, dataAsOf }],
 * moves }`. The same for every person.
 */
async function chatScripts({ brandId, now }) {
  const ctx = S.demoContext(brandId, now);
  const { results, citations, prompts } = ctx.rows;
  // Before now, whatever the runs' hours: never an answer from the future.
  const at = (run, hours, minutesAgo) =>
    new Date(
      Math.min(
        S.afterRun(ctx.starts, run, hours).getTime(),
        now.getTime() - minutesAgo * MINUTE_MS,
      ),
    );
  const asOf = (rows) =>
    rows.reduce((latest, r) => (r.created_at > latest ? r.created_at : latest), '');

  const last = S.runResults(results, [LATEST]);
  const before = S.runResults(results, [LATEST - 1]);
  const week = S.runResults(results, [LATEST - 2, LATEST - 1, LATEST]);
  const own = S.brandStats(last);
  const was = S.brandStats(before);
  const rivals = [...S.competitorStats(last).values()].sort(
    (a, b) => b.mentionRate - a.mentionRate,
  );
  const leader = rivals[0];
  const byPlatform = PLATFORMS.map((p) => {
    const now_ = S.brandStats(last.filter((r) => r.model_used === p.id)).mentionRate;
    const then = S.brandStats(before.filter((r) => r.model_used === p.id)).mentionRate;
    return { id: p.id, name: platformName(p.id), now: now_, then };
  });
  const rising = [...byPlatform].sort((a, b) => b.now - b.then - (a.now - a.then))[0];
  const weakest = [...byPlatform].sort((a, b) => a.now - b.now)[0];

  const actions = (await actionCenterRows({ brandId, now })).actions;
  const open = actions
    .filter((a) => a.status === 'new' || a.status === 'in_progress')
    .filter((a) => actionTitle(a))
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  // An open one first: the one Chat would point at.
  const ofKind = (kind) =>
    open.find((a) => a.kind === kind) ??
    actions.find((a) => a.kind === kind && actionTitle(a)) ??
    null;

  // ── 1. How visible are we this week? (with a follow-up on Perplexity) ──────
  const perplexity = 'perplexity-web';
  const perplexityByPrompt = [
    ...S.groupBy(
      last.filter((r) => r.model_used === perplexity),
      'prompt_id',
    ),
  ]
    .map(([promptId, rows]) => ({
      text: ctx.promptText(promptId),
      named: rows.some((r) => r.mention_count > 0),
      answers: rows.map((r) => r.id),
    }))
    .sort((a, b) => Number(a.named) - Number(b.named));
  const missed = perplexityByPrompt.filter((p) => !p.named);
  // The sites Perplexity's answers to them cite most.
  const missedAnswers = new Set(missed.flatMap((p) => p.answers));
  const missedCited = new Map();
  for (const c of citations) {
    if (missedAnswers.has(c.prompt_result_id)) {
      missedCited.set(c.domain, (missedCited.get(c.domain) ?? 0) + 1);
    }
  }
  const missedSites = [...missedCited]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([domain]) => domain);
  const askedAt = at(LATEST, 2, 40);
  const followAt = new Date(askedAt.getTime() + 4 * MINUTE_MS);
  const visibility = {
    key: 'visibility',
    title: 'How visible is Brewline in AI answers this week?',
    origin: 'page',
    turns: [
      {
        question: 'How visible is Brewline in AI answers this week?',
        at: askedAt,
        workingMs: 18_400,
        dataAsOf: asOf(last),
        steps: [
          read('Read Visibility', {
            dateRange: 'Last 7 days',
            rows: week.length,
            tool: 'get_visibility',
          }),
          read('Read Competitors', {
            dateRange: 'Last 7 days',
            rows: COMPETITORS.length,
            tool: 'get_competitors',
          }),
        ],
        answer: [
          `**Brewline is named in ${pct(own.mentionRate)} of AI answers** in the latest check, ${trend(own.mentionRate, was.mentionRate)} ${pct(was.mentionRate)} three days before. Its AI Visibility Score is ${own.score} (${was.score} before).`,
          '',
          table(
            ['Platform', 'Named in', 'Check before'],
            byPlatform.map((p) => [p.name, pct(p.now), pct(p.then)]),
          ),
          '',
          `${rising.name} moved most. ${weakest.name} is still the weakest platform for Brewline, at ${pct(weakest.now)}.`,
          '',
          `Among your competitors, **${leader.name}** is named in ${pct(leader.mentionRate)} of the same answers, ${rivals
            .slice(1)
            .map((c) => `${c.name} in ${pct(c.mentionRate)}`)
            .join(', ')}. Brewline's share of voice is ${pct(S.shareOfVoice(last))}.`,
        ].join('\n'),
        sources: [
          { label: 'Visibility', count: week.length },
          { label: 'Competitors', count: COMPETITORS.length },
        ],
      },
      {
        question: 'And on Perplexity?',
        at: followAt,
        workingMs: 9_700,
        dataAsOf: asOf(last),
        steps: [
          read('Read Prompt performance', {
            dateRange: 'Latest check',
            platforms: [platformName(perplexity)],
            rows: perplexityByPrompt.length,
            tool: 'get_prompt_performance',
          }),
        ],
        answer: [
          `On Perplexity, Brewline is named in ${perplexityByPrompt.length - missed.length} of the ${perplexityByPrompt.length} tracked prompts (${pct(byPlatform.find((p) => p.id === perplexity).now)} of its answers).`,
          '',
          missed.length > 0
            ? `It isn't named for:\n${missed.map((p) => `- ${p.text}`).join('\n')}`
            : 'It is named for every tracked prompt.',
          '',
          missedSites.length > 0
            ? `Perplexity's answers to them cite ${missedSites.join(' and ')} most, so a page of yours that answers the question directly gives it one of yours to cite.`
            : 'A page of yours that answers these questions directly gives Perplexity one of yours to cite.',
        ].join('\n'),
        sources: [{ label: 'Prompt performance', count: perplexityByPrompt.length }],
      },
    ],
    moves: [
      `Compare us with ${leader.name}`,
      'Which sites do AI answers cite?',
      'What should I work on first?',
    ],
  };

  // ── 2. Which sites do AI answers cite? (asked from the Citations page's panel) ─
  // Asked the day before the latest check: the three checks before it.
  const prior = S.runResults(results, [LATEST - 3, LATEST - 2, LATEST - 1]);
  const priorIds = new Set(prior.map((r) => r.id));
  const byDomain = new Map();
  for (const c of citations) {
    if (priorIds.has(c.prompt_result_id)) byDomain.set(c.domain, (byDomain.get(c.domain) ?? 0) + 1);
  }
  const domains = [...byDomain].sort((a, b) => b[1] - a[1]);
  const ownRank = domains.findIndex(([d]) => d === BRAND.domain) + 1;
  const citationAction = ofKind('earn_third_party_citations');
  const sources = {
    key: 'citations',
    title: 'Which sites do AI answers cite for our prompts?',
    origin: 'panel',
    originPage: '/dashboard/citations',
    turns: [
      {
        question: 'Which sites do AI answers cite for our prompts?',
        at: at(LATEST - 1, 26, 26 * 60),
        workingMs: 12_900,
        dataAsOf: asOf(prior),
        steps: [
          read('Read Citations', {
            dateRange: 'Last 9 days',
            rows: domains.length,
            tool: 'get_citations',
          }),
        ],
        answer: [
          `Over the last three checks, answers to your ${prompts.length} tracked prompts cited ${domains.length} sites. The most cited:`,
          '',
          table(
            ['Site', 'Citations'],
            domains.slice(0, 6).map(([domain, count]) => [domain, String(count)]),
          ),
          '',
          ownRank > 0
            ? `brewline.example is number ${ownRank}, with ${byDomain.get(BRAND.domain)} citations. Review sites and forums are cited more than any shop, yours included.`
            : 'brewline.example isn’t cited yet. Review sites and forums are cited more than any shop.',
          ...(citationAction
            ? [
                '',
                `The Action Center already has a task for it: [${actionTitle(citationAction)}](${actionHref(citationAction)}).`,
              ]
            : []),
        ].join('\n'),
        sources: [{ label: 'Citations', count: domains.length }],
      },
    ],
    moves: ['Which of our pages get cited?', `Compare citations with ${leader.name}`],
  };

  // ── 3. Compare us with the leading competitor ───────────────────────────────
  const ownPrior = S.brandStats(prior);
  const leaderPrior = S.competitorStats(prior).get(leader.name);
  const leaderTraits = COMPETITORS.find((c) => c.name === leader.name)?.traits ?? [];
  const leads = PLATFORMS.map((p) => {
    const rows = prior.filter((r) => r.model_used === p.id);
    return {
      name: platformName(p.id),
      brand: S.brandStats(rows).mentionRate,
      rival: S.competitorStats(rows).get(leader.name)?.mentionRate ?? 0,
    };
  });
  const widest = [...leads].sort((a, b) => b.rival - b.brand - (a.rival - a.brand))[0];
  const gapAction = ofKind('close_competitor_gap');
  const compare = {
    key: 'compare',
    title: `Compare us with ${leader.name}`,
    origin: 'page',
    turns: [
      {
        question: `Compare us with ${leader.name}`,
        at: at(LATEST - 1, 3, 3 * 24 * 60),
        workingMs: 21_300,
        dataAsOf: asOf(prior),
        steps: [
          read('Read Competitors', {
            dateRange: 'Last 9 days',
            rows: COMPETITORS.length,
            tool: 'get_competitors',
          }),
          read('Read Mentions · Competitors', {
            dateRange: 'Last 9 days',
            rows: prior.length,
            tool: 'get_mention_competitors',
          }),
        ],
        answer: [
          `Over the last three checks, **${leader.name}** is named in ${pct(leaderPrior.mentionRate)} of AI answers to your prompts, Brewline in ${pct(ownPrior.mentionRate)}.`,
          '',
          table(
            ['Platform', 'Brewline', leader.name],
            leads.map((l) => [l.name, pct(l.brand), pct(l.rival)]),
          ),
          '',
          `Answers describe ${leader.name} as a brand that ${leaderTraits.slice(0, 2).join(' and ')}, and Brewline as one that ${BRAND_TRAITS.positive[0]}. The gap is widest on ${widest.name}: ${pct(widest.rival)} against ${pct(widest.brand)}.`,
          ...(gapAction
            ? [
                '',
                `This is the Action Center's [${actionTitle(gapAction)}](${actionHref(gapAction)}).`,
              ]
            : []),
        ].join('\n'),
        sources: [
          { label: 'Competitors', count: COMPETITORS.length },
          { label: 'Mentions · Competitors', count: prior.length },
        ],
      },
    ],
    moves: [],
  };

  // ── 4. What should I work on first? ─────────────────────────────────────────
  const firstDraft = demoId(brandId, 'draft:low-acid-guide');
  const priorities = {
    key: 'priorities',
    title: 'What should I work on first?',
    origin: 'page',
    turns: [
      {
        question: 'What should I work on first?',
        at: at(LATEST, 5, 15),
        workingMs: 14_200,
        dataAsOf: asOf(last),
        steps: [
          read('Read Action Center', {
            dateRange: 'Open now',
            platforms: [],
            rows: open.length,
            tool: 'get_actions',
          }),
        ],
        answer: [
          `You have ${open.length} open actions in the Action Center. By Priority Score:`,
          '',
          ...open.map(
            (a, i) =>
              `${i + 1}. [${actionTitle(a)}](${actionHref(a)}) · ${a.priority_score} · ${a.status === 'in_progress' ? 'In progress' : 'New'}`,
          ),
          '',
          `Start with the first: its draft is already in the [Content Editor](/dashboard/content/editor/${firstDraft}), and the prompts it answers are asked often.`,
        ].join('\n'),
        sources: [{ label: 'Action Center', count: open.length }],
      },
    ],
    moves: ['Open the draft for the first action', 'Why is the second one in progress?'],
  };

  // ── 5. Which subscription questions miss us? ───────────────────────────────
  const topic = TOPICS.find((t) => t.key === 'subscriptions');
  const topicPrompts = prompts.filter((p) => p.topic_id === demoId(brandId, `topic:${topic.key}`));
  const earlier = S.runResults(results, [LATEST - 4, LATEST - 3, LATEST - 2]);
  const perPrompt = topicPrompts
    .map((p) => ({
      text: p.text,
      rate: S.brandStats(earlier.filter((r) => r.prompt_id === p.id)).mentionRate ?? 0,
    }))
    .sort((a, b) => a.rate - b.rate);
  // The sites the weakest prompt's answers cite most.
  const weakestId = topicPrompts.find((p) => p.text === perPrompt[0].text)?.id;
  const weakestAnswers = new Set(earlier.filter((r) => r.prompt_id === weakestId).map((r) => r.id));
  const cited = new Map();
  for (const c of citations) {
    if (weakestAnswers.has(c.prompt_result_id)) cited.set(c.domain, (cited.get(c.domain) ?? 0) + 1);
  }
  const weakestSites = [...cited]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([domain]) => domain);
  // The help page in the Content Editor answers the pause-or-skip prompt.
  const help = DRAFTS.find((d) => d.key === 'pause-skip-help');
  const helpPrompt = PROMPTS.find((p) => p.key === 'pause-skip')?.text;
  const helpRate = perPrompt.find((p) => p.text === helpPrompt)?.rate;
  const subscriptions = {
    key: 'subscriptions',
    title: 'Which subscription questions don’t name us?',
    origin: 'page',
    turns: [
      {
        question: 'Which subscription questions don’t name us?',
        at: at(LATEST - 2, 4, 6 * 24 * 60),
        workingMs: 16_800,
        dataAsOf: asOf(earlier),
        steps: [
          read('Read Prompt performance', {
            subject: topic.name,
            dateRange: 'Last 9 days',
            rows: earlier.filter((r) => topicPrompts.some((p) => p.id === r.prompt_id)).length,
            tool: 'get_prompt_performance',
          }),
        ],
        answer: [
          `In ${topic.name}, how often each prompt's answers name Brewline, lowest first:`,
          '',
          table(
            ['Prompt', 'Named in'],
            perPrompt.map((p) => [p.text, pct(p.rate)]),
          ),
          '',
          `"${perPrompt[0].text}" is the weakest. Its answers cite ${weakestSites.join(' and ')} most, so a page of yours on the same question gives them one of yours to cite.`,
          ...(help && helpPrompt && helpRate !== undefined
            ? [
                '',
                `For "${helpPrompt}" (${pct(helpRate)}), a help page that answers it step by step is already in the Content Editor: [${help.title}](/dashboard/content/editor/${demoId(brandId, `draft:${help.key}`)}).`,
              ]
            : []),
        ].join('\n'),
        sources: [{ label: 'Prompt performance', count: perPrompt.length }],
      },
    ],
    moves: [],
  };

  return [visibility, priorities, sources, compare, subscriptions];
}

/**
 * Every row of the demo's chats for the given people, in memory: chats,
 * their questions and answers, the answers' runs with their steps, end
 * events and next moves. Deterministic but for the dates.
 *
 * @param {{ brandId: string, now: Date, organizationId: string, userIds: string[] }} args
 */
export async function chatRows({ brandId, now, organizationId, userIds }) {
  const scripts = await chatScripts({ brandId, now });
  const rows = {
    conversations: [],
    messages: [],
    runs: [],
    steps: [],
    events: [],
    moves: [],
  };
  for (const userId of userIds) {
    for (const chat of scripts) {
      const id = (key) => demoId(brandId, `chat:${userId}:${chat.key}:${key}`);
      const conversationId = id('conversation');
      let lastAt = null;
      chat.turns.forEach((turn, n) => {
        const askedAt = turn.at;
        const startedAt = new Date(askedAt.getTime() + 1000);
        const finishedAt = new Date(startedAt.getTime() + turn.workingMs);
        const answerId = id(`answer:${n}`);
        const runId = id(`run:${n}`);
        lastAt = finishedAt;
        rows.messages.push(
          {
            id: id(`question:${n}`),
            conversation_id: conversationId,
            role: 'user',
            content_md: turn.question,
            created_at: askedAt.toISOString(),
          },
          {
            id: answerId,
            conversation_id: conversationId,
            role: 'assistant',
            content_md: turn.answer,
            generated_at: finishedAt.toISOString(),
            data_as_of: turn.dataAsOf || null,
            timezone: 'UTC',
            created_at: new Date(askedAt.getTime() + 500).toISOString(),
          },
        );
        rows.runs.push({
          id: runId,
          message_id: answerId,
          conversation_id: conversationId,
          status: 'done',
          model: 'auto',
          effort: 'normal',
          created_at: askedAt.toISOString(),
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
        });
        const stepMs = turn.workingMs / (turn.steps.length + 1);
        turn.steps.forEach((step, i) => {
          rows.steps.push({
            id: id(`run:${n}:step:${i + 1}`),
            run_id: runId,
            position: i + 1,
            kind: step.kind,
            status: 'done',
            label: step.label,
            detail: step.detail || null,
            scope_json: step.scope,
            row_count: step.rows ?? null,
            data_as_of: turn.dataAsOf || null,
            started_at: new Date(startedAt.getTime() + i * stepMs).toISOString(),
            finished_at: new Date(startedAt.getTime() + (i + 1) * stepMs).toISOString(),
            tool: step.tool,
          });
        });
        rows.events.push({
          run_id: runId,
          seq: 1,
          type: 'run.finished',
          data: {
            workingMs: turn.workingMs,
            stepCount: turn.steps.length,
            sources: turn.sources,
            generatedAt: finishedAt.toISOString(),
            dataAsOf: turn.dataAsOf || null,
          },
          created_at: finishedAt.toISOString(),
        });
        // The next moves come under the chat's latest answer only, as a finished run leaves them.
        if (n === chat.turns.length - 1) {
          chat.moves.forEach((label, rank) => {
            rows.moves.push({
              id: id(`run:${n}:move:${rank + 1}`),
              run_id: runId,
              rank: rank + 1,
              label,
              prompt: label,
              class: 'read',
              ghost_ok: false,
              created_at: finishedAt.toISOString(),
            });
          });
        }
      });
      rows.conversations.push({
        id: conversationId,
        organization_id: organizationId,
        user_id: userId,
        brand_id: brandId,
        title: chat.title,
        origin: chat.origin,
        origin_page: chat.originPage ?? '/dashboard/chat',
        touched_brand_ids: [brandId],
        last_message_at: lastAt.toISOString(),
        // Read a minute after its answer: an answer read is no news for the Inbox.
        last_read_at: new Date(lastAt.getTime() + 60_000).toISOString(),
        created_at: chat.turns[0].at.toISOString(),
        updated_at: lastAt.toISOString(),
      });
    }
  }
  return rows;
}

/** The demo brand's organization and its people, oldest first. */
async function readPeople(db, brandId) {
  const { data: brand, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();
  if (error) throw new Error(`demo chat brand read: ${error.message}`);
  const { data: people, error: peopleError } = await db
    .from('profiles')
    .select('id')
    .eq('organization_id', brand.organization_id)
    .order('created_at', { ascending: true })
    .limit(MAX_PEOPLE);
  if (peopleError) throw new Error(`demo chat people read: ${peopleError.message}`);
  return { organizationId: brand.organization_id, userIds: (people ?? []).map((p) => p.id) };
}

/**
 * Deletes the demo brand's chats (every person's), with what hangs off them.
 * Called where the demo brand is hidden: a chat about a brand no one sees
 * would stay in Chat's menu, which lists a person's chats of every brand.
 *
 * @param {object} db supabase client
 * @param {string} brandId the demo brand
 */
export async function hideDemoChats(db, brandId) {
  const { error } = await db.from('chat_conversations').delete().eq('brand_id', brandId);
  if (error) throw new Error(`demo chats delete: ${error.message}`);
}

export const chat = {
  name: 'chat',
  // Cleared just before it is built (index.js): its rows hang off its chats, deleted with them.
  tables: ['chat_conversations'],
  keys: { chat_run_events: 'run_id,seq' },

  /**
   * Through the build's writer (a writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    write = demoWriter({ db, brandId, keys: chat.keys }).write,
  }) {
    const people = await readPeople(db, brandId);
    if (people.userIds.length === 0) return { chats: 0, people: 0 };
    const rows = await chatRows({ brandId, now, ...people });
    // A row after the one it points at.
    await write('chat_conversations', rows.conversations);
    await write('chat_messages', rows.messages);
    await write('chat_runs', rows.runs);
    await Promise.all([
      write('chat_run_steps', rows.steps),
      write('chat_run_events', rows.events),
      write('chat_next_moves', rows.moves),
    ]);
    return { chats: rows.conversations.length, people: people.userIds.length };
  },
};
