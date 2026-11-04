import { describe, expect, it } from 'vitest';
import { oneH1Html } from './oneH1';

/** A page coming in whole keeps one H1, its title. */
describe('oneH1Html', () => {
  it('keeps the first H1 with words and makes the others H2s', () => {
    expect(oneH1Html('<h1>Title</h1><p>a</p><h1>Key <em>takeaways</em></h1><p>b</p>')).toBe(
      '<h1>Title</h1><p>a</p><h2>Key <em>takeaways</em></h2><p>b</p>',
    );
  });

  it('unwraps an H1 without words, so a logo never takes the title', () => {
    expect(oneH1Html('<h1><img src="/logo.png" alt=""></h1><h1>Title</h1>')).toBe(
      '<img src="/logo.png" alt=""><h1>Title</h1>',
    );
  });

  it('leaves a page with one H1, or none, as it was', () => {
    expect(oneH1Html('<h1>Title</h1><h2>A</h2>')).toBe('<h1>Title</h1><h2>A</h2>');
    expect(oneH1Html('<p>Just text</p>')).toBe('<p>Just text</p>');
  });
});
