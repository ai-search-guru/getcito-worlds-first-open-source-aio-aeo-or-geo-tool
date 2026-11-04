---
title: Daily Pulse email digest
route: /dashboard/settings/notifications
keywords: [daily pulse, digest, notifications, email summary, highlights, warnings]
synonyms: [daily email, weekly email, brand digest, visibility alerts, stop the emails]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/daily-pulse.mdx]
---
The Daily Pulse is a short digest for each brand that goes out after its scheduled tracking run. It shows the headline numbers for the period, then lists what went well (highlights) and what needs attention (warnings). It comes by email in cloud mode, and can also go to your webhook, in both cloud and self-hosted modes.

## Choose how often it comes

Open **Settings › Notifications**. Every active brand has its own row with a frequency and a recipient list. Admins and managers can change them; other members see them read-only. The **Manage notification settings** link at the bottom of every pulse email opens this page.

- **Daily** (the default): after every scheduled daily tracking run.
- **Weekly**: once a week on Monday (UTC), covering the last 7 days compared with the 7 days before.
- **Only when notable**: like Daily, but skipped when there are no highlights and no warnings.
- **Off**: no email and no webhook.

## Choose who gets it

Enter email addresses separated by commas. Leave the field empty to send to every member of the organization. Each address is checked when you save: if one isn't valid, the save is rejected and the invalid entries are listed under the field, so fix or remove them and save again. Up to 50 addresses are stored. Recipients apply to the email only, not to the webhook.

## AI Traffic weekly digest

Each brand's row also has **AI Traffic weekly digest**: every Monday, last week's AI visits in one summary line, with the top three changes. It goes to the same recipients, and isn't sent while the Daily Pulse is **Off**.

## When it is sent

A pulse follows a brand's scheduled daily tracking run; manual runs and single-prompt refreshes never trigger one. It waits up to 90 minutes for late answers, so its numbers match the dashboard. No pulse is sent when the frequency is **Off**, or **Weekly** and it isn't Monday; when the brand already had one that day; when there are no tracking results in the window; when the frequency is **Only when notable** and nothing is notable; or, in cloud mode, when the subscription isn't active or trialing.

## What's in a pulse

The KPIs are **Visibility**, the **7-day trend**, **Mentions** and **Citations**, **Positive sentiment**, and **Prompts you appear in**. For Daily and Only when notable, the period is the latest completed tracking run, at most 24 hours, compared with the run before it. For Weekly, it is the last 7 days compared with the 7 days before. The email subject carries the visibility score and the weekly trend; on Weekly, it says Weekly Pulse.

## Highlights

- **First citation**: a URL from a prompt's Target URLs list was cited by an AI engine for the first time. Up to 5 are listed.
- **Prompt gain**: a prompt's visibility score rose by 5 points or more this week versus last week. The top 3 are listed.
- **Competitor overtaken**: last week a competitor's score was at or above yours; this week yours is higher.
- **New engine**: your brand was mentioned or cited on an AI platform for the first time ever.

## Warnings

- **Sharp drop**: your visibility score fell week over week by at least 3 points and at least 30% of last week's score, for brands with 10 or more tracked prompts.
- **Competitor surge**: a competitor's score rose by 15 points or more week over week.
- **Competitor crossed**: a competitor at or below your score last week is above it this week.
- **Lost citations**: a prompt with an estimated AI volume above zero was cited on at least 60% of its result days in the last 14 days, then not at all on its 3 most recent.

A smaller fall shows as **Visibility slipping**, in the email and the webhook alike.

## Repeats and collection problems

The same warning about the same subject, such as a surge by the same competitor, isn't repeated within 7 days. Highlights have no such pause. If an AI platform's result volume collapses on GetCito's side, the pulse treats it as a collection problem rather than a real change: **Sharp drop**, **Visibility slipping** and **Lost citations** are held back, and the email notes which platforms were affected.

## Send it to a webhook

Every pulse also goes to the brand's active webhook, if it is subscribed to the Daily Pulse event: under **Content**, open **Webhook Settings** and tick **Daily Pulse created**. On self-hosted installs, this is the only way the pulse is delivered. The webhook carries the same KPIs, highlights and warnings as the email. The frequency applies to it too; the recipient list doesn't.
