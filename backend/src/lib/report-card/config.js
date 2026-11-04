/**
 * The free AI visibility report card's limits (Customer priorities §5;
 * owner decisions 2026-11-02), each from the environment so they change
 * without a deploy of code: 200 cards a day, $200 a month, one card per
 * company every 30 days, a few requests an hour from one address.
 *
 * The cost of an engine's answer and of the keyword call are estimates, kept
 * here too, until the provider contract confirms them; a card's real model
 * cost is counted from each call's tokens.
 */

/** Questions on a card. */
export const QUESTION_COUNT = 25;
/** What the caps fall back to with nothing set. */
export const DEFAULTS = Object.freeze({
  dailyCap: 200,
  monthlyBudgetUsd: 200,
  repeatDays: 30,
  ipHourly: 5,
  concurrency: 2,
  answerUsd: 0.002,
  volumeUsd: 0.075,
});
/** Where the form may post from, with nothing set. */
export const DEFAULT_ORIGINS = ['https://www.getcito.com', 'https://getcito.com'];

/** A non-negative number from the environment, or the fallback. */
function envNumber(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The limits in force: REPORT_CARD_DAILY_CAP, REPORT_CARD_MONTHLY_BUDGET_USD,
 * REPORT_CARD_REPEAT_DAYS, REPORT_CARD_IP_HOURLY, REPORT_CARD_CONCURRENCY,
 * REPORT_CARD_ANSWER_USD and REPORT_CARD_VOLUME_USD.
 */
export function reportCardLimits(env = process.env) {
  return {
    dailyCap: Math.floor(envNumber('REPORT_CARD_DAILY_CAP', DEFAULTS.dailyCap, env)),
    monthlyBudgetUsd: envNumber('REPORT_CARD_MONTHLY_BUDGET_USD', DEFAULTS.monthlyBudgetUsd, env),
    repeatDays: envNumber('REPORT_CARD_REPEAT_DAYS', DEFAULTS.repeatDays, env),
    ipHourly: Math.floor(envNumber('REPORT_CARD_IP_HOURLY', DEFAULTS.ipHourly, env)),
    concurrency: Math.max(
      1,
      Math.floor(envNumber('REPORT_CARD_CONCURRENCY', DEFAULTS.concurrency, env)),
    ),
    answerUsd: envNumber('REPORT_CARD_ANSWER_USD', DEFAULTS.answerUsd, env),
    volumeUsd: envNumber('REPORT_CARD_VOLUME_USD', DEFAULTS.volumeUsd, env),
  };
}

/**
 * What one card is expected to cost before it runs: every question in all
 * four engines, the keyword call, and a margin for the model calls. The
 * monthly budget keeps room for the cards queued.
 */
export function estimatedCardUsd(limits = reportCardLimits()) {
  return QUESTION_COUNT * 4 * limits.answerUsd + limits.volumeUsd + 0.05;
}

/** The origins the form may post from: REPORT_CARD_ORIGINS, comma-separated. */
export function reportCardOrigins(env = process.env) {
  const listed = String(env.REPORT_CARD_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return listed.length ? listed : DEFAULT_ORIGINS;
}
