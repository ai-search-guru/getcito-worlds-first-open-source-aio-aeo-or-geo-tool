/**
 * A white label logo as the report's PDF can draw it (00429): the PDF is made
 * in the browser by @react-pdf/renderer, which draws PNG and JPEG only, so an
 * SVG logo is drawn onto a canvas first and handed over as a PNG. Null when
 * it can't be; the PDF is then made without that logo.
 */

/** The longer side an SVG is drawn at, in pixels: sharp at a logo's printed size. */
const RASTER_SIZE = 800;

/** An SVG's own size, from its width and height or its viewBox; null for none. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const attr = (name: string) => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i').exec(tag)?.[1];
    return value ? Number(value) : null;
  };
  const width = attr('width');
  const height = attr('height');
  if (width && height) return { width, height };
  const box =
    /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  if (box && Number(box[1]) > 0 && Number(box[2]) > 0) {
    return { width: Number(box[1]), height: Number(box[2]) };
  }
  return null;
}

/** The SVG a data URL holds, as text. */
function svgText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const body = dataUrl.slice(comma + 1);
  return /;base64,/.test(dataUrl.slice(0, comma + 1))
    ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))
    : decodeURIComponent(body);
}

/** The logo as the PDF draws it: a PNG or JPEG as it is, an SVG as a PNG. */
export async function pdfImage(dataUrl: string | null): Promise<string | null> {
  if (!dataUrl) return null;
  if (!dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
  try {
    const size = svgSize(svgText(dataUrl)) ?? { width: 4, height: 1 };
    const scale = RASTER_SIZE / Math.max(size.width, size.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('Could not draw the SVG logo for the PDF:', err);
    return null;
  }
}
