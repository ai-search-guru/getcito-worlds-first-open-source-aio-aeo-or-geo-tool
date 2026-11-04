/**
 * A page's own content, for the Content Editor to optimize (CE-003: Optimize
 * content › Page URL): its main text without the site's frame, its title,
 * and its schema JSON-LD. The editor cleans it again, as it does a paste;
 * this only picks what belongs to the page.
 *
 * Many pages have no <main> or <article> (Webflow, page builders), and the
 * ones that do often keep an author box, share buttons or related posts in
 * it. So the text is found where the page's paragraphs are, the root is the
 * part of the page holding it and its H1, and the furniture around the text
 * is taken out: blocks named for it (author, share, related…), blocks that
 * are mostly links (breadcrumbs, a table of contents, icon rows, post
 * lists), bylines ("8 min read"), and avatars, logos, icons and cover
 * images. A page builder's copy of a block for another screen size (Framer
 * prints one per breakpoint and its CSS shows one) is taken out first, and
 * any block saying just what the one before it says goes last.
 */

import * as cheerio from 'cheerio';
import { compile } from 'css-select';

/** The most HTML a page brings into a draft, as the editor's body limit. */
export const MAX_CONTENT_LENGTH = 500_000;

/** The most JSON-LD kept, and the most characters each. */
const MAX_JSON_LD = 5;
const MAX_JSON_LD_LENGTH = 50_000;

/** Where a page's own content usually is, the most telling first. */
const MAIN_SELECTORS = ['main', 'article', '[role="main"]', '#content', '#main'];

/**
 * A block named #main or #content holding this much of the page's text is
 * an app's root (Framer's #main is the whole site), no sign of the content.
 */
const APP_ROOT_SHARE = 0.95;

/**
 * The screen width a page is read at: a page builder (Framer) puts a copy of
 * a block in the page for each breakpoint and its CSS shows one, so the
 * copies hidden on this screen are taken out.
 */
const DESKTOP_WIDTH = 1440;

/** The site's frame, and what can't be content. */
const FRAME =
  'script, style, noscript, template, iframe, object, embed, form, button, input, select, textarea, svg, canvas, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .w-condition-invisible';

/**
 * What the page hides, taken out around the text only: a collapsed FAQ
 * answer ships hidden, and it is just the text an AEO page needs. A block
 * hidden until found (the browser's search opens it) is never taken out.
 */
const HIDDEN =
  '[hidden]:not([hidden="until-found"]), [style*="display:none"], [style*="display: none"]';

/**
 * All a page hides from its reader, for a reader that keeps nothing hidden
 * (Chat's fetch_page, `dropHidden`): what the browser hides, what only a
 * screen reader reads, an FAQ's collapsed answers too.
 */
const ALL_HIDDEN =
  '[hidden], [aria-hidden="true"], .sr-only, .visually-hidden, .screen-reader-text';
/**
 * Classes that hide a block (Tailwind's, Bootstrap's): unless a class on
 * it shows it again on a wider screen (`hidden md:block`, `d-none
 * d-lg-block`, `invisible md:visible`), which a desktop reader sees.
 */
const HIDDEN_CLASSES = '.hidden, .d-none, .invisible';
const SHOWN_CLASS =
  /^(?:(?:sm|md|lg|xl|2xl):(?:block|flex|grid|inline|inline-block|inline-flex|inline-grid|table|contents|visible)|d-(?:sm|md|lg|xl|xxl)-(?:block|flex|grid|inline|inline-block|inline-flex|table)|visible)$/;
/**
 * Styles that hide text from a reader: gone, see-through, zero-sized,
 * off-screen or clipped. A property's own name only: `margin-left`,
 * `background-clip: text` (a gradient heading) show what they style.
 */
const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)|font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|%|pt)?\s*(?:;|!|$)|(?<![\w-])(?:left|top|text-indent)\s*:\s*-\d{3,}|(?<![\w-])clip\s*:\s*rect/i;

/** Whether a class hides the block for every screen: none of its others shows it again. */
const hiddenByClass = ($, el) =>
  !String($(el).attr('class') ?? '')
    .split(/\s+/)
    .some((name) => SHOWN_CLASS.test(name));

/** The blocks a text reads apart: a space after each, so their words don't run together. */
const TEXT_BLOCKS = new Set([
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'div',
  'section',
  'article',
  'blockquote',
  'pre',
  'td',
  'th',
  'dt',
  'dd',
  'br',
  'figcaption',
  'tr',
  'ul',
  'ol',
  'table',
]);

const BLOCK_END = Symbol('block end');

/** Elements whose text is code, not words a reader sees: never read as text. */
const NOT_WORDS = new Set(['script', 'style']);

/**
 * An element's words, each block apart, in one walk (no recursion: a deep
 * page is fine). A script's or a style's code isn't words.
 */
export function plainTextOf(root) {
  const parts = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === BLOCK_END) {
      parts.push(' ');
    } else if (node.type === 'text') {
      parts.push(node.data);
    } else if (isElement(node) && NOT_WORDS.has(node.name)) {
      // Its code, skipped.
    } else if (node.children) {
      if (isElement(node) && TEXT_BLOCKS.has(node.name)) stack.push(BLOCK_END);
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
  }
  return clean(parts.join(''));
}

/**
 * The blocks under `root` that hide their words from a reader (ALL_HIDDEN,
 * HIDDEN_CLASSES, HIDDEN_STYLE): what `dropHidden` removes, and what a
 * reader for a model checks apart (pageOpen.js).
 */
export function hiddenBlocksIn($, root) {
  return [
    ...findIn($, root, ALL_HIDDEN).toArray(),
    ...findIn($, root, HIDDEN_CLASSES)
      .toArray()
      .filter((el) => hiddenByClass($, el)),
    ...findIn($, root, '[style]')
      .toArray()
      .filter((el) => HIDDEN_STYLE.test($(el).attr('style') ?? '')),
  ];
}

/**
 * A question an accordion's hidden answer follows: an FAQ beside the text
 * (after the post, in the page's main block) keeps its answers too.
 */
const QUESTION = new Set(['h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * Words in a block's class or id that name furniture: anywhere, even in the
 * text (an author box or share buttons in the article)…
 */
const FURNITURE_WORDS = new Set([
  'ad',
  'ads',
  'advert',
  'author',
  'authors',
  'avatar',
  'bio',
  'breadcrumb',
  'breadcrumbs',
  'byline',
  'comment',
  'comments',
  'consent',
  'cookie',
  'modal',
  'newsletter',
  'popup',
  'recommended',
  'related',
  'share',
  'sharing',
  'social',
  'sponsor',
  'sponsored',
  'subscribe',
  'toc',
]);

/** …and outside the text only, as the article's own call to action is its text. */
const PAGE_FURNITURE_WORDS = new Set([
  ...FURNITURE_WORDS,
  'announcement',
  'cta',
  'footer',
  'header',
  'menu',
  'meta',
  'nav',
  'navbar',
  'pager',
  'pagination',
  'promo',
  'sidebar',
  'signup',
  'tag',
  'tags',
  'widget',
]);

/**
 * Words in an image's (or its block's) class or id that mark it as no part
 * of the text: anywhere…
 */
const IMAGE_FURNITURE_WORDS = new Set([
  'author',
  'avatar',
  'badge',
  'emoji',
  'gravatar',
  'icon',
  'logo',
  'profile',
  'sprite',
]);

/**
 * …and outside the text, the post's cover. ("cover" itself is no sign:
 * Tailwind's object-cover is on any picture.)
 */
const PAGE_IMAGE_FURNITURE_WORDS = new Set([
  ...IMAGE_FURNITURE_WORDS,
  'featured',
  'hero',
  'thumb',
  'thumbnail',
]);

/** A line about the post rather than of it. */
const BYLINE =
  /\b\d+\s*(?:min|mins|minute|minutes)\s+read\b|\breading time\b|\blast updated\b|\bupdated on\b|\bpublished (?:on|by)\b|\bposted (?:on|by)\b|\bwritten by\b/i;

/** Paragraphs shorter than this don't say where the text is. */
const MIN_PARAGRAPH = 25;
/** The text area holds at least this share of the page's paragraph text. */
const TEXT_AREA_SHARE = 0.6;
/** A furniture block is never this big a share of the root's text. */
const MAX_FURNITURE_SHARE = 0.5;
/**
 * Outside the text, a block with at most this much text besides its links
 * is furniture (breadcrumbs, icon rows, a few related posts), as is a
 * table of contents (links within the page) …
 */
const MAX_LINK_LIST_TEXT = 50;
/**
 * … but a list going to this many pages, or a long block mostly of links,
 * is the page's own (a category's products) and is kept whole.
 */
const MIN_LIST_TARGETS = 8;
const MAX_LINK_LIST = 600;
const LIST_LINK_SHARE = 0.3;
/** A byline is a short line. */
const MAX_BYLINE = 200;
/** Images this small (width or height, in pixels) are icons. */
const MAX_ICON_SIZE = 64;

function clean(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** A class and id, as lower-case words: "authorBox ans-trk__i" → author, box, ans, trk, i. */
function nameWords(className, id) {
  return `${className ?? ''} ${id ?? ''}`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A block's class, id and Framer layer name ("Avatar with text"), as lower-case words. */
function wordsOf($el) {
  return nameWords(
    `${$el.attr('class') ?? ''} ${$el.attr('data-framer-name') ?? ''}`,
    $el.attr('id'),
  );
}

/** An element's class and id, as lower-case words, from its attributes. */
export function classIdWords(attribs = {}) {
  return nameWords(attribs.class, attribs.id);
}

/**
 * Whether an element's class or id names furniture anywhere on a page
 * (author box, share buttons, related posts, ads…), from its attributes:
 * the Action Center's page checks read a page's words without it.
 */
export function furnitureNamed(attribs = {}) {
  return classIdWords(attribs).some((word) => FURNITURE_WORDS.has(word));
}

function named($el, words) {
  return wordsOf($el).some((word) => words.has(word));
}

/*
 * A page is read in time that grows with its length, whatever its shape.
 * cheerio's find and remove don't: find sorts an element's children out again
 * and remove searches its siblings, each in time that grows with the square
 * of their number, and asking each element about every block above it grows
 * with the page's length times its depth. So elements are found from the
 * element itself, removed siblings together, and each block above asked once.
 */

const isElement = (node) =>
  node?.type === 'tag' || node?.type === 'script' || node?.type === 'style';

const matchers = new Map();

/**
 * The elements under `el` matching `selector`, in page order, as
 * `$(el).find(selector)` gives them for these selectors, which have no
 * combinators: each element is tested once against the selector, compiled
 * once.
 */
function findIn($, el, selector) {
  if (!matchers.has(selector)) matchers.set(selector, compile(selector));
  const matches = matchers.get(selector);
  const found = [];
  const stack = [...(el.children ?? [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isElement(node)) continue;
    if (matches(node)) found.push(node);
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return $(found);
}

/** Takes the nodes out of the page, as cheerio's remove does, each parent's in one pass. */
function removeAll(nodes) {
  const byParent = new Map();
  for (const node of nodes) {
    if (!node.parent) continue;
    if (!byParent.has(node.parent)) byParent.set(node.parent, new Set());
    byParent.get(node.parent).add(node);
  }
  for (const [parent, gone] of byParent) {
    relink(
      parent,
      parent.children.filter((child) => !gone.has(child)),
    );
    for (const node of gone) {
      node.parent = null;
      node.prev = null;
      node.next = null;
    }
  }
}

/**
 * Puts each element's contents in its place, in page order, as
 * `$(el).replaceWith($(el).contents())` one after another does. The deepest
 * parents go first, so one inside another lands where the outer one was.
 */
function unwrapAll(elements) {
  const byParent = new Map();
  for (const el of elements) {
    if (!el.parent) continue;
    if (!byParent.has(el.parent)) byParent.set(el.parent, new Set());
    byParent.get(el.parent).add(el);
  }
  // A parent inside an unwrapped element comes after it in page order.
  for (const [parent, unwrapped] of [...byParent].reverse()) {
    relink(
      parent,
      parent.children.flatMap((child) => (unwrapped.has(child) ? child.children : [child])),
    );
  }
  for (const el of elements) {
    el.children = [];
    el.parent = null;
    el.prev = null;
    el.next = null;
  }
}

/** A parent's new children, linked to it and to each other. */
function relink(parent, children) {
  children.forEach((child, i) => {
    child.parent = parent;
    child.prev = children[i - 1] ?? null;
    child.next = children[i + 1] ?? null;
  });
  parent.children = children;
}

/**
 * Whether an element or a block above it, below `stop`, passes `test`: the
 * blocks asked once each, across calls.
 */
function upward(test, stop = null) {
  const seen = new Map();
  return (start) => {
    const path = [];
    let found = false;
    for (let node = start; isElement(node) && node !== stop; node = node.parent) {
      if (seen.has(node)) {
        found = seen.get(node);
        break;
      }
      path.push(node);
      if (test(node)) {
        found = true;
        break;
      }
    }
    for (const node of path) seen.set(node, found);
    return found;
  };
}

/** Whether `node` is `block` or inside it. */
function inside(node, block) {
  for (let el = node; el; el = el.parent) if (el === block) return true;
  return false;
}

/**
 * What a block's judging reads of it, each element counted once, children
 * first: its text's length, with a space where its blocks meet ("Ada" "8 min
 * read" → "Ada 8 min read") and each element's own text before its
 * children's; the text itself while it's short; and its links. Read for
 * every block of a deep page, it stays linear in the page. The page mustn't
 * change while it's read.
 */
function blockReader() {
  const blocks = new Map();
  const read = (start) => {
    const stack = [[start, false]];
    while (stack.length > 0) {
      const [node, ready] = stack.pop();
      if (blocks.has(node)) continue;
      const children = node.children ?? [];
      if (!ready) {
        stack.push([node, true]);
        for (const child of children) {
          if (isElement(child) && !blocks.has(child)) stack.push([child, false]);
        }
        continue;
      }
      const own = clean(
        children
          .filter((child) => child.type === 'text')
          .map((child) => child.data)
          .join(' '),
      );
      const block = {
        own,
        length: own.length,
        parts: own ? 1 : 0,
        links: 0,
        linkText: 0,
        inPage: 0,
        pictures: node.name === 'img' ? 1 : 0,
        hrefs: new Set(),
      };
      for (const child of children) {
        if (!isElement(child)) continue;
        const sub = blocks.get(child);
        if (sub.length) {
          block.length += sub.length;
          block.parts += 1;
        }
        if (child.name === 'a') {
          const href = child.attribs?.href ?? '';
          block.links += 1;
          block.linkText += sub.length;
          if (href.startsWith('#')) block.inPage += 1;
          if (block.hrefs.size < MIN_LIST_TARGETS) block.hrefs.add(href);
        }
        block.links += sub.links;
        block.linkText += sub.linkText;
        block.inPage += sub.inPage;
        block.pictures += sub.pictures;
        for (const href of sub.hrefs) {
          if (block.hrefs.size >= MIN_LIST_TARGETS) break;
          block.hrefs.add(href);
        }
      }
      // A space between each part with words.
      block.length += Math.max(0, block.parts - 1);
      blocks.set(node, block);
    }
    return blocks.get(start);
  };
  const texts = new Map();
  /** The block's text when it's at most `max` long, else null. */
  const shortText = (el, max) => {
    if (read(el).length > max) return null;
    if (!texts.has(el)) {
      const parts = blocks.get(el).own ? [blocks.get(el).own] : [];
      for (const child of el.children ?? []) {
        if (isElement(child) && blocks.get(child).length) parts.push(shortText(child, max));
      }
      texts.set(el, parts.join(' '));
    }
    return texts.get(el);
  };
  return { read, shortText };
}

/**
 * Where the page's text is: paragraphs score their block and, half, the one
 * above it (as reader modes do), and the text area is the best block,
 * widened until it holds most of the page's paragraph text. Null when the
 * page has no paragraphs to go by.
 */
function findTextArea($, body) {
  const scores = new Map();
  let total = 0;
  // An author's bio or a comment is no sign of where the text is, nor is
  // what the page hides: the text is where its visible paragraphs are, and
  // a hidden answer inside it stays (HIDDEN).
  const hidden = new Set($(HIDDEN).toArray());
  const hiddenHere = upward((node) => hidden.has(node));
  const furnitureHere = upward((node) => named($(node), PAGE_FURNITURE_WORDS));
  const counted = new Map();
  for (const el of findIn($, body[0], 'p, pre, blockquote, li').toArray()) {
    const text = clean($(el).text());
    if (text.length >= MIN_PARAGRAPH && !hiddenHere(el) && !furnitureHere(el.parent)) {
      counted.set(el, text);
    }
  }
  for (const [el, text] of counted) {
    const length = text.length;
    total += length;
    const score = 1 + (text.match(/,/g)?.length ?? 0) + Math.min(3, Math.floor(length / 100));
    const parent = el.parent;
    if (!parent || parent.type !== 'tag') continue;
    scores.set(parent, (scores.get(parent) ?? 0) + score);
    const grandparent = parent.parent;
    if (grandparent && grandparent.type === 'tag') {
      scores.set(grandparent, (scores.get(grandparent) ?? 0) + score / 2);
    }
  }
  let best = null;
  for (const [el, score] of scores) {
    if (!best || score > best.score) best = { el, score };
  }
  if (!best) return null;

  // The blocks the area may widen to, the best one first, short of the body;
  // each counted paragraph's text is on the first of them it's inside.
  const steps = [best.el];
  for (let el = best.el; el.parent?.type === 'tag' && el.parent !== body[0]; el = el.parent) {
    steps.push(el.parent);
  }
  const stepOf = new Map(steps.map((el, i) => [el, i]));
  const seen = new Map();
  const firstStepAbove = (start) => {
    const path = [];
    let step;
    for (let node = start; isElement(node); node = node.parent) {
      if (seen.has(node)) {
        step = seen.get(node);
        break;
      }
      path.push(node);
      if (stepOf.has(node)) {
        step = stepOf.get(node);
        break;
      }
    }
    for (const node of path) seen.set(node, step);
    return step;
  };
  const within = steps.map(() => 0);
  for (const [el, text] of counted) {
    const step = firstStepAbove(el.parent);
    if (step !== undefined) within[step] += text.length;
  }
  let step = 0;
  let text = within[0];
  while (text < total * TEXT_AREA_SHARE && step < steps.length - 1) {
    step += 1;
    text += within[step];
  }
  return steps[step];
}

/** The closest block holding both elements. */
function commonAncestor($, a, b) {
  const above = new Set([a, ...$(a).parents().toArray()]);
  let el = b;
  while (el && !above.has(el)) el = el.parent;
  return el;
}

/**
 * Whether a media query holds on a DESKTOP_WIDTH screen: one of its
 * comma-separated queries does, each part a screen type or a min/max width.
 * A part it can't read ("print", an orientation) holds nowhere.
 */
export function onDesktop(query) {
  return query.split(',').some((alternative) =>
    alternative
      .toLowerCase()
      .split(/\band\b/)
      .map((part) => part.trim())
      .every((part) => {
        if (/^(?:only\s+)?(?:screen|all)$/.test(part)) return true;
        const width = /^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)\s*\)$/.exec(part);
        if (!width) return false;
        const px = Number(width[2]) * (width[3] === 'px' ? 1 : 16);
        return width[1] === 'min' ? DESKTOP_WIDTH >= px : DESKTOP_WIDTH <= px;
      }),
  );
}

/**
 * The classes a page's own CSS hides on a desktop screen: rules of only
 * class selectors and display:none, inside a media query that holds there.
 * Read in one pass however the CSS is written.
 */
export function classesHiddenOnDesktop(css) {
  const hidden = new Set();
  for (let at = css.indexOf('@media'); at !== -1;) {
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 1;
    let end = open + 1;
    for (; end < css.length && depth > 0; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') depth -= 1;
    }
    if (onDesktop(css.slice(at + '@media'.length, open))) {
      for (const rule of css.slice(open + 1, end - 1).split('}')) {
        const brace = rule.indexOf('{');
        if (brace === -1) continue;
        const selectors = rule
          .slice(0, brace)
          .split(',')
          .map((selector) => selector.trim());
        const declaration = rule
          .slice(brace + 1)
          .replace(/\s+/g, '')
          .replace(/;$/, '')
          .toLowerCase();
        if (
          (declaration === 'display:none' || declaration === 'display:none!important') &&
          selectors.every((selector) => /^\.[a-z_-][\w-]*$/i.test(selector))
        ) {
          for (const selector of selectors) hidden.add(selector.slice(1));
        }
      }
    }
    at = css.indexOf('@media', end);
  }
  return hidden;
}

/**
 * What a block says, its words and pictures, for telling a copy: null when
 * it says nothing (a spacer). Its words are read only when it has some.
 */
function signatureOf($, el, length) {
  const pictures = [...(el.name === 'img' ? [el] : []), ...findIn($, el, 'img').toArray()].map(
    (img) => pictureOf(img.attribs?.src ?? ''),
  );
  const text = length > 0 ? clean($(el).text()) : '';
  return text || pictures.some(Boolean) ? `${text}|${pictures.join(' ')}` : null;
}

/**
 * A picture's address for telling a copy: a builder's copies ask for the
 * same image file in other sizes (`a.png?scale-down-to=512`), so a file's
 * query is left out; an address that is a script's (`/_next/image?url=…`,
 * `image.php?id=…`) names its picture in the query, and is kept whole.
 */
function pictureOf(src) {
  const [path] = src.split('?');
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path) ? path : src;
}

/** The blocks a run of copies is looked for in: not a list's items or a table's cells. */
const REPEATABLE = new Set([
  'div',
  'section',
  'figure',
  'picture',
  'img',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
]);

/**
 * Each block saying the same as the block of its tag right before it, at
 * any depth: a copy the page shows on another screen, or a builder's
 * leftover. Only blocks of the same length are read in full, so a page is
 * read about once. When the copy holds the text or its title (`kept`), the
 * block before it goes instead.
 */
function repeatedBlocks($, root, kept) {
  const { read } = blockReader();
  const signatures = new Map();
  const signature = (el) => {
    if (!signatures.has(el)) signatures.set(el, signatureOf($, el, read(el).length));
    return signatures.get(el);
  };
  const repeats = [];
  const stack = [root];
  while (stack.length > 0) {
    const parent = stack.pop();
    let before = null;
    for (const child of parent.children ?? []) {
      if (!isElement(child)) continue;
      // Read in full only when their text and their pictures count the same
      // and aren't nothing: such a block inside another such block holds at
      // most half of its text and pictures, so the page is read only as many
      // times as it can be halved.
      if (
        before?.name === child.name &&
        REPEATABLE.has(child.name) &&
        read(child).length === read(before).length &&
        read(child).pictures === read(before).pictures &&
        read(child).length + read(child).pictures > 0 &&
        signature(child) !== null &&
        signature(child) === signature(before)
      ) {
        if (!kept.has(child)) {
          repeats.push(child);
          continue;
        }
        repeats.push(before);
      }
      before = child;
      stack.push(child);
    }
  }
  return repeats;
}

/*
 * The tag passes below read each '<' once, left to right, and give what the
 * regex each names would, in time near the text's length however its tags
 * are left open.
 */

/** ASCII letters lower-cased, nothing else: every index stays where it was. */
const asciiLower = (text) => text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** A letter, digit or _, as \b reads a word. */
const isWordChar = (code) =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  code === 95;

/** Each script and style element as a space: /<(script|style)\b[\s\S]*?<\/\1>/gi. */
function withoutScripts(text) {
  const lower = asciiLower(text);
  // A name with no closing tag left closes nowhere after it either.
  const open = new Set(['script', 'style']);
  let out = '';
  let kept = 0;
  for (let at = lower.indexOf('<'); at !== -1 && open.size;) {
    const name = [...open].find((tag) => lower.startsWith(tag, at + 1));
    const after = name ? at + 1 + name.length : 0;
    if (name && !isWordChar(lower.charCodeAt(after))) {
      const close = lower.indexOf(`</${name}>`, after);
      if (close !== -1) {
        out += `${text.slice(kept, at)} `;
        kept = close + name.length + 3;
        at = lower.indexOf('<', kept);
        continue;
      }
      open.delete(name);
    }
    at = lower.indexOf('<', at + 1);
  }
  return out + text.slice(kept);
}

const SPACED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'td',
  'th',
  'blockquote',
  'br',
  'div',
]);

/** Each block tag, opening or closing, as a space: /<\/?(p|h[1-6]|li|td|th|blockquote|br|div)\b[^>]*>/gi. */
function withoutBlockTags(text) {
  const lower = asciiLower(text);
  let out = '';
  let kept = 0;
  for (let at = lower.indexOf('<'); at !== -1;) {
    const from = lower[at + 1] === '/' ? at + 2 : at + 1;
    let end = from;
    while (isWordChar(lower.charCodeAt(end))) end += 1;
    if (SPACED_TAGS.has(lower.slice(from, end))) {
      const close = lower.indexOf('>', end);
      // No '>' left: no tag after this one ends either.
      if (close === -1) break;
      out += `${text.slice(kept, at)} `;
      kept = close + 1;
      at = lower.indexOf('<', kept);
      continue;
    }
    // The word holds no '<': the next tag starts after it.
    at = lower.indexOf('<', Math.max(at + 1, end));
  }
  return out + text.slice(kept);
}

/** Every other tag dropped: /<[^>]*>/g. */
function withoutTags(text) {
  let out = '';
  let kept = 0;
  for (let at = text.indexOf('<'); at !== -1;) {
    const close = text.indexOf('>', at + 1);
    if (close === -1) break;
    out += text.slice(kept, at);
    kept = close + 1;
    at = text.indexOf('<', kept);
  }
  return out + text.slice(kept);
}

/**
 * The page's text length as the Rules tab counts it (pageTextLength in
 * frontend/src/lib/content/rules.ts): a space between blocks, an entity as one
 * character, runs of spaces as one.
 */
export function textLength(html) {
  return withoutTags(withoutBlockTags(withoutScripts(String(html ?? ''))))
    .replace(/&nbsp;/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * @param {string} html the page as fetched
 * @param {string} pageUrl the page's address after redirects, for its links
 * @param {{ $?: import('cheerio').CheerioAPI, dropHidden?: boolean, withText?: boolean }} [opts]
 *   `$`: the page already parsed, read once by a caller that reads it too
 *   (it is changed: the frame and furniture go). `dropHidden`: all the page
 *   hides goes first, with no FAQ answers kept (a reader for a model).
 *   `withText`: the content's words too.
 * @returns {{ title: string, html: string, text?: string }} html: the content,
 *   then its JSON-LD scripts; text (withText): its words, each block apart
 */
export function extractPageContent(
  html,
  pageUrl,
  { $: parsed, dropHidden = false, withText = false } = {},
) {
  const $ = parsed ?? cheerio.load(html);

  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text && text.length <= MAX_JSON_LD_LENGTH)
    .slice(0, MAX_JSON_LD);

  // The copies a desktop screen doesn't show, by the page's own CSS, go
  // before anything is read: the text, its title and its pictures once.
  const desktopHidden = classesHiddenOnDesktop(
    $('style')
      .map((_, el) => $(el).text())
      .get()
      .join('\n'),
  );
  if (desktopHidden.size > 0) {
    removeAll(
      findIn($, $.root()[0], '[class]')
        .toArray()
        .filter((el) => el.attribs.class.split(/\s+/).some((name) => desktopHidden.has(name))),
    );
  }

  // The H1s with words, and the page's order, before the frame goes: an
  // article's title often sits in its own <header>.
  const order = new Map(
    $('*')
      .toArray()
      .map((el, i) => [el, i]),
  );
  const worded = $('h1')
    .toArray()
    .filter((el) => clean($(el).text()));

  const body = $('body');
  removeAll(findIn($, body[0], FRAME).toArray());
  if (dropHidden) removeAll(hiddenBlocksIn($, body[0]));

  // The root: the page's main block when it holds the text; else the part
  // of the page holding the text and its H1; else the text area alone.
  const textArea = findTextArea($, body);
  // What the page hides goes, outside the text. An answer right after its
  // question waits for the root: in it, it's an FAQ's (QUESTION).
  const answers = [];
  const hiddenGone = [];
  for (const el of findIn($, body[0], HIDDEN).toArray()) {
    if (textArea && (inside(el, textArea) || inside(textArea, el))) continue;
    if (QUESTION.has($(el).prev()[0]?.name)) answers.push(el);
    else hiddenGone.push(el);
  }
  removeAll(hiddenGone);
  // The title's H1, picked once: the last one with words before the text's
  // first paragraph (not a logo's or a site name's above it), else the first.
  // A byline, date or breadcrumb line above the title is no paragraph of it.
  const furnitureInArea = upward((block) => named($(block), PAGE_FURNITURE_WORDS), textArea);
  const lead = textArea
    ? findIn($, textArea, 'p, li, pre, blockquote')
        .toArray()
        .find((el) => clean($(el).text()).length >= MIN_PARAGRAPH && !furnitureInArea(el))
    : null;
  const titleH1 =
    (lead && worded.filter((el) => order.get(el) < order.get(lead)).at(-1)) || worded[0] || null;
  const title =
    clean(titleH1 ? $(titleH1).text() : '') ||
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').first().text());
  // Still on the page (not in a header that went with the frame).
  const heading = titleH1 && $(titleH1).closest('body').length > 0 ? titleH1 : null;
  // Each block's text read once, however many app roots nest.
  const measured = blockReader();
  const appRoot = (el) => {
    if (el.name === 'main' || el.name === 'article' || el.attribs.role === 'main') return false;
    return measured.read(el).length >= measured.read(body[0]).length * APP_ROOT_SHARE;
  };
  const main = MAIN_SELECTORS.map((selector) => $(selector).toArray())
    .flat()
    .find((el) => (!textArea || inside(textArea, el)) && !appRoot(el));
  const root = main
    ? $(main)
    : textArea
      ? $(heading ? commonAncestor($, heading, textArea) : textArea)
      : body;
  removeAll(answers.filter((el) => !inside(el, root[0])));

  // What stays whatever its name: the text area, the blocks around it and
  // the H1's.
  const kept = new Set();
  for (const el of [textArea, heading]) {
    if (!el) continue;
    kept.add(el);
    for (const parent of $(el).parents().toArray()) kept.add(parent);
  }
  const rootLength = clean(root.text()).length;

  // 'remove' for furniture; 'list' for a long list of links outside the
  // text (a category's products), kept and read as the text is.
  const blocks = blockReader();
  const judge = (el, inContent) => {
    const $el = $(el);
    const block = blocks.read(el);
    const toc = `${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`
      .toLowerCase()
      .includes('table-of-contents');
    if (
      (named($el, inContent ? FURNITURE_WORDS : PAGE_FURNITURE_WORDS) || toc) &&
      block.length < rootLength * MAX_FURNITURE_SHARE
    ) {
      return 'remove';
    }
    // In the text, lists of links and short lines are its own; a page with
    // no paragraphs to go by keeps them too.
    if (!textArea || inContent) return null;
    // Its links: the ones inside it, or itself when it's one.
    const links = el.name === 'a' ? 1 : block.links;
    if (links >= 2) {
      // A table of contents: links within the page.
      if (block.inPage * 2 > links) return 'remove';
      if (
        block.hrefs.size >= MIN_LIST_TARGETS ||
        (block.length > MAX_LINK_LIST && block.linkText >= block.length * LIST_LINK_SHARE)
      ) {
        return 'list';
      }
      if (block.length - block.linkText <= MAX_LINK_LIST_TEXT) return 'remove';
    }
    const text = blocks.shortText(el, MAX_BYLINE);
    return text !== null && BYLINE.test(text) ? 'remove' : null;
  };
  const lists = new Set();
  const stripped = [];
  const strip = (parent, inContent) => {
    $(parent)
      .children()
      .each((_, el) => {
        const content = inContent || el === textArea;
        if (kept.has(el)) {
          strip(el, content);
          return;
        }
        const verdict = judge(el, content);
        if (verdict === 'remove') {
          stripped.push(el);
        } else if (verdict === 'list') {
          lists.add(el);
          strip(el, true);
        } else {
          strip(el, content);
        }
      });
  };
  strip(root[0], root[0] === textArea);
  removeAll(stripped);

  // Avatars, logos, icons and cover images aren't the text's; a list's
  // pictures (its products) are its own.
  const inTextArea = upward((node) => node === textArea, root[0]);
  const inList = upward((node) => lists.has(node), root[0]);
  const markedFor = (words) => upward((node) => !kept.has(node) && named($(node), words), root[0]);
  const markedInText = markedFor(IMAGE_FURNITURE_WORDS);
  const markedOnPage = markedFor(PAGE_IMAGE_FURNITURE_WORDS);
  const images = [];
  for (const el of findIn($, root[0], 'img').toArray()) {
    const $el = $(el);
    const small = ['width', 'height'].some((side) => {
      const size = Number($el.attr(side));
      return Number.isFinite(size) && size > 0 && size <= MAX_ICON_SIZE;
    });
    // In the text when the root is the text area itself, as strip has it.
    const inText = textArea && (root[0] === textArea || inTextArea(el.parent));
    // Its own name or its block's, not the text's or the H1's wrappers.
    const marked = !inList(el.parent) && (inText ? markedInText : markedOnPage)(el);
    if (small || marked) images.push(el);
  }
  removeAll(images);

  // Links and images keep working outside the page: relative addresses
  // become absolute; anything else the editor's cleaning decides on.
  for (const el of findIn($, root[0], 'a[href]').toArray()) {
    const href = $(el).attr('href');
    try {
      $(el).attr('href', new URL(href, pageUrl).toString());
    } catch {
      $(el).removeAttr('href');
    }
  }
  const unaddressed = [];
  for (const el of findIn($, root[0], 'img[src]').toArray()) {
    try {
      $(el).attr('src', new URL($(el).attr('src'), pageUrl).toString());
    } catch {
      unaddressed.push(el);
    }
  }
  removeAll(unaddressed);
  removeAll(repeatedBlocks($, root[0], kept));

  // One H1 per page, its title: any other becomes an H2, and one without
  // words (a logo) is no heading.
  const wordless = [];
  for (const el of findIn($, root[0], 'h1').toArray()) {
    if (el === heading) continue;
    if (!clean($(el).text())) wordless.push(el);
    else el.name = 'h2';
  }
  unwrapAll(wordless);
  let content = (root.html() ?? '').trim();
  // A title above the content (a hero outside <main>) heads it, as the
  // draft's title is its first heading.
  if (title && findIn($, root[0], 'h1').length === 0) {
    content = `<h1>${$('<i>').text(title).html()}</h1>${content}`;
  }
  const schema = jsonLd
    .map((text) => `<script type="application/ld+json">${text.replace(/</g, '\\u003c')}</script>`)
    .join('');
  return {
    title,
    html: `${content}${schema}`,
    ...(withText ? { text: plainTextOf(root[0]) } : {}),
  };
}
