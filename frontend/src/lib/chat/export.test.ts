// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ANSWER_EXPORT_FORMATS,
  answerBlocks,
  answerDocumentBlocks,
  answerFileName,
  answerFormats,
  answerMarkdown,
  answerSheets,
  answerTables,
  exportHref,
  tableCsv,
  type ExportAnswer,
} from './export';

const ORIGIN = 'https://app.getcito.com';

const MARKDOWN = `## Neden düştü?

Perplexity **şubatta** _ılımlı_ düştü ¹ — [kaynak](https://example.com/a?b=1&c=2).
İkinci satır.

1. Fiyat sayfası
2. SSS bölümü
   - Şema ekle

- [Citations · 42 rows](/dashboard/citations?platform=perplexity)

## Sayfalar

| Sayfa | Atıf | Pay |
|---|---:|---:|
| /fiyat | 1,234 | 12% |
| [Ana sayfa](/dashboard/x) | 56.5 | 3% |

> Bir alıntı

| Rakip | Görünürlük |
|---|---|
| Ğüzel İşler | 4 |
`;

const ANSWER: ExportAnswer = {
  markdown: MARKDOWN,
  question: 'Why did Perplexity citations drop?',
  chatTitle: 'Perplexity drop',
  generatedAt: '2026-10-25T22:30:00Z',
  timezone: 'Europe/Istanbul',
  stamp: 'Generated Oct 26, 2026 · 01:30 GMT+3 · Data as of Oct 25, 2026 · 06:00',
  appOrigin: ORIGIN,
};

describe('exportHref', () => {
  it('keeps web and mail addresses, makes app pages whole, and drops the rest', () => {
    expect(exportHref('https://example.com/a', ORIGIN)).toBe('https://example.com/a');
    expect(exportHref('mailto:a@example.com', ORIGIN)).toBe('mailto:a@example.com');
    expect(exportHref('/dashboard/citations?x=1', ORIGIN)).toBe(
      'https://app.getcito.com/dashboard/citations?x=1',
    );
    expect(exportHref('/dashboard/citations', null)).toBeUndefined();
    expect(exportHref('javascript:alert(1)', ORIGIN)).toBeUndefined();
    expect(exportHref('//evil.example/x', ORIGIN)).toBeUndefined();
  });
});

describe('answerBlocks', () => {
  const blocks = answerBlocks(MARKDOWN, ORIGIN);

  it('reads headings, paragraphs with their formats and links, lists, tables and quotes', () => {
    expect(blocks[0]).toEqual({ kind: 'heading', level: 2, runs: [{ text: 'Neden düştü?' }] });
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      runs: [
        { text: 'Perplexity ' },
        { text: 'şubatta', bold: true },
        { text: ' ' },
        { text: 'ılımlı', italics: true },
        { text: ' düştü ¹ — ' },
        { text: 'kaynak', link: 'https://example.com/a?b=1&c=2' },
        { text: '.' },
        // A line break in the answer stays one, as the app shows it.
        { text: '', break: true },
        { text: 'İkinci satır.' },
      ],
    });
    const items = blocks.filter((block) => block.kind === 'item');
    expect(items).toEqual([
      { kind: 'item', ordered: true, level: 0, list: 1, n: 1, runs: [{ text: 'Fiyat sayfası' }] },
      { kind: 'item', ordered: true, level: 0, list: 1, n: 2, runs: [{ text: 'SSS bölümü' }] },
      { kind: 'item', ordered: false, level: 1, list: 2, n: 1, runs: [{ text: 'Şema ekle' }] },
      {
        kind: 'item',
        ordered: false,
        level: 0,
        list: 3,
        n: 1,
        // A data chip links to the app page with the same scope (item 33).
        runs: [
          {
            text: 'Citations · 42 rows',
            link: 'https://app.getcito.com/dashboard/citations?platform=perplexity',
          },
        ],
      },
    ]);
    expect(blocks.find((block) => block.kind === 'quote')).toEqual({
      kind: 'quote',
      paragraphs: [[{ text: 'Bir alıntı' }]],
    });
    const table = blocks.find((block) => block.kind === 'table');
    expect(table?.kind === 'table' && table.rows[0]).toEqual({
      header: true,
      cells: [[{ text: 'Sayfa' }], [{ text: 'Atıf' }], [{ text: 'Pay' }]],
    });
  });

  it('writes code as its lines, and HTML as its text', () => {
    expect(
      answerBlocks('```json\n{"a": 1}\n{"b": 2}\n```\n\n<div>Kutu &amp; içerik</div>'),
    ).toEqual([
      {
        kind: 'paragraph',
        runs: [{ text: '{"a": 1}' }, { text: '', break: true }, { text: '{"b": 2}' }],
      },
      { kind: 'paragraph', runs: [{ text: 'Kutu & içerik' }] },
    ]);
  });

  it('puts the question above the answer for Word and PDF', () => {
    expect(answerDocumentBlocks(ANSWER)[0]).toEqual({
      kind: 'heading',
      level: 1,
      runs: [{ text: 'Why did Perplexity citations drop?' }],
    });
  });
});

describe('answerTables', () => {
  it('gives each table its rows as text, named by the heading above it', () => {
    expect(answerTables(MARKDOWN)).toEqual([
      {
        name: 'Sayfalar',
        header: ['Sayfa', 'Atıf', 'Pay'],
        rows: [
          ['/fiyat', '1,234', '12%'],
          ['Ana sayfa', '56.5', '3%'],
        ],
      },
      { name: 'Sayfalar', header: ['Rakip', 'Görünürlük'], rows: [['Ğüzel İşler', '4']] },
    ]);
  });

  it('pads a short row to its header', () => {
    expect(answerTables('| a | b |\n|---|---|\n| 1 |\n')[0].rows).toEqual([['1', '']]);
  });
});

describe('answerFormats', () => {
  it('offers Markdown, Word and PDF always, and CSV and Excel with a table', () => {
    expect(answerFormats('Just text, **no** table.')).toEqual(['md', 'docx', 'pdf']);
    expect(answerFormats(MARKDOWN)).toEqual([...ANSWER_EXPORT_FORMATS]);
  });
});

describe('answerFileName', () => {
  it('is the question’s slug and the day it was generated, in its time zone', () => {
    // 22:30 UTC on the 25th is the 26th in Istanbul.
    expect(answerFileName(ANSWER, 'pdf')).toBe('why-did-perplexity-citations-drop-2026-10-26.pdf');
    expect(answerFileName({ ...ANSWER, timezone: null }, 'md')).toBe(
      'why-did-perplexity-citations-drop-2026-10-25.md',
    );
  });

  it('takes the chat’s title for a question longer than 60 characters, and spells Turkish out', () => {
    const long = { ...ANSWER, question: 'x'.repeat(61), chatTitle: 'Şubat ayı görünürlük özeti' };
    expect(answerFileName(long, 'docx')).toBe('subat-ayi-gorunurluk-ozeti-2026-10-26.docx');
    expect(answerFileName({ ...ANSWER, question: '???', chatTitle: null }, 'md')).toBe(
      'answer-2026-10-26.md',
    );
  });
});

describe('answerMarkdown', () => {
  it('starts with the line, then the question, then the answer with app links made whole', () => {
    const md = answerMarkdown(ANSWER);
    const lines = md.split('\n');
    expect(lines[0]).toBe(ANSWER.stamp);
    expect(lines[2]).toBe('# Why did Perplexity citations drop?');
    expect(md).toContain(
      '[Citations · 42 rows](https://app.getcito.com/dashboard/citations?platform=perplexity)',
    );
    expect(md).toContain('[Ana sayfa](https://app.getcito.com/dashboard/x)');
    expect(md).toContain('[kaynak](https://example.com/a?b=1&c=2)');
    expect(md).toContain('| Ğüzel İşler | 4 |');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('leaves app links as they are with no origin', () => {
    expect(answerMarkdown({ ...ANSWER, appOrigin: null })).toContain('](/dashboard/x)');
  });
});

describe('tableCsv', () => {
  it('starts with the line, then the header and rows, quoted where needed', () => {
    const [table] = answerTables(MARKDOWN);
    expect(tableCsv(table, ANSWER.stamp).split('\n')).toEqual([
      // The line has commas, so it is one quoted cell.
      `"${ANSWER.stamp}"`,
      'Sayfa,Atıf,Pay',
      '/fiyat,"1,234",12%',
      'Ana sayfa,56.5,3%',
    ]);
  });

  it('keeps a cell from running as a formula', () => {
    const table = { name: null, header: ['a'], rows: [['=1+1']] };
    expect(tableCsv(table, 'Generated').split('\n')[2]).toBe("'=1+1");
  });
});

describe('answerSheets', () => {
  it('makes one sheet per table: the line, a bold header, numbers as numbers', () => {
    const sheets = answerSheets(ANSWER);
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['Sayfalar', 'Sayfalar (2)']);
    expect(sheets[0].data[0]).toEqual([{ value: ANSWER.stamp, color: '#6B7280' }]);
    expect(sheets[0].data[1]).toEqual([
      { value: 'Sayfa', fontWeight: 'bold' },
      { value: 'Atıf', fontWeight: 'bold' },
      { value: 'Pay', fontWeight: 'bold' },
    ]);
    expect(sheets[0].data.slice(2)).toEqual([
      ['/fiyat', 1234, '12%'],
      ['Ana sayfa', 56.5, '3%'],
    ]);
    expect(sheets[1].data[2]).toEqual(['Ğüzel İşler', 4]);
  });

  it('names a sheet as Excel allows', () => {
    const md = '## Q3: pages / [top]?\n\n| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n';
    const names = answerSheets({ ...ANSWER, markdown: `# ${'L'.repeat(40)}\n\n${md}` }).map(
      (sheet) => sheet.sheet,
    );
    expect(names).toEqual(['Q3 pages top', 'Q3 pages top (2)']);
    expect(answerSheets({ ...ANSWER, markdown: '| a |\n|---|\n| 1 |\n' })[0].sheet).toBe('Table 1');
    expect(
      answerSheets({ ...ANSWER, markdown: `## ${'x'.repeat(40)}\n\n| a |\n|---|\n| 1 |\n` })[0]
        .sheet,
    ).toHaveLength(31);
  });

  it('has none without a table', () => {
    expect(answerSheets({ ...ANSWER, markdown: 'No table here.' })).toEqual([]);
  });
});
