---
title: Add prompts to track
route: /dashboard/prompts/tracked
keywords: [add prompt, bulk import, track prompts, new prompt]
synonyms: [add a question, add queries, track a search]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
A prompt is a question GetCito asks the AI engines for your brand every day, such as "best project management tool for agencies". Its answers show where your brand is named and cited. You can add prompts one at a time, many at once, or from suggestions. Admins and managers can add prompts.

## Add a topic first

Prompts are grouped under topics, so a brand needs at least one topic before it can have prompts. Without one, **Add prompt**, **Bulk import**, **Track** and suggestions say **Add a topic first**. Admins and managers get an **Add a topic** button that opens **Prompts › Topics** with **Add Topic**. Other roles are asked to have an admin or a manager add one.

## Add one prompt

On **Prompts › Tracked Prompts**, click **Add prompt**. On the **Single** tab, type the question and pick its topic, platforms and AI models. **Add to list** queues several, and **Save & close** or **Save & add more** saves them. It is tracked in the brand's location; add more later with **Track in more locations**.

## Add many at once

In the same dialog, open the **Bulk import** tab and upload a one-column Excel or CSV file of prompts. A preview marks each row **Valid**, **Duplicate**, **Error** or **Over plan limit**, and the valid rows that fit are imported. They get the platforms and models picked in the dialog and the brand's location. Set their topic afterwards from each prompt's **Edit**, and add locations with **Track in more locations**.

## Add from suggestions

Switch the list to **Prompt Suggestions**. Add one suggestion with its **+** button, or every listed one with **Add All**.

## When the first results come

A prompt has no results until it is first asked. **Add prompt** and **Bulk import** start right away when they can. A prompt added from suggestions, or one whose analysis couldn't start, gets its first results with the next daily run. Until then, for its first two days, its row says **Within 24h**.

## What counts on your plan

Every prompt counts on your plan's prompt limit, once in each location it is tracked in. Paused prompts don't count. If adding would pass the limit, GetCito adds the prompts that fit and says how many weren't added. Once the limit is reached, it adds nothing until you pause or remove prompts.
