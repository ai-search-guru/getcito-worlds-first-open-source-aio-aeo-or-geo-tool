---
title: Get daily suggestions in your Chat Inbox
route: /dashboard/chat/inbox
keywords: [daily suggestions, inbox, suggestion, pause daily suggestions, turn back on, action center, one action a day, inbox tabs, do it with chat, not now, remove this suggestion]
synonyms: [daily tips, what should I do today, suggested action, stop suggestions, daily nudge]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [frontend/messages/en.json, frontend/src/lib/chat/dailySuggestions.ts, frontend/src/components/chat/SuggestionDetail.tsx]
---
Each morning Chat can pick one action that waits in your Action Center and put it in your **Inbox**, with what it would take, so your open actions get done. It picks from what is already there, by its priority, and adds no new work. Picking costs no AI usage.

## The Inbox tabs

The **Inbox** has tabs on top, each with its count:

- **All**: everything below.
- **Daily suggestions**: the actions picked for you.
- **Needs you**: chats waiting for your OK.
- **Runs**: chats still working, and results you haven't opened.

The line under **Inbox** counts what needs you, what runs and the suggestions of this week.

## Daily suggestions

You get at most one a day for each brand, and at most 7 a week. Each row shows the action's title, its number in the Action Center, its priority, how it can be done, such as **Content Editor or Chat · about 20 min**, and the day it came. With more than one brand, each row also names its brand.

The dot shows where it stands: blue while it's new, no longer blue once you've seen it, and green once you started it. The list shows the last 7 days only.

When the action is done or dismissed in the Action Center, its row stays, faded, with **Done** or **Dismissed**. When the action is deleted, its suggestion leaves the list.

Click a row, or **Open**, to open the suggestion's page, on its brand.

## The suggestion's page

The page asks the action's title as a question and answers it: **Picked for you today · no AI cost**, what Chat read, then why this action, why now and how long it takes.

The **From your Action Center** card shows the action, its tasks and its pages. **Open** opens it in the Action Center. Two buttons start the work:

- **Content Editor**: opens the action's draft, when it has writing to do.
- **Do it with Chat**: starts a chat about the action, in your Chat mode.

You can also tell Chat what to do in the box at the bottom. That starts the same chat, which counts toward your AI usage like any chat.

**Not now** brings it back in a week if the action is still open. **Remove this suggestion** takes it off your **Inbox**: the action stays in the Action Center.

## Who gets them

Daily suggestions come from the Action Center, which is in everyone's menu, so menu settings don't turn them off. Admins and Managers get them for every brand they can see. Agency partners get them once they open the **Inbox** for the first time. Analysts don't get them. The demo brand gets none, and a workspace whose plan ended gets no new ones: its list keeps what it has.

## Pause or turn them back on

Click **Pause daily suggestions**, on the **Daily suggestions** tab, to stop them for all your brands. Your Action Center is unchanged.

When you haven't opened, started, put off or removed any brand's suggestion for 30 days, Chat stops picking them for that brand and says **Daily suggestions are paused**. Seeing them in the **Inbox** doesn't count as using them.

Click **Turn back on** to start them again for all your brands: the first one arrives the next morning.
