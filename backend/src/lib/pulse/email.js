import { sendEmail } from '../email.js';

/**
 * Daily Pulse email rendering + delivery via the Resend HTTP API (#540).
 *
 * Cloud-only: the caller gates on isCloud(). No SDK — a single fetch to
 * https://api.resend.com/emails with RESEND_API_KEY. When the key is
 * missing the send is a silent no-op so self-host / misconfigured
 * environments never crash the tracking pipeline.
 */

// Display names for platform slugs used in email copy. Keep in sync with
// PLATFORM_LABELS in frontend/src/config/platformLabels.ts.
const PLATFORM_LABELS = {
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Google Gemini',
};

function platformLabel(slug) {
  return PLATFORM_LABELS[slug] ?? slug;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signed(n, suffix = '') {
  const v = Math.round(n * 10) / 10;
  if (v > 0) return `+${v}${suffix}`;
  return `${v}${suffix}`;
}

function kpiCell(label, value, change) {
  const roundedChange = change === null ? null : Math.round(change * 10) / 10;
  const changeHtml =
    change === null
      ? ''
      : `<div style="font-size:12px;color:${roundedChange >= 0 ? '#059669' : '#dc2626'};">${escapeHtml(roundedChange >= 0 ? '▲' : '▼')} ${escapeHtml(signed(roundedChange))}</div>`;
  return `<td style="padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
    <div style="font-size:22px;font-weight:600;color:#111827;">${escapeHtml(value)}</div>
    ${changeHtml}
  </td>`;
}

function listItem(text) {
  return `<li style="margin:0 0 8px 0;color:#374151;font-size:14px;line-height:1.5;">${text}</li>`;
}

function highlightLine(h) {
  switch (h.type) {
    case 'first_citation':
      return listItem(
        `First citation for <a href="${escapeHtml(h.url)}" style="color:#2563eb;">${escapeHtml(h.label || h.url)}</a>${h.promptText ? ` — “${escapeHtml(h.promptText)}”` : ''}`,
      );
    case 'prompt_gain':
      return listItem(
        `“${escapeHtml(h.promptText)}” gained <strong>${escapeHtml(signed(h.gain, ' pts'))}</strong> visibility this week`,
      );
    case 'competitor_overtaken':
      return listItem(
        `You overtook <strong>${escapeHtml(h.competitorName)}</strong> on the leaderboard (${escapeHtml(String(h.brandRate))} vs ${escapeHtml(String(h.competitorRate))})`,
      );
    case 'new_engine':
      return listItem(
        `First appearance on <strong>${escapeHtml(platformLabel(h.platform))}</strong>`,
      );
    default:
      return '';
  }
}

function warningLine(w) {
  switch (w.type) {
    case 'sharp_drop':
      return listItem(
        `Visibility score dropped sharply: <strong>${escapeHtml(String(w.from))} → ${escapeHtml(String(w.to))}</strong> week-over-week`,
      );
    case 'visibility_slipping':
      return listItem(
        `Visibility is slipping: <strong>${escapeHtml(String(w.from))} → ${escapeHtml(String(w.to))}</strong> week-over-week`,
      );
    case 'competitor_surge':
      return listItem(
        `<strong>${escapeHtml(w.competitorName)}</strong> surged from ${escapeHtml(String(w.from))} to ${escapeHtml(String(w.to))} week-over-week`,
      );
    case 'competitor_crossed':
      return listItem(
        `<strong>${escapeHtml(w.competitorName)}</strong> crossed above your visibility score (${escapeHtml(String(w.competitorRate))} vs ${escapeHtml(String(w.brandRate))})`,
      );
    case 'lost_citations':
      return listItem(
        `High-volume prompt “${escapeHtml(w.promptText)}” has stopped citing you for 3 runs in a row`,
      );
    default:
      return '';
  }
}

/**
 * Render the pulse into { subject, html }.
 */
export function renderPulseEmail({ brandName, metrics, insightsUrl, settingsUrl }) {
  const { kpis, highlights, warnings, degradedPlatforms, windowDays } = metrics;
  const windowLabel = windowDays === 7 ? 'last 7 days' : 'last 24 hours';
  // The weekly frequency reads a 7-day window; daily and notable read a day.
  const title = windowDays === 7 ? 'Weekly Pulse' : 'Daily Pulse';

  const trend = kpis.weekTrend;
  const subject = `${brandName} ${title} — visibility ${kpis.visibilityRate} (${signed(trend)} pts this week)`;

  const highlightItems = highlights.map(highlightLine).filter(Boolean).join('');
  const warningItems = warnings.map(warningLine).filter(Boolean).join('');

  const degradedNote = degradedPlatforms.length
    ? `<p style="font-size:12px;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 12px;">
        Data collection was degraded on ${escapeHtml(degradedPlatforms.map(platformLabel).join(', '))} today, so drop detection was paused — numbers for ${degradedPlatforms.length > 1 ? 'these platforms' : 'this platform'} may look artificially low.
      </p>`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 4px 0;">${title} — ${escapeHtml(brandName)}</h1>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px 0;">How your brand showed up in AI answers over the ${windowLabel}.</p>

  <table role="presentation" cellspacing="8" style="border-collapse:separate;width:100%;margin-bottom:8px;">
    <tr>
      ${kpiCell('Visibility', String(kpis.visibilityRate), null)}
      ${kpiCell('7-day trend', String(kpis.weekRate), kpis.weekTrend)}
    </tr>
    <tr>
      ${kpiCell('Mentions', String(kpis.mentions), kpis.mentionsChange)}
      ${kpiCell('Citations', String(kpis.citations), kpis.citationsChange)}
    </tr>
    <tr>
      ${kpiCell('Positive sentiment', `${kpis.sentimentPct}%`, kpis.sentimentChange)}
      ${kpiCell('Prompts you appear in', `${kpis.visiblePrompts}/${kpis.promptCount}`, null)}
    </tr>
  </table>

  ${degradedNote}

  ${
    highlightItems
      ? `<h2 style="font-size:14px;color:#059669;margin:20px 0 8px 0;">✦ Highlights</h2>
         <ul style="margin:0;padding-left:20px;">${highlightItems}</ul>`
      : ''
  }

  ${
    warningItems
      ? `<h2 style="font-size:14px;color:#dc2626;margin:20px 0 8px 0;">⚠ Needs attention</h2>
         <ul style="margin:0;padding-left:20px;">${warningItems}</ul>`
      : ''
  }

  <div style="margin:28px 0;">
    <a href="${escapeHtml(insightsUrl)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">Open Insights</a>
  </div>

  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    You're receiving this because Daily Pulse is enabled for ${escapeHtml(brandName)}.
    <a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">Manage notification settings</a>
  </p>
</div>`;

  return { subject, html };
}

/**
 * Send a pulse email through the Resend HTTP API.
 * Returns true when accepted, false otherwise (missing key, HTTP error).
 */
export function sendPulseEmail({ to, subject, html, settingsUrl }) {
  return sendEmail({ to, subject, html, headers: { 'List-Unsubscribe': `<${settingsUrl}>` } });
}
