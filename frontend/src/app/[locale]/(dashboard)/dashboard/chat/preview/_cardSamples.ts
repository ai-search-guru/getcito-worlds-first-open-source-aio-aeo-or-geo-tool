import type { ChatStep } from '@/lib/chat/events';
import type { TrayResponse } from '@/lib/chat/runsTray';
import type { PlanStep } from '@/components/agentic/PlanCard';
import type { StepRow } from '@/components/agentic/StepList';

/**
 * The run cards' sample data for the design preview (Chat P0, D2), taken
 * from the approved Chat v2 mockups (CHAT-mockup-v2.html `#s-plan`,
 * `#s-need`, `#s-done`, `#s-denied`, `#s-failed`). In the product the server
 * sends these words (the label registry, the precedence's denial), so they
 * are data here, not the app's own copy.
 */

export const TASKS_PLAN = {
  title: 'Action Center tasks · 4 due',
  due: 'Due Fri, Oct 30',
  uses: 'Action Center · 52 sources · 2 live pages',
  connections: [
    { name: 'Google Search Console', connected: true },
    { name: 'Webflow', connected: true },
  ],
  time: '6 min',
  aiUsage: '~2%',
  outputs: 'FAQ draft, schema code, report',
  steps: [
    {
      label: 'Read the 4 tasks and rank them by impact',
      detail: 'Action Center · citations last 30 days',
      cls: 'read',
    },
    {
      label: 'Check /pricing and /features as AI engines see them',
      detail: 'Live page read · schema check',
      cls: 'read',
    },
    {
      label: 'Write an FAQ block for /pricing from 18 fan-outs',
      detail: 'Draft in this chat · your brand facts',
      cls: 'read',
    },
    {
      label: 'Change one cited passage on /pricing',
      detail: 'Cited 12× · I show you the change first',
      cls: 'write',
    },
    {
      label: 'Push the FAQ, FAQPage schema and 2 link fixes to Webflow as a draft',
      detail: 'Webflow draft · nothing goes live',
      cls: 'write',
    },
    {
      label: 'Publish the Webflow draft',
      detail: 'Goes live on getcito.com/pricing',
      cls: 'execute',
    },
  ] satisfies PlanStep[],
};

export const SHOPPING_PLAN = {
  title: 'AI shopping readiness · 48 products',
  uses: 'Product Visibility · 48 products',
  connections: [{ name: 'Shopify', connected: false }],
  time: '6 min',
  aiUsage: '~2%',
  outputs: 'Fix list, feed changes',
  steps: [
    { label: 'Read product pages and feed', detail: 'Shopify · 48 products', cls: 'read' },
    {
      label: 'Check against ChatGPT Shopping and Google Shopping',
      detail: 'Product Visibility',
      cls: 'read',
    },
    { label: 'Save the fixes as drafts', detail: 'Shopify drafts', cls: 'write' },
    { label: 'Push the feed', detail: 'Leaves your workspace', cls: 'execute' },
  ] satisfies PlanStep[],
};

export const QUALITY_PLAN = {
  title: 'Quality pass · 3 drafts',
  uses: 'Content · 3 drafts',
  time: '4 min',
  aiUsage: '~1%',
  outputs: '3 improved drafts, your to-do list',
  steps: [
    { label: 'Score the 3 drafts under 60', detail: 'E-E-A-T · Trust · Readability', cls: 'read' },
    { label: 'Save the fixes to the drafts', detail: 'Content Editor drafts', cls: 'write' },
    { label: 'List what only you can add', detail: 'Quotes, first-hand data, author', cls: 'read' },
  ] satisfies PlanStep[],
};

const step = (
  n: number,
  status: ChatStep['status'],
  label: string,
  detail?: string,
  kind: ChatStep['kind'] = 'read',
): ChatStep => ({ n, kind, status, label, ...(detail ? { detail } : {}) });

/** A run's steps at one moment of the Action Center tasks run. */
export const RUN_STEPS = {
  running: [
    step(1, 'done', 'Read Action Center', '4 tasks due this week'),
    step(
      2,
      'done',
      'Opened getcito.com/pricing',
      'No FAQ block and no FAQPage schema found',
      'open_page',
    ),
    step(3, 'running', 'Drafted FAQ block · /pricing', 'From 18 fan-outs', 'write'),
  ],
  waiting: [
    step(1, 'done', 'Read Action Center', '4 tasks due this week'),
    step(2, 'done', 'Opened getcito.com/pricing', undefined, 'open_page'),
    step(3, 'done', 'Drafted FAQ block · /pricing', undefined, 'write'),
    step(4, 'waiting', 'Change one cited passage on /pricing', 'Waiting for your OK', 'write'),
  ],
  done: [
    step(1, 'done', 'Thinking · 3s', '3 tasks are due this week.', 'thinking'),
    step(2, 'done', 'Read Action Center', '4 tasks due this week'),
    step(
      3,
      'done',
      'Read Citations',
      'Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows',
    ),
    step(4, 'done', 'Opened getcito.com/pricing', undefined, 'open_page'),
    step(5, 'done', 'Read Prompts', '12 prompts'),
    step(6, 'done', 'Checked facts', 'Plan names and prices match your Billing page', 'check'),
    step(7, 'done', 'Saved draft in Content', 'FAQ block · /pricing', 'write'),
  ],
  single: [
    {
      ...step(1, 'done', 'Read Citations', 'Perplexity · Last 30 days'),
      rowCount: 18,
    },
  ],
  stopped: [
    step(1, 'done', 'Read Action Center', '4 tasks due this week'),
    step(2, 'skipped', 'Opened getcito.com/pricing', undefined, 'open_page'),
  ],
  error: [
    step(1, 'done', 'Read Action Center', '4 tasks due this week'),
    step(2, 'error', 'Read Citations', 'Timed out'),
  ],
} satisfies Record<string, ChatStep[]>;

export const APPROVAL_HEAD = {
  title: 'I need your OK on one change',
  subtitle: 'Step 4 of 6 · Action Center tasks',
  note: 'The run waits up to 7 days for you, then stops. Nothing changes until you answer.',
};

export const APPROVAL = {
  title: 'Change a cited passage on /pricing',
  badge: 'Cited 12× last month',
  why: 'ChatGPT cites this passage, but it says “7 platforms” on Starter. Your pricing page says Starter covers ChatGPT and Copilot.',
  change: {
    before: 'Every plan tracks all 7 AI platforms, including Claude.',
    after:
      'Starter tracks ChatGPT and Copilot. Growth adds Gemini, Perplexity, AI Overviews and AI Mode. Claude is on Enterprise.',
  },
  sources: [
    'Brand fact · Plans (approved)',
    'Cited page · /pricing',
    'Fan-out · getcito plans platforms',
  ],
  dontAskAgainLabel: 'Don’t ask again for brand-fact fixes',
  doneLabel: 'cited passage changed',
};

/** A finished run's next moves (CHAT-07 §C, mockup `#s-done`): the first continues it. */
export const NEXT_MOVES = [
  { label: 'Do the same for /features', prompt: 'Do the same for /features', ghost: true },
  {
    label: 'Win back Google AI Overviews citations',
    prompt: 'Win back the Google AI Overviews citations we lost this week',
  },
  { label: 'Schedule this every Monday', prompt: 'Schedule this every Monday' },
];

/** Two questions asked together before a FAQ draft (CHAT-07 §A). */
export const QUESTIONS = {
  page: {
    n: 2,
    question: 'Which page should the FAQ go on?',
    options: [
      { label: '/pricing', detail: 'Cited 18 times for pricing prompts', recommended: true },
      { label: '/features', detail: 'Cited 6 times' },
      { label: 'A new FAQ page' },
    ],
    allowOther: true,
    multi: false,
    batch: { at: 1, of: 2 },
    then: 'Then I’ll write the FAQ draft',
  },
  topics: {
    n: 3,
    question: 'Which questions should it answer?',
    options: [
      { label: 'Plans and prices', recommended: true },
      { label: 'Platforms tracked' },
      { label: 'Trial and cancelling' },
    ],
    allowOther: false,
    multi: true,
    batch: { at: 2, of: 2 },
  },
};

export const PUSH_APPROVAL = {
  title: 'Push to Webflow as a draft',
  items: [
    { icon: '≡', title: 'FAQ block · 6 questions', detail: 'New section on /pricing' },
    { icon: '{ }', title: 'FAQPage schema', detail: 'JSON-LD in the page head' },
    { icon: '↗', title: '2 broken links fixed', detail: '/pricing → /plans, /features#api → /api' },
  ],
  note: 'Draft only · nothing goes live',
};

export const PUBLISH = {
  title: 'Publish the Webflow draft for /pricing',
  summary:
    'FAQ block (6 questions), FAQPage schema, 1 changed passage and 2 link fixes · Webflow draft “Pricing”',
  note: 'Goes live on getcito.com/pricing · same in every mode',
  actionLabel: 'Publish',
  busyLabel: 'Publishing…',
  previewLabel: 'Preview in Webflow',
  disabledReason: 'After the draft is approved',
  doneLabel: 'Published to getcito.com/pricing · 14:32 · by you',
};

export const RESULT = {
  done: {
    title: 'Done. 4 tasks are ready for you to close.',
    summary: '6 of 6 steps · Auto (Haiku 5.5 + Sonnet 5.5) · 2% of monthly AI limit',
  },
  needsClick: {
    title: 'Ready to go live. Publishing needs your click.',
    summary: '5 of 6 steps · Auto (Haiku 5.5 + Sonnet 5.5) · 2% of monthly AI limit',
  },
  generatedAt: '2026-10-26T11:32:00Z',
  dataAsOf: '2026-10-26T05:00:00Z',
  timeZone: 'Europe/Istanbul',
  kpis: [
    { label: 'Tasks ready', value: '4', note: 'of 4' },
    { label: 'Changes', value: '2', note: 'you approved 2' },
    { label: 'First impact check', value: 'Nov 2', note: 'day 7 · 14 · 30 · 90' },
  ],
  files: [
    {
      icon: '≡',
      title: 'FAQ block for /pricing',
      meta: '6 questions · HTML + Markdown · in Files',
      href: '/dashboard/content/library',
    },
    { icon: '{ }', title: 'FAQPage schema', meta: 'JSON-LD · in the Webflow draft' },
    // Not a path in the app: no Open.
    {
      icon: '▤',
      title: 'What I did and why',
      meta: 'Report · 1 page',
      href: 'https://example.com/report',
    },
  ],
  note: 'You close tasks in Action Center. I never mark them done.',
  primary: {
    label: 'Close tasks in Action Center',
    href: '/dashboard/action-center',
    action: 'done.closeTasksInActionCenter',
  },
} as const;

export const DENIALS = {
  role: {
    title: 'I can’t add these prompts for you',
    subtitle: 'Answered in 1 s · you are signed in as Analyst',
    asked: 'Add 5 prompts to Tracked Prompts for GetCito.',
    askedItems: [
      'best aeo tools',
      'aeo vs seo',
      'ai visibility tracker',
      'track brand in perplexity',
      'llms.txt generator',
    ],
    why: 'Your role is Analyst. Adding prompts needs Manager or Admin.',
    whySource: 'Role rule · Settings › Team › Roles & access',
    whoCan: 'Admins and Managers can do this.',
    nextActions: ['ask_admin', 'see_access'],
  },
  plan: {
    title: 'Full auto needs Growth',
    subtitle: 'Answered in 1 s · you are signed in as Admin · preview as Starter',
    asked: 'Run /winback in Full auto, so drafts are saved without asking you first.',
    why: 'Full auto needs Growth. Your plan: Starter.',
    whySource: 'Plan rule · Billing › Plans',
    whoCan: 'Admins can change the plan.',
    nextActions: ['upgrade', 'compare_plans'],
    extra: {
      label: 'Growth adds',
      items: [
        { title: 'Full auto', detail: 'agents apply changes for you, logged and undoable' },
        { title: '4 more AI platforms', detail: 'Gemini, Perplexity, AI Overviews, AI Mode' },
        {
          title: 'Open pull request and MCP write',
          detail: 'ship fixes as PRs, act from Claude, ChatGPT, Cursor',
        },
      ],
      note: '$249 a month · $200 more than Starter',
    },
  },
  policy: {
    title: 'Your Admin set this tool to Never',
    subtitle: 'Answered in 1 s · you are signed in as Manager',
    asked: 'Send 4 outreach emails from /wrongclaim to third-party sites.',
    why: 'Your Admin set this tool to Never: Send outreach email. Chat can’t run it for anyone in this workspace.',
    whySource: 'Tool policy · Settings › Chat',
    whoCan: 'Admins can change the tool policy.',
    nextActions: ['ask_admin', 'open_policy', 'see_access'],
  },
} as const;

export const DENIAL_FOOTNOTE = 'Nothing was changed · nothing outside your access was shown';

export const FAILED = {
  title: 'Merchant feed fix · EU',
  reason: 'Google Merchant Center isn’t connected · nothing was changed',
  connect: 'Connect Google Merchant Center',
  steps: [
    { n: 1, label: 'Read 48 products', detail: 'Product Visibility · EU', state: 'done' },
    {
      n: 2,
      label: 'Update 12 titles in Google Merchant Center',
      detail: 'Google Merchant Center isn’t connected',
      state: 'failed',
      pill: 'asks',
    },
    {
      n: 3,
      label: 'Push the feed',
      detail: 'Leaves your workspace',
      state: 'pending',
      pill: 'click',
    },
  ] satisfies StepRow[],
  runReason: 'The answer stopped before it was done · Retry sends your message again',
};

export const TRAY: TrayResponse = {
  running: 1,
  needsYou: 1,
  runs: [
    {
      source: 'chat',
      state: 'needsYou',
      title: 'Action Center tasks',
      step: 4,
      steps: 6,
      stepLabel: 'Change one cited passage on /pricing',
      startedAt: '2026-10-26T13:02:00Z',
      finishedAt: null,
      href: '/dashboard/action-center',
    },
    {
      source: 'chat',
      state: 'running',
      title: 'Win back citations · /features',
      step: 2,
      steps: 5,
      stepLabel: 'Comparing cited pages',
      startedAt: '2026-10-26T12:40:00Z',
      finishedAt: null,
      href: '/dashboard/citations',
    },
    {
      source: 'content',
      state: 'done',
      title: 'Weekly citations report',
      step: 3,
      steps: 3,
      stepLabel: 'Checking sources',
      startedAt: '2026-10-26T04:58:00Z',
      finishedAt: '2026-10-26T05:02:00Z',
      href: '/dashboard/content/library',
    },
    {
      source: 'chat',
      state: 'failed',
      title: 'Merchant feed fix · EU',
      step: 2,
      steps: 3,
      stepLabel: 'Update 12 titles in Google Merchant Center',
      startedAt: '2026-10-26T04:30:00Z',
      finishedAt: '2026-10-26T04:31:00Z',
      href: '/dashboard/shopping',
    },
  ],
};
