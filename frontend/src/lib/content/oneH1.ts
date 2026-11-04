/**
 * A page's HTML with one H1, its title, as the editor keeps it
 * (editor/_oneH1.ts): the first H1 with words stays, any later one becomes
 * an H2, and one without words (a logo) is unwrapped. For a page that comes
 * in whole: a paste, a file or an imported page in New content.
 */
export function oneH1Html(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let titled = false;
  for (const h1 of [...doc.body.querySelectorAll('h1')]) {
    if (!h1.textContent?.trim()) {
      h1.replaceWith(...h1.childNodes);
    } else if (titled) {
      const h2 = doc.createElement('h2');
      h2.append(...h1.childNodes);
      h1.replaceWith(h2);
    } else {
      titled = true;
    }
  }
  return doc.body.innerHTML;
}
