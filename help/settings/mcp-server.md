---
title: Use GetCito in AI assistants with MCP
route: /dashboard/settings/api-keys
keywords: [mcp, mcp server, api key, claude, cursor, codex, connect assistant]
synonyms: [model context protocol, use getcito in claude, ai assistant integration, connector]
plan: all
updated: 2026-11-04
last_checked: 2026-10-30
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/mcp-server.mdx, frontend/messages/en.json]
---
GetCito has an MCP (Model Context Protocol) server, so AI assistants such as Claude, Codex, Cursor, VS Code, Windsurf, Gemini CLI and Zed can query your GetCito data in a normal conversation. There is nothing to install: the assistant connects with an API key from **Settings › MCP & API Keys**.

## Create an API key

1. Open **Settings › MCP & API Keys**.
2. Click **New key** and give it a name you'll recognize, such as "MCP — my laptop".
3. Click **Create** and copy the key. It's shown only once, so store it somewhere safe, such as your password manager.

## Connect your assistant

The dialog that shows the key also has a ready-to-paste setup for each assistant under **Connect a client**, with the key filled in. Pick yours, click **Copy setup**, and follow the line under it, which says where the setup goes. Because it includes the key, copy it before you close the dialog.

In Claude's desktop app, for example, you add GetCito under **Settings › Connectors › Add custom connector**. On Claude's Team and Enterprise plans, an owner adds the connector in the organization settings first.

On a self-hosted install, the assistant connects to your own GetCito instead.

## Check the connection

Ask your assistant "List my GetCito brands". It should show your brands. If it reports a 401 error, the key is missing from the setup or was revoked.

## What you can ask

Ask in plain words, for example:

- "What's my visibility score on ChatGPT for the last 7 days?"
- "Which topic has the most prompts?"
- "Who are my top 5 competitors by mention count this month?"
- "Why did our sentiment drop on Gemini?"

The assistant can read visibility, mentions, citations, prompts, AI traffic, saved reports, content, Site Audits, product visibility and the Action Center. Some requests change data, such as accepting a suggested prompt, writing a content draft or recording a task's progress. Assistants are told to make a change only when you ask for it.

## What your plan includes

In cloud mode, every plan can read over MCP, the free trial included. Changes, runs and anything that uses credits, such as accepting a suggestion, writing a content draft or starting a Site Audit, need the Growth plan or above, paid. On Starter and in the free trial, the assistant still sees those requests, but GetCito refuses them and says they need Growth, so it can tell you why. The same applies to the API and to every assistant: Claude, ChatGPT, Cursor and the others. An admin can upgrade in **Settings › Billing**. A self-hosted instance can do everything.

## What your key may do

A key acts as the person who created it, with their role. Reading, drafts and suggestions in the Content Editor, Site Audits, task progress and an opportunity's progress are open to every role.

Adding prompts or topics, reviewing tasks, dismissing, and work that costs AI, such as content briefs and Improve actions, are for admins and managers. Dismissing a prompt suggestion is open to analysts too. Anything a role can't do is refused before it changes anything.

## Publish a draft from your assistant

GetCito never sends a page to your CMS through MCP. Instead, the assistant can get a draft as a page ready for your CMS, put it there with its own CMS connector, and then mark the draft published at the address it went live at, so GetCito measures it.

## When the plan has ended

In cloud mode, a workspace without an active plan is read-only. Its API keys keep working for reading, but every change is refused until an admin chooses a plan in **Settings › Billing**. Retrying doesn't help. New API keys can still be created; on a read-only workspace they only read. A self-hosted instance is never read-only.

## Revoke a key

If a key leaks or you stop using an assistant, open **Settings › MCP & API Keys** and click the trash icon next to the key. Assistants using it lose access immediately.
