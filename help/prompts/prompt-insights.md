---
title: Prompt Insights tab and volume analysis
route: /dashboard/prompts/insights
keywords: [prompt insights, analyze volumes, refresh volumes, intent, similar topics, high opportunity prompts]
synonyms: [prompt volume, search demand, keyword volume, volume analysis]
plan: all
updated: 2026-11-01
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
The **Insights** tab of the **Prompts** page shows the estimated AI search volume of your tracked prompts, their intent and the highest-demand prompts. It has no date range, because volume estimates aren't tied to a period.

## Run a volume analysis

Volumes come from an analysis you run:

- **Analyze Volumes** the first time;
- **Analyze New Prompts** for prompts added since, shown while some have no volume;
- **Refresh Volumes** for newer Google data;
- **Re-analyze Keywords** to analyze every prompt again, keywords included.

On plans with a monthly analysis limit, each analysis counts against it, and the toolbar shows how many are left. **Tracked Prompts** also warns when some prompts haven't been analyzed yet.

## What the tab shows

For analyzed prompts you see:

- **Prompts Analyzed**, with how many keywords they cover, and **Total Est. AI Volume** and **Avg. AI Volume** across your prompts.
- Two **Prompt Volumes** cards: a chart of the total by answer engine, and a table with each prompt's **Google Vol. (head terms)** and **Est. AI Vol.**
- Each prompt's **Intent**: Comparison, How-to, What is, Best / Top, vs. / Review, Recommendation, Problem Solving or Other.
- **High Opportunity Prompts**: the prompts with the most estimated AI searches. A low-confidence estimate isn't listed there on its own.
- **Similar Topics**: the most-searched keyword clusters across your prompts. **See all** opens its own page.
- **AI Adoption Rate**: the share of Google searches that get an AI answer, used in every estimate.

## Where else estimated volumes show

- **Tracked Prompts**: the **Volume** column.
- A prompt's own page: an **AI searches a month** card, when the prompt has a volume.
- **Prompt Suggestions**: each AI suggestion's monthly range.
- Outside Prompts: the Action Center's affected prompts and topic opportunities, the Brand Visibility page's Opportunities, and a content opportunity's **Est. AI Volume**.

Exports mark estimated volumes, with their range and confidence, so a spreadsheet doesn't read them as counts.
