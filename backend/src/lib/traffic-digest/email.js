import { deliverEmail } from '../email.js';
import { changeText, platformName } from './summary.js';

/**
 * The AI Traffic weekly digest as an e-mail (AT-013, spec §3.8): the week's
 * summary line and its top three changes, laid out with the page's numbers
 * — three cards, the visits by day, the platforms — and a way to the AI
 * Traffic page and to the notification settings. English, like the Daily
 * Pulse.
 *
 * Built for mail clients: tables and inline styles only, no images or
 * scripts, so it reads the same in Gmail, Apple Mail and Outlook. A full
 * document that declares UTF-8 itself, whatever the client assumes.
 *
 * In the brand's colors and type (the style guide the product follows):
 * warm neutrals, locally available fonts, pill buttons. Red, green
 * and amber only say what a change was.
 */

const INK = '#1C1A17';
const MUTED = '#464442';
const SAND = '#F0EEEA';
const LINE = '#EBE6DE';
const WHITE = '#FFFFFF';
// What a change was: up, down, needs a fix — each on a tint of itself.
const UP = '#067647';
const UP_TINT = '#ECFDF3';
const DOWN = '#B42318';
const DOWN_TINT = '#FEF3F2';
const WARN = '#B54708';
const WARN_TINT = '#FFFAEB';
const FONT = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const formatNumber = (value) => Math.round(value).toLocaleString('en-US');

/** "Oct 12", or "Mon": calendar days in UTC, so written in UTC. */
function day(isoDay, options = { month: 'short', day: 'numeric' }) {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-US', {
    ...options,
    timeZone: 'UTC',
  });
}

/** Each change's mark: a broken link, a first, a rise or a fall. */
function changeMark(change) {
  if (change.type === 'broken') return { symbol: '!', color: WARN, background: WARN_TINT };
  if (change.before === 0) return { symbol: '✦', color: UP, background: UP_TINT };
  return change.now > change.before
    ? { symbol: '▲', color: UP, background: UP_TINT }
    : { symbol: '▼', color: DOWN, background: DOWN_TINT };
}

function card(label, value, sub, subColor = MUTED) {
  return `<td class="stack" width="33%" valign="top" style="padding:0 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
      <tr><td style="padding:14px 14px 12px 14px;">
        <div style="font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</div>
        <div style="font-size:26px;font-weight:500;letter-spacing:-0.03em;color:${INK};margin:6px 0 2px 0;line-height:1.2;">${escapeHtml(value)}</div>
        <div style="font-size:12px;color:${subColor};">${escapeHtml(sub)}</div>
      </td></tr>
    </table>
  </td>`;
}

function cards({ visits, prevVisits, change, platforms, share, citedNotClicked }) {
  const visitsSub =
    change !== null
      ? `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% on the week before`
      : prevVisits > 0
        ? `${formatNumber(prevVisits)} the week before`
        : 'none the week before';
  const visitsColor = change === null ? MUTED : change > 0 ? UP : DOWN;
  const top = platforms[0];
  const third = share
    ? card('Share of traffic', share, 'of all sessions in Analytics')
    : card(
        'Cited, not clicked',
        formatNumber(citedNotClicked),
        citedNotClicked === 1 ? 'page AI answers cite' : 'pages AI answers cite',
      );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px 20px -4px;">
    <tr>
      ${card('AI visits', formatNumber(visits), visitsSub, visitsColor)}
      ${card(
        'Top platform',
        top ? platformName(top.platform) : '—',
        top
          ? `${formatNumber(top.visits)} ${top.visits === 1 ? 'visit' : 'visits'}`
          : 'no AI visits',
      )}
      ${third}
    </tr>
  </table>`;
}

function section(title, body) {
  return `<div style="font-size:15px;font-weight:500;letter-spacing:-0.01em;color:${INK};margin:26px 0 10px 0;">${escapeHtml(title)}</div>${body}`;
}

/** Seven columns, one a day, as tall as its share of the busiest day. */
function dayBars(days) {
  const max = Math.max(1, ...days.map((d) => d.visits));
  const height = 72;
  const columns = days
    .map((d) => {
      const bar = d.visits > 0 ? Math.max(4, Math.round((d.visits / max) * height)) : 3;
      return `<td align="center" valign="bottom" style="padding:0 3px;">
        <div style="font-size:11px;color:${MUTED};margin-bottom:4px;">${d.visits > 0 ? formatNumber(d.visits) : ''}</div>
        <div style="width:70%;max-width:28px;height:${bar}px;line-height:${bar}px;font-size:0;background:${d.visits > 0 ? INK : LINE};border-radius:6px 6px 0 0;margin:0 auto;">&nbsp;</div>
      </td>`;
    })
    .join('');
  const labels = days
    .map(
      (d) =>
        `<td align="center" style="padding:6px 3px 0 3px;font-size:11px;color:${MUTED};">${escapeHtml(day(d.day, { weekday: 'short' }))}</td>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${LINE};">
    <tr style="height:${height + 20}px;">${columns}</tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${labels}</tr></table>`;
}

/** A row a platform: its name, a bar as long as its share of the top one, its visits. */
function platformBars(platforms) {
  const max = Math.max(1, ...platforms.map((p) => p.visits));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${platforms
    .map((p) => {
      const pct = Math.max(2, Math.round((p.visits / max) * 100));
      return `<tr>
        <td width="110" style="padding:5px 10px 5px 0;font-size:13px;color:${INK};white-space:nowrap;">
          ${escapeHtml(platformName(p.platform))}
        </td>
        <td style="padding:5px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};border-radius:4px;">
            <tr><td width="${pct}%" style="height:8px;line-height:8px;font-size:0;background:${INK};border-radius:4px;">&nbsp;</td><td style="font-size:0;">&nbsp;</td></tr>
          </table>
        </td>
        <td width="48" align="right" style="padding:5px 0 5px 10px;font-size:13px;font-weight:600;color:${INK};">${formatNumber(p.visits)}</td>
      </tr>`;
    })
    .join('')}</table>`;
}

function changeRows(changes) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${changes
    .map((c) => {
      const mark = changeMark(c);
      return `<tr>
        <td width="34" valign="top" style="padding:6px 0;">
          <div style="width:24px;height:24px;line-height:24px;border-radius:12px;text-align:center;font-size:12px;font-weight:600;color:${mark.color};background:${mark.background};">${mark.symbol}</div>
        </td>
        <td valign="top" style="padding:8px 0 6px 0;font-size:14px;line-height:1.5;color:${INK};">${escapeHtml(changeText(c))}</td>
      </tr>`;
    })
    .join('')}</table>`;
}

/**
 * @param {{ brandName: string, week: { firstDay: string, lastDay: string },
 *   visits: number, prevVisits?: number, change: number | null, sentences: string[],
 *   changes: object[], share?: string | null, citedNotClicked?: number,
 *   platforms?: { platform: string, visits: number }[], days?: { day: string, visits: number }[],
 *   trafficUrl: string, settingsUrl: string }} digest
 * @returns {{ subject: string, html: string }}
 */
export function renderTrafficDigestEmail({
  brandName,
  week,
  visits,
  prevVisits = 0,
  change,
  sentences,
  changes,
  share = null,
  citedNotClicked = 0,
  platforms = [],
  days = [],
  trafficUrl,
  settingsUrl,
}) {
  const range = `${day(week.firstDay)} – ${day(week.lastDay)}`;
  const count = `${formatNumber(visits)} AI ${visits === 1 ? 'visit' : 'visits'}`;
  const pct = change === null ? '' : ` (${change > 0 ? '+' : '−'}${Math.abs(change)}%)`;
  const subject = `${brandName} AI traffic last week: ${count}${pct}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
<style>
  /* Phones: the cards stack and the margins narrow. Clients that ignore
     this (Outlook) keep the three columns. */
  @media (max-width: 480px) {
    .stack { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
    .pad { padding-left: 18px !important; padding-right: 18px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${SAND};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${WHITE};border:1px solid ${LINE};border-radius:16px;overflow:hidden;font-family:${FONT};">
  <tr><td class="pad" style="background:${INK};padding:26px 28px;">
    <div style="font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${LINE};">GetCito · AI Traffic weekly</div>
    <div style="font-size:26px;font-weight:500;letter-spacing:-0.03em;color:${WHITE};margin:8px 0 4px 0;">${escapeHtml(brandName)}</div>
    <div style="font-size:14px;color:${SAND};opacity:0.8;">Visits from AI assistants to your site, ${escapeHtml(range)}</div>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 8px 28px;">
    ${cards({ visits, prevVisits, change, platforms, share, citedNotClicked })}
    <div style="background:${SAND};border-radius:12px;padding:16px 18px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(sentences.join(' '))}</div>
    ${days.length ? section('AI visits by day', dayBars(days)) : ''}
    ${platforms.length ? section('By platform', platformBars(platforms)) : ''}
    ${changes.length ? section('Top changes', changeRows(changes)) : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;">
      <tr><td style="background:${INK};border-radius:100px;">
        <a href="${escapeHtml(trafficUrl)}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:500;color:${WHITE};text-decoration:none;border-radius:100px;">Open AI Traffic →</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:18px 28px 24px 28px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${MUTED};">
    You're receiving this because the AI Traffic weekly digest is on for ${escapeHtml(brandName)}.
    <a href="${escapeHtml(settingsUrl)}" style="color:${INK};">Manage notification settings</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

/** Sends through the Resend HTTP API: 'sent', 'refused', 'unknown' or 'skipped' (deliverEmail). */
export function sendTrafficDigestEmail({ to, subject, html, settingsUrl }) {
  return deliverEmail({ to, subject, html, headers: { 'List-Unsubscribe': `<${settingsUrl}>` } });
}
