/**
 * The longest a topic's name may be. Setup's prompt generation takes topics
 * up to this many characters (BRAND_SETUP_LIMITS.topic in aiBrandSetup.ts,
 * and backend/src/lib/brandSetupInput.js), and a topic is a few words, so the
 * Topics pages stop there and the actions refuse more: a longer name would
 * make Generate fail.
 */
export const TOPIC_NAME_CHARS = 100;

/** Whether a topic name, trimmed, fits. */
export const topicNameFits = (name: string) => name.trim().length <= TOPIC_NAME_CHARS;
