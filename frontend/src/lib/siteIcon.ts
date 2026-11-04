/**
 * Demo logos ship with the app. Other sites get a local letter mark so
 * viewing a brand never sends its domain to an icon service.
 */
const DEMO_LOGOS = new Set([
  'brewline',
  'northboundroasters',
  'kettleandcrate',
  'morningritual',
  'daybreakbeans',
  'roastnotes',
  'dailybrewnews',
  'cupcompare',
  'brewersforum',
  'beanbulletin',
]);

function localLogoUrl(host: string, size: number): string {
  const name = host.replace(/^www\./, '').split('.')[0];
  if (host.endsWith('.example') && DEMO_LOGOS.has(name)) return `/demo/logos/${name}.svg`;
  const initial = (name[0] ?? '?').toUpperCase();
  const letter = /^[A-Z0-9]$/.test(initial) ? initial : '?';
  const pixels = Number.isFinite(size) ? Math.max(16, Math.min(512, Math.round(size))) : 128;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#44403c"/><text x="32" y="33" fill="#fafaf9" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Returns a bundled logo or an inline image, without making a network request.
 */
export function getSiteIconUrl(domain: string, size: number = 128): string {
  const clean = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  if (!clean) return '';
  return localLogoUrl(clean, size);
}
