import { describe, expect, it } from 'vitest';

import { stripEntityMarkup } from './entityMarkup';

describe('stripEntityMarkup', () => {
  it('replaces each entity tag with its value', () => {
    const text =
      '1. **<Entity category="software" value="Tesseract" disambig="Adlift AI search optimization platform"/>** — tracks answers.\n' +
      '2. **<Entity category="software" value="GetCito" />** — open source.';
    expect(stripEntityMarkup(text)).toBe(
      '1. **Tesseract** — tracks answers.\n2. **GetCito** — open source.',
    );
  });

  it('reads the value whatever the attribute order, quoting and spacing', () => {
    expect(stripEntityMarkup('<Entity value="Acme" category="company"/>')).toBe('Acme');
    expect(stripEntityMarkup("<Entity category='company' value='Acme'/>")).toBe('Acme');
    expect(stripEntityMarkup('<Entity\n  category = "company"\n  value = "Acme"\n/>')).toBe('Acme');
  });

  it('unescapes XML escapes in the value', () => {
    expect(stripEntityMarkup('<Entity category="company" value="AT&amp;T"/>')).toBe('AT&T');
    expect(stripEntityMarkup('<Entity value="&quot;Q&quot; &#39;R&#x27;"/>')).toBe('"Q" \'R\'');
  });

  it('keeps escapes for characters a text column cannot hold', () => {
    expect(stripEntityMarkup('<Entity value="a&#0;b&#xD800;c"/>')).toBe('a&#0;b&#xD800;c');
  });

  it('keeps an attribute containing ">" or "/>" inside its value', () => {
    expect(stripEntityMarkup('<Entity value="A/B" disambig="x > y />"/> ok')).toBe('A/B ok');
  });

  it('leaves a tag without a value as it is', () => {
    const text = 'See <Entity category="software"/> here.';
    expect(stripEntityMarkup(text)).toBe(text);
  });

  it('leaves other tags and look-alikes alone', () => {
    const text = '<entity class="User"/> <EntityList value="x"/> <Entity value="open">';
    expect(stripEntityMarkup(text)).toBe(text);
  });

  it('returns empty and plain text unchanged', () => {
    expect(stripEntityMarkup('')).toBe('');
    expect(stripEntityMarkup('No tags here.')).toBe('No tags here.');
  });
});
