/** The longest text `?compose=` hands Chat Home's box. */
export const MAX_COMPOSE = 500;

/**
 * The text `?compose=` hands Chat Home's box (a skill's Schedule on the
 * Skills page, W3-07): one value, trimmed of control characters, at most
 * MAX_COMPOSE characters; null for none. It only fills the box: the person
 * reads it and sends it.
 */
export function composeText(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, MAX_COMPOSE);
  return text.trim() ? text : null;
}

/** Chat Home with its box filled with `text`. */
export const composeHref = (text: string) =>
  `/dashboard/chat?${new URLSearchParams({ compose: text.slice(0, MAX_COMPOSE) })}`;
