/**
 * Agents that publish and send on their own (AUTONOMOUS-GO-LIVE): what the
 * browser and the server share. Pure.
 */

/** The version of the responsibility text an Admin accepts (chatAccess.settings.goLive.dialog). */
export const GO_LIVE_TERMS = 1;

/** The go-live groups an Admin may allow on their own; v1 has publishing alone. */
export const GO_LIVE_GROUPS = ['publishing'] as const;

/** An agent's daily limit of go-lives, as an Admin sets it on the agent's form (§6.1), and its default. */
export const GO_LIVE_LIMIT_MIN = 1;
export const GO_LIVE_LIMIT_MAX = 20;
export const GO_LIVE_LIMIT_DEFAULT = 5;
