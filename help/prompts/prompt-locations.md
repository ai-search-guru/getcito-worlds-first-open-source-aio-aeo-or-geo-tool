---
title: Track prompts in more locations
route: /dashboard/prompts/tracked
keywords: [locations, add location, remove location, locations view, countries, us states, cities]
synonyms: [track in another country, regional tracking, geo tracking, stop tracking a location]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
A prompt can be tracked in several locations (countries, US states or cities), with its own figures in each one. In **Tracked Prompts** you compare them in the **Locations** view, and add or remove places with the **Track in more locations** dialog. Admins and managers add and remove locations.

## The Locations view

The **Table | Locations** switch, above the table, opens **Locations**: one row per prompt and one column per location your prompts track, the most-tracked first (12 at most). Pick **Visibility**, **Position**, **Mentions** or **Citations**; cells are shaded light to dark, and for Position, named earlier is darker.

An **All prompts · average** row and a **Gap** column (the best location minus the worst) sit beside three cards: **Weakest location**, **Strongest location** and **Biggest gap between locations**. Click a cell to open the prompt's Positions panel for that location. The date range and filters work as in the table.

## A location as a table column

To see one location in the normal table, open **Columns** and use **Add a location column**. It adds a metric in one location, such as Visibility in one country, as its own column, up to eight of them.

## Add locations

Open **Track in more locations** from **+ Add location** in the Locations view, **+ Track** in a cell, or **Locations › Add locations** in the bar that shows when you select prompts. Then:

1. Pick one or more countries, US states or cities. A country one engine doesn't answer from says so, and that engine is skipped there while the others run.
2. Choose the prompts: the one you clicked, the selected ones, a topic, or every prompt shown.
3. Check **Plan usage**. Every prompt in every location counts once on your plan's prompt locations. Paused prompts don't count.

## When locations would pass your plan's limit

If the choice would pass your plan's limit, the dialog says how many it needs and how many are left, and saves nothing. Pick fewer prompts or places, or follow your plan's way to track more.

## Which engines answer from a state or city

**US states** are asked by every engine from the state itself. Google's engines asked a state country-wide until October 2026, so their answers from before then stay in the country's column.

**Cities** are asked only by the engines that can answer from a city: Google AI Mode, Google AI Overview and the API models (OpenAI, Claude). ChatGPT, Perplexity, Copilot, Gemini and Grok answer per country, so they skip a city and their answers stay in the country's column; track the country too to see them. A city column says **AI Mode · AIO · APIs**. A city counts as one location on your plan, like a country.

## What a new location shows

A location you just added has no answers until the next daily run asks it. Until then, its cells say:

- **Within 24h**: it's tracked there, and the first results come with the next daily run. While a new brand's first tracking runs, **Arriving now**: that tracking is asking it.
- **Paused**: the prompt is paused, so it isn't asked anywhere until you resume it.
- **No engine here**: none of the prompt's engines answers from that place. Add an engine that does, or remove the location.

When your plan's prompt locations are used up, **+ Track** reads **Limit reached**. It still opens the dialog, which shows your plan's way to track more.

## Stop tracking in a location

Open the same dialog in **Remove** mode from:

- the **…** menu on a location's column in the Locations view, then **Stop tracking in** that location;
- the **×** on a tracked cell (**Stop tracking here**), when the prompt is tracked somewhere else too;
- **Locations › Remove locations** in the bar for selected prompts;
- **Remove** at the top of **Track in more locations**.

Pick the locations and the prompts. A prompt needs at least one location, so one tracked only in the places you stop keeps them.

## What happens to past results

Past results stay. The prompt is no longer asked there from the next daily run, and the answers already collected there aren't deleted. The dialog shows how many tracked locations it removes and how many it frees on your plan; a paused prompt's locations go too, but free nothing. When no prompt shown is tracked in a location any more, its column leaves the Locations view.
