---
title: Work with Action Center actions
route: /dashboard/action-center/actions
keywords: [actions, action status, assign action, dismiss action, export actions, top actions, run agent, run with chat, stale actions, still relevant, confidence]
synonyms: [recommendations, work items, to-dos, action list, let an agent do this, agent on an action]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
An action is one piece of work with an outcome, built from the evidence behind it. GetCito groups many signals into one action: six valuable pages with no AI traffic become one "Capture AI traffic" action with six linked signals, not six rows. New actions are added after the daily tracking run, on the **Actions** tab.

## Action categories

- **Growth**: ground you could win, such as demand, topics, platforms or pages where you could appear more.
- **Protect**: ground you hold that is starting to slip.
- **Recover**: ground you held and lost, in visibility, citations, mentions or traffic.
- **Fix**: issues on your own site, such as low audit scores, blocked crawlers or broken links AI sends people to.
- **Compete**: places where competitors lead you.

## Cards and filters

The cards at the top count and filter the list, all but **Highest Priority**. Click one to narrow the table, and click it again to clear it.

- **Top Actions**: the five highest-priority open actions.
- **At Risk**: open Recover and Fix actions.
- **Opportunities**: open Growth actions.
- **In Progress**: actions someone is working on.
- **Highest Priority**: the highest level among open actions; it doesn't filter. While Getting started runs, its card shows instead.

Below them, filter by category, **Priority**, **Status** (including **Stale**) and **Assignee**, or search. **Sort** by Priority (the default), Newest, Due date or Recently updated. Filters are kept in the page's address, so a filtered view can be shared. For an online shop, the **From Products** chip lists only the actions sent from Products.

## Status, dismiss and delete

An action's status is **New**, **In Progress**, **On Hold**, **Completed** or **Dismissed**. The row menu sets In Progress, Completed or Dismiss without opening the action.

Dismissing asks why: it doesn't matter to us, it's already done, the data behind it is wrong, or not now. You can also dismiss without saying why. History shows the reason.

**Delete**, for admins and managers only, removes an action for everyone, and it won't come back on its own the next day.

## Stale actions

An action that has stayed **New** for 30 days, with no one assigning, editing, sending or updating its tasks, is marked **Stale** each night. It isn't closed or dismissed: it shows a **Stale** label next to its status, and the **Status** filter's **Stale** lists them all.

If it still matters, click **Still relevant** in the open action, or in the row menu. The label goes, its 30 days start again, and History says who kept it. Any other change to the action, or moving it out of New, clears the label too. If it no longer matters, dismiss it.

## Inside an action

Click a row to open the action. Under its title you set **Status**, **Assignee** and **Due date**. Its tabs:

- **Overview**: **Why this priority?**, with how sure the score is (low, medium or high confidence, and why, such as one kind of finding from one source), **Why this action?** with the signals behind it, the **Goal** (what done looks like, with a date) and the linked **KPIs**.
- **Affected**: the prompts, pages, topics, competitors or platforms it is about, with each prompt's demand.
- **Tasks**: the work, step by step.
- **Signals**: the evidence. Click one to open it on the Signals tab.
- **History**: every change, from status and assignee changes to tasks updated or sent.

## Run an agent on an action

When Chat is on, Admins and Managers see **Run agent** on each open action: an agent button next to its title in the list, and at the top of the open action.

It lists your agents that work on the action's brand, the ones used on this kind of action first. Pick one, and Chat starts a run on this action alone and opens it beside the action. **Run with Chat** does the same without an agent, in your default mode. **Create an agent for this kind of action** starts a new agent from a fitting skill.

The run drafts the work, but closing tasks stays your click. If the action is completed or dismissed, an agent's run stops; a **Run with Chat** run doesn't. The action's **History** shows when a run started and ended, and who started it.

## Assign work

An action with no one on it belongs to **Everyone** in the workspace until someone takes it. Pick a teammate in the action's **Assignee** field, and set a **Due date** if it has one. The **Assignee** filter on the Actions tab shows one person's actions, or **Everyone** for the unassigned ones.

## Export actions

**Export CSV** on the Actions tab downloads the actions in the current view, as filtered, with their priority, status, assignee, due date, task progress and affected items.

Inside an action, **Copy Data** gives the whole action as Markdown to paste into a doc or ticket, and **Export** downloads it as **Export CSV** or **Export Excel**. The Excel file has one sheet each for the action, its affected items, tasks, signals and history.

## Send work here from other pages

Most actions come from signals each night, but you can also send work to the Action Center:

- **Mentions**: select answers, or open one, and click **Send to Action Center**.
- **Content**: **Send to Actions** on a content opportunity, or **Assign to…** on a Content Plan row.
- **New content**: send it to a teammate with **Send to Action Center**.
- **Site Audit**: **Send to Action Center** on a page's audit report.
- **AI Referral Traffic**: select pages and click **Send to Action Center**.
- **Brand Visibility**: **Send action** on a topic in Opportunities.
- **Product Visibility**: pick the work in a product's plan and click **Send … actions to Action Center**.
- **Prompts**: **Send Actions** on a prompt's Improve tab.
- **Chat**: **Send to Action Center** under an answer. Its Overview links back to the chat.

Sending the same thing twice doesn't create a second action: the page says it is already in the Action Center.
