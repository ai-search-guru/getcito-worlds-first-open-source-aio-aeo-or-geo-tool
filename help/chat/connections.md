---
title: See and manage connections in Chat
route: /dashboard/chat/connections
keywords: [connections, integrations, connect, disconnect, search console, google analytics, cms, webflow, wordpress, merchant center, product feed, connected tools]
synonyms: [connected apps, linked tools, data sources, plug in a tool, hook up]
plan: all
updated: 2026-11-04
last_checked: 2026-11-02
owner: GetCito maintainers
app_version: 0.3.0
approved: false
sources: [frontend/messages/en.json, docs/guides/send-to-cms.mdx]
---
**Connections** shows what the brand open now has connected, and what it could connect: Search Console, Analytics, your CMS, your product catalog and more. Connections are per brand. Chat, its skills and your agents all read the same list, so a tool connected in Settings shows as connected here too.

## In the chat menu

Under **Skills** in the chat menu, the **Connections** row has **Manage** and an arrow. Click the arrow to open the list under the row: connected tools first, with a green dot and ✓, then the ones you can connect, then the ones coming soon. With more than 20 tools, a **Search connections** box shows above the list. The menu remembers whether you left the list open. **Manage** opens the Connections page.

## The Connections page

The tabs **All**, **Connected** and **Not connected** show how many tools each has. Search by name, or pick a group: **Search & analytics**, **CMS**, **E-commerce**, **CRM & revenue** or **Team & data**.

Each card shows the tool, its group and its status. A connected card shows the account, who connected it and when, and what GetCito may do with it, such as **read-only** or **read + write drafts**. **Used by** lists the skills and agents that use it. A card not connected says what it would unlock instead. Up to two cards carry a **Suggested** tag.

## Connect, reconnect and disconnect

Only Admins connect tools. **Connect** opens the tool's card in Settings, Integrations, where you sign in. **Sign-in failed** means the tool refused the saved sign-in: click **Reconnect**.

**Disconnect** asks first and lists the agents that need the tool and would pause. For a CMS, pages stop going to that site for this brand. For Search Console or Analytics, GetCito stops reading it for this brand; other brands keep theirs. Catalog sources and workflow webhooks are managed in **Settings**.

If you're not an Admin, click **Ask your Admin to connect** to send them a request.

## Tools coming soon

Cards marked **Soon**, such as HubSpot or Slack, can't be connected yet. To ask for a tool that isn't listed, click **Request a connection**.
