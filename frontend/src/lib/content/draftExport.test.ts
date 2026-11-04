import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  draftBlocks,
  draftDocx,
  draftExportBlob,
  draftExportFileName,
  draftHtmlDocument,
  draftMarkdown,
  draftText,
  libraryCsv,
  libraryDocx,
  libraryExportFileName,
  libraryRows,
  libraryWorkbook,
  pageCsv,
  pageSheetRow,
  pageWorkbook,
  type LibraryExportItem,
} from './draftExport';

// The page as Copy HTML gives it: one block per line, an HTML block as its
// code, the schema JSON-LD as its script.
const PAGE = [
  '<h1>Pipeline forecasting</h1>',
  '<p>Teams <strong>trust</strong> it, <em>every</em> week. See <a href="https://acme.example/pricing">our pricing</a>.</p>',
  '<h2>How it works</h2>',
  '<ul><li>Weighted stages<ul><li>By deal size</li></ul></li><li>Rep calls</li></ul>',
  '<ol><li>Import deals</li><li>Set the stages</li></ol>',
  '<blockquote><p>It saved us a week.</p></blockquote>',
  '<table><tbody><tr><th>Plan</th><th>Price</th></tr><tr><td>Starter</td><td>$49 | month</td></tr></tbody></table>',
  '<div class="callout"><p>Free for 14 days</p></div>',
  '<script type="application/ld+json">{"@type":"Article"}</script>',
].join('\n');

/** jsdom's Blob has no text() or arrayBuffer(): read it as a browser's FileReader would. */
function read(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('draftBlocks', () => {
  it('reads the page as headings, paragraphs, lists, a quote, a table and an HTML block', () => {
    const blocks = draftBlocks('Pipeline forecasting', PAGE);
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'item',
      'item',
      'item',
      'item',
      'item',
      'quote',
      'table',
      'html',
    ]);
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      runs: [
        { text: 'Teams ' },
        { text: 'trust', bold: true },
        { text: ' it, ' },
        { text: 'every', italics: true },
        { text: ' week. See ' },
        { text: 'our pricing', link: 'https://acme.example/pricing' },
        { text: '.' },
      ],
    });
    // The nested item one level down, in its parent's place.
    expect(blocks.slice(3, 6)).toMatchObject([
      { ordered: false, level: 0, n: 1, runs: [{ text: 'Weighted stages' }] },
      { ordered: false, level: 1, n: 1, runs: [{ text: 'By deal size' }] },
      { ordered: false, level: 0, n: 2, runs: [{ text: 'Rep calls' }] },
    ]);
  });

  it('opens with the title when the page has no H1', () => {
    expect(draftBlocks('Pipeline forecasting', '<p>Body</p>')[0]).toEqual({
      kind: 'heading',
      level: 1,
      runs: [{ text: 'Pipeline forecasting' }],
    });
    expect(draftBlocks('', '<p>Body</p>').map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('drops a link to an unsafe address, and keeps its text', () => {
    const [block] = draftBlocks(
      'T',
      '<h1>T</h1><p><a href="javascript:alert(1)">click</a></p>',
    ).slice(1);
    expect(block).toEqual({ kind: 'paragraph', runs: [{ text: 'click' }] });
  });
});

describe('draftMarkdown', () => {
  it('writes the page as Markdown, an HTML block as HTML, without the JSON-LD', () => {
    expect(draftMarkdown('Pipeline forecasting', PAGE)).toBe(
      [
        '# Pipeline forecasting',
        '',
        'Teams **trust** it, *every* week. See [our pricing](https://acme.example/pricing).',
        '',
        '## How it works',
        '',
        '- Weighted stages',
        '    - By deal size',
        '- Rep calls',
        '1. Import deals',
        '2. Set the stages',
        '',
        '> It saved us a week.',
        '',
        '| Plan | Price |',
        '| --- | --- |',
        '| Starter | $49 \\| month |',
        '',
        '<div class="callout"><p>Free for 14 days</p></div>',
        '',
      ].join('\n'),
    );
  });

  it('escapes what Markdown would read as its own', () => {
    expect(draftMarkdown('', '<p>2 * 3 = 6 and [not] a_link</p><p># not a heading</p>')).toBe(
      '2 \\* 3 = 6 and \\[not\\] a\\_link\n\n\\# not a heading\n',
    );
  });
});

describe('draftHtmlDocument', () => {
  it("wraps Copy HTML's page in a titled document", () => {
    const doc = draftHtmlDocument('Pricing <2026>', '<h1>Pricing</h1>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<title>Pricing &lt;2026&gt;</title>');
    expect(doc).toContain('<body>\n<h1>Pricing</h1>\n</body>');
  });
});

describe('draftDocx', () => {
  it('writes a Word document with the headings, text, links, lists and table', async () => {
    const files = unzipSync(await read(await draftDocx('Pipeline forecasting', PAGE)));
    const xml = strFromU8(files['word/document.xml']);
    for (const text of [
      'Pipeline forecasting',
      'How it works',
      'trust',
      'our pricing',
      'By deal size',
      'Set the stages',
      'It saved us a week.',
      '$49 | month',
      'Free for 14 days',
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('@type');
    // The link points at the page's address.
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain(
      'https://acme.example/pricing',
    );
  });
});

describe('the page fields an export carries (CE-057)', () => {
  const fields = {
    table: {
      note: 'Page fields: these go in your CMS fields.',
      rows: [
        ['Meta title', 'Pipeline forecasting: a guide'],
        ['Slug', 'pipeline-forecasting'],
        ['Reviewed by', 'Dr. Grace Hopper, Clinical Reviewer'],
      ] as [string, string][],
    },
    front: {
      title: 'Pipeline: "a guide"',
      description: 'How teams forecast.',
      slug: 'pipeline',
      author: '',
      reviewed_by: 'Dr. Grace Hopper, Clinical Reviewer',
    },
    head: {
      title: 'Pipeline forecasting: a guide',
      description: 'How "teams" <forecast>.',
      author: 'Ada Lovelace',
      reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
    },
  };

  it('gives Markdown front matter, each value quoted, an empty one left out, the title not again', () => {
    expect(draftMarkdown('Pipeline', '<h1>Pipeline</h1><p>Teams trust it.</p>', fields)).toBe(
      '---\ntitle: "Pipeline: \\"a guide\\""\ndescription: "How teams forecast."\nslug: "pipeline"\nreviewed_by: "Dr. Grace Hopper, Clinical Reviewer"\n---\n\nTeams trust it.\n',
    );
  });

  it('gives HTML its meta title, description, author and reviewer', () => {
    const doc = draftHtmlDocument('Pipeline', '<h1>Pipeline</h1>', fields);
    expect(doc).toContain('<title>Pipeline forecasting: a guide</title>');
    expect(doc).toContain(
      '<meta name="description" content="How &quot;teams&quot; &lt;forecast&gt;.">',
    );
    expect(doc).toContain('<meta name="author" content="Ada Lovelace">');
    expect(doc).toContain(
      '<meta name="reviewed-by" content="Dr. Grace Hopper, Clinical Reviewer">',
    );
  });

  it('gives Word a table of them on page 1, the page after it', async () => {
    const files = unzipSync(await read(await draftDocx('Pipeline forecasting', PAGE, fields)));
    const xml = strFromU8(files['word/document.xml']);
    const table = xml.indexOf('Pipeline forecasting: a guide');
    expect(xml.indexOf('Page fields: these go in your CMS fields.')).toBeLessThan(table);
    expect(xml).toContain('pipeline-forecasting');
    // The page starts on a page of its own.
    expect(xml.indexOf('How it works')).toBeGreaterThan(xml.indexOf('<w:sectPr'));
  });
});

describe('draftExportBlob and draftExportFileName', () => {
  it('gives each format its file', async () => {
    const md = await draftExportBlob('md', 'T', '<h1>T</h1>');
    expect(md.type).toBe('text/markdown;charset=utf-8');
    expect(strFromU8(await read(md))).toBe('# T\n');
    expect((await draftExportBlob('html', 'T', '<h1>T</h1>')).type).toBe('text/html;charset=utf-8');
    expect(draftExportFileName('Pipeline forecasting: a guide', 'docx')).toBe(
      'getcito_content_pipeline-forecasting-a-guide.docx',
    );
    expect(draftExportFileName('—', 'md')).toBe('getcito_content_page.md');
  });

  it('gives CSV marked as UTF-8 for Excel, and Excel as a workbook', async () => {
    const csv = await draftExportBlob('csv', 'T', '<h1>T</h1><p>Ünlü.</p>');
    expect(csv.type).toBe('text/csv;charset=utf-8;');
    const bytes = await read(csv);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(bytes.slice(3))).toContain('Ünlü.');
    const xlsx = await draftExportBlob('xlsx', 'T', '<h1>T</h1><p>Done.</p>');
    const files = unzipSync(await read(xlsx));
    expect(Object.keys(files)).toContain('xl/workbook.xml');
    expect(draftExportFileName('T', 'xlsx')).toBe('getcito_content_t.xlsx');
  });

  it('starts the name with a white label kit’s word instead, or none', () => {
    expect(draftExportFileName('T', 'docx', 'acme-agency')).toBe('acme-agency_content_t.docx');
    expect(draftExportFileName('T', 'docx', null)).toBe('content_t.docx');
  });

  it('names a white label kit’s company as the Word file’s author, and nobody without one', async () => {
    const core = async (author?: string) =>
      strFromU8(
        unzipSync(
          await read(await draftExportBlob('docx', 'T', '<h1>T</h1>', undefined, null, author)),
        )['docProps/core.xml'],
      );
    const branded = await core('Acme Agency');
    expect(branded).toContain('<dc:creator>Acme Agency</dc:creator>');
    expect(branded).toContain('<cp:lastModifiedBy>Acme Agency</cp:lastModifiedBy>');
    expect(await core()).not.toContain('Acme Agency');
    expect(await core()).not.toMatch(/getcito/i);
  });
});

describe('one page as a spreadsheet row (Excel, CSV)', () => {
  const fields = {
    table: { note: '', rows: [] as [string, string][] },
    front: {
      title: 'Pipeline forecasting: a guide',
      description: 'How teams forecast.',
      slug: 'pipeline-forecasting',
      author: 'Ada Lovelace',
      reviewed_by: 'Dr. Grace Hopper, Clinical Reviewer',
      image: 'https://acme.example/cover.png',
    },
    head: { title: '', description: '', author: '' },
  };

  it('holds the title, the page fields, its words and its HTML without the H1', () => {
    expect(pageSheetRow('Pipeline forecasting', PAGE, fields)).toMatchObject({
      Title: 'Pipeline forecasting',
      'Meta title': 'Pipeline forecasting: a guide',
      'Meta description': 'How teams forecast.',
      Slug: 'pipeline-forecasting',
      Author: 'Ada Lovelace',
      'Reviewed by': 'Dr. Grace Hopper, Clinical Reviewer',
      'Featured image': 'https://acme.example/cover.png',
      Content: expect.stringMatching(
        /^Teams trust it, every week\. See our pricing\.\nHow it works\n/,
      ),
      HTML: expect.stringMatching(/^<p>Teams <strong>trust<\/strong>/),
    });
    // Without Export's fields (the Library's row, the header's menu): read
    // from the page as Export reads them, with no author.
    expect(pageSheetRow('Pour-over guide', '<p>Done.</p>')).toMatchObject({
      'Meta title': 'Pour-over guide',
      'Meta description': 'Done.',
      Slug: 'pour-over-guide',
      Author: '',
      Characters: 5,
    });
    // An optimize draft's slug is its live page's: a CMS import updates it.
    expect(
      pageSheetRow('Pour-over guide', '<p>Done.</p>', undefined, 'https://acme.com/blog/pour-over/')
        .Slug,
    ).toBe('pour-over');
    // A list's items with "•": a cell starting "-" would be read as a formula.
    expect(pageSheetRow('T', '<h1>T</h1><ul><li>HubSpot</li></ul>').Content).toBe('• HubSpot');
    expect(pageCsv('T', '<h1>T</h1><ul><li>HubSpot</li></ul>')).toContain(',• HubSpot,');
  });

  it('writes CSV with its header, and Excel with a cell cut at its limit', () => {
    const csv = pageCsv('T', '<p>Done.</p>', fields);
    // Reviewed by came later: it goes last, so an import by position still fits.
    expect(csv.split('\n')[0]).toBe(
      'Title,Meta title,Meta description,Slug,Author,Featured image,Characters,Content,HTML,Reviewed by',
    );
    expect(csv).toContain('<p>Done.</p>');
    const long = `<p>${'x'.repeat(40_000)}</p>`;
    const [{ data }] = pageWorkbook('T', long, fields);
    expect(data[0][0]).toEqual({ value: 'Title', fontWeight: 'bold' });
    const content = data[1][7] as string;
    expect(data[1][9]).toBe('Dr. Grace Hopper, Clinical Reviewer');
    expect(content).toHaveLength(32_767);
    expect(content.endsWith('…')).toBe(true);
  });
});

describe('the Library’s Export', () => {
  const item = (over: Partial<LibraryExportItem> = {}): LibraryExportItem => ({
    title: 'Pipeline forecasting',
    status: 'In review',
    method: 'Optimize',
    pageType: 'Blog post',
    author: 'Content Agent',
    createdAt: '2026-10-20T09:00:00Z',
    updatedAt: '2026-10-21T15:30:00Z',
    url: 'https://acme.example/blog/forecasting',
    html: '<h1>Pipeline forecasting</h1><p>Teams <strong>trust</strong> it.</p><ol><li>Import</li><li>Stage</li></ol>',
    ...over,
  });

  it('reads a page as text, a block a line', () => {
    expect(draftText('T', PAGE)).toBe(
      [
        'Pipeline forecasting',
        'Teams trust it, every week. See our pricing.',
        'How it works',
        '- Weighted stages',
        '  - By deal size',
        '- Rep calls',
        '1. Import deals',
        '2. Set the stages',
        '> It saved us a week.',
        'Plan | Price',
        'Starter | $49 | month',
        'Free for 14 days',
      ].join('\n'),
    );
  });

  it('writes one row a draft, in the header’s order, with its page’s text', () => {
    const csv = libraryCsv([item()]);
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'Title,Status,Method,Page type,By,Created,Updated,Page URL,Characters,Content',
    );
    expect(row).toContain(
      'Pipeline forecasting,In review,Optimize,Blog post,Content Agent,2026-10-20,2026-10-21,https://acme.example/blog/forecasting,',
    );
    expect(libraryRows([item()])[0]).toMatchObject({
      Characters: 'Pipeline forecastingTeams trust it.1. Import2. Stage'.length,
      Content: 'Pipeline forecasting\nTeams trust it.\n1. Import\n2. Stage',
    });
  });

  it('cuts a page past a spreadsheet cell’s limit', () => {
    const long = `<h1>T</h1><p>${'a'.repeat(40_000)}</p>`;
    const [{ data }] = libraryWorkbook([item({ html: long })]);
    const content = (data[1][9] as { value: string }).value;
    expect(content).toHaveLength(32_767);
    expect(content.endsWith('…')).toBe(true);
  });

  it('wraps the page text, a block a line, so Excel keeps its lines apart', () => {
    const [{ data }] = libraryWorkbook([item()]);
    expect(data[1][9]).toEqual({
      value: 'Pipeline forecasting\nTeams trust it.\n1. Import\n2. Stage',
      wrap: true,
    });
    // A one-line value stays a plain cell.
    expect(typeof data[1][0]).toBe('string');
  });

  it('puts every draft in one Word document, each on its own page', async () => {
    const files = unzipSync(
      await read(
        await libraryDocx([
          item(),
          item({ title: 'Churn', html: '<h1>Churn</h1><ol><li>One</li></ol>' }),
        ]),
      ),
    );
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('In review · Optimize · Blog post · Updated 2026-10-21');
    expect(xml).toContain('Churn');
    // Two sections: the second starts a new page.
    expect(xml.match(/<w:sectPr/g)).toHaveLength(2);
    // Each draft's numbered list counts on its own.
    const numbering = strFromU8(files['word/numbering.xml']);
    expect(numbering.match(/<w:num w:numId=/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('names the file by tab and day', () => {
    expect(libraryExportFileName('in_review', 'xlsx', new Date('2026-10-22T10:00:00Z'))).toBe(
      'getcito_content_library_in-review_2026-10-22.xlsx',
    );
    expect(
      libraryExportFileName('in_review', 'docx', new Date('2026-10-22T10:00:00Z'), 'acme-agency'),
    ).toBe('acme-agency_content_library_in-review_2026-10-22.docx');
  });

  it('names a white label kit’s company as the Word file’s author', async () => {
    const files = unzipSync(await read(await libraryDocx([item()], 'Acme Agency')));
    expect(strFromU8(files['docProps/core.xml'])).toContain('<dc:creator>Acme Agency</dc:creator>');
  });
});
