/**
 * Brewline's pages as HTML (demo-site), for Site Audit to read: the demo's
 * audits are the real audit engine's verdicts on these pages, so a score,
 * a signal and its evidence are what the live product would show for them.
 *
 * A page is rendered as it stood in one audit round: a fix named in its
 * `since` (siteWorld.js) is on the page from that round on, so later
 * audits score higher. Links go only to Brewline's pages and the demo's
 * fictional publishers; no image is ever loaded (an <img> has an address on
 * brewline.example that nothing fetches).
 */

import { BRAND } from './brewline.js';
import { AUTHORS, CATALOG, FOOTER_LINKS, SITE_URL, pageUrl } from './siteWorld.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const esc = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ld = (data) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...data })}</script>`;

/** Whether a fix is on the page in this round. */
const has = (page, fix, round) => round >= (page.since?.[fix] ?? 0);

const productOf = (id) => CATALOG.find((p) => p.id === id);

/** A product's variants as [label, price, availability, sale price]. */
export function variantsOf(product) {
  if (product.sizes) return product.sizes;
  if (product.bags) return product.bags;
  return [[null, product.price]];
}

const money = (amount) => `$${amount.toFixed(2)}`;
const fromPrice = (product) => Math.min(...variantsOf(product).map(([, price]) => price));

/** The product page's description: its opening, then the rest. */
export function productDescription(product, { opening = true } = {}) {
  const coffee = product.type.startsWith('Coffee');
  const sizes = variantsOf(product)
    .map(([label]) => label)
    .filter(Boolean);
  const lead = coffee
    ? `Whole bean ${product.roast} roast coffee with notes of ${product.notes}, in ${sizes.join(' and ')} bags, roasted to order.`
    : product.type === 'Subscriptions'
      ? `A coffee subscription of ${product.notes}, delivered weekly, every two weeks or monthly in ${sizes.join(' or ')} a delivery.`
      : `${product.title}: ${product.notes}.`;
  const fluff =
    'Meet your new favorite cup. Some coffees just make the morning better, and this is one of them.';
  const rest = coffee
    ? `We roast ${product.title} in small batches and ship it within 24 hours, so it arrives at its best.${product.process ? ` Process: ${product.process}.` : ''}`
    : 'Every order ships within 24 hours of roasting, and subscriptions can be paused or skipped anytime.';
  return opening ? `${lead} ${rest}` : `${fluff} ${lead} ${rest}`;
}

function head(page, { url, round, jsonLd }) {
  const meta = [];
  const description = has(page, 'metaDescription', round) ? page.description : null;
  if (description) meta.push(`<meta name="description" content="${esc(description)}">`);
  meta.push(
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:type" content="${page.kind === 'article' ? 'article' : 'website'}">`,
    `<meta property="og:url" content="${url}">`,
  );
  if (description) meta.push(`<meta property="og:description" content="${esc(description)}">`);
  if (has(page, 'ogImage', round)) {
    meta.push(`<meta property="og:image" content="${SITE_URL}/share/brewline-card.png">`);
  }
  if (has(page, 'twitterCard', round)) {
    meta.push(
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${SITE_URL}/share/brewline-card.png">`,
    );
  }
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
${meta.join('\n')}
<link rel="canonical" href="${url}">
${jsonLd.map(ld).join('\n')}
</head>`;
}

const NAV = [
  ['/subscriptions', 'Subscriptions'],
  ['/collections/single-origin', 'Single origin'],
  ['/collections/blends', 'Blends'],
  ['/collections/espresso', 'Espresso'],
  ['/collections/decaf', 'Decaf'],
  ['/gifts', 'Gifts'],
  ['/blog', 'Guides'],
];

const header = () =>
  `<header><a href="${SITE_URL}/">${BRAND.name}</a><nav>${NAV.map(
    ([path, label]) => `<a href="${pageUrl(path)}">${label}</a>`,
  ).join(' ')}</nav></header>`;

const footer = () =>
  `<footer><nav>${FOOTER_LINKS.map(
    ([path, label]) => `<a href="${pageUrl(path)}">${label}</a>`,
  ).join(' ')}</nav><p>&copy; ${BRAND.name}</p></footer>`;

function sectionHtml(section) {
  const parts = [`<h2>${esc(section.h2)}</h2>`];
  for (const p of section.p ?? []) parts.push(`<p>${esc(p)}</p>`);
  if (section.list) {
    parts.push(`<ul>${section.list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`);
  }
  if (section.table) {
    parts.push(
      `<table><thead><tr>${section.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${section.table.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`,
    );
  }
  return `<section>${parts.join('\n')}</section>`;
}

const faqHtml = (faq) =>
  `<section><h2>Frequently asked questions</h2>${faq
    .map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`)
    .join('\n')}</section>`;

const faqLd = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});

const productCard = (product) =>
  `<li><a href="${pageUrl(product.path)}">${esc(product.title)}</a>: ${esc(product.notes)}, from ${money(fromPrice(product))}</li>`;

function productJsonLd(product, url, description) {
  return {
    '@type': 'Product',
    name: product.title,
    description,
    brand: { '@type': 'Brand', name: BRAND.name },
    sku: product.id,
    url,
    offers: variantsOf(product).map(([label, price, availability]) => ({
      '@type': 'Offer',
      name: label ?? product.title,
      price: price.toFixed(2),
      priceCurrency: 'USD',
      availability:
        availability === 'out of stock'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
    })),
  };
}

function productBody(page, product, round) {
  const opening = has(page, 'descriptionOpening', round);
  const variants = variantsOf(product);
  const parts = [
    `<h1>${esc(page.h1)}</h1>`,
    `<p itemprop="description">${esc(productDescription(product, { opening }))}</p>`,
    `<ul>${variants
      .map(
        ([label, price, availability, sale]) =>
          `<li>${esc(label ?? product.title)}: ${sale ? `${money(sale)} (regular ${money(price)})` : money(price)}${availability ? `, ${availability}` : ''}</li>`,
      )
      .join('')}</ul>`,
  ];
  if (product.type.startsWith('Coffee')) {
    parts.push(
      sectionHtml({
        h2: 'Details',
        list: [
          `Roast: ${product.roast}`,
          `Tasting notes: ${product.notes}`,
          ...(product.process ? [`Process: ${product.process}`] : []),
          'Ships within 24 hours of roasting',
        ],
      }),
      sectionHtml({
        h2: 'How to brew it',
        p: [
          'For pour-over, use 15 grams of coffee to 250 grams of water at 94 degrees Celsius. For espresso, start at 18 grams in and 36 grams out.',
        ],
      }),
    );
  } else {
    parts.push(
      sectionHtml({
        h2: 'How it works',
        list: [
          'Choose weekly, every two weeks or monthly deliveries',
          'Pick whole beans or a grind for your brewer',
          'Pause, skip or cancel anytime',
        ],
      }),
    );
  }
  parts.push(
    `<p><a href="${pageUrl('/subscriptions')}">See all subscriptions</a> or <a href="${pageUrl('/collections/single-origin')}">browse single origins</a>.</p>`,
  );
  if (page.faq) parts.push(faqHtml(page.faq));
  return parts.join('\n');
}

function articleBody(page, round, now) {
  const author = AUTHORS.find((a) => a.key === page.author);
  const published = new Date(now - page.published * DAY_MS).toISOString().slice(0, 10);
  const modified = new Date(now - page.modified * DAY_MS).toISOString().slice(0, 10);
  const parts = [`<h1>${esc(page.h1)}</h1>`];
  if (!page.noByline) {
    parts.push(
      `<p class="byline">By <a rel="author" href="${pageUrl(author.path)}">${esc(author.name)}</a>, ${esc(author.role)}. Updated <time datetime="${modified}">${modified}</time></p>`,
    );
  }
  parts.push(`<p>${esc(page.intro)}</p>`);
  for (const section of page.sections) parts.push(sectionHtml(section));
  if (page.quote && has(page, 'quote', round)) {
    parts.push(
      `<blockquote><p>${esc(page.quote[0])}</p><cite>${esc(page.quote[1])}</cite></blockquote>`,
    );
  }
  if (page.links) {
    parts.push(
      `<p>Further reading: ${page.links.map(([href, text]) => `<a href="${href}">${esc(text)}</a>`).join(', ')}.</p>`,
    );
  }
  if (page.faq) parts.push(faqHtml(page.faq));
  if (!page.noByline) {
    parts.push(`<aside><h2>About the author</h2><p>${esc(author.bio)}</p></aside>`);
  }
  return {
    body: parts.join('\n'),
    jsonLd: {
      '@type': 'BlogPosting',
      headline: page.h1,
      ...(page.noByline ? {} : { author: { '@type': 'Person', name: author.name } }),
      publisher: { '@type': 'Organization', name: BRAND.name },
      datePublished: published,
      dateModified: modified,
    },
  };
}

const ORGANIZATION = {
  '@type': 'Organization',
  name: BRAND.name,
  url: SITE_URL,
  email: 'hello@brewline.example',
  foundingDate: '2016',
};

/**
 * One audited page's HTML as it stood in audit round `round`.
 *
 * @param {object} page an AUDITED_PAGES entry
 * @param {{ round: number, now: number }} at the round, and when the audit ran (ms)
 */
export function pageHtml(page, { round, now }) {
  const url = pageUrl(page.path);
  const jsonLd = [];
  let body;
  const { h1 } = page;

  if (page.kind === 'product') {
    const product = productOf(page.product);
    body = productBody(page, product, round);
    if (has(page, 'productJsonLd', round)) {
      const opening = has(page, 'descriptionOpening', round);
      jsonLd.push(productJsonLd(product, url, productDescription(product, { opening })));
    }
  } else if (page.kind === 'article') {
    const article = articleBody(page, round, now);
    body = article.body;
    jsonLd.push(article.jsonLd);
  } else {
    const parts = [`<h1>${esc(h1)}</h1>`, `<p>${esc(page.intro)}</p>`];
    for (const section of page.sections ?? []) parts.push(sectionHtml(section));
    if (page.products) {
      parts.push(`<ul>${page.products.map(productOf).map(productCard).join('')}</ul>`);
      jsonLd.push({
        '@type': 'CollectionPage',
        name: h1,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: page.products.map((id, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: pageUrl(productOf(id).path),
          })),
        },
      });
    }
    if (page.kind === 'contact') {
      parts.push(
        '<p>Email <a href="mailto:hello@brewline.example">hello@brewline.example</a>. Wholesale: <a href="mailto:wholesale@brewline.example">wholesale@brewline.example</a>.</p>',
      );
      jsonLd.push({ '@type': 'ContactPage', name: h1 });
    }
    if (page.kind === 'home' || page.kind === 'about') jsonLd.push(ORGANIZATION);
    if (page.kind === 'home') {
      jsonLd.push({ '@type': 'WebSite', name: BRAND.name, url: SITE_URL });
    }
    if (page.faq && page.kind !== 'faq') parts.push(faqHtml(page.faq));
    if (page.kind === 'faq') {
      parts.push(page.faq.map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('\n'));
    }
    body = parts.join('\n');
  }
  // FAQPage markup: on the FAQ page always, elsewhere once added.
  if (page.faq && (page.kind === 'faq' || has(page, 'faqSchema', round))) {
    jsonLd.push(faqLd(page.faq));
  }

  return `<!doctype html>
<html lang="en">
${head(page, { url, round, jsonLd })}
<body>
${header()}
<main>
${body}
</main>
${footer()}
</body>
</html>`;
}

/** Brewline's robots.txt: AI crawlers named and allowed. */
export const ROBOTS_TXT = `User-agent: *
Disallow: /cart
Disallow: /account

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

/** Brewline has no llms.txt yet: one of the gaps its audits show. */
export const LLMS_TXT = null;
