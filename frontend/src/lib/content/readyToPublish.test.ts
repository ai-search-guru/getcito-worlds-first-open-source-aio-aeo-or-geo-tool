import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import type { LinkCheck } from './qualityChecks';
import { PLACEHOLDER } from './placeholders';
import {
  blankCode,
  bylineText,
  disclosureText,
  exportPlaceholders,
  fragment,
  pageFields,
  pageNamesPerson,
  pasteChecks,
  reviewerJsonLd,
  teamName,
  titlePlaceholders,
  withByline,
  withReviewerJsonLd,
  withoutLeadingH1,
  withoutPlaceholders,
} from './readyToPublish';

/** Ready to publish (Quality spec §7b, CE-057): what an export gives, and checks first. */

const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;

/** A FAQPage's JSON-LD, one line as a draft stores it, with a placeholder in an answer. */
const FAQ =
  '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' +
  '{"@type":"Question","name":"How long does it take?","acceptedAnswer":{"@type":"Answer","text":"About four minutes. It costs [price]."}},' +
  '{"@type":"Question","name":"Which grind?","acceptedAnswer":{"@type":"Answer","text":"Medium-fine."}}]}';
const jsonLdOf = (html: string) =>
  JSON.parse(fragment(html).querySelector('script[type="application/ld+json"]')!.textContent!);

describe('fragment', () => {
  it('parses into a document of its own, and keeps a leading script where it is', () => {
    const root = fragment(
      '<script type="application/ld+json">{}</script><p><img src="https://cdn.acme.com/a.jpg" alt="A"></p>',
    );
    expect(root.ownerDocument).not.toBe(document);
    expect(root.firstElementChild?.tagName).toBe('SCRIPT');
  });
});

describe('pageNamesPerson', () => {
  it('finds a reviewer name in visible page text, ignoring case and whitespace', () => {
    expect(
      pageNamesPerson(
        '<h1>Guide</h1><p>Reviewed by <strong>Dr. Grace Hopper</strong>.</p>',
        'dr. grace  hopper',
      ),
    ).toBe(true);
  });

  it('does not count names in structured data, attributes or hidden content', () => {
    expect(
      pageNamesPerson(
        '<img alt="Dr. Grace Hopper"><script type="application/ld+json">{"name":"Dr. Grace Hopper"}</script><p hidden>Dr. Grace Hopper</p><p>Welcome.</p>',
        'Dr. Grace Hopper',
      ),
    ).toBe(false);
  });

  it('reads a block’s end as a word’s end', () => {
    expect(
      pageNamesPerson(
        '<p>Reviewed by Dr. Grace Hopper</p><p>Coffee is ready.</p>',
        'Dr. Grace Hopper',
      ),
    ).toBe(true);
    expect(pageNamesPerson('<h2>Reviewed by</h2><p>Dr. Grace Hopper</p>', 'Dr. Grace Hopper')).toBe(
      true,
    );
    expect(pageNamesPerson('<p>Dr. Grace<br>Hopper</p>', 'Dr. Grace Hopper')).toBe(true);
  });

  it('requires the complete name rather than a substring of another word', () => {
    expect(pageNamesPerson('<p>Annual results are ready.</p>', 'Ann')).toBe(false);
    expect(pageNamesPerson('<p>Reviewed by Ann.</p>', 'Ann')).toBe(true);
  });
});

describe('reviewerJsonLd', () => {
  const grace = {
    id: 'r1',
    name: 'Dr. Grace Hopper',
    title: 'Clinical Reviewer',
  } as ContentAuthor;

  it('gives the WebPage.reviewedBy node only once the page names the reviewer', () => {
    const named = '<h1>Guide</h1><p>Reviewed by Dr. Grace Hopper.</p>';
    expect(reviewerJsonLd('Guide', named, grace)).toContain('"reviewedBy"');
    expect(withReviewerJsonLd('Guide', named, grace)).toMatch(
      /^<h1>Guide<\/h1><p>Reviewed by Dr\. Grace Hopper\.<\/p>\n<script type="application\/ld\+json">/,
    );
    expect(reviewerJsonLd('Guide', '<h1>Guide</h1><p>Done.</p>', grace)).toBeNull();
    expect(withReviewerJsonLd('Guide', '<p>Done.</p>', grace)).toBe('<p>Done.</p>');
    expect(reviewerJsonLd('Guide', named, null)).toBeNull();
  });

  it("keeps a reviewer's words from closing the script", () => {
    const sly = { ...grace, name: 'Eve', title: '</script><img src=x onerror=alert(1)>' };
    const script = reviewerJsonLd('Guide', '<p>Reviewed by Eve.</p>', sly)!;
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(script).not.toContain('<img');
  });
});

describe('exportPlaceholders', () => {
  it('counts every placeholder an export would carry: words, alt text, JSON-LD', () => {
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"author":"[name of a real person]"}</script>' +
          '<h2>What [name of a real person] uses</h2><p>Use [figure, source] g.</p>' +
          '<div class="cta"><span>Call [phone number]</span></div><p>Note [1], [sic].</p>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="[photo of the founder]">',
      ),
    ).toBe(5);
  });

  it("reads JSON-LD by its strings: an array is no placeholder, one that doesn't parse is read for none", () => {
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"@type":["Article","NewsArticle"],"author":{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada","https://acme.com/ada"]}}</script><p>Brew.</p>',
      ),
    ).toBe(0);
    expect(exportPlaceholders(`<script type="application/ld+json">${FAQ}</script>`)).toBe(1);
    expect(
      exportPlaceholders(
        '<script type="application/ld+json">{"sameAs":["https://x.example/"],"name":"[brand]"</script>',
      ),
    ).toBe(0);
  });

  it("holds a title's or a heading's brackets only in the agent's own forms", () => {
    expect(
      exportPlaceholders(
        '<h1>Best CRM tools [2026 Update]</h1><h2>How to brew [Step-by-Step Guide]</h2>' +
          '<h3>The checklist [PDF]</h3><p>Brew it slowly.</p>',
      ),
    ).toBe(0);
    expect(
      exportPlaceholders(
        '<h2>What [name of a real person] uses</h2><h2>[quote from a real person, with its source]</h2>' +
          '<h3>Brew [figure, source, 2025] grams</h3><p>Costs [price].</p>',
      ),
    ).toBe(4);
  });
});

describe('titlePlaceholders', () => {
  it("counts the title's only when the page's H1 isn't it", () => {
    const title = 'Best [figure, source] grinders';
    expect(titlePlaceholders(title, '<h1>Best [figure, source] grinders</h1>')).toBe(0);
    expect(titlePlaceholders(title, '<h1>Best grinders</h1>')).toBe(1);
    expect(titlePlaceholders(title, '<p>No H1.</p>')).toBe(1);
  });

  it('counts it with the page when a heading or the first line reads as it, H1 or not', () => {
    const title = 'How [name of a real person] forecasts';
    // An H2 with no H1 above it: the title is that heading.
    expect(titlePlaceholders(title, '<h2>How [name of a real person] forecasts</h2>')).toBe(0);
    expect(titlePlaceholders(title, '<p>Teams trust it.</p><h2>Other</h2>')).toBe(1);
    // No heading: the title is the first line's start, cut with an ellipsis.
    const line =
      'Ask [name of a real person] how pipeline forecasting works when the quarter closes and the numbers shift.';
    expect(
      titlePlaceholders(
        'Ask [name of a real person] how pipeline forecasting works when the quarter…',
        `<p>${line}</p>`,
      ),
    ).toBe(0);
  });

  it("reads a person's brackets in the title as part of it", () => {
    expect(titlePlaceholders('Best CRM tools [2026 Update]', '<p>No H1.</p>')).toBe(0);
    expect(titlePlaceholders('The checklist [PDF]', '<h1>The checklist</h1>')).toBe(0);
  });
});

describe('blankCode', () => {
  const matches = (text: string) => [...text.matchAll(PLACEHOLDER)];

  it('leaves only where exportPlaceholders reads, each position as in the HTML', () => {
    const html =
      '<style>a[href] { color: red }</style><script>var a = ["x y"];</script>\n' +
      '<script type="application/ld+json">{"@type":"FAQPage","sameAs":["https://x.example/"],"text":"Costs [price]."}</script>\n' +
      '<!-- [old note] -->\n<h1>Best CRM tools [2026 Update]</h1>\n' +
      '<p class="[cta]">Ask <img src="https://cdn.acme.com/a.jpg" alt="[photo of the founder]"> [name of a real person].</p>';
    const blanked = blankCode(html, { words: true });
    expect(blanked).toHaveLength(html.length);
    const found = matches(blanked).map((m) => html.slice(m.index, m.index + m[0].length));
    expect(found).toEqual(['[price]', '[photo of the founder]', '[name of a real person]']);
    expect(found).toHaveLength(exportPlaceholders(html));
    // A heading's own forms stay; a JSON-LD that doesn't parse is read for none.
    expect(
      matches(
        blankCode(
          '<h2>What [name of a real person] uses</h2><script type="application/ld+json">{"a":"[x y]",</script>',
          { words: true },
        ),
      ).map((m) => m[0]),
    ).toEqual(['[name of a real person]']);
  });

  it('without fields, leaves only the words the page shows: no alt, title or JSON-LD', () => {
    const html =
      '<script type="application/ld+json">{"text":"Costs [price]."}</script>\n' +
      '<p title="[tip]">Ask <img src="a.jpg" alt="[photo of the founder]"> [name of a real person].</p>';
    const blanked = blankCode(html, { words: true, fields: false });
    expect(blanked).toHaveLength(html.length);
    expect(matches(blanked).map((m) => html.slice(m.index, m.index + m[0].length))).toEqual([
      '[name of a real person]',
    ]);
  });

  it('blanks comments and what scripts, styles and templates hold, keeping the tags', () => {
    const html =
      '<!-- <h1>Old</h1> -->\n<script>document.write("</h1>")</script><template><h1>T</h1></template>\n<h1>Pour-over</h1>';
    const blanked = blankCode(html);
    expect(blanked).toHaveLength(html.length);
    expect(blanked.indexOf('<h1>')).toBe(html.lastIndexOf('<h1>'));
    expect(blanked.indexOf('</h1>')).toBe(html.lastIndexOf('</h1>'));
    expect(blanked).toContain('<script>');
    expect(blanked).toContain('</template>');
  });
});

describe('withoutPlaceholders', () => {
  it('leaves out the sentence a placeholder is in, and keeps the rest as written', () => {
    expect(
      withoutPlaceholders(
        '<p>Brew it slowly. Use [figure, source] g of <strong>fresh</strong> coffee. See <a href="https://acme.com/">our guide</a>.</p>',
      ),
    ).toBe('<p>Brew it slowly. See <a href="https://acme.com/">our guide</a>.</p>');
  });

  it('reads sentences as a reader does: numbers, abbreviations and addresses end none', () => {
    expect(
      withoutPlaceholders(
        '<p>The kettle holds 1.5 litres and costs [price]. Use a scale, e.g. the Acme one. Visit acme.com for [details]. As [Dr. Name, title] says, pour slowly. Next.</p>',
      ),
    ).toBe('<p>Use a scale, e.g. the Acme one. Next.</p>');
  });

  it('keeps a heading’s placeholder to be filled, and drops what is left empty', () => {
    expect(
      withoutPlaceholders(
        '<h2>What [name of a real person] uses</h2>' +
          '<blockquote><p>[quote from a real person, with its source]</p></blockquote>' +
          '<ul><li><p>Ask <a href="https://x.example/">[name of a real person]</a>.</p></li><li><p>Grind fresh.</p></li></ul>' +
          '<table><tbody><tr><td><p>[price]</p></td></tr><tr><td><p>Ratio</p></td></tr></tbody></table>',
      ),
    ).toBe(
      '<h2>What [name of a real person] uses</h2><ul><li><p>Grind fresh.</p></li></ul>' +
        '<table><tbody><tr><td><p>Ratio</p></td></tr></tbody></table>',
    );
  });

  it('takes one alone where no line holds it, in alt text and JSON-LD, and keeps a leading script', () => {
    expect(
      withoutPlaceholders(
        '<script type="application/ld+json">{"author":"[name of a real person]"}</script>' +
          '<div class="cta"><span>Call [phone number] today</span></div>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="[photo of the founder]">',
      ),
    ).toBe(
      '<script type="application/ld+json">{"author":""}</script>' +
        '<div class="cta"><span>Call today</span></div>' +
        '<img src="https://cdn.acme.com/a.jpg" alt="">',
    );
  });

  it("clears a JSON-LD's placeholders in its strings, and keeps it JSON", () => {
    const out = withoutPlaceholders(
      `<script type="application/ld+json">${FAQ}</script>` +
        '<script type="application/ld+json">{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada"]}</script>',
    );
    const faq = jsonLdOf(out);
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('About four minutes. It costs .');
    expect(out).toContain(
      '<script type="application/ld+json">{"@type":"Person","name":"Ada","sameAs":["https://x.example/ada"]}</script>',
    );
    // One that doesn't parse is left as written.
    const broken = '<script type="application/ld+json">{"name":"[brand]",</script>';
    expect(withoutPlaceholders(broken)).toBe(broken);
  });

  it("keeps a heading's own brackets as written", () => {
    const html = '<h1>Best CRM tools [2026 Update]</h1><p>Brew it slowly.</p>';
    expect(withoutPlaceholders(html)).toBe(html);
  });
});

describe('pageFields', () => {
  const html =
    '<h1>How to brew pour-over coffee</h1>' +
    '<p>Pour-over coffee takes a dripper, a filter and four minutes. You pour 1.5 litres of hot water over the grounds in slow circles, and the coffee drips through. It tastes cleaner than a French press.</p>' +
    '<p><img src="https://cdn.acme.com/pour.jpg" alt="Pouring"></p>';

  it('reads them from the page: its title, first paragraph, a slug, its author and first image', () => {
    expect(
      pageFields({
        title: 'How to brew pour-over coffee',
        html,
        sourceUrl: null,
        author: ada,
        reviewer: { ...ada, name: 'Dr. Grace Hopper' },
        teamByline: 'Acme Team',
      }),
    ).toEqual({
      metaTitle: 'How to brew pour-over coffee',
      metaDescription:
        'Pour-over coffee takes a dripper, a filter and four minutes. You pour 1.5 litres of hot water over the grounds in slow circles, and the coffee drips through.',
      slug: 'how-to-brew-pour-over-coffee',
      author: 'Ada Lovelace',
      reviewer: 'Dr. Grace Hopper',
      featuredImage: 'https://cdn.acme.com/pour.jpg',
    });
  });

  it("keeps a live page's address as it reads, and the team byline with no author", () => {
    const fields = (sourceUrl: string) =>
      pageFields({
        title: 'Pour-over',
        html: '<p>Short.</p>',
        sourceUrl,
        author: null,
        reviewer: null,
        teamByline: 'Acme Team',
      });
    expect(fields('https://acme.com/blog/pour-over-guide/')).toMatchObject({
      slug: 'pour-over-guide',
      author: 'Acme Team',
      featuredImage: null,
      metaDescription: 'Short.',
    });
    expect(fields('https://acme.com/blog/x/index.html').slug).toBe('x');
    expect(fields('https://acme.com/tr/%C3%A7ay-rehberi?ref=1').slug).toBe('çay-rehberi');
  });

  it('gives no slug for a title with none to give', () => {
    expect(
      pageFields({ title: '東京ガイド', html: '', sourceUrl: null, author: null, teamByline: '' })
        .slug,
    ).toBe('');
  });

  it('cuts a long title’s slug at a word near 60 characters, without a leading "the" or a dangling word', () => {
    const slug = (title: string) =>
      pageFields({ title, html: '', sourceUrl: null, author: null, teamByline: '' }).slug;
    expect(
      slug(
        'Defend the coffee subscription comparison with up-to-date pricing and shipping details',
      ),
    ).toBe('defend-the-coffee-subscription-comparison-with-up-to-date');
    // The page that went to Webflow with an 80-character address.
    expect(
      slug(
        'The Ultimate Technical Guide to Unified Tracking Across ChatGPT, Gemini, and Google AIO',
      ),
    ).toBe('ultimate-technical-guide-to-unified-tracking-across-chatgpt');
    // Never ending on a word that leads into what was cut.
    expect(slug('Pour-over coffee guide for home baristas who brew with a kettle and a')).toBe(
      'pour-over-coffee-guide-for-home-baristas-who-brew',
    );
    expect(slug('The Pour-over Guide')).toBe('pour-over-guide');
    expect(slug('The')).toBe('the');
    // One word longer than 60 is cut.
    expect(slug('b'.repeat(90))).toBe('b'.repeat(60));
    expect(slug(`${'a'.repeat(60)} b`)).toBe('a'.repeat(60));
  });

  it('never ends a Turkish title’s slug on a word that leads into what was cut, as the slug spells it', () => {
    const slug = (title: string) =>
      pageFields({ title, html: '', sourceUrl: null, author: null, teamByline: '' }).slug;
    // "için" is "icin" in a slug: cut there, it goes too.
    expect(slug('Yapay zekâ aramasında görünürlük isteyen yerel markalar için en iyi rehber')).toBe(
      'yapay-zeka-aramasinda-gorunurluk-isteyen-yerel-markalar',
    );
    expect(slug('Yapay Zekâ Aramasında Görünürlük İsteyen Yerel Markalar İçin En İyi Rehber')).toBe(
      'yapay-zeka-aramasinda-gorunurluk-isteyen-yerel-markalar',
    );
  });

  it('drops "the", "a" or "an" only when it is the title’s first word, not a word’s start', () => {
    const slug = (title: string) =>
      pageFields({ title, html: '', sourceUrl: null, author: null, teamByline: '' }).slug;
    expect(slug('A-Frame houses guide')).toBe('a-frame-houses-guide');
    expect(slug('An-Najah alumni stories')).toBe('an-najah-alumni-stories');
    expect(slug('A guide to A-Frame houses')).toBe('guide-to-a-frame-houses');
    expect(slug('the pour-over guide')).toBe('pour-over-guide');
  });

  it('cuts a first sentence too long to fit at a word', () => {
    const long = `${'Pour slowly '.repeat(20)}now.`;
    const { metaDescription } = pageFields({
      title: 'x',
      html: `<p>${long}</p>`,
      sourceUrl: null,
      author: null,
      teamByline: 'Acme Team',
    });
    expect(metaDescription.length).toBeLessThanOrEqual(160);
    expect(metaDescription.endsWith('slowly…')).toBe(true);
  });
});

describe('withByline', () => {
  it('puts one byline line under the H1, or at the top of a page with none, as text', () => {
    expect(withByline('<h1>Pour-over</h1><p>Brew.</p>', 'By Ada Lovelace')).toBe(
      '<h1>Pour-over</h1><p>By Ada Lovelace</p><p>Brew.</p>',
    );
    expect(withByline('<p>Brew.</p><h1>Late</h1>', 'By <Acme> Team')).toBe(
      '<p>By &lt;Acme&gt; Team</p><p>Brew.</p><h1>Late</h1>',
    );
    expect(withByline('<h1>Pour-over</h1>\n<p>Brew.</p>', 'By Ada')).toBe(
      '<h1>Pour-over</h1>\n<p>By Ada</p>\n<p>Brew.</p>',
    );
  });

  it('keeps the rest as written, under an H1 an image comes before, and adds none twice or alone', () => {
    // An HTML block's code is not rewritten (a template would close <path/>).
    expect(withByline('<h1>Pour-over</h1><svg><path d="M0"/></svg>', 'By Ada')).toBe(
      '<h1>Pour-over</h1><p>By Ada</p><svg><path d="M0"/></svg>',
    );
    expect(
      withByline('<img src="https://cdn.acme.com/a.jpg"><h1>Pour-over</h1><p>Brew.</p>', 'By Ada'),
    ).toBe('<img src="https://cdn.acme.com/a.jpg"><h1>Pour-over</h1><p>By Ada</p><p>Brew.</p>');
    expect(withByline('<h1>Pour-over</h1>\n<p>By  Ada</p>\n<p>Brew.</p>', 'By Ada')).toBe(
      '<h1>Pour-over</h1>\n<p>By  Ada</p>\n<p>Brew.</p>',
    );
    expect(withByline('', 'By Ada')).toBe('');
    expect(withByline('<p></p>', 'By Ada')).toBe('<p></p>');
  });

  it("puts it under the lead's own H1: not an empty one above, nor one in a comment", () => {
    expect(withByline('<h1></h1>\n<h1>Pour-over</h1>\n<p>Brew.</p>', 'By Ada')).toBe(
      '<h1></h1>\n<h1>Pour-over</h1>\n<p>By Ada</p>\n<p>Brew.</p>',
    );
    expect(withByline('<!-- <h1>Old</h1> -->\n<h1>Pour-over</h1>\n<p>Brew.</p>', 'By Ada')).toBe(
      '<!-- <h1>Old</h1> -->\n<h1>Pour-over</h1>\n<p>By Ada</p>\n<p>Brew.</p>',
    );
    expect(
      withByline(
        '<script>document.write("<h1>x</h1>")</script>\n<H1 class="t">Pour-over</H1>\n<p>Brew.</p>',
        'By Ada',
      ),
    ).toBe(
      '<script>document.write("<h1>x</h1>")</script>\n<H1 class="t">Pour-over</H1>\n<p>By Ada</p>\n<p>Brew.</p>',
    );
  });
});

describe('teamName', () => {
  it('names the team in the page’s language, the brand alone in another', () => {
    expect(teamName(null, 'Acme')).toBe('Acme Team');
    expect(teamName('tr', 'Acme')).toBe('Acme Ekibi');
    expect(teamName('German', 'Acme')).toBe('Acme-Team');
    expect(teamName('pt-BR', 'Acme')).toBe('Equipe Acme');
    expect(teamName('ja', 'Acme')).toBe('Acme');
    // A "$" in the name is written as it is; no brand read yet, no team.
    expect(teamName('en', 'Cash $1')).toBe('Cash $1 Team');
    expect(teamName('de', ' ')).toBe('');
  });
});

describe('disclosureText', () => {
  it('writes the line in the page’s language, none in another or with no brand (CE-050)', () => {
    expect(disclosureText(null, 'Acme')).toBe(
      'Disclosure: the product this page recommends is offered by Acme.',
    );
    expect(disclosureText('tr', 'Acme')).toBe(
      'Açıklama: Bu sayfada önerilen ürün Acme tarafından sunuluyor.',
    );
    expect(disclosureText('ja', 'Acme')).toBeNull();
    expect(disclosureText('en', ' ')).toBeNull();
    // A "$" in a name stays as it is.
    expect(disclosureText('en', 'A$1')).toBe(
      'Disclosure: the product this page recommends is offered by A$1.',
    );
  });
});

describe('bylineText', () => {
  it("writes the line in the brand's language, by the author or the brand's team", () => {
    expect(bylineText(null, 'Ada Lovelace', 'Acme')).toBe('By Ada Lovelace');
    expect(bylineText('en-US', null, 'Acme')).toBe('By Acme Team');
    expect(bylineText('tr', 'Ayşe Yılmaz', 'Acme')).toBe('Yazar: Ayşe Yılmaz');
    expect(bylineText('tr', null, 'Acme')).toBe('Yazar: Acme Ekibi');
    expect(bylineText('pt-BR', 'Ana Silva', 'Acme')).toBe('Por Ana Silva');
    expect(bylineText('pt', null, 'Acme')).toBe('Pela equipe Acme');
    expect(bylineText('de', null, 'Acme')).toBe('Vom Acme-Team');
    expect(bylineText('fr', null, 'Acme')).toBe("Par l'équipe Acme");
    // A "$" in a name is written as it is.
    expect(bylineText('es', 'Ana $& Co', 'Acme')).toBe('Por Ana $& Co');
  });

  it('puts the name alone, or the brand alone, for a language not in the table', () => {
    expect(bylineText('ja', '山田太郎', 'Acme')).toBe('山田太郎');
    expect(bylineText('ar', null, 'Acme')).toBe('Acme');
  });
});

describe('withoutLeadingH1', () => {
  it('drops the H1 the title field holds, and nothing else', () => {
    expect(withoutLeadingH1('<h1>Pour-over</h1><p>Brew.</p><h1>Second</h1>')).toBe(
      '<p>Brew.</p><h1>Second</h1>',
    );
    expect(withoutLeadingH1('<p>Intro.</p><h1>Late</h1>')).toBe('<p>Intro.</p><h1>Late</h1>');
  });
});

describe('pasteChecks', () => {
  it('counts the links read and those that don’t answer, the images with no alt text, and own code', () => {
    const checks = new Map<string, LinkCheck>([
      [
        'https://ok.example/',
        { href: 'https://ok.example/', status: 'ok', httpStatus: 200, date: null },
      ],
      [
        'https://gone.example/',
        { href: 'https://gone.example/', status: 'broken', httpStatus: 404, date: null },
      ],
      // A site that refused the read (a bot wall): no word on it.
      [
        'https://walled.example/',
        { href: 'https://walled.example/', status: 'unknown', httpStatus: 403, date: null },
      ],
    ]);
    expect(
      pasteChecks(
        '<p><a href="https://ok.example/">a</a> <a href="https://gone.example/">b</a> <a href="https://gone.example/">c</a> <a href="https://new.example/">n</a> <a href="https://walled.example/">w</a> <a href="/local">d</a></p>' +
          '<img src="https://cdn.acme.com/a.jpg" alt="A"><img src="https://cdn.acme.com/b.jpg" alt=" ">' +
          '<div class="cta" style="color:red">x</div><script type="application/ld+json">{}</script>',
        checks,
      ),
    ).toEqual({
      links: { count: 4, read: 2, broken: 1 },
      images: { count: 2, withoutAlt: 1 },
      ownCode: 1,
    });
  });
});
