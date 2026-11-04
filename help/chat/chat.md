---
title: Use Chat
route: /dashboard/chat
keywords: [chat, ask chat, download answer, save to files, export chat, storage, output card, open in content editor, side panel, chat panel, ctrl j, ask about this, page context, agent, new chat, open a chat, chat menu, agents at work, hide menu, inbox, chat home, for you now, pin chat, rename chat, share chat, archive chat, delete chat, run mode, full auto, stop chat, steer, attach files, reference data, data used, retry, error, reconnecting, question, chat asks, recommended option, skip question, next moves, what to do next, add prompts, pause prompts, add topic, rename topic, add competitors, remove competitor, undo, change draft, send to cms, make report, site audit, open page, read web page, fetch page, why did it change, why did visibility drop, explain change, what explains the change, cited before, cited now, since you left, send to action center, add to action, attach to task, ready for review, complete tasks, /tasks, task strip, tasks ready, close tasks, attach to task and mark done, attach only, mark task done, ai limit, part of a job, remaining ai usage, do the first now, shortcuts, slash menu, /start, /analyze, /new-report, /create, /optimize, /opportunities, /audit, get started, create a report, optimize a page, find opportunities, improve with audit, brand facts, approved facts, /facts, /wrongclaim, fact check, api key in message, paste api key, remove key]
synonyms: [assistant, ai agent, agent chat, ask getcito]
plan: all
updated: 2026-11-04
last_checked: 2026-11-03
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [frontend/messages/en.json]
---
Chat answers questions about your brand from your GetCito data, and can do work for you step by step. Open it from **Chat** in the main menu. Every chat is saved, so you can come back to it later and pick up where you left off.

## Chat Home

Chat opens on **Home**: a greeting by name at your time of day, then a link to your **Inbox** when something needs you, else **All caught up.**

**For you now** starts common jobs: **Ask anything** goes to the box, **More** opens every shortcut, and the rest show when the open brand has work. **Complete tasks**: Action Center actions due this week or overdue (Chat prepares, you close them). **Win back citations**: pages that lost citations. **Ready to publish**: drafts marked ready (Chat sends them to your CMS as drafts; you publish them). Each starts a new chat. Read-only roles get only the jobs that read, no **More**.

**Since you left** shows the engine whose citations fell most, and one that won, from the day you last left Home to yesterday, against as many days before, beyond normal swing only. **Why?** and **Which ones?** ask Chat in a new chat.

## Ask Chat

Type in the box at the bottom and press Enter, or click the arrow. Shift+Enter adds a line. The arrow stays off while the box is empty.

Next to the arrow, pick how much Chat does on its own: **Ask me first** asks before every step; **Auto, ask before changes** reads freely and asks before every change; **Full auto** makes changes without asking. In your own chats nothing is published or sent without your click. Agents an Admin allows can publish on their own (see **Agents**). Every change is logged in **Activity**. **Full auto** needs the Growth plan, and an Admin can turn it off for everyone but Admins in **Settings › Chat**.

Analysts and Agency partners only read; their box says **Read-only**, with a link to their role.

The demo brand has sample chats to open. There and in a read-only workspace, sending opens the plan dialog.

## Chat beside any page

On most pages **Ask Chat** sits at the top right, next to the AI usage meter. Click it, or press **Ctrl J** (**⌘J** on a Mac), to open Chat in a panel on the right without leaving the page. Press it again, or click **✕**, to close the panel: the page stays exactly as you left it.

At the top of the panel, start a **New chat**, open a recent one from **Chat history**, or pick **Compact**, **Wide** or **Full screen**. The panel keeps the size you picked. On a wide screen the page moves aside so nothing is covered; on a smaller screen the panel opens over the page.

## What the panel looks at

The box in the panel starts with chips for what you have on screen: the page, your brand, the date range and the filters you picked. Chat takes them as the scope of your question. They follow the page while the panel is open; click **×** on one to leave it out, until you start a new chat.

An empty panel offers a few questions about the page, some from what the page shows, such as the platform that moved most. Click one to put it in the box, then edit it or send it.

The speech bubble icon next to a table's or chart's title, on a tracked prompt and on an Action Center action opens the panel with it attached, so you can ask about it directly. You find it on Brand Visibility, Mentions & Sentiment, Citations, AI Referral Traffic, Prompts and Action Center.

## Chats in the panel

A chat you start in the panel is saved like any other: it is in **Chat**, where you can carry on with it. If you used a panel chat in the last 30 minutes, the panel opens on it again.

Once the panel has a chat, its **⋯** menu offers **Open as full page**, **Open in new window**, and for your own chats **Pin**, **Rename**, **Share with team**, **Archive** and **Delete**. On the full page, **↙ Back to** the page you came from takes you back there, with the chat in the panel as it is now.

The panel isn't on Chat's own pages, where **Ctrl J** takes you to the message box, or in the Content Editor, which has its own chat.

## Stop or steer

While Chat works, the arrow turns into Stop: click it or press Esc. Steps it already finished stay, and so does the answer so far. The step it was on shows **Stopped**, and the line with the steps says how long it worked, such as **Stopped after 41s · 5 steps**.

You can type while it works. Enter then stops the run and sends what you typed as the next message, so you can redirect it, for example "only blog pages".

## When Chat asks you

When an answer changes what Chat makes and isn't in your data, Chat stops and asks, with 2 to 4 options. The one marked **Recommended** is picked to start with; under each option it says why it fits. When Chat asks more than one thing at once, the card counts them, such as "1 of 2".

Click an option, or press its number, then **Next** or Enter. Where the card says **Pick one or more**, click each one. Type your own answer in **Other…**. **Skip** goes on with the Recommended option.

Once answered, the card folds to one line with the question and your answer, and Chat goes on.

## Answer in the box

While Chat asks, you can also answer in the box below. It shows the Recommended option dim; Tab puts it in, and Enter sends it. A message that isn't one of the options answers every question Chat asked with it. An answer is text only, up to 500 characters.

**Stop** beside the arrow, or Esc, ends the run and leaves its question skipped.

## Change what you track

Admins and Managers can ask Chat to track new prompts in a topic, pause prompts, add or rename a topic, and add or remove competitors. A prompt goes into a topic the brand already has, so Chat adds a new topic first. A prompt, topic or competitor the brand already has is skipped. Your plan's prompt locations still apply: Chat says so when they run out.

Chat asks first, except in **Full auto**. Removing a competitor, or pausing more than five prompts in one run, always asks.

Each change is in the **Activity** log, with **Undo** for 7 days (30 days for paused prompts). Undo leaves alone anything someone changed since, and says so. Undoing new prompts pauses them; their first answers, and what they cost, stay. A removed competitor comes back without its timeline events.

## Send a finding to Action Center

Admins and Managers see **Send to Action Center** under Chat's latest answer. Chat proposes the finding as an action: its title, category, the prompts, pages and competitors it is about, and its tasks. Each task names its page and says when it is done. You approve it on its card, except in **Full auto**. Action Center sets its Priority Score, and **Open in Actions** opens it.

If an open action already covers these prompts, pages or competitors, Chat offers to add the finding to it instead. That action's targets don't change. **Create anyway** is offered only when the new finding covers something the open action doesn't.

Chat can also attach a file or draft to a task, and set a task it finished to **Ready for review**. It never marks a task done: you do that in Action Center. Each change has **Undo** in the **Activity** log.

## Work through your Action Center tasks

Type **/tasks**, or click **Complete tasks** under **For you now** on Chat Home, and Chat works through the brand's Action Center tasks: those due this week first, highest Priority Score first.

Under the answer, **Action Center tasks** lists up to 4 tasks it takes on and how many are ready ("1 of 3 ready"). Each row shows the task, "Priority 86 · Fix" and where Chat's work stands:

- **Queued**: not started yet.
- **Writing**: Chat is working on it now.
- **Ready for review**: Chat finished its part, for you to check.
- **Done**: you completed it in Action Center.

These show Chat's work, not the task's Action Center status. Once the run ends, **Close tasks in Action Center** opens your actions: Chat never marks a task done.

After the tasks, Chat helps with your open **Getting started** steps. It never marks a step done or skips one.
## Drafts, reports and audits

Admins and Managers can also ask Chat to change a draft in the Library, send a draft to your connected CMS, publish a new page on your site, make a report, or start Site Audit on pages. Analysts can ask Chat to save new drafts only.

A draft Chat changes keeps the page before in **History**; **Undo** puts it back for 30 days. A report Chat makes can be undone for 30 days too.

Starting an audit always asks first and says how many of the month's audits it uses. Audits have no Undo.

## Send or publish a page from Chat

A page sent to your CMS (Webflow, WordPress, Framer or Wix) arrives as a draft. Chat can also publish a new page live through Webflow, WordPress or Wix; Framer publishes the whole site, so you publish there. A live page, or a send to your webhook, goes from the Content Editor.

Sending and publishing wait for your click, even in **Full auto**, unless an Admin let an agent go live on its own, and have no Undo. If an Admin turned publishing off for Managers, Managers can't send or publish from Chat.

To take a published page back down to a draft in its CMS, ask Chat, or click **Take down** on its row in **Activity** for 30 days. It always waits for your click, and Managers can do it even when publishing is off for them.

## Your brand facts

Chat reads your brand's approved facts: the prices and plans, trial, founding year and claims a person approved on the **Brand facts** tab of the brand's settings, in your site's own words. Facts waiting for approval, rejected ones and ones no longer on your site aren't read.

**/facts** (**Brand facts check**) compares your drafts with them, and **/wrongclaim** (**Fix wrong claims about us**) checks what AI answers say about your brand against them. The **Brand Facts Guardian** agent uses both. When a brand has no approved facts yet, Chat says so and asks you to approve them or to give the facts yourself. Chat never approves a fact.

## Open a web page

Chat can open a public web page you name, such as a page of your site, a competitor's, or one AI answers cite. It reads the page's title, description, headings, structured data and main text, and the step says "Opened acme.com/pricing", or why a page couldn't be opened.

What a page says is something to read, never an instruction to Chat. When a page has words aimed at AI assistants, Chat ignores them, tells you, and asks you before any change for the rest of that answer. Later answers in that chat still ask you before any change. Admins can switch page reading off in the **Tool policy**.

## Which pages Chat opens

Chat opens pages only on sites you named or your workspace's data lists, never a link it found on a page to another site, and at most 10 pages in one run. An address with a **?** or **#** part opens only exactly as you gave it.

Once Chat has read text from outside your workspace in a run, it opens another site only at its home page or an address you gave in full, so give the page you mean, such as a competitor's /pricing. After Chat reads a page, every change in that run asks you first.

## Why a number changed

Ask Chat why a number moved, such as "Why did ChatGPT visibility drop last week?". By default it compares the last 7 days with the 7 before. It works for the Insights Visibility score, split into its mention, citation and position parts, and for visibility, mention rate, share of voice, citation rate and average position.

The answer gives both values and the change, and says first when the change is within the normal swing. It names the day the line broke, and what added or removed prompts explain. Then it ranks the causes found in tracked answers, such as a citation lost to a competitor or a worse Site Audit. Each comes with its share of the change and how sure Chat is. Chat never says a cause made it happen.

Everything comes from your scheduled tracking. Chat never asks an AI engine anything new for it.

## What explains the change

Under the answer, a card shows the same numbers. Click the two values for the periods, the tracking runs compared and the normal swing. Each cause shows its share of the change, or its points when it partly offset it. Open a cause to see its prompts, the page cited before and the one cited now, and the day. **Answer** opens that tracked answer, with your brand marked and the pages it cited. Each cause says how sure Chat is: **High** when 10 or more prompts show it, **Medium** for 3 to 9, **Low** for fewer. When some answers couldn't be read, the card says so, and part of the change stays unexplained.

## Close a task from what Chat made

When Chat drafts something for an Action Center task, its card says **Task:** and the task's name. Admins and Managers see **Attach to task & mark done**: it adds the file to the task and marks the task done in Action Center, as you, as if you ticked it there. The toast has **Undo** for a while, unless the task or its action changed since.

**Attach only**, in the card's **⋯** menu, adds the file and leaves the task open.

## Next moves

When Chat finishes an answer, **Next moves** under it suggests up to three things to do next, such as "Do the same for /features". Click one to send it as your next message. A change it leads to still asks you first where it should.

When the first move carries on with what this answer worked on, the box shows it dim: Tab puts it in, and Enter sends it. Nothing is sent by itself.

Analysts and Agency partners see only moves that read data. Next moves show under the latest answer, and come back when you open the chat again.

## Shortcuts

Type **/** at the start of an empty box, or click **/**, for shortcuts that start a message: **/start** (Get started), **/analyze**, **/new-report** (Reports), **/create**, **/optimize**, **/opportunities** and **/audit** (Improve with audit). A shortcut puts its first words in the box, such as "Analyze", for you to finish. Chat then reads only the data that job needs, by default your brand's last 30 days, and says in one line when your plan leaves part of it out. Change the first words and Chat treats the message as your own question. Some **For you now** chips on Chat Home work the same way.

Under the shortcuts are the skills Chat can use, such as **/report** for the weekly report (see **Skills in Chat**).

## Reference your data

Type **@**, or click **@**, to point Chat at your data: charts and metrics on the page, tracked prompts, your pages and open Action Center tasks. Use the arrow keys and Enter, or click. Your pick shows as a chip above the text; **×** takes it off.

## Attach files

Click **＋** and **Attach files**, drop files on the box, or paste them. A message takes up to 5 files of 10 MB each: PDF, Word, Excel, CSV, text, Markdown and HTML files, and PNG, JPG or WEBP images. Each file shows as a chip while it uploads; the arrow waits until they are up. If a file can't go, the box says why, and **Retry** sends a failed one again.

Attached files are data for Chat to read, not files you made: they don't show in **Files**, and they are kept for 90 days.

In **＋**, **Connect a tool** opens **Settings › Integrations** for Admins; others send their Admin a request in one click.

## An API key in your message

If your message holds something that looks like an API key, Chat doesn't send it: the key would end up in the chat. A line under the box says so, and **Send** waits. Click **Remove** to take the key out and keep the rest of your message. To run Chat on your own AI key, an Admin saves it in **Settings › AI Providers**; own keys come with Enterprise.

## Watch the work

While Chat works, one line says what it is doing now, such as "Reading Citations…". Steps it finished show as chips with a check mark above the answer: click one for its detail, or click the line with the number of steps for the full list. A fact check of the answer's figures shows as **Checked facts**.

Under the answer, **Data used** names each source it read, with its rows, and each page it opened. The answer says when it was generated and how fresh the data was, in your time zone.

## When something goes wrong

A step that fails shows a red mark and why, such as **Timed out**. Chat goes on where it can, and the answer says what it couldn't read.

If the whole answer stops on an error, it says **Stopped: something went wrong** and why, and it still says so after you reload the page. Click **Retry** to send your message again.

If your connection drops while Chat works, the line with the steps says **Reconnecting…**. Chat keeps working meanwhile and picks up where it was; reloading the page shows where it is too. When the monthly AI usage runs out mid-answer, the step it was on shows **Stopped at the AI limit**.

## When your AI key fails

If your workspace runs Chat on its own AI key and the provider turns the key down, the account is out of credit, or the key can't reach its model, the answer stops and says which. Admins get **Open AI Providers**; others read that an Admin can fix it there. When the provider doesn't answer at all, the answer says so: try again in a moment.

While the key isn't working, a line above the message box says why. You can still send: the key may work again, for example once the account has credit.

## AI usage

Chat draws on your workspace's monthly AI usage, shared by every seat. The meter under the box shows how much is used; click it for what used it and when it resets. From 80% it turns amber, and a line above the box says so once a month, on whichever device you are on; **×** closes it.

Once the usage is used up, Chat pauses: the box is off, and a red line above it says until when. **Get more AI credits** there opens a window with your plan and the credit packs, and it opens once by itself the first time Chat stops. Admins buy packs; everyone else sees them and can **Ask your Admin**. On Enterprise, admins can also use their own AI key. In the free trial, starting the plan gives its full monthly AI usage.

## When only part of a job fits

Before work in several parts, such as five drafts, Chat checks that your remaining AI usage covers them all. When it covers only some, Chat asks first, for example "Your remaining AI limit covers about 2 of the 5 drafts.": **Do the first 2 now** (recommended), **Get more AI credits**, which stops there so you can add credits, or **Cancel**. When it covers none, Chat stops at the AI limit before starting. A skill's answer is checked the same way before Chat reads anything.

An agent's run, with no one there to ask, does the parts that fit, keeps what it made, and stops at the AI limit. A workspace on its own AI key isn't checked.

## Inbox

**Inbox** in the chat menu lists what your agents did: chats waiting for your OK first, with **Review**, then chats still working, with their progress and **Watch**, then results you haven't opened yet, with **Open**. Click a row to open its chat. A result leaves the Inbox once you open it. The count next to **Inbox** shows how many items there are, with an amber dot when something needs you. Daily suggestions aren't in that count: the **Daily suggestions** tab shows theirs.

Tabs on top, each with its count, show **All**, your **Daily suggestions**, what **Needs you** and your **Runs**.

## The chat menu

The chat menu on the left of Chat lists your chats. **New chat** starts a new one. **Home** and **Inbox** come first. **Governance** opens the **Activity** log, **What Chat can do** and the **Tool policy**.

**Agents at work** lists the chats that need your OK, the ones still working, and finished results you haven't opened yet, with the step each one is on. It shows three at a time: **See all** lists the rest. A dot shows each chat's state; click **?** to see what the dots mean.

**Chats** lists every other chat, newest first, under **Pinned**, **Today**, **Yesterday**, **Previous 7 days**, **Previous 30 days**, then by month. A chat a teammate shared shows their initials. **Search chats** above them finds a chat by its words, and **All chats** and **Archived** at the end list every chat.

## Hide the chat menu

Click the panel button next to **New chat**, or press Ctrl+\ (⌘\ on a Mac), to hide the menu and give the chat the whole width. A small bar at the top then keeps **New chat** and your runs at hand. Chat remembers your choice on every device. On a narrow window the menu opens over the page instead. Ctrl+Shift+O (⌘⇧O) starts a new chat from anywhere in Chat.

## Move around Chat

Pages under Chat, such as **Inbox** and **All chats**, show **← Back to Chat** at the top left, next to where you are, such as Chat › All chats. It takes you back to the chat you last had open in this tab, or to Chat Home. Click **Chat** in the path for Chat Home; **Chat** in the main menu always opens Chat Home too.

Esc closes only the box or menu on top, such as search or a **⋯** menu, and never leaves the page.

In Chat, the main menu on the left is a narrow bar of icons, so the chat has room. Point at it to see it whole, or click the GetCito logo to keep it open; click the logo again to make it narrow. Chat remembers your choice on every device.

## Manage a chat

Point at a chat in the menu and click **⋯**, or click **⋯** at the top right of an open chat:

- **Pin** keeps it under **Pinned** at the top of the menu; **Unpin** puts it back under its day.
- **Rename** lets you type a new name in place. Press Enter to save or Esc to cancel. You can also double-click a chat's name in the menu.
- **Archive** takes it off the menu. It waits under **All chats › Archived**, where **Unarchive selected** brings it back.
- **Delete** asks first, then deletes the chat for everyone. Click **Undo** within a few seconds to bring it back. A chat that is still working is stopped first.
- **Open in new window** opens it in another browser window.

**Export chat** downloads the whole chat as **Markdown**, **Word** or **PDF**: each question under "You" and its answer after it.

## Copy, download or save an answer

Under every finished answer, three small buttons show their names when you point at them:

- **Copy** copies the answer, with its formatting where you paste it.
- **Download** gives the answer as **Markdown**, **Word** or **PDF**, and as **CSV** or **Excel** when it has a table (one sheet per table). The file is named after your question and the day, and it carries when the answer was made and how fresh its data was. Downloads aren't kept and use no AI.
- **Save to Files** keeps the answer for your whole workspace; it then reads **In Files**. Saved answers count toward your workspace's storage: 1 GB in the free trial, 5 GB on Starter, 25 GB on Growth, and what your contract says on Enterprise. When storage is full, the answer isn't saved, and the button says so.

Every role can copy, download and save answers it can open.

## What Chat makes

When Chat makes something for you, such as a page saved as a Content draft, it shows under the answer as a card with its name and type. It is also kept in **Files** for your whole workspace, and the card says **In Files**. From the card, **Copy** copies it, **Download** gives it in the formats it has (for a page: HTML, Markdown, Word or PDF), and **Open in Content Editor** opens the page to keep working on it. When storage is full, the card says it wasn't saved to Files, with **Get more storage** to add a storage pack. Click **Files** in the chat menu to find, copy or download everything kept there.

The pen button under an answer, **Open in Content Editor**, turns the answer itself into a new Content draft in your brand and opens it.

## Share a chat with your team

A chat is yours alone until you share it. **Share with team** lets everyone in your workspace open it and read it; they can't change it, and their box says so, with **Start your own chat**. **Stop sharing** makes it private again. A shared chat shows its author's initials in teammates' menus, and an Admin can delete it.

## Old Agent links

Chat replaces the earlier Agent page. Links and bookmarks to the Agent page open Chat instead, and a link to one of your chats opens that chat.

The first time you open Chat, your chats from the Agent page are copied in, so they are in the chat menu with your other chats, by the date of their last message. Your questions and the answers are kept; the steps the Agent took to find them are not. A chat the Agent page never named is called **New chat**.

## A chat that isn't available

If a chat was deleted, or it belongs to someone else and isn't shared with you, Chat says **This chat isn't available.** Click **New chat** to start a new one.
