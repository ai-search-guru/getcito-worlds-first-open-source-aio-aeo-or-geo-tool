---
title: Review tasks waiting in Needs review
route: /dashboard/action-center/review
keywords: [needs review, approve task, dismiss task, task review, missing fields]
synonyms: [review queue, pending tasks, tasks to approve, incomplete tasks]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
A task the AI writes without its **URL**, its **Change**, **Done when** or **How we check** doesn't reach the action's task list. It waits on the Action Center's **Needs review** tab instead, with what it misses. Only admins and managers see the tab and review tasks.

## Approve a task

Click **Edit**, fill the missing fields and click **Approve**. The task is added after the action's other tasks. All four fields, the URL, the change, Done when and How we check, must be filled before it can be approved.

## Dismiss a task

Click **Dismiss** on a task you don't want. A dismissed task never reaches its action.

## Where these tasks come from

They come from AI task writing, such as **Regenerate tasks** on an action. Only the tasks that miss one of the four fields wait here; the others go straight to the action's **Tasks** tab. Tasks of an action that is completed, dismissed or deleted aren't listed.
