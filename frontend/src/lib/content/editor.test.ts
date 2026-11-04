import { describe, expect, it } from 'vitest';
import {
  draftTitleFromDoc,
  lengthTarget,
  safeImageSrc,
  safeLinkHref,
  type EditorJsonNode,
} from './editor';

const doc = (...content: EditorJsonNode[]): EditorJsonNode => ({ type: 'doc', content });
const heading = (level: number, text: string): EditorJsonNode => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const paragraph = (...texts: string[]): EditorJsonNode => ({
  type: 'paragraph',
  content: texts.map((text) => ({ type: 'text', text })),
});

describe('draftTitleFromDoc', () => {
  it('names the draft by its first H1, wherever it is', () => {
    expect(
      draftTitleFromDoc(
        doc(paragraph('Intro'), heading(2, 'How it works'), heading(1, 'Pipeline forecasting')),
      ),
    ).toBe('Pipeline forecasting');
  });

  it('takes the first heading when there is no H1, then the first text', () => {
    expect(draftTitleFromDoc(doc(paragraph(''), heading(2, 'FAQ')))).toBe('FAQ');
    expect(draftTitleFromDoc(doc(paragraph('Lisbon ', 'in winter')))).toBe('Lisbon in winter');
  });

  it('cuts a long first paragraph at a word', () => {
    const title = draftTitleFromDoc(
      doc(
        paragraph(
          'Northwind forecasts each deal from real activity: emails, meetings and stage changes, every week.',
        ),
      ),
    );
    expect(title).toBe(
      'Northwind forecasts each deal from real activity: emails, meetings and stage…',
    );
  });

  it('is empty for an empty page, and keeps a heading to the column’s limit', () => {
    expect(draftTitleFromDoc(doc(paragraph()))).toBe('');
    expect(draftTitleFromDoc({ type: 'doc' })).toBe('');
    expect(draftTitleFromDoc(doc(heading(1, 'x'.repeat(400))))).toHaveLength(300);
  });
});

describe('lengthTarget', () => {
  it('follows the spec’s default Length rule per page type', () => {
    expect(lengthTarget('product_page')).toBe(1200);
    expect(lengthTarget('category_page')).toBe(800);
    expect(lengthTarget('blog_post')).toBe(3000);
    expect(lengthTarget(null)).toBe(3000);
  });
});

describe('safeLinkHref', () => {
  it('keeps web addresses, e-mail and paths on the brand’s site', () => {
    expect(safeLinkHref('https://gartner.com/en/sales')).toBe('https://gartner.com/en/sales');
    expect(safeLinkHref('  example.com/pricing ')).toBe('https://example.com/pricing');
    expect(safeLinkHref('mailto:sales@acme.com')).toBe('mailto:sales@acme.com');
    expect(safeLinkHref('/features/email-sync')).toBe('/features/email-sync');
  });

  it('refuses scripts and anything that isn’t a link', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('data:text/html,hi')).toBeNull();
    expect(safeLinkHref('//evil.com')).toBeNull();
    expect(safeLinkHref('/\\evil.com')).toBeNull();
    expect(safeLinkHref('hello')).toBeNull();
    expect(safeLinkHref('')).toBeNull();
  });
});

describe('safeImageSrc', () => {
  it('takes only http(s) addresses', () => {
    expect(safeImageSrc('https://cdn.acme.com/a.png')).toBe('https://cdn.acme.com/a.png');
    expect(safeImageSrc('/a.png')).toBeNull();
    expect(safeImageSrc('mailto:a@b.co')).toBeNull();
  });
});
