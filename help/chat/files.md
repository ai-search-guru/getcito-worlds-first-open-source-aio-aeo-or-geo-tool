---
title: Find and download what Chat made in Files
route: /dashboard/chat/files
keywords: [files, chat files, download files, zip, download selected, storage, storage full, saved answers]
synonyms: [chat outputs, saved work, my downloads, where did my file go, storage limit]
plan: all
updated: 2026-10-30
last_checked: 2026-10-30
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [frontend/messages/en.json, frontend/src/config/plans.ts]
---
**Files** keeps everything Chat finished for your workspace: pages it saved and answers you saved to Files. Everyone in your workspace can see and download them. Files are kept for 1 year.

## Open Files

Click **Files** in the chat menu, under **Settings**. You can also press Ctrl K (⌘K on a Mac) in Chat and type "Files". The newest files come first, 50 at a time; click **Show more** at the bottom to see older ones.

Each row shows:

- The file's name and the formats it comes in, and **Used in Content draft** when it was opened in the Content Editor.
- **Made by**: you, a teammate, **Agent** (an Action Center task) or **Scheduled** (a scheduled job).
- **From chat**: the chat it was made in. Click it to open that chat. It shows only for chats you can open.
- **Updated**: when it was made, and **Data as of** when it used your workspace data. Hover over it to see the time zone.

## Find a file

Use the filters above the list: **All** (with how many files your workspace has), **Drafts**, **Reports**, **Code**, **Tables**, **Images**, **From me** and **From agents**. Type in **Filter by name…** to see the files whose name has every word you typed. A few letters are enough. When nothing matches, click **Clear filters**.

## Copy, open and download

- **Copy** copies the file's text as Markdown.
- **Open** opens a page in the Content Editor, when it was saved as a Content draft.
- **Download** gives the file in one of its formats: for a page HTML, Markdown, Word or PDF; for a saved answer Markdown, Word or PDF, plus CSV and Excel when it has a table.

To download several files at once, tick them and click **Download selected**. You get one .zip file with each file in its main format. You can download up to 50 files and 100 MB at a time.

## Storage

The meter at the top right shows how much storage your workspace uses, for example "Storage 2.1 of 25 GB". Your plan includes 1 GB in the free trial, 5 GB on Starter, 25 GB on Growth, and what your contract says on Enterprise. The meter turns amber at 80%.

When storage is full, a line under the title says so. Chat still shows new work in its chat as a card, but it isn't saved to Files, so the card can't copy or download it; the answer above it can still be copied and downloaded. Files you already have are never deleted because storage is full. Click **Get more storage** on that line, on the card, or on the meter to add a storage pack.
