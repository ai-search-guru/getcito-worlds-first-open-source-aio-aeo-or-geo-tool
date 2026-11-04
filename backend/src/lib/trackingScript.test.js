import { runInNewContext } from 'vm';
import { describe, expect, it } from 'vitest';
import {
  AI_SOURCES,
  AI_SOURCES_VERSION,
  classifyAiSource,
  classifyAiSurface,
  landingMedium,
} from './aiSources.js';
import { buildTrackingScript } from './trackingScript.js';
import { eventRow } from './trafficEvents.js';

/**
 * The tracking snippet (AT-004) counts what the AI source list counts, the
 * same way the Google Analytics sync does, and sends the source's key and the
 * list version. Run here in a stand-in browser.
 */

const SCRIPT = buildTrackingScript();

/**
 * Runs t.js on a page, then lets the page go on: `then` changes it after the
 * script ran (a single-page app setting its title), and pending timers run.
 * Returns the visit's beacon (or null), every beacon it sent, its timers and
 * a way to fire the page's events.
 */
function run({
  referrer = '',
  search = '',
  alreadyTracked = false,
  title = 'Menu · Acme Coffee',
  navigation,
  readyState = 'complete',
  then,
  runTimers = true,
} = {}) {
  const sent = [];
  const timers = [];
  const listeners = {};
  const on = (scope) => (type, fn) => (listeners[`${scope}:${type}`] ||= []).push(fn);
  const fire = (key) => (listeners[key] || []).forEach((fn) => fn());
  const window = alreadyTracked ? { __at: 1 } : {};
  window.addEventListener = on('window');
  const document = {
    title,
    referrer,
    readyState,
    visibilityState: 'visible',
    addEventListener: on('document'),
    currentScript: {
      src: 'https://api.getcito.test/t.js',
      getAttribute: (name) => (name === 'data-t' ? 'abcdef123' : null),
    },
  };
  const location = { href: `https://acme.example/menu${search}`, search };
  runInNewContext(SCRIPT, {
    window,
    // A browser without the navigation entry (older Safari) has none.
    ...(navigation === undefined
      ? {}
      : { performance: { getEntriesByType: () => (navigation ? [navigation] : []) } }),
    document,
    location,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    navigator: {
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      sendBeacon: (url, blob) => sent.push({ url, blob }),
    },
    screen: { width: 1440, height: 900 },
    URL,
    URLSearchParams,
    Blob: class {
      constructor(parts) {
        this.text = parts.join('');
      }
    },
    JSON,
    Date,
    String,
  });
  then?.({ document, location });
  if (runTimers) for (const timer of timers) timer.fn();
  // Read when asked, so a beacon sent after a later event or timer counts.
  const parse = () => sent.map((b) => ({ url: b.url, ...JSON.parse(b.blob.text) }));
  return {
    get beacon() {
      return parse()[0] ?? null;
    },
    get beacons() {
      return parse();
    },
    timers,
    fire,
  };
}

/** The beacon a visit sent, or null. */
const visit = (options) => run(options).beacon;

describe('the tracking snippet', () => {
  it("sends the source's key and the list version to the brand's beacon", () => {
    const beacon = visit({ referrer: 'https://chat.openai.com/c/123' });
    expect(beacon).toMatchObject({
      url: 'https://api.getcito.test/track/abcdef123',
      s: 'chatgpt.com',
      v: AI_SOURCES_VERSION,
      r: 'https://chat.openai.com/c/123',
      u: 'https://acme.example/menu',
    });
  });

  it('counts a subdomain, and engines the old snippet missed', () => {
    expect(visit({ referrer: 'https://m.perplexity.ai/' }).s).toBe('perplexity.ai');
    expect(visit({ referrer: 'https://grok.com/' }).s).toBe('grok.com');
    expect(visit({ referrer: 'https://chat.deepseek.com/' }).s).toBe('deepseek.com');
  });

  it('falls back to utm_source, matched the same way', () => {
    expect(
      visit({ referrer: 'https://www.google.com/', search: '?utm_source=chatgpt.com' }).s,
    ).toBe('chatgpt.com');
    expect(visit({ search: '?utm_source=Perplexity' }).s).toBe('perplexity.ai');
    // A name inside another tag isn't an engine.
    expect(visit({ search: '?utm_source=newsletter-chatgpt-tips' })).toBeNull();
  });

  // #1283: a ChatGPT Shopping product card opens the product's feed link.
  it('counts a ChatGPT Shopping product card as ChatGPT, sending the URL that says so', () => {
    const search = '?utm_source=chatgpt.com&utm_medium=feed';
    for (const referrer of ['', 'https://chatgpt.com/']) {
      const beacon = visit({ referrer, search });
      expect(beacon, referrer).toMatchObject({
        s: 'chatgpt.com',
        v: AI_SOURCES_VERSION,
        u: `https://acme.example/menu${search}`,
      });
      // The server reads the surface from that URL.
      expect(classifyAiSurface(beacon.s, landingMedium(beacon.u))).toBe('shopping');
    }
    // A ChatGPT answer's link: plain ChatGPT.
    const answer = visit({ search: '?utm_source=chatgpt.com' });
    expect(answer.s).toBe('chatgpt.com');
    expect(classifyAiSurface(answer.s, landingMedium(answer.u))).toBeNull();
  });

  it('counts Bing only from a Copilot answer link', () => {
    expect(visit({ referrer: 'https://www.bing.com/ck/a?!&&p=abc' }).s).toBe('bing.com');
    expect(visit({ referrer: 'https://www.bing.com/search?q=coffee' })).toBeNull();
    expect(visit({ search: '?utm_source=bing' })).toBeNull();
  });

  it('sends nothing for other traffic, or twice on one page', () => {
    expect(visit({ referrer: 'https://notchatgpt.com/' })).toBeNull();
    expect(visit({ referrer: 'https://example.com/' })).toBeNull();
    expect(visit({ referrer: 'https://chatgpt.com/', alreadyTracked: true })).toBeNull();
  });

  it("sends the landing page's status as the browser saw it (AT-012)", () => {
    const from = { referrer: 'https://chatgpt.com/' };
    expect(visit({ ...from, navigation: { responseStatus: 404 } })).toMatchObject({
      st: 404,
      nf: 0,
    });
    // A 2xx page that only mentions 404s is an ordinary page.
    expect(
      visit({ ...from, navigation: { responseStatus: 200 }, title: 'How we fixed our 404s' }),
    ).toMatchObject({ st: 200, nf: 0 });
    // Any other status says it all, whatever the title.
    expect(
      visit({ ...from, navigation: { responseStatus: 404 }, title: 'Page not found' }),
    ).toMatchObject({ st: 404, nf: 0 });
  });

  // gkhngyk on #1192: a single-page app answers 200 and shows its own
  // not-found route, so soft 404s were never seen.
  it("reads a 2xx page's title as a soft 404 only when it's the not-found page's own", () => {
    const ok = { referrer: 'https://chatgpt.com/', navigation: { responseStatus: 200 } };
    for (const title of [
      '404',
      '404 | Acme Coffee',
      '404 Not Found',
      'Page Not Found – Acme',
      'Acme Coffee - Page not found',
      'Error 404 · Acme',
    ]) {
      expect(visit({ ...ok, title }), title).toMatchObject({ st: 200, nf: 1 });
    }
    for (const title of ['Error 404 explained', 'Lost and not found | Books', 'Menu · Acme']) {
      expect(visit({ ...ok, title }), title).toMatchObject({ st: 200, nf: 0 });
    }
  });

  // gkhngyk on #1247: the visit's beacon waited for load on every page.
  it('sends the visit at once, and says so later when the app shows its not-found page', () => {
    const { beacons, timers } = run({
      referrer: 'https://chatgpt.com/',
      navigation: { responseStatus: 200 },
      title: 'Acme Coffee',
      // The app's router resolves the route and shows its not-found page.
      then: ({ document, location }) => {
        document.title = 'Page not found | Acme Coffee';
        location.href = 'https://acme.example/elsewhere';
      },
    });
    expect(timers.map((t) => t.ms)).toEqual([1500]);
    expect(beacons).toHaveLength(2);
    expect(beacons[0]).toMatchObject({ st: 200, nf: 0, u: 'https://acme.example/menu' });
    // The address the visit landed on, not where the app went since; a mark, not a visit.
    expect(beacons[1]).toEqual({
      url: 'https://api.getcito.test/track/abcdef123',
      k: 'nf',
      u: 'https://acme.example/menu',
      s: 'chatgpt.com',
      a: 'Mozilla/5.0',
      st: 200,
    });
  });

  it("doesn't wait for the page to load, and checks the title again only after it", () => {
    const loading = run({
      referrer: 'https://chatgpt.com/',
      navigation: { responseStatus: 200 },
      readyState: 'loading',
      runTimers: false,
    });
    expect(loading.beacons).toHaveLength(1);
    expect(loading.timers).toHaveLength(0);
    loading.fire('window:load');
    expect(loading.timers).toHaveLength(1);
    // The title still reads as a page: nothing more.
    loading.timers[0].fn();
    expect(loading.beacons).toHaveLength(1);

    // Nothing to check again: a 404, or a title that already said not found.
    expect(
      run({ referrer: 'https://chatgpt.com/', navigation: { responseStatus: 404 } }).timers,
    ).toHaveLength(0);
    expect(
      run({ referrer: 'https://chatgpt.com/', navigation: { responseStatus: 200 }, title: '404' })
        .timers,
    ).toHaveLength(0);
  });

  it('says whether the title reads "not found" when the browser gives no status', () => {
    const from = { referrer: 'https://chatgpt.com/' };
    // Safari: no responseStatus on the entry, or no entry at all.
    expect(visit({ ...from, navigation: {}, title: 'Page Not Found – Acme' })).toMatchObject({
      st: 0,
      nf: 1,
    });
    expect(visit({ ...from, title: '404 | Acme Coffee' })).toMatchObject({ st: 0, nf: 1 });
    expect(visit({ ...from, navigation: null, title: 'Error 404' })).toMatchObject({ nf: 1 });
    // Not a 404: a number that contains 404, or an ordinary page.
    expect(visit({ ...from, title: 'Order #14045 shipped' })).toMatchObject({ st: 0, nf: 0 });
    expect(visit({ ...from, title: 'Menu · Acme Coffee' })).toMatchObject({ st: 0, nf: 0 });
  });

  it('names every listed host and alias as the server does', () => {
    for (const source of AI_SOURCES) {
      for (const host of source.hosts) {
        const path = source.referrerPath ?? '/';
        expect(visit({ referrer: `https://${host}${path}` })?.s, host).toBe(classifyAiSource(host));
      }
      for (const alias of source.aliases) {
        expect(visit({ search: `?utm_source=${alias}` })?.s ?? null, alias).toBe(
          classifyAiSource(alias, { origin: 'utm' }),
        );
      }
    }
  });
});

/**
 * Runs t.js installed with conversions (data-c="1", CE-017) on a page of the
 * site: `stored` is what localStorage already holds, `dataLayer` Google's,
 * `queue` the site's calls made before t.js loaded. Returns the beacons, the
 * storage, and the page's window, document listeners and history to go on.
 */
function runWithConversions({
  referrer = '',
  path = '/pricing',
  consent = null,
  stored = null,
  dataLayer,
  queue,
  installed = true,
  crypto,
  storageThrows = false,
} = {}) {
  const sent = [];
  let sendsFail = false;
  const storage = new Map(stored ? [['getcito_v', JSON.stringify(stored)]] : []);
  const listeners = {};
  const on = (scope) => (type, fn) => (listeners[`${scope}:${type}`] ||= []).push(fn);
  const window = { addEventListener: on('window') };
  if (dataLayer) window.dataLayer = dataLayer;
  if (queue) window.getcito = { q: queue };
  const attributes = {
    'data-t': 'abcdef123',
    ...(installed ? { 'data-c': '1' } : {}),
    ...(consent ? { 'data-consent': consent } : {}),
  };
  const location = {
    origin: 'https://acme.example',
    pathname: path,
    href: `https://acme.example${path}?email=ann@example.com`,
    search: '?email=ann@example.com',
  };
  const history = { pushState: (state, title, url) => (location.pathname = url) };
  window.history = history;
  const context = {
    window,
    document: {
      title: 'Acme',
      referrer,
      readyState: 'complete',
      addEventListener: on('document'),
      currentScript: {
        src: 'https://api.getcito.test/t.js',
        getAttribute: (name) => attributes[name] ?? null,
      },
    },
    location,
    history,
    localStorage: storageThrows
      ? {
          getItem: () => {
            throw new Error('SecurityError');
          },
          setItem: () => {
            throw new Error('QuotaExceededError');
          },
          removeItem: () => {
            throw new Error('SecurityError');
          },
        }
      : {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, String(value)),
          removeItem: (key) => storage.delete(key),
        },
    ...(crypto ? { crypto } : {}),
    setTimeout: () => {},
    navigator: {
      userAgent: 'Mozilla/5.0',
      language: 'en-US',
      sendBeacon: (url, blob) => {
        if (sendsFail) throw new Error('beacon failed');
        sent.push({ url, blob });
      },
    },
    screen: { width: 1440, height: 900 },
    URL,
    URLSearchParams,
    Blob: class {
      constructor(parts) {
        this.text = parts.join('');
      }
    },
    JSON,
    Date,
    String,
  };
  runInNewContext(SCRIPT, context);
  return {
    get beacons() {
      return sent.map((b) => JSON.parse(b.blob.text));
    },
    get stored() {
      return storage.has('getcito_v') ? JSON.parse(storage.get('getcito_v')) : null;
    },
    window,
    history,
    storage,
    submit: (form) => (listeners['document:submit'] || []).forEach((fn) => fn({ target: form })),
    listeners,
    location,
    failSends: () => {
      sendsFail = true;
    },
    popstate: () => (listeners['window:popstate'] || []).forEach((fn) => fn()),
  };
}

/** A form as the submit listener reads it: its attributes and the inputs it has. */
const form = (attributes = {}, inputs = ['email']) => ({
  tagName: 'FORM',
  // An input named "id" shadows the property: the snippet reads the attribute.
  id: { tagName: 'INPUT' },
  getAttribute: (name) => attributes[name] ?? null,
  // An input matches [attr=value] by its value, [attr*=value] by part of it.
  querySelector: (selector) =>
    [...selector.matchAll(/(\*?)=([\w-]+)\]/g)].some(([, part, value]) =>
      inputs.some((input) => (part ? input.includes(value) : input === value)),
    )
      ? {}
      : null,
});

const DAY = 24 * 60 * 60 * 1000;
const earlier = (days, extra = {}) => ({
  id: 'Vq3xT0mZ8kLp2RwYbN5sQa',
  f: { s: 'chatgpt.com', u: 'https://acme.example/blog/crm', at: Date.now() - days * DAY },
  ...extra,
});

describe('the tracking snippet with conversions (CE-017)', () => {
  it('keeps nothing in the browser and sends nothing new without data-c', () => {
    const page = runWithConversions({
      referrer: 'https://chatgpt.com/',
      installed: false,
      consent: 'always',
    });
    expect(page.beacons).toHaveLength(1);
    expect(page.stored).toBeNull();
    expect(page.window.getcito).toBeUndefined();
    // Other traffic, as ever: nothing at all.
    expect(runWithConversions({ installed: false }).beacons).toEqual([]);
  });

  it('keeps an AI visitor’s id only once the site says they agreed, and sends what waited then', () => {
    const page = runWithConversions({ referrer: 'https://chatgpt.com/', path: '/blog/crm' });
    // The visit goes as ever; the id waits.
    expect(page.beacons).toHaveLength(1);
    expect(page.stored).toBeNull();
    page.window.getcito('conversion', { type: 'newsletter' });
    expect(page.beacons).toHaveLength(1);

    page.window.getcito('consent', 'granted');
    expect(page.stored).toMatchObject({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      f: { s: 'chatgpt.com', u: 'https://acme.example/blog/crm' },
    });
    expect(page.beacons[1]).toMatchObject({
      k: 'cv',
      g: 'newsletter',
      o: 'call',
      id: page.stored.id,
      f: page.stored.f,
      // Never the query string.
      u: 'https://acme.example/blog/crm',
    });
  });

  it('keeps it at once with data-consent="always", and takes it back when the visitor says no', () => {
    const page = runWithConversions({ referrer: 'https://perplexity.ai/', consent: 'always' });
    expect(page.stored.f.s).toBe('perplexity.ai');
    page.window.getcito('consent', 'denied');
    expect(page.stored).toBeNull();
    page.window.getcito('conversion', { type: 'signup' });
    expect(page.beacons).toHaveLength(1);
  });

  it('follows Google Consent Mode: a grant keeps the id, an update that takes it back deletes it', () => {
    const dataLayer = [['consent', 'default', { analytics_storage: 'denied' }]];
    const page = runWithConversions({ referrer: 'https://chatgpt.com/', dataLayer });
    expect(page.stored).toBeNull();
    dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.stored).not.toBeNull();
    dataLayer.push(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(page.stored).toBeNull();
  });

  it('sends the pages an AI visitor goes on to, single-page app routes too, without repeats', () => {
    const stored = earlier(2);
    const page = runWithConversions({ stored, consent: 'always' });
    expect(page.beacons).toEqual([
      {
        k: 'pv',
        id: 'Vq3xT0mZ8kLp2RwYbN5sQa',
        f: stored.f,
        u: 'https://acme.example/pricing',
      },
    ]);
    page.history.pushState({}, '', '/demo');
    page.popstate();
    expect(page.beacons.map((b) => b.u)).toEqual([
      'https://acme.example/pricing',
      'https://acme.example/demo',
    ]);
  });

  it('credits the first AI visit: a later one keeps it; past 30 days a new journey starts', () => {
    const again = runWithConversions({
      referrer: 'https://gemini.google.com/',
      stored: earlier(3),
      consent: 'always',
    });
    expect(again.stored.f.s).toBe('chatgpt.com');
    // This landing is a page of the journey too.
    expect(again.beacons.map((b) => b.k ?? 'visit')).toEqual(['visit', 'pv']);

    const later = runWithConversions({
      referrer: 'https://gemini.google.com/',
      stored: earlier(31),
      consent: 'always',
    });
    expect(later.stored.f.s).toBe('gemini.google.com');
    expect(later.stored.id).not.toBe('Vq3xT0mZ8kLp2RwYbN5sQa');
    // Not from an AI assistant, and the journey is over: nothing.
    expect(runWithConversions({ stored: earlier(31), consent: 'always' }).beacons).toEqual([]);
  });

  it('counts a form with an email field as a signup, unless it says otherwise or opts out', () => {
    const page = runWithConversions({ stored: earlier(1), consent: 'always' });
    page.submit(form({ id: 'trial' }));
    page.submit(form({ 'data-getcito-goal': 'demo', name: 'book-a-demo' }, ['email', 'text']));
    page.submit(form({ 'data-getcito': 'off' }));
    // A login, a search box: not conversions.
    page.submit(form({}, ['email', 'password']));
    page.submit(form({}, ['search']));
    expect(page.beacons.filter((b) => b.k === 'cv')).toEqual([
      expect.objectContaining({ g: 'signup', o: 'form', n: 'trial' }),
      expect.objectContaining({ g: 'demo', o: 'form', n: 'book-a-demo' }),
    ]);
  });

  it('runs the calls the site made before t.js loaded, and reads an order’s value and units', () => {
    const queue = [
      ['consent', 'granted'],
      ['conversion', { type: 'order', value: 129.5, currency: 'EUR', units: 2, order: 1001 }],
      ['conversion', { type: 'trial_to_paid' }],
    ];
    const page = runWithConversions({ referrer: 'https://chatgpt.com/', queue });
    expect(page.beacons.filter((b) => b.k === 'cv')).toEqual([
      expect.objectContaining({ g: 'order', val: 129.5, cur: 'EUR', q: 2, ref: '1001' }),
      // A type of the site's own: a custom goal named after it.
      expect.objectContaining({ g: 'custom', n: 'trial_to_paid' }),
    ]);
  });

  it('sends events the server stores as they are (trafficEvents.js)', () => {
    const page = runWithConversions({ stored: earlier(1), consent: 'always' });
    page.window.getcito('conversion', { type: 'demo', label: 'pricing-demo' });
    const [pageview, conversion] = page.beacons.map((beacon) => eventRow('b1', beacon));
    expect(pageview).toMatchObject({ kind: 'page', url: 'https://acme.example/pricing' });
    expect(conversion).toMatchObject({
      kind: 'conversion',
      goal: 'demo',
      label: 'pricing-demo',
      origin: 'call',
      first_source: 'chatgpt.com',
    });
  });

  it('waits for the visitor’s own choice when Consent Mode’s default names a region', () => {
    // Google's own example: denied in the EU, granted elsewhere — this visitor may be in the EU.
    const dataLayer = [
      ['consent', 'default', { analytics_storage: 'denied', region: ['DE', 'FR'] }],
      ['consent', 'default', { analytics_storage: 'granted' }],
    ];
    const page = runWithConversions({ referrer: 'https://chatgpt.com/', dataLayer });
    page.window.getcito('conversion', { type: 'signup' });
    expect(page.stored).toBeNull();
    expect(page.beacons).toHaveLength(1);
    // The visitor says yes: the id is kept and what waited goes.
    dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.stored).not.toBeNull();
    expect(page.beacons.map((b) => b.k ?? 'visit')).toEqual(['visit', 'cv']);
  });

  it('never takes a default pushed after t.js as consent: only the visitor’s update grants', () => {
    // A CMP or GTM's Consent Initialization tag that runs after t.js, with Google's regional example.
    const page = runWithConversions({ referrer: 'https://chatgpt.com/' });
    page.window.dataLayer.push([
      'consent',
      'default',
      { analytics_storage: 'denied', region: ['DE'] },
    ]);
    page.window.dataLayer.push(['consent', 'default', { analytics_storage: 'granted' }]);
    page.window.getcito('conversion', { type: 'signup' });
    expect(page.stored).toBeNull();
    expect(page.beacons).toHaveLength(1);
  });

  it('pauses a returning visitor whose page denies by default, regional defaults or not', () => {
    const dataLayer = [
      ['consent', 'default', { analytics_storage: 'granted', region: ['US'] }],
      ['consent', 'default', { analytics_storage: 'denied' }],
    ];
    const page = runWithConversions({ stored: earlier(1), dataLayer });
    expect(page.beacons).toEqual([]);
    dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.beacons.map((b) => b.k)).toEqual(['pv']);
  });

  it('takes a "denied" the site queued before t.js before keeping or sending anything', () => {
    const page = runWithConversions({
      stored: earlier(1),
      consent: 'always',
      queue: [['consent', 'denied']],
    });
    expect(page.beacons).toEqual([]);
    expect(page.stored).toBeNull();
  });

  it('keeps the AI landing through a "denied" the visitor takes back: the grant keeps it and sends what waited', () => {
    const dataLayer = [];
    const page = runWithConversions({ referrer: 'https://chatgpt.com/', dataLayer });
    // A banner pushing the visitor's state before they choose.
    dataLayer.push(['consent', 'update', { analytics_storage: 'denied' }]);
    expect(page.stored).toBeNull();
    page.window.getcito('conversion', { type: 'demo' });
    dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.stored.f.s).toBe('chatgpt.com');
    expect(page.beacons.filter((b) => b.k === 'cv')).toMatchObject([
      { g: 'demo', f: { s: 'chatgpt.com' } },
    ]);
    // The site's call says no again: the stored id goes, what waited too.
    page.window.getcito('consent', 'denied');
    expect(page.stored).toBeNull();
  });

  it('runs the queued consent calls first: a "denied" queued after a conversion still comes first', () => {
    const page = runWithConversions({
      stored: earlier(1),
      queue: [
        ['conversion', { type: 'demo' }],
        ['consent', 'denied'],
      ],
    });
    expect(page.beacons).toEqual([]);
    expect(page.stored).toBeNull();
  });

  it('adds no hooks for a visitor it doesn’t follow: no dataLayer, push, route or form hook', () => {
    const page = runWithConversions({ referrer: '', consent: 'always' });
    const pushState = page.history.pushState;
    expect(page.window.dataLayer).toBeUndefined();
    expect(page.window.history.pushState).toBe(pushState);
    expect(page.listeners['document:submit']).toBeUndefined();
    expect(page.listeners['window:popstate']).toBeUndefined();
    // The site's calls still find getcito() and do nothing.
    page.window.getcito('conversion', { type: 'signup' });
    page.window.getcito('consent', 'granted');
    expect(page.beacons).toEqual([]);
    expect(page.stored).toBeNull();
  });

  it('never stops the site’s own push or route change when its own part fails', () => {
    const page = runWithConversions({ stored: earlier(1) });
    page.failSends();
    expect(() => page.window.history.pushState({}, '', '/checkout')).not.toThrow();
    expect(page.location.pathname).toBe('/checkout');
    expect(() => page.popstate()).not.toThrow();
    // A grant sending what waited, with the beacon failing: the push still goes in.
    const dataLayer = [];
    const landing = runWithConversions({ referrer: 'https://chatgpt.com/', dataLayer });
    landing.window.getcito('conversion', { type: 'demo' });
    landing.failSends();
    expect(() =>
      dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]),
    ).not.toThrow();
    expect(dataLayer).toHaveLength(1);
  });

  it('takes an id kept earlier as the visitor’s consent then, on the pages after', () => {
    const page = runWithConversions({ stored: earlier(1) });
    page.window.getcito('conversion', { type: 'demo' });
    expect(page.beacons.map((b) => b.k)).toEqual(['pv', 'cv']);
  });

  it('pauses an "always" site whose Consent Mode default denies it, until it’s granted', () => {
    const dataLayer = [['consent', 'default', { analytics_storage: 'denied' }]];
    const page = runWithConversions({
      referrer: 'https://chatgpt.com/',
      consent: 'always',
      dataLayer,
    });
    expect(page.stored).toBeNull();
    page.window.getcito('conversion', { type: 'order', value: 10, currency: 'USD' });
    expect(page.beacons).toHaveLength(1);
    dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.beacons[1]).toMatchObject({ k: 'cv', g: 'order', val: 10 });
  });

  it('listens to Consent Mode on a page whose dataLayer isn’t there yet', () => {
    const page = runWithConversions({ referrer: 'https://chatgpt.com/' });
    page.window.dataLayer.push(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(page.stored).not.toBeNull();
  });

  it('sends a value, units and an order only as the server takes them', () => {
    const page = runWithConversions({ stored: earlier(1), consent: 'always' });
    page.window.getcito('conversion', {
      type: 'order',
      value: Number.NaN,
      units: 1.5,
      currency: 'EUR',
    });
    page.window.getcito('conversion', {
      type: 'order',
      value: '49.90',
      units: 2,
      order: 'x'.repeat(300),
    });
    page.window.getcito('conversion', 'demo');
    const [nan, text, short] = page.beacons.filter((b) => b.k === 'cv');
    expect(nan).not.toHaveProperty('val');
    expect(nan).not.toHaveProperty('q');
    expect(text).toMatchObject({ val: 49.9, q: 2 });
    expect(text.ref).toHaveLength(200);
    expect(short).toMatchObject({ g: 'demo' });
    // Each makes a row (or, past the server's own limits, still none that fails).
    expect(eventRow('b1', nan)).not.toBeNull();
    expect(eventRow('b1', short)).not.toBeNull();
  });

  it('counts a form once a page, a signup with a new password, and an email field by its name', () => {
    const page = runWithConversions({ stored: earlier(1), consent: 'always' });
    const trial = form({ id: 'trial' });
    page.submit(trial);
    page.submit(trial);
    page.submit(form({ name: 'join' }, ['email', 'password', 'new-password']));
    page.submit(form({ name: 'subscribe' }, ['email-field']));
    expect(page.beacons.filter((b) => b.k === 'cv').map((b) => b.n)).toEqual([
      'trial',
      'join',
      'subscribe',
    ]);
  });

  it('makes the id from crypto where there is one, and deletes one past its 30 days', () => {
    const crypto = { getRandomValues: (bytes) => bytes.fill(1) };
    const page = runWithConversions({
      referrer: 'https://chatgpt.com/',
      consent: 'always',
      crypto,
    });
    expect(page.stored.id).toBe('B'.repeat(22));
    const expired = runWithConversions({ stored: earlier(31) });
    expect(expired.storage.has('getcito_v')).toBe(false);
  });

  it('still sends the visit, and breaks nothing, where storage throws', () => {
    const page = runWithConversions({
      referrer: 'https://chatgpt.com/',
      consent: 'always',
      storageThrows: true,
    });
    page.window.getcito('conversion', { type: 'signup' });
    expect(page.beacons.map((b) => b.k ?? 'visit')).toEqual(['visit', 'cv']);
  });

  it('sends nothing for a visitor who never came from an AI assistant', () => {
    const page = runWithConversions({ consent: 'always' });
    page.window.getcito('conversion', { type: 'signup' });
    page.submit(form({ id: 'trial' }));
    expect(page.beacons).toEqual([]);
    expect(page.stored).toBeNull();
  });
});
