---
title: Skills in Chat
route: /dashboard/chat
keywords: [skills, skill, slash menu, getcito skills, used skill, save a skill, my skills, skills page, turn off a skill, schedule a skill, import a skill, upload a skill, skill from github, review a skill, skill update, update available, faq from fan-outs, weekly report, win back citations, ready to publish, buyer questions, rival brief, listing gaps]
synonyms: [slash commands, playbooks, how-tos, templates]
plan: all
updated: 2026-11-04
last_checked: 2026-11-02
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [frontend/messages/en.json, skills/README.md]
---
Skills teach Chat how to do a task the way GetCito recommends: what to read, the steps to take and what the result looks like. Chat has twenty-one GetCito skills, such as **Win back lost citations**, **FAQ from fan-outs**, **Ready to publish**, **Weekly report**, **Buyer questions** and **Rival brief**.

## Use a skill

Type **/** at the start of an empty box, or click **/**. Under the shortcuts, **Skills** lists each skill by its command and name. Type to filter, such as **/fa** for **/faq**, then press Enter or click. The command goes first in the box: finish your message after it and send.

You can also type a skill's command yourself, at the start of your message. One answer uses up to three skills, a shortcut's own steps counted. **/report** is the **Weekly report** skill; for any other report, use the **/new-report** shortcut (**Reports**).

## The Skills page

Open **Skills** in the Chat menu to see every skill. **GetCito skills** lists GetCito's, and **All**, **Content**, **Brand Visibility**, **Product Visibility**, **Technical** and **Reports** narrow them. **My skills** lists your workspace's own, with where each came from and whether it waits for review.

A card shows the connections the skill uses on the brand you have open: green when connected, grey when not. **Run** starts a chat with the skill. **Schedule** opens Chat with "Every Monday at 9:00, /skill" in the box, to change before you send. **Create agent** starts an agent on it.

Admins turn a skill on or off for the whole workspace, and you turn your own saved skills on or off. Click a skill's name to see its details, share it with your workspace or delete it.

## When Chat picks a skill

Chat also picks a skill by itself when one fits your question. Either way, the steps above the answer show **Used skill:** with the skill's name, and where it comes from under it: **GetCito library**, or **You** for a skill you saved. A shortcut shows **Used shortcut:** with its name.

Analysts and Agency partners have no **/** menu, but Chat still uses a skill for them when one fits.

## Save your own skill

Admins and Managers can ask Chat to keep steps they repeat as a skill of their own, for example: "Save this as a skill called /pricing-brief: open with the answer, then three short sections." Chat shows the skill's name, what it does and its steps on a card, and saves it when you approve, or by itself in Full auto. The skill is private to you and joins your **/** menu right away. It can't take the name of a GetCito skill or a shortcut, such as **/analyze**, and your plan sets how many skills your workspace keeps.

## Import a skill

Admins and Managers on a paid plan can bring in a skill from outside. On the **Skills** page, click **New skill**, then **Upload a SKILL.md or .zip** (up to 5 MB), or **Import from GitHub** and paste a public github.com link. Only the skill's instructions come in: scripts, commands and allowed tools are removed, and nothing runs. A GitHub skill is read at today's commit and never updates by itself. Only MIT, Apache-2.0, BSD and ISC licenses are accepted.

An imported skill stays off until an Admin reviews it. **Review** shows the cleaned file with any hidden characters marked, what the safety scan found, what was removed and where it came from. The Admin approves or rejects it; a skill the scan blocks can't be approved. A Manager's import asks the Admins to review it.


## Updates to an imported skill

Once a week, GetCito checks the source of each approved GitHub skill. When its SKILL.md changed, its card in **My skills** shows **Update available**. **Review update** shows what changed, line by line, and the safety scan of the new version. Nothing changes until an Admin clicks **Approve update**, and the new version is cleaned and scanned again first. A skill whose saved file was changed some other way is turned off.
## What a skill can't change

A skill shapes how Chat works, not what it may do. It gives Chat no new tools, doesn't skip the card a change waits on, and doesn't publish by itself: only an agent an Admin allows may send pages on its own. Your role, your plan and your workspace's Chat settings still decide what Chat can change, and a change still asks you first where it should.

## The GetCito skills

Win back lost citations, Complete this week’s tasks, Quality pass, FAQ from fan-outs, Weekly report, Beat a competitor, Refresh for this year, Ready to publish, AI shopping readiness, Fix wrong claims about us, Answer-first rewrite, Brand facts check, Comparison page and Translate a page.
