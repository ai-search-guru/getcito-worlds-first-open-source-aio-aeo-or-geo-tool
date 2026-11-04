import sanitizeHtml from 'sanitize-html';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  DEMOTED_HEADINGS,
  KEPT_SLOT,
  cleanHref,
  extractKeptBlocks,
  restoreKeptBlocks,
} from './htmlAllowlist';

/**
 * The server's check of a draft's HTML before it is saved (Content Editor
 * CE-005, spec §12: "The server re-checks the HTML before saving"). The
 * editor sends clean HTML already; this keeps a save made without it to the
 * same allow-list, so the save action never stores a script, an event
 * handler or a javascript: link. Schema JSON-LD stays, written again from
 * its JSON, and HTML blocks stay as their encoded code, checked to decode
 * and fit.
 *
 * Stored HTML is still untrusted: a member can also write
 * content_drafts.body_html straight through PostgREST (the update policy in
 * 00204), past this check. Whatever reads it parses it through the editor's
 * schema or cleans it again before showing it or handing it on.
 */
export function sanitizeDraftHtml(html: string): string {
  const { html: withSlots, kept } = extractKeptBlocks(html, { htmlBlocks: true });
  const clean = sanitizeHtml(withSlots, {
    allowedTags: [...ALLOWED_TAGS, KEPT_SLOT],
    allowedAttributes: { ...ALLOWED_ATTRIBUTES, [KEPT_SLOT]: ['data-i'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      ...Object.fromEntries(DEMOTED_HEADINGS.map((tag) => [tag, 'h3'])),
      a: (tagName, attribs) => {
        const href = cleanHref(attribs.href ?? '');
        const kept: sanitizeHtml.Attributes = href ? { href } : {};
        return { tagName, attribs: kept };
      },
    },
    // An image whose address was refused is no image at all.
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
  return restoreKeptBlocks(clean, kept);
}
