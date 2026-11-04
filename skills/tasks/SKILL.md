---
name: tasks
description: "Works through Action Center by priority. You close the tasks."
license: MIT
metadata:
  title: "Complete this week’s tasks"
  filters: "content visibility"
---

# Complete this week’s tasks

Work through the brand's Action Center actions, highest priority first, and prepare what each one needs: drafts, code and notes. The person closes the tasks.

## When to use

- "Complete this week's Action Center tasks", "Work on what's due by Friday", "Start the top task."
- For one action the person names, do only that one.

## What to read

1. `list_action_center_tasks` sorted by priority, the new and in-progress ones: their category, impact, due date and progress.
2. `get_action` for each action you work on: why it exists, its signals, and its tasks (What, Where, Why, How, Done when).
3. `list_citations` for the last 30 days, when an action is about citations: which pages are cited, and which lost citations.
4. `get_site_audit_summary`, then `list_site_audit_issues`, for the pages the tasks name: the failed checks, as AI engines would see the page.
5. `get_fanouts` when a task asks for questions to answer.
6. `get_onboarding_progress`, once the actions are worked through: the open Getting started steps, in stage order.

## Steps

1. Read the open actions and rank them by impact and due date. Say which ones you will work on, at most four in one run.
2. Check the pages the tasks name, from their latest Site Audit.
3. Prepare each task's work: an FAQ block, a rewritten passage, schema code or a new page, as its How says. Show a change to a passage AI cites before it is made.
4. Save page work as a draft with `create_draft`; the app asks the person first when it should.
5. Sending a draft to the site's CMS, and publishing it, aren't part of this skill: the person does both in the Content Library (**Send to CMS**, then **Publish**), or an agent with the Ready to publish skill does. Never publish yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
6. When a task's work is finished, set it Ready for review with `set_task_ready_for_review`, so the person sees it in the task strip under your answer.
7. Then help with the open Getting started steps, in stage order: say what each step needs and link its page, with short steps for anything the person connects themselves (Search Console, Analytics, the AI Traffic snippet). Add competitors, topics or prompts a step asks for only with the tools that do it, and the app asks the person first.

## Output

A list of the actions worked on, each with what was made (and where it is), what is left for the person, and its "Done when" check. Then the actions not reached, by priority.

## Don't

- Never close, complete or dismiss an Action Center task: the person does, once its "Done when" is met.
- Never mark a Getting started step done or skip it: it completes through its own check, and the person skips an optional one in Action Center.
- Don't invent facts, quotes or figures for a draft: use [placeholders] the person fills.
- Never claim a task's work will move a number; say what to watch after it goes live.
