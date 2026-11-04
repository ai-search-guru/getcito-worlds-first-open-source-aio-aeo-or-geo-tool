---
title: Action tasks and how they are checked
route: /dashboard/action-center/actions
keywords: [tasks, task status, check now, regenerate tasks, done when, how we check, attached from chat, ready for review]
synonyms: [steps, subtasks, to-do items, task checks]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
Each action comes with tasks: concrete steps such as "Refresh content for these prompts" or "Add structured data to these pages". You find them on the action's **Tasks** tab.

## What a task tells you

Open a task to see:

- **What**, **URL** (the exact page), **Where** and **Why**;
- **Change**: the text before and after, or the text to add;
- **How**: one step per line;
- **Done when** and **How we check**;
- **Type** (Content, On-page, Technical, Outreach, PR or Product), **Effort** and **Role**.

Click **Edit** to change any of them.

## How we check

**How we check** says how a task is confirmed:

- **Automatic**: GetCito fetches the page again.
- **Re-run**: the prompts run again.
- **Manual**: you confirm it.

Automatic checks run every night, and when you click **Check now**. Only pages on the brand's own site are read. A task that passes is completed by itself, and History says so. One that doesn't shows **Last check** with what is still missing. Site Audit fixes are checked by your next audit.

## What an automatic check looks for

- **A broken page**: the page answers again.
- **Publishing**: the page answers where it wasn't before.
- **Structured data**: the audit checks that raised the action now pass on the page.
- **Crawler access**: robots.txt lets the AI crawlers in, and the page isn't noindex.
- **Optimizing or refreshing**: the page changed by more than a date, a price or a rotating quote. Blocks that change by themselves, such as the latest posts, don't count.
- **New text**: the task's new text is on the page, and the text it replaces is gone.

A task you reopen after it passed stays open: the call is yours.

## Task status

A task's status is **To Do**, **In Progress**, **Completed**, **Skipped** (with a reason), **Waiting Approval**, or **Failed** when GetCito couldn't carry it out itself and it needs doing by hand. Skipped tasks leave the count, so they don't hold an action short of done. Use **Add task** for work of your own, and delete tasks you don't need.

## Hand a task on

From a task you can:

- **Create content** or **Optimize page**: open a draft in the Content Editor for this task. **Open draft** returns to it, and marking the draft ready completes the task.
- **Send to Content**: send a content task to Content as an opportunity, where a brief can be written for it.
- **Send to webhook**: post the task to the brand's webhook, for a workflow outside GetCito. Set it up under **Content › Webhook Settings** with the **Action Center task sent** event selected.

## Files attached from Chat

When Chat attaches a file or a draft to a task, the task's details list it under **Attached from Chat**: its name, who attached it, when, and **Open**. A draft opens in the Content Editor; any other file downloads. A paperclip with a count shows on the task row.

Each attachment is also a line in the action's **History**, as is a task Chat set to **Ready for review**. Neither changes the task's status: you mark it done yourself.

## Regenerate tasks

Where AI task writing is on for your workspace, **Regenerate tasks** writes the action's tasks again from its evidence, in your brand's terms, by the **Site type** in the brand settings. Done, under-way and hand-added tasks stay. It uses your plan's monthly AI allowance.

The AI also reads this brand's last three closed rounds of the same action. It builds on what improved results here, and doesn't hand out again a task that was done without effect. A task it writes without its URL, Change, Done when or How we check waits on **Needs review**.

## Tasks GetCito does itself

Some tasks that only read data, such as checking a page's traffic in your connected Analytics, can be carried out by GetCito overnight. The action's History says so. Nothing that would change something outside GetCito runs without your approval: such a task waits as **Waiting Approval**.

## Comparing pages overnight

Two tasks compare pages for you overnight:

- **Compare competitor content and coverage** reads up to three pages AI answers cited for the action's prompts, your competitors' first, and your own cited page. It says which checks at least half of their pages pass that yours doesn't.
- **Find what sets your winning pages apart** compares up to three of your winning pages with your other pages that Site Audit checked. It lists what most winning pages have and the others lack, and the pages missing the most of it.

When there is nothing to compare, the task stays open with the reason, and GetCito tries again a week later.
