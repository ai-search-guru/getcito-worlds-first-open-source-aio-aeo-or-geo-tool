import { describe, expect, it } from 'vitest';
import { pdfImage, svgSize } from './pdfImage';

/** A logo as the PDF draws it: PNG and JPEG as they are, an SVG drawn at its own shape. */

describe('svgSize', () => {
  it('reads an SVG’s width and height, else its viewBox', () => {
    expect(svgSize('<svg width="240" height="60px" viewBox="0 0 10 10"></svg>')).toEqual({
      width: 240,
      height: 60,
    });
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>')).toEqual({
      width: 120,
      height: 40,
    });
    expect(svgSize('<svg width="100%" height="100%"></svg>')).toBeNull();
  });
});

describe('pdfImage', () => {
  it('hands a PNG or JPEG over as it is, and nothing for no logo', async () => {
    expect(await pdfImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(await pdfImage('data:image/jpeg;base64,BBBB')).toBe('data:image/jpeg;base64,BBBB');
    expect(await pdfImage(null)).toBeNull();
  });
});
