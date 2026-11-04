/**
 * What a status change does to an opportunity's source data (CONTENT-006).
 *
 * Dismissing can say why: the topic doesn't matter to the brand, or the topic
 * is right and the angle wrong. The reason lives in source_data while the
 * opportunity stays dismissed and goes once it's restored, so it never
 * describes an opportunity the user kept.
 */

export const DISMISS_REASONS = ['not_relevant', 'wrong_angle'];

/** Status values accepted by dashboard actions and external webhook callbacks. */
export const VALID_OPPORTUNITY_STATUSES = Object.freeze([
  'new',
  'reviewed',
  'sent',
  'in_progress',
  'done',
  'dismissed',
]);

/**
 * The source data to write with a status change, or null when it stays as
 * it is. An unknown reason is ignored.
 */
export function sourceDataForStatus(sourceData, status, reason) {
  const sd = sourceData || {};
  if (status === 'dismissed' && DISMISS_REASONS.includes(reason)) {
    return sd.dismissReason === reason ? null : { ...sd, dismissReason: reason };
  }
  if (status !== 'dismissed' && sd.dismissReason) {
    const { dismissReason: _dropped, ...rest } = sd;
    return rest;
  }
  return null;
}
