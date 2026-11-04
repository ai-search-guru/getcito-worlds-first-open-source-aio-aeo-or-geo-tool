import { describe, expect, it } from 'vitest';
import { classesHiddenOnDesktop, extractPageContent, onDesktop } from './pageContent.js';

/** A page brought into the Content Editor: its own content, not the site's frame. */

const PAGE = `<!doctype html><html><head>
  <title>Pricing | Northwind</title>
  <meta property="og:title" content="Northwind pricing">
  <script type="application/ld+json">{"@type":"Product","name":"Northwind <CRM>"}</script>
  <script>track()</script>
</head><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <h1>Plans for every team</h1>
    <p>Start <a href="/signup?plan=pro">free</a>, then <strong>scale</strong>.</p>
    <img src="/img/plans.png" alt="Plans">
    <form><input name="email"><button>Go</button></form>
    <aside>Related posts</aside>
  </main>
  <footer>© Northwind</footer>
</body></html>`;

describe('extractPageContent', () => {
  it('keeps the main content, without the site’s frame, forms or scripts', () => {
    const { title, html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(title).toBe('Plans for every team');
    expect(html).toContain('<h1>Plans for every team</h1>');
    expect(html).toContain('<strong>scale</strong>');
    for (const gone of ['Home', 'Related posts', '© Northwind', '<form', 'track()']) {
      expect(html).not.toContain(gone);
    }
  });

  it('makes links and images absolute, against the page’s address', () => {
    const { html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(html).toContain('href="https://northwind.example/signup?plan=pro"');
    expect(html).toContain('src="https://northwind.example/img/plans.png"');
  });

  it('keeps the schema JSON-LD after the content, safe inside its script', () => {
    const { html } = extractPageContent(PAGE, 'https://northwind.example/pricing');
    expect(
      html.endsWith(
        '<script type="application/ld+json">{"@type":"Product","name":"Northwind \\u003cCRM>"}</script>',
      ),
    ).toBe(true);
  });

  it('reads an article, or the body, when there is no <main>', () => {
    const article = extractPageContent(
      '<body><nav>Menu</nav><article><h2>Guide</h2><p>Steps</p></article></body>',
      'https://acme.example/guide',
    );
    // No H1 and no title anywhere: nothing to head it with.
    expect(article.html).toBe('<h2>Guide</h2><p>Steps</p>');
    const body = extractPageContent('<body><p>Just text</p></body>', 'https://acme.example/x');
    expect(body.html).toBe('<p>Just text</p>');
  });

  it('keeps one H1, its first, and makes the others H2s', () => {
    const { html } = extractPageContent(
      '<body><main><h1>AEO vs SEO</h1><p>Intro.</p><h1>Key takeaways</h1><p>Short.</p></main></body>',
      'https://acme.example/aeo',
    );
    expect(html).toBe('<h1>AEO vs SEO</h1><p>Intro.</p><h2>Key takeaways</h2><p>Short.</p>');
  });

  it('keeps the article’s H1, not a logo’s or a site name’s before it', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const logo = extractPageContent(
      `<body><div id="page"><div class="top"><h1><a href="/"><img alt="Acme" src="/logo.png"></a></h1></div><div class="content"><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></div></div></body>`,
      'https://acme.example/forecasting',
    );
    expect(logo.html).toContain('<h1>Pipeline forecasting</h1>');
    expect(logo.html.match(/<h1/g)).toHaveLength(1);

    const branding = extractPageContent(
      `<body><main><div class="site-branding"><h1>Acme</h1></div><article><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></article></main></body>`,
      'https://acme.example/forecasting',
    );
    expect(branding.html).toContain('<h2>Acme</h2>');
    expect(branding.html).toContain('<h1>Pipeline forecasting</h1>');
  });

  it('keeps an article’s H1 over a site name’s when a byline line comes first', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><div class="site-branding"><h1>Acme</h1></div><article><p class="entry-meta">Published on October 22, 2026 by Ada Lovelace</p><h1>Pipeline forecasting</h1><p>${lead}</p><p>${lead}</p></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html).toContain('<h1>Pipeline forecasting</h1>');
    expect(html).not.toContain('<h1>Acme</h1>');
  });

  it('keeps the title H1 of an article and makes a section H1 in its text an H2', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><header class="site"><h1><a href="/">Acme</a></h1></header><article><h1 class="entry-title">Pipeline forecasting</h1><div class="entry-content"><p>${lead}</p><h1>Why forecasts miss</h1><p>${lead}</p></div></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Pipeline forecasting<\/h1>/);
    expect(html).toContain('<h2>Why forecasts miss</h2>');
  });

  it('takes the title from an article’s own header, not the site’s logo H1', () => {
    const lead = 'Forecasts that sales leaders trust, built from real activity. '.repeat(6);
    const { title, html } = extractPageContent(
      `<body><header class="site"><h1><a href="/">Acme</a></h1></header><article><header class="entry-header"><h1 class="entry-title">Pipeline forecasting</h1></header><div class="entry-content"><p>${lead}</p><p>${lead}</p></div></article></body>`,
      'https://acme.example/forecasting',
    );
    expect(title).toBe('Pipeline forecasting');
    expect(html.startsWith('<h1>Pipeline forecasting</h1>')).toBe(true);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain('Acme');
  });

  it('heads the content with the page title when its H1 sits outside it', () => {
    const { html, title } = extractPageContent(
      '<head><title>Lisbon &amp; more</title></head><body><div class="hero"><h1>Lisbon &amp; Porto</h1></div><main><p>Days out.</p></main></body>',
      'https://travel.example/lisbon',
    );
    expect(title).toBe('Lisbon & Porto');
    expect(html).toBe('<h1>Lisbon &amp; Porto</h1><p>Days out.</p>');
  });

  it('takes an article’s author box, byline, share buttons, related posts and comments out', () => {
    const { html } = extractPageContent(
      `<body><main><article>
        <header class="entry-header"><h1>Cold brew at home</h1></header>
        <div class="entry-meta">By Ada · 5 min read</div>
        <div class="entry-content">
          <p>Cold brew takes time, coarse grounds and cold water, nothing more.</p>
          <img src="/img/jar.jpg" alt="A jar of cold brew">
          <p>Steep it for twelve to eighteen hours, then strain it twice.</p>
          <div class="sharedaddy sd-sharing"><a href="https://x.com/share">Share on X</a><a href="https://facebook.com/share">Share on Facebook</a></div>
        </div>
        <div class="author-box"><img class="avatar" src="/ada.jpg" alt="Ada" width="96"><p>Ada writes about coffee, slowly and with care.</p></div>
      </article>
      <section class="related-posts"><h3>Related</h3><a href="/espresso">Espresso basics</a><a href="/latte">Latte art</a></section>
      <div id="comments"><p>Great post, thanks for sharing the recipe with us!</p></div>
      </main></body>`,
      'https://coffee.example/cold-brew',
    );
    expect(html).toContain('<h1>Cold brew at home</h1>');
    expect(html).toContain('coarse grounds and cold water');
    expect(html).toContain('src="https://coffee.example/img/jar.jpg"');
    for (const gone of [
      '5 min read',
      'Share on',
      'Ada writes',
      'ada.jpg',
      'Espresso basics',
      'Great post',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('finds the text on a page with no <main>, and keeps its H1 and lead but not the furniture', () => {
    const { html } = extractPageContent(
      `<body>
        <div class="announcement-bar"><a href="/trial">Stop measuring. Start improving.</a></div>
        <div class="page-wrapper"><section class="blog-hero"><div class="container">
          <div class="hero-content">
            <div class="columns"><a href="/blog">← Explore all</a><a href="/blog/ai">AI Search</a></div>
            <div class="blog-tag">AI Search</div>
            <h1>AI search monitoring</h1>
            <div class="blog-intro-text">Run one shared prompt set on every engine each week, and report each one apart.</div>
            <div class="div-block-7"><div>Alex Morgan</div><img src="/eye.png" alt=""><div>8 min read</div><div>Last Updated:</div><div>October 21, 2026</div></div>
            <div class="blog-single-hero-img"><img class="all-img" src="/alex-morgan.jpg" alt="Alex"></div>
          </div>
          <div class="blog-details">
            <div class="blog-single-right">Explore with AI<a href="https://chatgpt.com/?q=x"><img src="/chatgpt.svg" alt="ChatGPT"></a><a href="https://claude.ai/new?q=x"><img src="/claude.svg" alt="Claude"></a>In this article<a href="#step-1">Step 1</a><a href="#step-2">Step 2</a></div>
            <div class="rich-text">
              <p>Many teams check ChatGPT one day, Google the next and Gemini when someone asks.</p>
              <figure><img src="/prompts.png" alt="The prompt list"></figure>
              <p>Record mentions, cited addresses and competitors, the same way every week.</p>
              <div class="ai-monitor-cta"><h2>How Example Analytics helps</h2><p>Our platform runs one prompt set across every engine and keeps every answer.</p></div>
              <div class="qoute-box"><img class="qoute-icon" src="/quote.svg" alt=""><p>Monitoring should explain why visibility changes, not only that it did.</p></div>
            </div>
          </div>
          <div class="author-box"><img src="/alex-morgan-small.jpg" alt="Alex"><h3>Alex Morgan</h3><p>Alex is an author at Example Analytics.</p></div>
          <div><a href="/blog">← Explore all</a><h3>Related Blog Posts</h3><a href="/blog/crawlers">How to check AI crawler access</a><a href="/blog/refresh">How to refresh content for AI search</a></div>
        </div></section>
        <section class="preferred-source"><p>Get more Example Analytics insights in Google, add us as a preferred source.</p><a href="https://google.com/preferences">Add Example Analytics</a></section>
        <div class="cta-footer"><p>Make your brand visible in AI answers, start a trial today.</p></div>
        </div>
      </body>`,
      'https://analytics.example/blog/ai-search-monitoring',
    );
    for (const kept of [
      '<h1>AI search monitoring</h1>',
      'Run one shared prompt set',
      'Many teams check ChatGPT',
      'src="https://analytics.example/prompts.png"',
      // The article's own call to action is its text.
      'How Example Analytics helps',
      'Monitoring should explain why',
    ]) {
      expect(html).toContain(kept);
    }
    for (const gone of [
      'Stop measuring',
      'Explore all',
      'blog-tag',
      '8 min read',
      'eye.png',
      'alex-morgan.jpg',
      'Explore with AI',
      'chatgpt.svg',
      'Step 1',
      'quote.svg',
      'Alex is an author',
      'Related Blog Posts',
      'preferred source',
      'start a trial today',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('keeps a category’s long list of products, with their pictures', () => {
    const products = Array.from(
      { length: 12 },
      (_, i) =>
        `<div class="product-card"><a href="/p/${i}"><img class="product-thumb" src="/p${i}.jpg" alt="Runner ${i}"></a><a href="/p/${i}">Wool Runner number ${i}</a><span>$98</span></div>`,
    ).join('');
    const { html } = extractPageContent(
      `<body><main><h1>Men’s shoes</h1>
        <div class="collection-description"><p>Sustainable, supportive and wildly comfortable sneakers, ready when you are.</p></div>
        <div class="product-grid">${products}</div>
      </main></body>`,
      'https://shoes.example/collections/men',
    );
    expect(html).toContain('Wool Runner number 11');
    expect(html).toContain('src="https://shoes.example/p11.jpg"');
    expect(html).toContain('wildly comfortable sneakers');
  });

  it('drops what the page hides and tiny icons, but never the text for its name', () => {
    const { html } = extractPageContent(
      `<body><main><h1>Dinner menu</h1>
        <div class="menu-items">
          <p>Grilled sea bass with lemon, capers and new potatoes, our house dish.</p>
          <p>Slow roasted lamb shoulder with rosemary, garlic and white beans.</p>
          <img src="/star.png" width="16" height="16" alt="">
          <img class="h-full w-full object-cover" src="/bass.jpg" alt="Sea bass">
        </div>
        <div class="w-condition-invisible"><p>No dishes are on the menu this evening, sorry.</p></div>
        <p hidden>Hidden note for the kitchen staff only.</p>
      </main></body>`,
      'https://bistro.example/menu',
    );
    expect(html).toContain('Grilled sea bass');
    expect(html).toContain('src="https://bistro.example/bass.jpg"');
    for (const gone of ['star.png', 'No dishes', 'Hidden note']) {
      expect(html).not.toContain(gone);
    }
  });

  it('keeps a collapsed FAQ answer in the text, and hides what is hidden around it', () => {
    const { html } = extractPageContent(
      `<body><div hidden class="mobile-menu"><p>Shop all our coffee subscriptions and gifts today.</p></div>
        <main><h1>Coffee subscription FAQ</h1>
        <div class="faq">
          <p>Answers to what customers ask most about deliveries, plans and pausing.</p>
          <h3>Can I pause my plan?</h3>
          <div hidden><p>Yes, pause or skip any delivery from your account, up to two days before it ships.</p></div>
          <h3>Do you ship abroad?</h3>
          <div hidden="until-found"><p>We ship to the EU and the UK, with tracked delivery in three to five days.</p></div>
          <h3>Is grinding free?</h3>
          <div style="display: none"><p>Grinding is free: pick whole bean, espresso, filter or French press.</p></div>
        </div>
      </main></body>`,
      'https://acme-coffee.example/faq',
    );
    for (const kept of ['pause or skip', 'We ship to the EU', 'Grinding is free']) {
      expect(html).toContain(kept);
    }
    expect(html).toContain('hidden="until-found"');
    expect(html).not.toContain('Shop all our coffee');
  });

  it('keeps a collapsed FAQ’s answers after the post body, and drops other hidden blocks beside it', () => {
    const { html } = extractPageContent(
      `<body><div hidden class="cookie-banner"><h2>Cookies</h2><p>We use cookies to improve your visit to our coffee shop.</p></div>
        <main><h1>How to brew pour-over coffee</h1>
        <div class="post-body">
          <p>Pour-over coffee tastes cleaner than a French press, with brighter notes.</p>
          <p>Start with a medium-fine grind and water just off the boil, around 94 °C.</p>
          <p>Pour in slow circles, and aim for a total brew time of about three minutes.</p>
        </div>
        <section class="faq">
          <h2>Frequently asked questions</h2>
          <h3>Do I need a gooseneck kettle?</h3>
          <div hidden><p>It helps you pour slowly, but any kettle works with a little practice.</p></div>
          <h3>Which filter should I use?</h3>
          <div style="display:none"><p>Paper filters give the cleanest cup; metal ones let more oils through.</p></div>
          <div hidden class="newsletter"><p>Sign up for our newsletter to get brewing tips every week.</p></div>
        </section>
      </main></body>`,
      'https://acme-coffee.example/pour-over',
    );
    for (const kept of [
      'Do I need a gooseneck kettle?',
      'any kettle works',
      'Which filter should I use?',
      'Paper filters give the cleanest cup',
    ]) {
      expect(html).toContain(kept);
    }
    for (const gone of ['We use cookies', 'Sign up for our newsletter']) {
      expect(html).not.toContain(gone);
    }
  });

  it('reads a Framer page once, as a desktop screen shows it, without the site around the post', () => {
    // Framer's #main is the whole site, and each breakpoint has its own copy
    // of a block, the others hidden by the page's CSS.
    const desktop = 'ssr-variant hidden-tab hidden-phone';
    const tablet = 'ssr-variant hidden-wide hidden-phone';
    const phone = 'ssr-variant hidden-wide hidden-tab';
    const copies = (block) =>
      [desktop, tablet, phone].map((variant) => `<div class="${variant}">${block}</div>`).join('');
    const { title, html } = extractPageContent(
      `<html><head><style data-framer-breakpoint-css>
        @media(min-width: 1200px){.hidden-wide{display:none!important}}
        @media(min-width: 810px) and (max-width: 1199.98px){.hidden-tab{display:none!important}}
        @media(max-width: 809.98px){.hidden-phone{display:none!important}}
        @media print{.hidden-print{display:none!important}}
      </style></head><body><div id="main" data-framer-hydrate-v2="{}"><div class="framer-page">
        ${copies('<div id="navigation" data-framer-name="Desktop"><a href="/"><p class="framer-text">Acme Roasters</p></a><a href="/shop"><p class="framer-text">Shop</p></a><a href="/pricing"><p class="framer-text">Pricing</p></a><a href="/login"><p class="framer-text">Log in</p></a></div>')}
        <div class="framer-1abc hidden-wide" data-framer-name="Page header"><a href="/blog"><p class="framer-text">Blog</p></a><p class="framer-text">how-to-brew-pour-over</p></div>
        <div class="framer-post" data-framer-name="Post">
          ${copies('<div data-framer-name="Heading"><h1 class="framer-text">How to brew pour-over coffee</h1></div>')}
          <div data-framer-name="Subcontent">
            <div data-framer-name="Avatar with text"><div data-framer-name="Avatar"><img src="https://framerusercontent.com/images/ada.png?width=800" width="800"></div><p class="framer-text">Ada Lovelace</p></div>
            <div data-framer-name="Reading time"><p class="framer-text">6</p><p class="framer-text">min read</p></div>
            <div data-framer-name="Date"><p class="framer-text"><time>Aug 15, 2024</time></p></div>
          </div>
          <div data-framer-name="Content">
            ${copies('<div data-framer-name="Image"><img src="https://framerusercontent.com/images/cover.png?width=1920" alt="A pour-over dripper" width="1920"></div>')}
            <div data-framer-name="Content">
              <p class="framer-text">Pour-over coffee tastes cleaner than a French press, with brighter notes.</p>
              <p class="framer-text"><br class="trailing-break"></p>
              <h2 class="framer-text">What you need</h2>
              <p class="framer-text">A dripper, paper filters, a kettle and freshly ground beans, medium-fine.</p>
              <p class="framer-text">Pour in slow circles, and aim for a total brew time of about three minutes.</p>
            </div>
          </div>
        </div>
        <div data-framer-name="Pivot"><p>Like this blog post?</p><a href="/blog"><div>Visit All Posts</div></a></div>
        <div data-framer-name="Blog filter">
          ${copies('<p class="framer-text">RELATED BLOGS</p><h2 class="framer-text">Our latest news and articles</h2>')}
          <div><a href="/blog/espresso"><p>Espresso at home, from the grind to the crema, in five steps.</p><p>5</p><p>min read</p></a></div>
        </div>
        <div id="faq" data-framer-name="FAQ">${copies('<h2>FAQ</h2><div data-framer-name="Accordion group"><div data-framer-name="Close"><p class="framer-text">Do you ship your coffee beans abroad?</p></div></div>')}</div>
        ${copies('<div data-framer-name="Footer item"><p class="framer-text">© 2026 Acme Roasters Inc. All rights reserved.</p></div>')}
      </div></div></body></html>`,
      'https://acme-coffee.example/blog/how-to-brew-pour-over',
    );
    expect(title).toBe('How to brew pour-over coffee');
    expect(html.match(/How to brew pour-over coffee/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="framer-text">How to brew pour-over coffee</h1>');
    expect(html.match(/cover\.png/g)).toHaveLength(1);
    for (const kept of [
      'tastes cleaner',
      'What you need',
      'freshly ground beans',
      'slow circles',
    ]) {
      expect(html.match(new RegExp(kept, 'g'))).toHaveLength(1);
    }
    for (const gone of [
      'Log in',
      'Pricing',
      'how-to-brew-pour-over<',
      'Ada Lovelace',
      'ada.png',
      'min read',
      'Visit All Posts',
      'RELATED BLOGS',
      'Espresso at home',
      'Do you ship',
      'All rights reserved',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('takes out an author box named only by its Framer layer', () => {
    const { html } = extractPageContent(
      `<body><div class="framer-page">
        <h1>How to brew pour-over coffee</h1>
        <div class="framer-x1">
          <p>Pour-over coffee tastes cleaner than a French press, with brighter notes.</p>
          <p>Pour in slow circles, and aim for a total brew time of about three minutes.</p>
        </div>
        <div class="framer-x2" data-framer-name="Author card"><img src="/ada.png" width="800"><p>Ada writes about coffee, slowly and with care.</p></div>
      </div></body>`,
      'https://acme-coffee.example/blog/pour-over',
    );
    expect(html).toContain('slow circles');
    expect(html).not.toContain('Ada writes');
    expect(html).not.toContain('ada.png');
  });

  it('keeps one of each run of copies, but not a list’s or a table’s repeats', () => {
    const { html } = extractPageContent(
      `<body><main>
        <div><h1>Cold brew at home</h1></div><div><h1>Cold brew at home</h1></div>
        <img src="/jar.jpg?w=800" alt="A jar"><img src="/jar.jpg?w=1600" alt="A jar">
        <p>Cold brew takes time, coarse grounds and cold water, nothing more.</p>
        <p>Cold brew takes time, coarse grounds and cold water, nothing more.</p>
        <p><br></p><p><br></p>
        <p>Steep it for twelve to eighteen hours, then strain it twice.</p>
        <ul><li>Coarse grounds</li><li>Coarse grounds</li></ul>
        <table><tr><td>Yes</td><td>Yes</td></tr></table>
      </main></body>`,
      'https://coffee.example/cold-brew',
    );
    expect(html.match(/Cold brew at home/g)).toHaveLength(1);
    expect(html).toContain('<h1>Cold brew at home</h1>');
    expect(html.match(/jar\.jpg/g)).toHaveLength(1);
    expect(html.match(/coarse grounds and cold water/g)).toHaveLength(1);
    expect(html.match(/<p><br><\/p>/g)).toHaveLength(2);
    expect(html.match(/<li>Coarse grounds<\/li>/g)).toHaveLength(2);
    expect(html.match(/<td>Yes<\/td>/g)).toHaveLength(2);
  });

  it('keeps pictures side by side whose address names them in its query', () => {
    const { html } = extractPageContent(
      `<body><main>
        <p>Cold brew takes time, coarse grounds and cold water, nothing more.</p>
        <img src="/_next/image?url=%2Fjar.jpg&amp;w=1080" alt="">
        <img src="/_next/image?url=%2Fpour.jpg&amp;w=1080" alt="">
        <figure><img src="/image.php?id=1"></figure><figure><img src="/image.php?id=2"></figure>
      </main></body>`,
      'https://coffee.example/cold-brew',
    );
    expect(html).toContain('%2Fjar.jpg');
    expect(html).toContain('%2Fpour.jpg');
    expect(html).toContain('image.php?id=1');
    expect(html).toContain('image.php?id=2');
  });

  it('judges images in the text as the text’s when the text area is the root', () => {
    const { html } = extractPageContent(
      `<body><article>
        <p>Our guide to brewing a better cup at home, with the gear you already own.</p>
        <p>Start with fresh beans, a scale and water just off the boil, then time it.</p>
        <img class="size-thumbnail" src="/pour-over.jpg" alt="Pour-over">
        <img class="avatar" src="/ada.jpg" alt="Ada">
      </article></body>`,
      'https://acme-coffee.example/guides/brew',
    );
    expect(html).toContain('src="https://acme-coffee.example/pour-over.jpg"');
    expect(html).not.toContain('ada.jpg');
  });
});

describe('extractPageContent on a long or deep page', () => {
  const P = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>';
  const SIZE = 1024 * 1024;
  const fill = (unit, size = SIZE) => unit.repeat(Math.ceil(size / unit.length));
  extractPageContent(`<body>${P}</body>`, 'https://acme.example/');

  // Each shape grew with the square of its length; now each reads in time
  // near it, well under the limit even on a busy machine.
  it.each([
    ['paragraphs side by side', `<html><body>${fill(P)}</body></html>`],
    ['paragraphs under 500 blocks', `<html><body>${'<div>'.repeat(500)}${fill(P)}</body></html>`],
    ['scripts to take out', `<html><body>${P}${fill('<script></script>')}</body></html>`],
    ['hidden blocks to take out', `<html><body>${P}${fill('<div hidden>x</div>')}</body></html>`],
    [
      'blocks of links',
      `<html><body>${P}${fill('<div><a href="/a">a</a><a href="/b">b</a></div>')}</body></html>`,
    ],
    [
      'H1s without words',
      `<html><body><h1>Title</h1>${P}${fill('<h1><b></b></h1>', SIZE / 2)}</body></html>`,
    ],
    [
      'paragraphs under 500 blocks named #main',
      `<html><body>${'<div id="main">'.repeat(500)}${fill(P)}</body></html>`,
    ],
    [
      'images under 500 pairs of blocks',
      `<html><body>${P}${'<div><div></div><div>'.repeat(500)}${fill('<img src="/a.png">')}</body></html>`,
    ],
    [
      'images under 500 named blocks',
      `<html><body>${P}${'<div class="post body">'.repeat(500)}${fill('<img src="/a.png">')}</body></html>`,
    ],
  ])(
    'reads a page of %s in time near its length',
    (_, html) => {
      const started = Date.now();
      const { html: content } = extractPageContent(html, 'https://acme.example/blog/post');
      expect(content).toContain('Lorem ipsum');
      expect(Date.now() - started).toBeLessThan(4_000);
    },
    10_000,
  );
});

describe('classesHiddenOnDesktop', () => {
  it('reads the classes a desktop screen hides, from rules of classes and display:none only', () => {
    const hidden = classesHiddenOnDesktop(`
      @media (min-width: 768px) { .mobile-only, .phone-menu { display: none; } }
      @media screen and (max-width: 767px) { .desktop-only { display: none } }
      @media (min-width: 48em) { .small-only { display:none !important } }
      @media print { .no-print { display: none } }
      @media (orientation: landscape) { .portrait { display: none } }
      @media (min-width: 1024px) { div.card { display: none } .wide-pad { display: none; padding: 0 } }
      .closed { display: none }
    `);
    expect([...hidden].sort()).toEqual(['mobile-only', 'phone-menu', 'small-only']);
  });

  it('reads a media query as a 1440px screen does', () => {
    expect(onDesktop('(min-width: 1440px)')).toBe(true);
    expect(onDesktop('(min-width: 1280px) and (max-width: 1439.98px)')).toBe(false);
    expect(onDesktop('only screen and (max-width: 639.98px), (min-width: 1200px)')).toBe(true);
    expect(onDesktop('print')).toBe(false);
  });
});
