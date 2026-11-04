---
title: Connect AI traffic data sources
route: /dashboard/traffic
keywords: [tracking snippet, connect google analytics, connect search console, data sources, install snippet, check again, tracking code not detected]
synonyms: [set up ai traffic, add tracking code, link analytics, ga4, gsc]
plan: all
updated: 2026-11-04
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
The **Data sources** strip at the top of **AI Traffic Analytics** shows the four sources the page reads, and each one's state. A section whose source isn't connected stays on the page with a **Needs …** tag and a **Connect …** button for that source. Only admins and managers can connect a source.

## What each source adds

- **Tracking snippet**: AI-referred visits, page by page, as they happen.
- **Google Analytics**: AI visits on days the snippet has none, plus engaged visits, key events, revenue and the AI share of all traffic.
- **Google Search Console**: Google clicks, the pages where AI may be taking them, and the Google queries you don't track yet.
- **AI bots**: which AI bots read your pages, from your own Cloudflare or Vercel, on the Growth plan and above.

## Add the tracking snippet

Until the snippet is seen on your site, the page opens with **Tracking code not detected on** your domain, the steps to add it and the snippet itself. **Install** in the Data sources strip opens it too; once the snippet is seen, the button reads **Code**. The page fills in your own address and tracking code, so copy it rather than typing it.

Add it to the head of every page you want to track, your 404 page included, so **Broken AI links** can see visitors who land on a missing page.

## Check that the snippet works

After you publish it, click **Check again**: GetCito reads your home page once and looks for the snippet. Your home page is also checked when the brand is set up, or once when you open this page if it never was and no AI visit has arrived: the card reads **Checking your home page…** meanwhile. The snippet itself adds no request for your other visitors.

The **Tracking snippet** card then reads:

- **Active · last visit …**: an AI-referred visit in the last week;
- **Installed · no AI visits in the last 7 days**: the check found it, or it has sent a visit before;
- **Not detected on** your domain: neither, so the page doesn't show 0 visits as a result.

Added the snippet with a tag manager? The check can't see it in the page, so the card changes with the first AI visit.

## What the snippet collects

The snippet sends nothing for a visitor who didn't come from an AI assistant. For an AI-referred visit it sends the page address, the referrer, the AI source, the browser, its language and screen size, and the page's status as the browser saw it. GetCito adds the country.

The snippet sets no cookies, and without conversions it stores nothing in the visitor's browser. The visitor's IP address is never stored.

## Connect Google Analytics and Search Console

Click **Connect** on either card in the Data sources strip and sign in to Google; access is read-only. If the card then reads **Connected · choose a property for this brand**, pick the property under **Manage**, in **Settings › Integrations**. Connections are shared across your organization.

On a self-hosted server, both cards read **Not set up on this server** until the server has its Google connection keys.

## When the first numbers arrive

Google Analytics' first numbers arrive in about 15 minutes; up to 14 months of history can take up to 24 hours. Search Console's can take up to 48 hours, because Google reports about two days late.
