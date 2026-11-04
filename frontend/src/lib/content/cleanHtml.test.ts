import { describe, expect, it } from 'vitest';
import { cleanHtml, formatHtmlSource, htmlFromSource, publishableHtml } from './cleanHtml';
import { htmlBlockElement } from './htmlAllowlist';

// A section copied from Google Docs: the whole copy in a non-bold <b>, bold
// and italic as styles, styled links with tracking parameters, an H5, a
// table, an image.
const GOOGLE_DOCS =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b">' +
  '<h1 dir="ltr" style="line-height:1.38"><span style="font-size:20pt;font-family:Arial;font-weight:700">Lisbon guide</span></h1>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt"><span style="font-weight:700;color:#000">Best time</span>' +
  '<span style="font-weight:400"> is </span><span style="font-style:italic">spring</span>. ' +
  '<a href="https://visitlisboa.com/en?utm_source=docs&amp;lang=en&amp;gclid=abc" style="text-decoration:none">' +
  '<span style="color:#1155cc">Visit Lisboa</span></a></p>' +
  '<ul style="margin-top:0"><li dir="ltr" style="list-style-type:disc"><p dir="ltr"><span>Alfama</span></p></li></ul>' +
  '<h5 dir="ltr"><span>Getting around</span></h5>' +
  '<div dir="ltr" align="left"><table style="border:none"><colgroup><col width="200"></colgroup><tbody><tr>' +
  '<td style="border-left:solid #000 1pt"><p dir="ltr"><span>Tram 28</span></p></td></tr></tbody></table></div>' +
  '<p><span><img src="https://lh7-rt.googleusercontent.com/docsz/abc" width="300"></span></p></b>';

describe('cleaning a paste', () => {
  it('keeps headings, bold, italic, links, lists and tables from Google Docs, and nothing else', () => {
    const { html, imagesRemoved, unsafeRemoved } = cleanHtml(GOOGLE_DOCS, { keepImages: false });
    expect(html).toBe(
      '<h1>Lisbon guide</h1>' +
        '<p><strong>Best time</strong> is <em>spring</em>. ' +
        '<a href="https://visitlisboa.com/en?lang=en">Visit Lisboa</a></p>' +
        '<ul><li><p>Alfama</p></li></ul>' +
        '<h3>Getting around</h3>' +
        '<table><tbody><tr><td><p>Tram 28</p></td></tr></tbody></table>',
    );
    expect(imagesRemoved).toBe(1);
    expect(unsafeRemoved).toBe(0);
  });

  it('keeps Word’s bold and drops its classes, fonts and empty o:p', () => {
    const word =
      '<p class="MsoNormal" style="mso-line-height:12pt"><b><span style="font-family:Calibri">Hello</span></b>' +
      '<span lang="EN-US"> world<o:p></o:p></span></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>';
    expect(cleanHtml(word, { keepImages: false }).html).toBe('<p><b>Hello</b> world</p>');
  });

  it('takes out scripts, iframes and event handlers, and counts them', () => {
    const { html, unsafeRemoved } = cleanHtml(
      '<script>alert(1)</script><p onclick="x()">Hi <a href="javascript:alert(1)">there</a></p>' +
        '<iframe src="https://evil.com"></iframe><img src="x" onerror="alert(1)">',
      { keepImages: true },
    );
    expect(html).toBe('<p>Hi <a>there</a></p>');
    expect(unsafeRemoved).toBe(2);
  });

  it('keeps schema JSON-LD, written again from its JSON', () => {
    const { html, unsafeRemoved } = cleanHtml(
      '<p>Shoe</p><script type="application/ld+json">\n{ "@type": "Product", "name": "X" }\n</script>',
      { keepImages: true },
    );
    expect(html).toBe(
      '<p>Shoe</p><script type="application/ld+json">{"@type":"Product","name":"X"}</script>',
    );
    expect(unsafeRemoved).toBe(0);
  });

  it('keeps web images in the HTML view, never embedded data', () => {
    const { html, imagesRemoved } = cleanHtml(
      '<p><img src="https://cdn.acme.com/a.png" alt="Shoe" style="width:10px"></p>' +
        '<p><img src="data:image/png;base64,AAAA"></p>',
      { keepImages: true },
    );
    expect(html).toBe('<p><img src="https://cdn.acme.com/a.png" alt="Shoe"></p>');
    expect(imagesRemoved).toBe(1);
  });

  it('keeps how a copy from the editor itself was cut', () => {
    const { html } = cleanHtml('<ul data-pm-slice="3 3 []"><li><p>One</p></li></ul>', {
      keepImages: true,
    });
    expect(html).toBe('<ul data-pm-slice="3 3 []"><li><p>One</p></li></ul>');
  });
});

describe('formatHtmlSource', () => {
  it('puts one block per line, as a draft stores it', () => {
    expect(
      formatHtmlSource(
        '<h1>A</h1><p>B <strong>C</strong> <a target="_blank" rel="noopener" href="/x">D</a></p>' +
          '<table style="min-width: 50px"><colgroup><col style="min-width: 25px"></colgroup>' +
          '<tbody><tr><td><p>E</p></td></tr></tbody></table>',
      ),
    ).toBe(
      '<h1>A</h1>\n<p>B <strong>C</strong> <a href="/x">D</a></p>\n<table>\n<tbody>\n<tr>\n<td>\n<p>E</p>\n</td>\n</tr>\n</tbody>\n</table>',
    );
  });
});

describe('HTML blocks', () => {
  const code = '<iframe src="https://www.youtube.com/embed/x"></iframe>\n<script>track()</script>';
  const page = `<h1>A</h1>${htmlBlockElement(code)}<p>B</p>`;

  it('come with the editor’s own HTML, never with a paste from elsewhere', () => {
    expect(cleanHtml(page, { keepImages: true, keepHtmlBlocks: true }).html).toBe(page);
    const pasted = cleanHtml(page, { keepImages: false });
    expect(pasted.html).toBe('<h1>A</h1><p>B</p>');
    expect(pasted.unsafeRemoved).toBe(0);
  });

  it('show as their code between markers in the HTML view, and go back as blocks', () => {
    const source = formatHtmlSource(page);
    expect(source).toBe(`<h1>A</h1>\n<!-- html-block -->\n${code}\n<!-- /html-block -->\n<p>B</p>`);
    expect(htmlFromSource(source)).toBe(`<h1>A</h1>\n${htmlBlockElement(code)}\n<p>B</p>`);
    // Code typed between new markers is a block; an empty pair is nothing.
    expect(
      htmlFromSource(
        '<!-- html-block -->\n<b>x</b>\n<!-- /html-block --><!-- html-block --><!-- /html-block -->',
      ),
    ).toBe(htmlBlockElement('<b>x</b>'));
  });

  it('go out as their own code when the page is copied as HTML', () => {
    const json = '<script type="application/ld+json">{"@type":"Product"}</script>';
    expect(publishableHtml(`${page}${json}`)).toBe(`<h1>A</h1>\n${code}\n<p>B</p>\n${json}`);
  });
});
