// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every write the web app makes straight to Supabase checks the plan first,
 * read from the code: each server action in lib/actions that writes —
 * itself or through a helper in its file — calls assertWritable, and each
 * POST, PUT, PATCH or DELETE route under app/api checks the plan, unless it
 * is named below with why it stays open while the workspace is read-only.
 * A new write is gated, or named here, before it ships.
 *
 * A write is .insert/.update/.upsert/.delete on a .from() query, a storage
 * change (a signed upload address too), an auth change, or an RPC whose
 * database function isn't declared STABLE or IMMUTABLE (supabase/schema.sql).
 * A query or bucket kept in a name first (`const images = ….storage.from(…)`)
 * is followed to it.
 *
 * The check comes first: it is the first thing a gated action awaits. And a
 * setup action (assertWritable({ onboarding: true })) never runs one in its
 * file that checks without it — that check would refuse the organization
 * setup lets through.
 *
 * A gated action that takes a brand id hands it to its check
 * (assertWritable({ brandId })), which refuses the demo brand (00380): a
 * parameter named brandId, an object parameter whose type in its file has
 * one, or a brand's own id named below.
 */

const ACTIONS_DIR = join(__dirname, 'actions');
const API_DIR = join(__dirname, '../app/api');
const SCHEMA = join(__dirname, '../../../supabase/schema.sql');

/**
 * Server actions that write and stay open while read-only: file:function →
 * why. One that writes through the API (a fetch that posts, puts, patches or
 * deletes) is named here when the API keeps that route open too.
 */
const OPEN_ACTIONS: Record<string, string> = {
  'organization.ts:updateAccountName': "the person's own profile",
  'chatNotices.ts:markChatNoticesRead':
    "the person's own record of seeing a notice (00441), nothing that runs or costs",
  'chatNotices.ts:closeChatNotice':
    "the person's own record of opening a notice about an agent (00446), nothing that runs or costs",
  'chatPrefs.ts:saveChatMenuOpen': "the person's own Chat layout, no cost",
  'chatPrefs.ts:saveChatRailOpen': "the person's own Chat layout, no cost",
  'chatPrefs.ts:saveChatGeneralSettings':
    "the person's own Chat settings, no cost; a run they start is checked by the engine",
  'chatPrefs.ts:saveUsageNoticePeriod':
    "the person's own record of a notice seen, nothing that costs",
  'team.ts:acceptInvitation': "the invited person's own account joins",
  'team.ts:revokeInvitation': 'takes back access, never gives it',
  'team.ts:removeMember': 'takes back access, never gives it',
  'gettingStarted.ts:markGettingStartedPageOpened': 'a trace of reading a page',
  'contentImages.ts:prepareImageUpload':
    'checks the plan itself (isSubscriptionActive), to answer "plan" instead of throwing',
  'brand.ts:deleteBrand':
    'deleting a brand only removes what the person gave us (GetCito, 2026-10-27)',
  'promptTableViews.ts:savePromptTableView':
    'a column layout: costs nothing, and read-only shows the data the same way',
  'promptTableViews.ts:removePromptTableView':
    'a column layout: costs nothing, and read-only shows the data the same way',
  'menuAccess.ts:setMyWorkAreas':
    'the person\'s own profile; it answers "What do you work on?", which /dashboard/welcome waits on',
  'chatUploads.ts:prepareChatUpload':
    'checks the plan itself (isSubscriptionActive), to answer read_only instead of throwing',
  'chatUploads.ts:finishChatUpload':
    "marks the person's own file, already let up by prepareChatUpload, as arrived",
  'chatUploads.ts:removeChatUpload': "takes the person's own draft file away, never adds one",
  'chatPrefs.ts:saveChatPanelSize': "the person's own Chat layout (panel size), nothing that costs",
  'chatPrefs.ts:saveHomeSeen': "the person's own record of leaving Chat Home, nothing that costs",
  'chatPrefs.ts:saveChatFocus':
    "the person's own Chat focus: it only shapes suggestions, nothing that costs",
  'chatPrefs.ts:skipChatFocus': "the person's own Chat focus left empty, nothing that costs",
  'chatPrefs.ts:markFocusPrompted':
    "the person's own record of being asked their focus, nothing that costs",
  // requestAccess writes through lib/chat/accessRequestStore.ts: asking an Admin
  // costs nothing, and a read-only workspace is one of the things to ask about.
  'chatAccessRequests.ts:withdrawAccessRequest': 'takes back a request, never gives access',
  'chatAccessRequests.ts:decideAccessRequest':
    "marks a request decided; it changes no one's access, and an approved memory line is checked against the plan by the memory store (read_only)",
  // Chat's settings (Admins): asAdmin() checks the plan itself (ctx.plan.writable,
  // as assertWritable) to answer read_only as a result instead of throwing.
  'chatSettings.ts:setToolPolicy': 'checks ctx.plan.writable itself, answering read_only',
  'chatSettings.ts:resetToolPolicies': 'checks ctx.plan.writable itself, answering read_only',
  'chatSettings.ts:setChatSwitch': 'checks ctx.plan.writable itself, answering read_only',
  'chatSettings.ts:setManagerExecute': 'checks ctx.plan.writable itself, answering read_only',
  'chatSettings.ts:setAutoGoLive': 'checks ctx.plan.writable itself, answering read_only',
  'chatSettings.ts:removeAutoChoice':
    "removes the person's own Don't ask again tick: takes an auto-approval back, never gives one",
  // An add-on pack (CHAT-18): only on an active, paid plan.
  'addOns.ts:startAddOnPurchase':
    'checks the plan itself (subscription_status active), answering trial or no_plan',
};

/** Actions that take a brand's own id under another name: file:function → the parameter. */
const BRAND_ID_PARAMS: Record<string, string> = {
  'brand.ts:updateBrand': 'id',
};

/** Write routes that stay open while read-only: path:METHOD → why. */
const OPEN_ROUTES: Record<string, string> = {
  'aeo/[...path]:POST': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:PUT': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:PATCH': 'a proxy to the API, which answers 402 itself',
  'aeo/[...path]:DELETE': 'a proxy to the API, which answers 402 itself',
  'agent/conversations/[id]:DELETE': 'deleting a conversation starts no cost',
  'keys:POST': 'a key costs nothing and only reads while read-only (2026-10-14 decision)',
  'keys/[id]:DELETE': 'revoking a key takes back access',
  'mcp:POST': 'its tools are gated one by one (gateWriteTools)',
  'mcp:DELETE': 'ends an MCP session',
  'settings/ai-providers:DELETE': 'removing a key takes back access',
  'stripe/checkout:POST': 'billing: choosing a plan',
  'stripe/portal:POST': 'billing: the payment method',
  'stripe/promo-code:POST': 'billing: checking a promo code',
  'stripe/subscription:PATCH': 'billing: changing the plan',
  'stripe/subscription:DELETE': 'billing: canceling the plan',
  'stripe/webhook:POST': "Stripe's own calls",
  'traffic/read:POST': 'reads only',
  // Chat's runs: the engine answers 402 with the server's body itself
  // (startChatRun, prepareResume), but for a request to the Admins.
  'chat/conversations:POST':
    'an empty chat of your own starts no cost; its first message is a run, which the engine refuses with 402',
  'chat/conversations/[id]:PATCH':
    'pinning, renaming, sharing or archiving your own chat starts no cost',
  'chat/conversations/[id]:DELETE':
    'deleting your own chat starts no cost, as the old Agent chats (#1613)',
  // Memory (W3-11): a person's own Me lines are their personal data (KVKK/GDPR).
  'chat/memory/[id]:DELETE':
    "deleting your own Me memory line stays open; the store answers 402 for a brand's or the workspace's",
  'chat/memory/[id]/restore:POST':
    'bringing back your own Me line you just deleted; the store answers 402 for the rest',
  'chat/memory/settings:PATCH':
    "turning your own Use memory off or on stays open; the store answers 402 for the workspace's switch",
  'chat/conversations/[id]/read:POST': 'marking your own chat read starts no cost',
  'chat/home-seen:POST': "the person's own record of leaving Chat Home starts no cost",
  'chat/whats-new/read:POST':
    "marking What's new read is the person's own record and starts no cost",
  'chat/conversations/[id]/restore:POST': 'undoing a delete starts no cost',
  'chat/runs:POST': 'the engine refuses a read-only workspace with the 402 body (startChatRun)',
  'chat/runs/[id]/approve:POST': 'the engine answers 402 (prepareResume), but for Ask your Admin',
  'chat/runs/[id]/skip:POST': 'saying no to a change starts no cost',
  'chat/runs/[id]/answer:POST': 'the engine answers 402 (prepareResume) while read-only',
  'chat/runs/[id]/stop:POST': 'stopping a run starts no cost',
  'chat/files/zip:POST': 'reads only: the picked files as one .zip, nothing kept',
  // The API server's cron and hooks (CHAT_INTERNAL_SECRET), never a person: the
  // triggers fire nothing in a read-only workspace, and the agent run driver
  // starts no run in one (readArmedOrgs, openAgentRun).
  'internal/chat/agents/tick:POST':
    "the server's cron; it starts no agent run in a read-only workspace",
  'internal/chat/agents/signals:POST':
    "the server's signal hook; it starts no agent run in a read-only workspace",
  // The same cron after the agents': a read-only workspace's due job is kept as
  // Skipped, and runs nothing (fireDueJobs).
  'internal/chat/schedules/tick:POST':
    "the server's cron; it runs no scheduled job in a read-only workspace",
};

/** What checks a route's plan before it writes. */
const ROUTE_GATES = new Set([
  'writeRefusal',
  'assertWritable',
  'subscriptionActiveFor',
  'assertSubscriptionActive',
  'authenticateMcpRequest',
]);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DB_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_WRITES = new Set([
  'upload',
  'update',
  'remove',
  'move',
  'copy',
  'createSignedUploadUrl',
]);

/** The database functions that only read: their last definition is STABLE or IMMUTABLE. */
function readOnlyFunctions(): Set<string> {
  const sql = readFileSync(SCHEMA, 'utf8');
  const volatility = new Map<string, boolean>();
  const create = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
  for (const match of sql.matchAll(create)) {
    const rest = sql.slice(match.index);
    const open = /\bas\s+(\$\w*\$)/i.exec(rest);
    if (!open) continue;
    const close = rest.indexOf(open[1], open.index + open[0].length);
    if (close < 0) continue;
    const end = rest.indexOf(';', close + open[1].length);
    const declared = rest.slice(0, open.index) + rest.slice(close, end < 0 ? undefined : end);
    volatility.set(match[1], /\b(stable|immutable)\b/i.test(declared));
  }
  return new Set([...volatility].filter(([, reads]) => reads).map(([name]) => name));
}

interface FunctionFacts {
  exported: boolean;
  writes: string[];
  /** Its fetches that change something through the API: `DELETE`, `POST`… */
  apiWrites: string[];
  gates: string[];
  /** It calls assertWritable() without `onboarding: true`. */
  strictGate: boolean;
  /** It calls assertWritable({ onboarding: true }). */
  onboardingGate: boolean;
  /** The brand id it takes: `brandId`, `input.brandId`… (null when it takes none). */
  brandParam: string | null;
  /** It hands a brand id to assertWritable ({ brandId }). */
  brandGate: boolean;
  /** What it awaits first, outside the functions inside it: the callee's name, else the text. */
  firstAwait: string | null;
  callees: string[];
}

/** What a file names with `const`/`let`, by name: `images` → `supabase.storage.from(…)`. */
type Bindings = Map<string, ts.Expression>;

function readBindings(source: ts.SourceFile): Bindings {
  const bound: Bindings = new Map();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      bound.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return bound;
}

/**
 * The chain a call hangs off: `supabase.from('x').select()` → true for
 * `.from`. A name is followed to what it was given, and a one-line arrow
 * to what it returns: `const uploads = () => admin.from('x')`.
 */
function chainCalls(node: ts.Expression, name: string, bound: Bindings): boolean {
  let current: ts.Expression = node;
  const followed = new Set<string>();
  for (;;) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === name) return true;
      current = callee;
    } else if (ts.isPropertyAccessExpression(current)) {
      if (current.name.text === name) return true;
      current = current.expression;
    } else if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isArrowFunction(current) && !ts.isBlock(current.body)) {
      current = current.body;
    } else if (ts.isIdentifier(current) && bound.has(current.text) && !followed.has(current.text)) {
      followed.add(current.text);
      current = bound.get(current.text)!;
    } else {
      return false;
    }
  }
}

/** The first await in a function's own body, in source order: not in the functions inside it. */
function firstAwaitIn(root: ts.Node): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found !== null) return;
    if (n !== root && ts.isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) {
      const awaited = n.expression;
      found =
        ts.isCallExpression(awaited) && ts.isIdentifier(awaited.expression)
          ? awaited.expression.text
          : awaited.getText().slice(0, 60);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

/** The top-level functions of a file: what each writes, which gates it calls, and its callees there. */
function readFunctions(
  file: string,
  readRpcs: Set<string>,
  gateNames: Set<string>,
): Map<string, FunctionFacts> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const bound = readBindings(source);
  // The interfaces and type aliases in the file with a brandId member.
  const hasBrandId = (members: ts.NodeArray<ts.TypeElement>) =>
    members.some((m) => m.name?.getText(source) === 'brandId');
  const brandTypes = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && hasBrandId(statement.members)) {
      brandTypes.add(statement.name.text);
    } else if (
      ts.isTypeAliasDeclaration(statement) &&
      ts.isTypeLiteralNode(statement.type) &&
      hasBrandId(statement.type.members)
    ) {
      brandTypes.add(statement.name.text);
    }
  }
  /** The brand id a function's parameters carry, as its body names it. */
  const brandParamOf = (fn: ts.SignatureDeclaration): string | null => {
    for (const param of fn.parameters) {
      const { name, type } = param;
      if (ts.isIdentifier(name) && name.text === 'brandId') return 'brandId';
      if (
        ts.isObjectBindingPattern(name) &&
        name.elements.some((e) => e.name.getText(source) === 'brandId')
      ) {
        return 'brandId';
      }
      if (
        ts.isIdentifier(name) &&
        type &&
        ((ts.isTypeReferenceNode(type) && brandTypes.has(type.typeName.getText(source))) ||
          (ts.isTypeLiteralNode(type) && hasBrandId(type.members)))
      ) {
        return `${name.text}.brandId`;
      }
    }
    return null;
  };
  const bodies = new Map<string, { node: ts.Node; exported: boolean; brandParam: string | null }>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const name = statement.name.text;
      bodies.set(name, {
        node: statement.body,
        exported: isExported(statement),
        brandParam: BRAND_ID_PARAMS[`${basename(file)}:${name}`] ?? brandParamOf(statement),
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const name = declaration.name.getText(source);
          bodies.set(name, {
            node: init,
            exported: isExported(statement),
            brandParam: BRAND_ID_PARAMS[`${basename(file)}:${name}`] ?? brandParamOf(init),
          });
        }
      }
    }
  }

  const facts = new Map<string, FunctionFacts>();
  for (const [name, { node, exported, brandParam }] of bodies) {
    const fact: FunctionFacts = {
      exported,
      writes: [],
      apiWrites: [],
      gates: [],
      strictGate: false,
      onboardingGate: false,
      brandParam,
      brandGate: false,
      firstAwait: firstAwaitIn(node),
      callees: [],
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          const target = callee.expression;
          if (chainCalls(target, 'storage', bound) && STORAGE_WRITES.has(method)) {
            fact.writes.push(`storage.${method}`);
          } else if (DB_WRITES.has(method) && chainCalls(target, 'from', bound)) {
            fact.writes.push(method);
          } else if (method === 'rpc') {
            const arg = n.arguments[0];
            const fn = arg && ts.isStringLiteralLike(arg) ? arg.text : '?';
            if (!readRpcs.has(fn)) fact.writes.push(`rpc ${fn}`);
          } else if (
            method === 'updateUser' ||
            (chainCalls(target, 'admin', bound) &&
              chainCalls(target, 'auth', bound) &&
              !['listUsers', 'getUserById'].includes(method))
          ) {
            fact.writes.push(`auth.${method}`);
          }
        } else if (ts.isIdentifier(callee)) {
          const called = callee.text;
          const opensMcpWrites = n.arguments.some((a) => /gateWrites:\s*false/.test(a.getText()));
          if (gateNames.has(called) && !opensMcpWrites) fact.gates.push(called);
          if (called === 'assertWritable') {
            const onboarding = n.arguments.some((a) => /onboarding:\s*true/.test(a.getText()));
            if (onboarding) fact.onboardingGate = true;
            else fact.strictGate = true;
            // Its brand: `{ brandId }`, or `{ brandId: <the brand id it takes> }`.
            const arg = n.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg)) {
              for (const prop of arg.properties) {
                if (prop.name?.getText() !== 'brandId') continue;
                const value = ts.isShorthandPropertyAssignment(prop)
                  ? 'brandId'
                  : ts.isPropertyAssignment(prop)
                    ? prop.initializer.getText()
                    : null;
                if (value !== null && value === brandParam) fact.brandGate = true;
              }
            }
          }
          if (bodies.has(called)) fact.callees.push(called);
          if (
            called === 'fetch' &&
            n.arguments[1] &&
            ts.isObjectLiteralExpression(n.arguments[1])
          ) {
            for (const prop of n.arguments[1].properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                prop.name.getText() === 'method' &&
                ts.isStringLiteralLike(prop.initializer) &&
                WRITE_METHODS.has(prop.initializer.text)
              ) {
                fact.apiWrites.push(prop.initializer.text);
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    facts.set(name, fact);
  }
  return facts;
}

/** What a function writes and which gates it calls, through the helpers in its file. */
function reach(facts: Map<string, FunctionFacts>, name: string) {
  const writes = new Set<string>();
  const apiWrites = new Set<string>();
  const gates = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const fact = facts.get(current)!;
    fact.writes.forEach((w) => writes.add(w));
    fact.apiWrites.forEach((w) => apiWrites.add(w));
    fact.gates.forEach((g) => gates.add(g));
    fact.callees.forEach(walk);
  };
  walk(name);
  return { writes: [...writes], apiWrites: [...apiWrites], gated: gates.size > 0 };
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

const readRpcs = readOnlyFunctions();

/** The server action files ('use server' in lib/actions), each with its functions. */
const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .filter((f) => /^['"]use server['"]/m.test(readFileSync(join(ACTIONS_DIR, f), 'utf8')))
  .map((file) => ({
    file,
    facts: readFunctions(join(ACTIONS_DIR, file), readRpcs, new Set(['assertWritable'])),
  }));

describe('read-only coverage', () => {
  it('reads which database functions only read', () => {
    // A sample each way, so a schema the parser can't read fails here.
    expect(readRpcs.has('mentions_list')).toBe(true);
    expect(readRpcs.has('insights_aggregates_daily')).toBe(true);
    expect(readRpcs.has('import_prompts')).toBe(false);
    expect(readRpcs.has('content_draft_snapshot')).toBe(false);
  });

  it('has every server action that writes call assertWritable, or name why it stays open', () => {
    const ungated: string[] = [];
    const writers = new Set<string>();
    const apiWriters = new Set<string>();
    const gatedOpen: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        if (!fact.exported) continue;
        const { writes, apiWrites, gated } = reach(facts, name);
        const key = `${file}:${name}`;
        if (apiWrites.length) apiWriters.add(key);
        if (key in OPEN_ACTIONS && gated) gatedOpen.push(key);
        // A write through the API is the API's to refuse (requireActiveSubscription).
        if (!writes.length) continue;
        writers.add(key);
        if (!(key in OPEN_ACTIONS) && !gated) ungated.push(`${key} (${writes.join(', ')})`);
      }
    }
    expect(ungated).toEqual([]);
    // The open list stays true: each one writes, here or through the API, and doesn't check after all.
    expect(
      Object.keys(OPEN_ACTIONS).filter((key) => !writers.has(key) && !apiWriters.has(key)),
    ).toEqual([]);
    expect(gatedOpen).toEqual([]);
    // Sanity: the scan finds the writes it is meant to.
    expect(writers.size).toBeGreaterThan(90);
  });

  it('has every gated action check the plan before anything else it awaits', () => {
    const late: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        const key = `${file}:${name}`;
        if (!fact.exported || key in OPEN_ACTIONS || !reach(facts, name).writes.length) continue;
        if (fact.firstAwait !== 'assertWritable') {
          late.push(`${key} (awaits ${fact.firstAwait ?? 'nothing'} first)`);
        }
      }
    }
    expect(late).toEqual([]);
  });

  it('has every gated action that takes a brand id hand it to the check, which refuses the demo brand', () => {
    const missing: string[] = [];
    let takers = 0;
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        const key = `${file}:${name}`;
        if (!fact.exported || key in OPEN_ACTIONS || !reach(facts, name).writes.length) continue;
        if (!fact.brandParam) continue;
        takers += 1;
        if (!fact.brandGate) missing.push(`${key} (takes ${fact.brandParam})`);
      }
    }
    expect(missing).toEqual([]);
    // The brand's own id under another name is still one it takes.
    for (const key of Object.keys(BRAND_ID_PARAMS)) {
      const [file, name] = key.split(':');
      const fact = actionFiles.find((a) => a.file === file)?.facts.get(name);
      expect(fact?.brandParam, key).toBe(BRAND_ID_PARAMS[key]);
    }
    // Sanity: the scan finds the actions that take a brand.
    expect(takers).toBeGreaterThan(40);
  });

  it("has no setup action run a function in its file whose check refuses setup's organization", () => {
    // A setup action is open to an organization that never subscribed; a
    // plain assertWritable() it runs on the way would refuse that one.
    const refused: string[] = [];
    for (const { file, facts } of actionFiles) {
      for (const [name, fact] of facts) {
        if (!fact.onboardingGate) continue;
        const seen = new Set([name]);
        const walk = (callee: string) => {
          if (seen.has(callee)) return;
          seen.add(callee);
          const called = facts.get(callee)!;
          if (called.strictGate) refused.push(`${file}:${name} → ${callee}`);
          called.callees.forEach(walk);
        };
        fact.callees.forEach(walk);
      }
    }
    expect(refused).toEqual([]);
  });

  it('has every write route check the plan, or name why it stays open', () => {
    const ungated: string[] = [];
    const handlers = new Set<string>();
    for (const path of routeFiles(API_DIR)) {
      const route = relative(API_DIR, path).replace(/\/route\.ts$/, '');
      const facts = readFunctions(path, readRpcs, ROUTE_GATES);
      for (const [name, fact] of facts) {
        if (!fact.exported || !WRITE_METHODS.has(name)) continue;
        const key = `${route}:${name}`;
        handlers.add(key);
        if (!(key in OPEN_ROUTES) && !reach(facts, name).gated) ungated.push(key);
      }
    }
    expect(ungated).toEqual([]);
    expect(Object.keys(OPEN_ROUTES).filter((key) => !handlers.has(key))).toEqual([]);
  });
});
