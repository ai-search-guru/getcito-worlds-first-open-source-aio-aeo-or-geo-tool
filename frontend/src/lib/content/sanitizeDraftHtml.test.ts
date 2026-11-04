import { describe, expect, it } from 'vitest';
import { htmlBlockElement } from './htmlAllowlist';
import { sanitizeDraftHtml } from './sanitizeDraftHtml';

/**
 * What a save can't store, whoever sends it: the editor sends clean HTML,
 * a hand-made request may not.
 */
describe('sanitizeDraftHtml', () => {
  it('keeps what the editor writes', () => {
    const html =
      '<h1>Pipeline forecasting</h1><p><strong>Bold</strong> and <em>italic</em> ' +
      '<a href="https://gartner.com/x">Gartner</a></p><ul><li><p>One</p></li></ul>' +
      '<blockquote><p>Quote</p></blockquote>' +
      '<table><tbody><tr><th colspan="1" rowspan="1"><p>A</p></th></tr></tbody></table>' +
      '<p><img src="https://cdn.acme.com/a.png" alt="A" /></p>';
    expect(sanitizeDraftHtml(html)).toBe(html);
  });

  it('drops scripts, frames, styles, handlers and javascript: links', () => {
    expect(
      sanitizeDraftHtml(
        '<script>alert(1)</script><p style="color:red" class="x" onclick="x()">Hi ' +
          '<a href="javascript:alert(1)" onmouseover="x()">there</a></p>' +
          '<iframe src="https://evil.com"></iframe><style>p{}</style>' +
          '<img src="data:image/png;base64,AAAA"><img src="https://a.co/i.png" onerror="x()">' +
          '<a href="//evil.com">far</a>',
      ),
    ).toBe('<p>Hi <a>there</a></p><img src="https://a.co/i.png" /><a>far</a>');
  });

  it('turns H4–H6 into H3 and drops tracking parameters from links', () => {
    expect(
      sanitizeDraftHtml('<h5>Deep</h5><a href="https://acme.com/?utm_source=x&amp;id=2">a</a>'),
    ).toBe('<h3>Deep</h3><a href="https://acme.com/?id=2">a</a>');
  });

  it('keeps schema JSON-LD, and nothing that tries to break out of it', () => {
    expect(
      sanitizeDraftHtml(
        '<script type="application/ld+json">{"@type":"Product","name":"</script><script>alert(1)</script>"}</script>' +
          '<script type="application/ld+json">{"@type":"FAQPage","x":"a<b"}</script>',
      ),
    ).toBe(
      // The first block ends at the first </script>, so its JSON is cut and
      // dropped; the script after it is removed; the second block is kept.
      '"}<script type="application/ld+json">{"@type":"FAQPage","x":"a\\u003cb"}</script>',
    );
  });

  it('keeps HTML blocks as their encoded code, and drops ones that aren’t', () => {
    const block = htmlBlockElement('<script src="https://widget.example/x.js"></script>');
    expect(
      sanitizeDraftHtml(
        `<p>a</p>${block}<div data-html-block="&lt;script&gt;"></div>` +
          `${htmlBlockElement('x'.repeat(50_001))}<div data-html-block="" onclick="x()"></div>`,
      ),
    ).toBe(`<p>a</p>${block}`);
  });

  it('keeps the schema and the text after it on a page with Turkish İ before it', () => {
    const html =
      '<h1>İzmir İçin İpuçları</h1><script type="application/ld+json">{"@type":"FAQPage"}</script><p>After the schema.</p>';
    expect(sanitizeDraftHtml(html)).toBe(html);
  });

  it('cleans a 500,000-character page built to backtrack within the save’s time', () => {
    const input = '<script type=application/ld+json '.repeat(15_000);
    const started = performance.now();
    sanitizeDraftHtml(input);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
