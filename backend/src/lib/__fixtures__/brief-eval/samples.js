/**
 * Two briefs for the first case (b2b-en-feature_page), as the model might
 * answer: one that follows the brief rules, one that breaks them. The eval's
 * own tests read them through shapeBrief, its checks and readJudged, and
 * judge answers for them stand in for a judge model's.
 */

/** Plans each H2's answer, its facts with their kind of source, a table, an FAQ, links. */
export const GOOD = {
  goal: 'Show finance leads how a rolling 13-week cash forecast works in Ledgerly, and why it beats a static budget.',
  audience: 'Finance leads at small companies who forecast cash in spreadsheets today.',
  outline: [
    {
      heading: 'What a rolling 13-week cash forecast is',
      keyPoints: [
        'Answer first: a 13-week forecast that moves forward one week every week, from known payments.',
        'TL;DR at the top: three key takeaways for the reader.',
      ],
      fanout: '13 week cash flow forecast template',
      platform: 'chatgpt',
    },
    {
      heading: 'Rolling cash forecast vs a static budget, side by side',
      keyPoints: [
        'A table comparing update cadence, accuracy and effort.',
        'Fact to state: how far forecasts drift, from a study.',
      ],
      fanout: 'rolling cash forecast vs static budget',
      platform: 'copilot-web',
    },
    {
      heading: 'How accurate cash forecasts are, and how to check yours',
      keyPoints: [
        'Proof to gather: Ledgerly’s own variance data from customers, dated.',
        'Add an "Updated" date and the year the figures are from.',
      ],
      fanout: 'how accurate are cash forecasts',
      platform: 'perplexity-web',
    },
    {
      heading: 'Choosing cash forecasting software for a small business',
      keyPoints: [
        'Steps to set it up in Ledgerly, as a numbered list.',
        'Link internally to the Ledgerly pricing page; cite the sources given.',
      ],
      fanout: 'cash forecasting software small business',
      platform: 'chatgpt',
    },
    {
      heading: 'Questions finance teams ask',
      keyPoints: ['An FAQ of the prompts, each answered in two sentences.'],
      fanout: null,
      platform: null,
    },
  ],
  keywords: ['rolling cash forecast', '13 week cash flow model', 'cash forecasting software'],
};

/**
 * Makes up a figure, a person, a quote and an address; answers one fan-out
 * of four; one section has no point.
 */
export const BAD = {
  goal: 'Rank for cash forecasting, cash forecasting software, best cash forecasting tool.',
  audience: 'Everyone.',
  outline: [
    {
      heading: 'Cash forecasting cash forecasting software best cash forecasting',
      keyPoints: [
        '73% of CFOs say forecasts fail.',
        'Read the CFO survey at https://made-up.example/report.',
        'Dr. Jane Doe recommends Ledgerly.',
      ],
      fanout: '13 week cash flow forecast template',
      platform: 'chatgpt',
    },
    { heading: 'More', keyPoints: [], fanout: null, platform: null },
  ],
  keywords: ['cash forecasting', 'cash forecasting software', 'best cash forecasting tool'],
};

/** A judge's answer for GOOD: its words quoted, one quote it doesn't have. */
export const GOOD_JUDGED = {
  scores: [
    {
      key: 'answerFirst',
      score: 2,
      quote: 'Answer first: a 13-week forecast that moves forward one week every week',
      why: 'The first H2 says its answer.',
    },
    {
      key: 'sourcedFacts',
      score: 1,
      quote: 'Fact to state: how far forecasts drift, from a study.',
      why: 'One fact, with its kind of source.',
    },
    {
      key: 'format',
      score: 2,
      quote: 'A table comparing update cadence, accuracy and effort.',
      why: 'A table and an FAQ.',
    },
    // Not the brief's words: it can't earn the score.
    {
      key: 'links',
      score: 2,
      quote: 'Link to the G2 category and the Ledgerly blog.',
      why: 'Links planned.',
    },
    { key: 'unknown', score: 2, quote: '', why: 'Not a criterion.' },
  ],
};
