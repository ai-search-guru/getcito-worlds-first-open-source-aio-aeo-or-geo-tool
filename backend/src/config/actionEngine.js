/**
 * Action Engine thresholds — the numbers that decide what counts (#818).
 *
 * Every value here answers a judgement call: how far something has to move
 * before it is a signal, how much evidence is enough to raise an action, how
 * long to wait before believing a measurement. They were scattered across the
 * detectors that used them, which is survivable at a dozen detectors and
 * unmanageable at forty — and phase 3 brings forty. Tuning the engine should
 * mean editing this file, not going hunting.
 *
 * Grouped by the question each number answers rather than by the file that
 * currently reads it, so a later refactor moving a detector does not move its
 * threshold.
 *
 * Resolution order, per the specification: system default → definition
 * default → workspace override. Only the first exists today; `resolve()` is
 * the seam the other two arrive through, so callers already read their
 * thresholds through a function rather than a constant and none of them has
 * to change when they do.
 *
 * What is deliberately *not* here: retry counts, page sizes, poll intervals,
 * display limits. Those are operational choices with one right answer, not
 * product judgements anyone would want to tune per workspace.
 */

/**
 * @typedef {typeof ENGINE_THRESHOLDS} EngineThresholds
 */
export const ENGINE_THRESHOLDS = Object.freeze({
  /** What a detector looks at, and how much movement it takes to speak up. */
  detection: Object.freeze({
    /** Days of history a detector compares against. */
    windowDays: 7,

    /**
     * A visibility fall is judged by how much of the brand's own level it
     * took, not by a fixed number of points.
     *
     * Brands sit anywhere from under 1% to 88% visible; a points threshold
     * decides which of them are allowed to have the signal at all. At 15
     * points a brand sitting at 12% could lose four fifths of its visibility
     * unreported, having never had 15 points to lose — which is why the
     * detector had not fired once in production.
     *
     * The floor exists only to clear measurement noise: week-to-week movement
     * averages 1.2 points across live brands, so 3 sits comfortably above the
     * wobble without excluding anyone. Measured across 124 brands, the pair
     * reports about four a week.
     */
    visibilityDropRatio: 0.3,
    visibilityDropFloorPoints: 3,
    /** Below this many tracked prompts the average is too thin to trust. */
    visibilityDropMinPrompts: 10,

    /**
     * Early deterioration — the Protect family's trigger.
     *
     * Judged relatively like the collapse above, one band below it, so the two
     * grades are measured the same way and differ only in severity. A fixed
     * points band would have been almost empty: with the collapse at 30% of a
     * baseline, five points from a baseline of twenty leaves less than a point
     * of room between the grades.
     *
     * The baseline keeps it to brands with something to protect. Scores across
     * live brands average 9.8 and top out at 48, so ten is "above average" —
     * a real position, not a brand that was barely visible to begin with.
     */
    slippingMinRatio: 0.1,
    slippingMinBaseline: 10,

    /** A competitor's rise, in points, before it is worth reporting. */
    competitorSurgePoints: 15,

    /** Cited on this share of days, then nothing — the pattern that makes a
     *  gap look deliberate rather than random. */
    lostCitationCitedRatio: 0.6,
    /** Consecutive result-days with no citation before calling it lost. */
    lostCitationQuietDays: 3,

    /** A rise smaller than this is not a story worth telling. */
    moverMinGain: 5,

    /** Mentioned across at least this many prompts before an uncited-mentions
     *  signal is worth an action: one prompt is an anecdote. */
    uncitedMinPrompts: 3,

    /**
     * A platform gap worth naming.
     *
     * Platforms differ for everyone: the spread between a brand's best and
     * worst averages 12 points across live brands, so a gap alone is the
     * normal state. Twenty is comfortably above that average, and the floor
     * on the best platform is what makes the gap mean "achievable here,
     * absent there" rather than "weak everywhere". Together they report
     * about one brand in five.
     */
    platformGapPoints: 20,
    platformBestFloor: 25,
    /** A platform needs this many tracked prompts before its rate is a rate,
     *  and this many platforms must qualify before a comparison is one. */
    platformMinPrompts: 10,
    platformMinCompared: 3,

    /**
     * A citation gap worth naming.
     *
     * A competitor leads two thirds of brands on citations in any given week,
     * so being behind is not the signal — being behind by a multiple is. The
     * absolute floor keeps the multiple off small numbers, where twice as
     * many citations can mean four against two. Reports about one brand in
     * four.
     */
    citationGapMultiple: 2,
    citationGapMinAbsolute: 20,

    /** Site Audit score below this (out of 100; audits store 0–1) is a
     *  problem; an audit older than this is not evidence about the page as
     *  it stands today. */
    auditLowScore: 50,
    auditMaxAgeDays: 90,

    /** A page earning at least this many sessions, in the top percentile of
     *  its brand's pages, is worth acting on. Below it, the opportunity is
     *  too small to spend anyone's week on. */
    pageMinSessions: 10,
    pageMinPercentile: 70,
    /** Window the page opportunity detector measures over. Longer than the
     *  others: traffic needs weeks to say anything. */
    pageWindowDays: 28,
  }),

  /**
   * The V1 definition library's detectors (#818).
   *
   * These are first settings, not calibrations. Every number that the
   * original detectors use was measured against production before being
   * written down; these forty-odd could not all be, in the time it took to
   * build the definitions they feed. They are chosen to be conservative —
   * a detector that is quiet for a week is easy to loosen, one that floods a
   * brand's Action Center on its first night teaches people to ignore it —
   * and the per-kind signal cap below bounds the worst case either way.
   *
   * Recalibrate against a few clean nights of `signals` rows, the way
   * `platformGapPoints` and `citationGapMultiple` were.
   */
  library: Object.freeze({
    /** Current and previous windows, in days. */
    windowDays: 7,
    /** No detector writes more than this many signals of one kind per brand
     *  per night; the strongest are kept. A definition consolidates them into
     *  one action anyway, so the rest would be rows nobody reads. Measured on
     *  the first read-only run: at 10, the five citation-source kinds hit the
     *  ceiling on most brands and wrote 730 rows between them. */
    maxSignalsPerKind: 5,

    // Prompts
    /**
     * How long an open signal may go undetected before it is closed. Longer
     * than a day, so one quiet night — a value dipping just under its
     * threshold and back — does not close a signal and raise it again the
     * next morning. Two missed nights close it.
     */
    resolveAfterHours: 36,
    /** Tracked on at least this many days of the window before absence counts… */
    promptMinDays: 3,
    /**
     * …or answered at least this many times, whichever days. A new brand's
     * first run answers each prompt once per platform on a single day; this
     * is what lets that run open actions instead of waiting three days.
     */
    promptMinAnswers: 5,
    /** Mentioned on at least this many days before, and not at all now, is a
     *  lost mention rather than noise. */
    lostMentionMinDays: 3,
    /** Estimated AI demand at or above this makes a prompt high-value. */
    highDemandVolume: 100,
    /** Citation days falling below this fraction of before, but not to zero,
     *  is a citation at risk. Zero is lost, which the original detector owns. */
    citationRiskRatio: 0.5,
    citationRiskMinDays: 3,
    /** Fewer absent prompts than this is not an action's worth. */
    promptGroupMin: 3,

    // Topics
    topicMinPrompts: 4,
    /** Coverage bands: below `uncovered` a topic needs new content; between
     *  that and `partial` it needs expanding. */
    topicUncoveredCoverage: 0.2,
    topicPartialCoverage: 0.6,
    /** A topic worth protecting had at least this coverage before. */
    topicLeadershipCoverage: 0.4,

    // Platforms, regions and relative declines
    platformMinAnswers: 20,
    slipRatio: 0.1,
    dropRatio: 0.3,
    /** A platform or region has to have been worth something to slip. */
    rateFloor: 0.1,
    countryGapPoints: 0.15,

    // Competitors
    /** A competitor mentioned this many times the brand's count leads it. */
    competitorLeadMultiple: 1.5,
    competitorLeadMinMentions: 20,
    /** Mentions growing by this fraction, from at least `min`, is momentum. */
    competitorMomentumRatio: 0.5,
    competitorMomentumMin: 10,
    competitorTopicShare: 0.5,
    competitorPromptMinDays: 3,

    // Citation sources
    /** A domain needs this many answers citing it before it is a source. */
    sourceMinResults: 20,
    sourceMinPrompts: 3,
    /** Competitor-only share above which a source is competitor-winning. */
    competitorSourceShare: 0.5,
    /** A source the brand appears alongside in fewer than this share of
     *  answers is one it has little authority on. */
    authorityBrandShare: 0.25,
    authorityMinResults: 25,

    // Owned pages
    ownedPageMinCitations: 5,
    ownedPageSlipRatio: 0.7,

    // Fan-outs
    fanoutMinPrompts: 2,
    fanoutGroupMin: 5,

    // Search Console
    gscMinImpressions: 100,
    gscMinClicks: 10,
    /** Word-overlap needed to map a search query to a tracked prompt. */
    gscMatchOverlap: 0.5,
    gscDeclineRatio: 0.3,
    /** CTR below this fraction of what its position usually earns. */
    gscCtrShortfall: 0.5,

    // AI traffic
    aiTrafficMinSessions: 10,
    aiTrafficSlipRatio: 0.1,
    aiTrafficDropRatio: 0.3,
    /** AI visits down this much week over week, from at least this many the
     *  week before (AT-013, spec §3.8; 30 is the page's Low sample floor). */
    aiVisitsWeeklyDropRatio: 0.4,
    aiVisitsWeeklyMinVisits: 30,
    /** A missing page AI answers cite raises its signal from the first visit
     *  (the citations come from tracking); any other needs this many, since
     *  the beacon is public and one stray or made-up 404 visit would do. */
    brokenLinkMinVisits: 3,
    /** Key events per session above this multiple of the site's rate is a
     *  winning page; engagement below `underperform` of it is a weak one. */
    landingWinnerMultiple: 1.5,
    landingUnderperformMultiple: 0.6,
  }),

  /** Guards against the engine talking over itself. */
  noise: Object.freeze({
    /**
     * How long a kind rests after a cycle closes before a new one may open.
     * Without it, a condition that is still firing produces a fresh action
     * the night after someone closed the last one — a treadmill.
     */
    restAfterCloseDays: 14,

    /**
     * How long an action may stay New with no one's event (an assignment, an
     * edit, a task's status, a send) before it is marked stale. Not closed:
     * it is shown as Stale until someone keeps it with Still relevant or acts
     * on it. A month is four nightly weeks of it being passed over.
     */
    staleAfterDays: 30,

    /**
     * How many new actions one brand may be given in a day.
     *
     * A ceiling, not a target. Today it binds on nothing: eight definitions
     * produce at most three actions on a brand's busiest day, because a brand
     * rarely has more than a couple of distinct conditions firing at once.
     * The ceiling is the definition count, and the plan takes that to sixty —
     * at which point a bad night could hand someone a list nobody reads, and
     * the engine would have talked its way out of being believed.
     *
     * Five is what one person can plausibly start on in a week. Anything over
     * it is not lost: the condition is still firing, so the slot opens again
     * tomorrow, in priority order.
     */
    maxNewActionsPerDay: 5,

    /**
     * How many tasks the engine may carry out for itself in one nightly sweep,
     * across every brand.
     *
     * A ceiling on a night that goes wrong, not a target. Every tool reads —
     * one from our own rollups, one from the brand's analytics property — so
     * the cost of overshooting is API calls and time rather than damage, but a
     * detector misfiring across the base should not turn into a thousand
     * requests to a third party before anyone is awake to see it.
     *
     * Sized from what exists: seven brands have analytics connected and an
     * action carries at most two tool-backed tasks, so a normal night is well
     * under this. Reaching it is a signal in itself, and the sweep says so.
     */
    maxTaskRunsPerNight: 50,

    /**
     * Platform-wide result volume collapsing to this fraction of its trailing
     * daily average is a collection incident on our side, not a visibility
     * change on the customer's. Signals are suppressed rather than reported.
     */
    outageCollapseRatio: 0.25,
    /** Below this daily baseline the ratio above is meaningless. */
    outageMinBaseline: 20,
  }),

  /**
   * An action's priority score (AC-006): how soon to work on it beside the
   * others, 0–100 (lib/action-center/priority.js). Impact says how much an
   * action could matter; priority weighs it with the evidence behind it.
   *
   * Seven factors, each read as 0–1 and weighted to sum to 100. Two rules the
   * numbers keep:
   *
   *   * **Quantity is not priority.** Demand counts the most demanded few
   *     targets (`demandTopTargets`), on a logarithmic scale, and confidence
   *     counts independent kinds and sources of evidence — never how many
   *     signals repeat the same finding. Fifty low-demand prompts do not
   *     outrank five high-demand commercial ones.
   *   * **Impact is not the whole answer.** It is one factor of seven, so a
   *     medium-impact loss on high-demand prompts can come before a
   *     high-impact gap nobody searches for.
   *
   * The same score orders the queue of waiting findings, plus a little for
   * each day waited (`waitPerDay`, up to `waitCapDays`) so nothing starves:
   * two weeks of patience is worth about one level.
   */
  priority: Object.freeze({
    weightImpact: 20,
    weightDemand: 20,
    weightSeverity: 20,
    weightBusinessValue: 15,
    weightConfidence: 10,
    weightRecoverability: 10,
    weightRecency: 5,
    /**
     * Monthly AI searches (or search impressions, or sessions) at which
     * demand counts in full; logarithmic below — 10 → 0.26, 100 → 0.5,
     * 1,000 → 0.75.
     */
    demandFullAt: 10000,
    /** The most demanded targets that count toward demand. */
    demandTopTargets: 5,
    /** Demand and business value when nothing measures them: neither for nor against. */
    demandUnknown: 0.4,
    /**
     * The demand a prompt's measured demand level (PROMPT-014: Search
     * Console, Google Trends, People Also Ask, YouTube) brings an action
     * about it up to, at least: High as much as about 2,500 monthly AI
     * searches (0.85), Medium about 160 (0.55). Low adds nothing: signals
     * that found little are not proof that nobody asks.
     */
    realDemandHigh: 0.85,
    realDemandMedium: 0.55,
    businessValueUnknown: 0.5,
    /** Days for a finding's recency to halve. */
    recencyHalfLifeDays: 10,
    /** Levels: critical at 90 and above, high at 75, medium at 50, low below. */
    levelCritical: 90,
    levelHigh: 75,
    levelMedium: 50,
    /** In the queue of waiting findings, per day waited, up to `waitCapDays`. */
    waitPerDay: 1,
    waitCapDays: 14,
    /**
     * Past success (learning B4): how this brand's own earlier actions of
     * the same kind turned out, from its History scorecard over the last
     * `pastSuccessDays`. The share that improved, pulled toward
     * `pastSuccessPrior` by `pastSuccessPseudoCount` imagined results, so a
     * couple of results barely move it: a kind with none sits at the prior
     * and its score doesn't move. Never another brand's history. The score
     * moves by the rate's distance from the prior times `pastSuccessSwing`:
     * up to 10 points either way, about 6.7 for a kind that improved 10
     * times out of 10.
     */
    pastSuccessSwing: 20,
    pastSuccessPrior: 0.5,
    pastSuccessPseudoCount: 5,
    pastSuccessDays: 180,
  }),

  /** How an action's effect is measured once it closes. */
  validation: Object.freeze({
    /** Length of the before and after windows. Equal, so the comparison is
     *  between like periods. */
    windowDays: 7,

    /**
     * How much a metric must move to count as movement, as a fraction of its
     * before value. These numbers drift week to week on their own; without a
     * floor every outcome would be a verdict and none would mean anything.
     */
    meaningfulChangeRatio: 0.05,

    /**
     * Days of a window with no stamped tracking run beyond which its counts
     * can't be compared (learning A6): a missed night reads as fewer
     * mentions and citations, a decline nobody caused. Up to this many, the
     * counts are read at a full window's worth from the nights that ran, and
     * flagged; more, and they're left out of the verdict (not measurable when
     * the main metric is one).
     */
    maxGapDays: 2,

    /**
     * The day after an action closed its last, final reading is taken on
     * (learning B1). Its effect is read a week and two weeks on too, each
     * over the window's length ending that day, against the same week
     * before it was raised: a week is short for AI answers to take in a
     * change to a page, so the final read is a month on, as an Improve
     * action's is (improveOutcome.js); the earlier ones show where it was
     * heading.
     */
    finalReadingDay: 30,
  }),

  /**
   * What the "Analyze competitor content" task reads (learning C1): the
   * pages cited in the brand's tracked answers for the action's prompts over
   * the last `answersDays`, at most `perAction` competitor pages a run, at
   * most `perBrandPerDay` new reads a day for the brand (its own page
   * included; a run needing more than are left waits for the next night),
   * and a page read within `freshDays` reused rather than read again. Read
   * free, never through a paid scraper. Fewer than `minPages` competitor
   * pages read are compared with nothing; a run that finds nothing to
   * compare leaves the task to a person and tries again after `retryDays`.
   */
  competitorPages: Object.freeze({
    answersDays: 14,
    perAction: 3,
    perBrandPerDay: 12,
    freshDays: 14,
    minPages: 2,
    retryDays: 7,
  }),

  /**
   * What the "Analyze your winning pages" task compares (learning C4): at
   * most `perAction` of the action's winning pages (G14's landing pages, or
   * G10's own pages its prompts' answers cite) with the brand's other pages
   * that have a completed Site Audit from the last `auditDays`, at most
   * `others` of them, the newest audit first. Those are read from their
   * audits, never fetched. A winning page without one is read like a cited
   * page (competitorPages' reader): within the same `perBrandPerDay` reads
   * and reused while `freshDays` old. Fewer than `minOthers` other pages and
   * nothing is compared: the task stays a person's and tries again after
   * `retryDays`. The `missingPages` other pages missing the most of what the
   * winners have are listed.
   */
  winningPages: Object.freeze({
    perAction: 3,
    auditDays: 90,
    others: 30,
    minOthers: 3,
    missingPages: 5,
    retryDays: 7,
  }),

  /**
   * A competitor's pages over time (learning C3). first_cited: a competitor
   * never read is read back `backfillDays` once, the others from their last
   * read. changed: each night, a brand's `pagesPerBrand` competitor pages its
   * answers cited most over the last `citedDays` are read again once their
   * last read is `rereadDays` old, within what is left of the brand's
   * `competitorPages.perBrandPerDay` reads after the tasks' (C1, C4), and
   * compared with that read's word sketch (task-checks' CHANGED_BELOW and
   * MIN_CHANGED_RUNS). At most `brandsPerNight` brands a night.
   */
  competitorTimeline: Object.freeze({
    backfillDays: 90,
    citedDays: 14,
    pagesPerBrand: 10,
    rereadDays: 7,
    brandsPerNight: 200,
  }),
});

/**
 * Thresholds for one caller, with overrides layered over the defaults.
 *
 * Merges one group deep — `resolve({ detection: { windowDays: 14 } })` keeps
 * every other detection threshold. Deeper nesting would invite a config that
 * is harder to read than the code it configures.
 *
 * @param {Partial<Record<keyof EngineThresholds, Record<string, number>>>} [overrides]
 * @returns {EngineThresholds}
 */
export function resolve(overrides) {
  if (!overrides) return ENGINE_THRESHOLDS;
  const merged = {};
  for (const [group, defaults] of Object.entries(ENGINE_THRESHOLDS)) {
    merged[group] = Object.freeze({ ...defaults, ...(overrides[group] ?? {}) });
  }
  return Object.freeze(merged);
}
