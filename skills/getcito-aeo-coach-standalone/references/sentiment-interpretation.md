# Sentiment interpretation

Each tracked AI response is tagged `positive`, `neutral`, or `negative`.
Sentiment is **not** part of the visibility score (see
[`visibility-scoring.md`](visibility-scoring.md)), but it's the loudest
**signal** about why a number changed.

## Net sentiment (Mentions & Sentiment)

The Mentions tools add up the tags over the responses that name the
brand:

- **Net sentiment** = positive share − negative share, from −100 to
  +100. Quote it signed, without a % sign: "net +21". +20 with 40%
  positive and 20% negative reads very differently from +20 with 20%
  positive and 0% negative, so give the split when it matters.
- **Low sample:** under 20 responses naming the brand, a figure
  carries `lowSample: true` and its change is `null`. Say "low sample,
  n = 12" and don't compare it with another window.
- **Per platform:** each platform has its own net. A platform with a
  much lower net than the rest is where to look first. Two platforms
  40+ points apart usually describe the brand differently, which is
  worth quoting from `list_mentions` (`GET /mentions`) excerpts.
- **Corrections:** a person can mark a response's sentiment as wrong.
  The corrected tone counts everywhere, and `get_mention`
  (`GET /mentions/{id}`) shows who corrected it and why.
- **Brand only:** competitors have no sentiment yet. Don't describe a
  competitor's tone.

## Three rules of thumb

1. **No mention = no sentiment.** If `mention_count = 0`, sentiment is
   irrelevant — the brand isn't in the answer at all. Don't mention
   sentiment in this case.
2. **Neutral is the default and is fine.** Most factual AI answers are
   neutral. A neutral mention with a citation is excellent.
3. **One negative response is noise. A pattern is a fire.** Don't alarm
   the user over a single negative reading. But if multiple recent
   results trend negative, surface it explicitly — that's a reputation
   issue, not an AEO one.

## When sentiment matters

- **Score is "OK" but sentiment is shifting negative.** Future
  visibility will erode even if current mentions hold steady. This is
  an early warning.
- **High-volume prompt suddenly turns negative.** Often points to a
  recent news cycle, support issue, or competitor messaging that the
  brand needs to respond to.
- **Sentiment positive but mentions drop.** The AI still likes the
  brand but isn't surfacing it. Usually a content-coverage problem (not
  enough material for the AI to pull from on this topic).

## When sentiment is noise

- **Small samples.** Under 20 responses naming the brand
  (`lowSample`), or a `resultCount` under 10 elsewhere, a single
  negative response moves the figure disproportionately. Caveat the
  answer.
- **Brand-comparison prompts.** "Should I use X or Y?" answers often
  read as neutral-negative for both brands because the AI is being
  even-handed. Don't treat that as a reputation problem.
- **Open-ended general questions.** "What is X?" answers are
  definitional and rarely emotional in either direction.

## What to tell the user

- **All neutral, score healthy:** _"You're being mentioned factually
  and consistently — that's the AEO sweet spot. No action needed."_
- **Trending positive recently:** _"Sentiment has improved over the
  last week — likely a recent piece of content or coverage is feeding
  the AIs a more favorable framing."_
- **Trending negative on a single prompt:** _"Worth eyeballing the
  actual response text on this prompt — there's a specific complaint or
  comparison driving the negative tone."_
- **Trending negative across many prompts:** _"This looks like a
  brand-perception issue, not an AEO issue. AEO can amplify whatever the
  AIs already think; the fix here is upstream — PR, support, or product
  signals the AIs are absorbing."_
