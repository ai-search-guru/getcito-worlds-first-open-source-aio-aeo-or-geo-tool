import type { AuthorsRead } from '@/lib/content/authors';
import { htmlBlockElement } from '@/lib/content/htmlAllowlist';

/**
 * One draft for get_content_draft_package's tests: the editor's own Send to
 * CMS (in the browser) and the MCP's (on the server, with jsdom) must make
 * the same page of it.
 */

export const BRAND_ID = '22222222-0000-4000-8000-000000000001';
export const DRAFT_ID = '33333333-0000-4000-8000-000000000001';
export const AUTHOR_ID = '44444444-0000-4000-8000-000000000001';

const JSON_LD =
  '{"@context":"https://schema.org","@type":"Article","headline":"Cold brew at home"}';

/** An HTML block's code (a call to action), with text past ASCII. */
const HTML_BLOCK =
  '<div class="acme-cta">\n  <a href="https://acme.example/shop">Kaffeebohnen kaufen – café</a>\n</div>';

/** The draft's row as the MCP reads it. */
export const DRAFT_ROW = {
  id: DRAFT_ID,
  brand_id: BRAND_ID,
  title: 'Cold brew at home: a slow, smooth coffee',
  body_html: [
    '<h1>Cold brew at home: a slow, smooth coffee</h1>',
    '<p>Cold brew is coffee steeped in cold water for twelve to eighteen hours. It tastes smoother and less bitter than coffee brewed hot, and it keeps for a week in the fridge.</p>',
    '<h2>What you need</h2>',
    '<ul><li><p>Coarsely ground coffee</p></li><li><p>A large jar and a filter</p></li></ul>',
    '<p><span style="font-weight:700">Tip:</span> grind it coarse, or the brew turns muddy.</p>',
    '<h4>Ratios in Zürich — çok güzel</h4>',
    '<table><colgroup><col style="width: 120px"><col></colgroup><tbody>',
    '<tr><th colspan="1" rowspan="1"><p>Coffee</p></th><th colspan="1" rowspan="1"><p>Water</p></th></tr>',
    '<tr><td colspan="1" rowspan="1"><p>100 g</p></td><td colspan="1" rowspan="1"><p>1 l</p></td></tr>',
    '</tbody></table>',
    '<p>Read <a target="_blank" rel="noopener noreferrer nofollow" href="https://acme.example/guides/grind">our grind guide</a> before you buy a naïve café blend.</p>',
    '<img src="https://acme.example/cold-brew.jpg" alt="A jar of cold brew">',
    htmlBlockElement(HTML_BLOCK),
    `<script type="application/ld+json">${JSON_LD}</script>`,
  ].join(''),
  source_url: null,
  author_id: AUTHOR_ID,
  reviewer_id: null,
  author_real_at: null,
  rules: null,
  // An article with its own Article JSON-LD: GetCito adds none (00448).
  page_type: 'blog_post',
  method: 'create',
  schema_left_out: false,
  slug: 'cold-brew-at-home',
  meta_title: null,
  meta_description: null,
  archived_at: null,
  brands: { organization_id: 'org-1', name: 'Acme Coffee', language: 'en' },
};

/** The workspace's authors and its brand, which puts the byline in the content. */
export const AUTHORS: AuthorsRead = {
  authors: [
    {
      id: AUTHOR_ID,
      name: 'Ada Lovelace',
      title: 'Head barista',
      bio: null,
      photoUrl: null,
      sameAs: [],
      userId: null,
      createdBy: null,
      defaultFor: [],
      pages: null,
    },
  ],
  brands: [{ id: BRAND_ID, name: 'Acme Coffee', bylineInContent: true }],
  me: { id: 'user-1', role: 'analyst' },
};

/** The JSON-LD the page carries, parsed. */
export const JSON_LD_PARSED = JSON.parse(JSON_LD);

/**
 * The page's HTML as the editor's Send to CMS sends it (in the browser): the
 * byline line first, no H1, the styled bold kept as <strong>, the H4 an H3,
 * the table without its column widths, the link with its address only, the
 * text past ASCII as written, and the image, the HTML block's code and the
 * JSON-LD as they are.
 */
export const EXPECTED_HTML = [
  '<p>By Ada Lovelace</p>',
  '<p>Cold brew is coffee steeped in cold water for twelve to eighteen hours. It tastes smoother and less bitter than coffee brewed hot, and it keeps for a week in the fridge.</p>',
  '<h2>What you need</h2>',
  '<ul>',
  '<li>',
  '<p>Coarsely ground coffee</p>',
  '</li>',
  '<li>',
  '<p>A large jar and a filter</p>',
  '</li>',
  '</ul>',
  '<p><strong>Tip:</strong> grind it coarse, or the brew turns muddy.</p>',
  '<h3>Ratios in Zürich — çok güzel</h3>',
  '<table>',
  '<tbody>',
  '<tr>',
  '<th colspan="1" rowspan="1">',
  '<p>Coffee</p>',
  '</th>',
  '<th colspan="1" rowspan="1">',
  '<p>Water</p>',
  '</th>',
  '</tr>',
  '<tr>',
  '<td colspan="1" rowspan="1">',
  '<p>100 g</p>',
  '</td>',
  '<td colspan="1" rowspan="1">',
  '<p>1 l</p>',
  '</td>',
  '</tr>',
  '</tbody>',
  '</table>',
  '<p>Read <a href="https://acme.example/guides/grind">our grind guide</a> before you buy a naïve café blend.</p>',
  // An image and an HTML block aren't blocks the HTML view puts on lines of their own.
  `<img src="https://acme.example/cold-brew.jpg" alt="A jar of cold brew">${HTML_BLOCK}`,
  `<script type="application/ld+json">${JSON_LD}</script>`,
].join('\n');
