---
title: Your first results after brand setup
route: /dashboard/insights
keywords: [first results, after onboarding, first run, first tracking, visibility zero, brand name prompts, tracking snippet]
synonyms: [no data yet, empty dashboard, why is my score zero, what happens next, how long until results]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/add-your-first-brand.mdx]
---
When you finish setting up a brand, the first round of questions to the AI engines starts on its own and the dashboard opens. On a self-hosted install it starts right away. In cloud mode it starts after the plan and checkout step, whether you start a free trial there or buy the plan. If you explore the demo brand instead, your brand's first run starts when you pick a plan.

## How long the first run takes

The first run can take anywhere from a few minutes to one or two hours at busy times. **Brand Visibility** shows that the first tracking is in progress, and fills in with your results as they come back.

You can leave the page: the run keeps going in the background. When your workspace's first results are ready, everyone in it gets one e-mail, **Your first results are ready**, where your deployment has e-mail set up. It's sent once, not for every brand you add.

## Where results appear first

While you wait:

- **Brand Visibility** fills in with your first results.
- **Citations** fills in with the addresses of the pages AI answers cite.
- **Prompt Suggestions**, on the **Prompts** page, offers prompt ideas to add to tracking.

## Add another brand

To add another brand, admins and managers pick **Add Brand** in the brand switcher. It walks through the same first five steps as your first brand: brand basics, region and language, topics, prompts and competitors. Its first run starts when you finish. Your plan sets how many brands you can have.

## Add the tracking snippet

Setup doesn't include the tracking snippet. It's an optional step you do separately for **AI Referral Traffic**: real visits that arrive on your site from AI answer engines.

1. Pick **AI Referral Traffic** in the sidebar. Until the snippet sends its first visit, the code is shown at the top of the page. After that, **Code** beside **Tracking snippet** in the **Data sources** strip shows it again.
2. Copy the snippet.
3. Paste it into the head section of your site's pages, just before the head closes. On WordPress, use a header injection plugin; on a static site, edit your template.

Once the snippet sends a visit, **Tracking snippet** in the **Data sources** strip shows it as active, with the time of the last visit.

## While the first tracking runs

Brand Visibility says **First tracking in progress** at the top until its first results are in. Above the **Tracked Prompts** table, a note says "Your first answers are arriving", with how many are in and about how long is left, and rows still without results say **Arriving now**. Everything fills in when tracking finishes. Meanwhile, do the **Ready now** steps of **Getting started** on the Action Center. When tracking finishes, the app says **Your first results are ready**.

## My visibility score is 0

Probably nothing is broken. New, niche or B2B brands often start at 0 on most prompts. AI engines need either plenty of training data that mentions your brand, or live citations from trusted sources. The score stays at 0 only while both are missing, and that is exactly what working on your AI visibility changes.

## Prompts that include my brand name

Remove them. A question that asks about your brand by name almost always scores high, because the AI obviously talks about you when asked. Such prompts don't measure how AI engines discover you on their own, and they distort your averages. Keep your tracked prompts free of your brand name.

## Competitors I've never heard of

Unknown brands in AI answers are useful: they're the alternatives people see when you aren't cited. Add the most-mentioned ones to your competitors to track them properly.

## An AI platform is missing

Your plan sets which AI platforms your prompts are asked on. A self-hosted install runs every platform. In cloud mode, some platforms come only with the higher plans.

## Add more topics and prompts later

You can add more at any time. On the **Topics** tab of the **Prompts** page, admins and managers add topics with **Add Topic** or from the **Topic Suggestions** card. **Prompt Suggestions** offers new prompts to track. New prompts run with the next daily run.
