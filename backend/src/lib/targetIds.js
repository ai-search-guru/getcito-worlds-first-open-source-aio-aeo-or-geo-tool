/**
 * The most target keys a signal or an action lists beyond the targets it
 * names (AC-009). A group signal names 50 targets with their labels and
 * lists every one's id up to this, so the action it starts counts and keeps
 * the whole group (action_entities, 00244); bigger groups count up to here.
 */
export const MAX_TARGET_IDS = 1000;

/**
 * The keys an action keeps, as action_entities keeps them (00244): each
 * trimmed of spaces, once, in order, up to MAX_TARGET_IDS; none empty, no
 * object or list, and no text that starts with "{" or "[" (00244 reads those
 * as an object's text, e.g. old signals' { url, score }). An action's
 * targetCount is their number, so its payload and its list agree.
 */
export function targetKeys(values) {
  const keys = new Set();
  for (const value of values) {
    if (keys.size >= MAX_TARGET_IDS) break;
    if (value !== null && typeof value === 'object') continue;
    const key = String(value ?? '').replace(/^ +| +$/g, '');
    if (key && key[0] !== '{' && key[0] !== '[') keys.add(key);
  }
  return [...keys];
}
