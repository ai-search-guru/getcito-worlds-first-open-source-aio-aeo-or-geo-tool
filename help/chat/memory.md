---
title: Memory in Chat
route: /dashboard/chat
keywords: [memory, remember, forget, used memory, saved notes, call me, remember that, forget that]
synonyms: [preferences, saved preferences, house style, what chat remembers, notes]
plan: all
updated: 2026-11-02
last_checked: 2026-11-02
owner: GetCito maintainers
app_version: 0.3.0
approved: false
sources: [frontend/messages/en.json]
---
Chat can remember short notes between chats, so you don't repeat the same preferences every time, such as "write blog posts in US English" or "reports as PDF". Memory keeps one line per note. Nothing is remembered without your click.

## Ask Chat to remember

Start a message with "Remember that…", in any language, for example: "Remember that our blog uses US English." Chat writes the fact as one short line on a card. You can change the words, with a counter under them, and pick where it goes under **Save to**: **Me**, the chat's brand, or **Workspace**. A place your role can't change is shown but can't be picked. When the note repeats or contradicts one you have, the card says **Replaces:** with the old note; untick it to keep both.

Nothing is saved until you click **Save**, in every mode, Full auto too. After that, the step reads **Saved to memory** with where it went.

Say "Forget that…" to remove a note. Chat finds the note and removes it once you approve, or by itself in Full auto. The step reads **Removed from memory**.

## Where a note goes

**Me** notes are yours alone: your name and how you like to work. Every role keeps its own. **Brand** notes are facts and rules for one brand, such as its product names or words to avoid. Admins and Managers change them. **Workspace** notes are rules for every brand and member. Admins change them; when a Manager saves one, the step reads **Sent to your Admins**, and the note is added once one of them approves the request.

Your first name from your profile becomes a **Call me** note, so Chat greets you by it.

## How Chat uses memory

Each chat uses your **Me** notes, the notes of the chat's brand and the **Workspace** notes. When notes disagree, your message wins, then **Me**, then the brand's, then the workspace's. When memory was used, the steps above the answer show **Used memory**, and **Data used** shows **Memory** with how many notes.

A note shapes how Chat does what you ask, such as the tone or the format. It never starts a change by itself and can't change Chat's rules, your role or what needs your approval. A change that only a note names still waits for your click, Full auto too.

## What memory doesn't keep

Memory doesn't keep secrets or personal details: passwords, keys, card, bank or ID numbers, email addresses, phone numbers, home addresses or private facts about you or others. It also refuses text that tries to change Chat's rules. Chat tells you when it can't save a note.

A note is at most 300 characters, and **Me**, each brand and the workspace each hold up to 4,000 characters. When one is full, delete or shorten a note first. The limits are the same on every plan.
