---
title: Write to the Content Editor rules
route: /dashboard/content/editor
keywords: [content rules, run agent, fix open rules, rewrite the whole page, agent suggestions, accept suggestions, rules tab, brand rules]
synonyms: [writing rules, style guide rules, apply rules with agent, rewrite page, let the agent fix the page]
plan: all
updated: 2026-11-03
last_checked: 2026-11-03
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
Every page in the Content Editor is written to a set of rules for its page type. The **Rules** chip in the header shows how many the page meets now; click it to open the rules. **Fix open rules** asks the Content Agent to suggest changes for the rules the page doesn't meet yet; **Rewrite page** rewrites the whole page to them.

## The Rules tab

In the side panel, **Instructions** opens on **Rules**. The rules come in five groups: page type rules, length and structure, fan-outs and keywords, links and sources, and style. Most rules can be turned on or off, and many have a value you can change. Each rule's status is read from the page as you write. Rules marked **AI check** are judged by the Content Agent and aren't counted yet.

## Save or reset your rules

Changes to the rules apply to this draft only. **Save as my rules**, for admins and managers, keeps them for your workspace's next drafts of this page type, and **Reset** goes back to the default set. Under **Your text rules**, write a rule in your own words, or use **Paste many** to add several from a style guide.

## Brand rules

Admins and managers keep a brand's rules in **Settings › Content › Brand rules**, one per line, up to 30, such as topics to stay away from. The Content Agent follows them on every page of the brand, before your text rules, and a brand rule wins when they disagree. They change what's written, not the **Rules** count.

## Fix open rules

**Fix open rules** sits at the top of **Rules**. It asks the Content Agent to suggest small, reviewable changes for the rules the page doesn't meet yet. Its suggestions appear in the page, each with **Accept** and **Reject**, under a bar with **Accept all** and **Reject all**.

A decided suggestion can be taken back with **Undo** or **Restore**, and **Undo all** brings every one back to review. One run makes at most eight changes: run it again for the rules still open. Running the agent uses your workspace's monthly AI usage.

An open rule shows its status in amber; red is kept for what blocks. Once you've decided a run's suggestions, a rule it tried and couldn't fix gets an amber label and a note that it's yours to decide: change the page yourself, or the rule.

## Rewrite the whole page

The **▾** menu beside **Fix open rules** also offers **Rewrite the whole page**: one new version written to every rule, with the cited passages kept. It uses more AI usage than fixing open rules. It's marked **Recommended** when the page is far off its Length or many rules are open. Picked, the button reads **Rewrite page**.

A rewrite comes back as one change: **Compare** it with your page, then **Accept** or **Reject**. Your page before it stays in History. A rewrite isn't offered once the page is ready or published. One past its Length is cut to it with one more pass; accept one still a little long, and the next rewrite starts from there.

When the passages it keeps stop the page reaching its Length, a note offers **Raise Length to …** and **Rewrite, cited passages too**, which may stop those passages being quoted. The **Length** rule says so too.

## Before you run it again

- Accept or reject the open suggestions before you run the agent again or edit the page as HTML.
- The agent doesn't change heading levels: turn extra H1s into H2s in the toolbar yourself.
- The agent only changes drafts, not published pages.

## How your choices teach the agent

What you accept and reject teaches the agent. For a rule whose suggestions this brand has mostly rejected over the last 90 days (at least five decided, on two pages or more, seven in ten rejected), it keeps its changes as small as the rule allows, and its card says which rules while it works. Only its small changes count: a rejected **Rewrite the whole page** doesn't. Quality's **Hand off** isn't affected.

## On a page that is already live

When the draft optimizes a live page, the agent is also told how that page does now, as the **Live page** tab shows it over 30 days: how often AI answers cite it and the prompts it lost. It keeps the answers and facts AI engines cite, answers a lost prompt's question where a rule's change can, and its card says what it kept in mind.
