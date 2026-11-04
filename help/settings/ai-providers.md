---
title: Use your own AI keys
route: /dashboard/settings/ai-providers
keywords: [ai providers, own key, api key, openai, anthropic, openrouter, test ai key, key not working, agents on your key, key limit]
synonyms: [bring your own key, byok, my own openai key, connect my ai account]
plan: enterprise
updated: 2026-11-04
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/faq.mdx]
---
Chat normally runs on your plan's monthly AI limit, and you don't need any key for it. On the Enterprise plan, an admin can connect the workspace's own account with an AI provider (Anthropic, OpenAI, Google Gemini, Microsoft Azure OpenAI or OpenRouter) in **Settings › AI Providers**. Chat then runs on that key: the provider bills your account, and your monthly AI limit doesn't move.

## Add a key

1. Open **Settings › AI Providers**. Only admins can add, replace or remove keys.
2. Click **Add key** next to the provider and paste the key.
3. If you save keys for more than one provider, click **Use for Chat** next to the one Chat should run on.

Keys are stored encrypted, and nobody can read a saved key back. If the server can no longer read the saved key, Chat stops rather than run on your plan's monthly AI limit: save the key again.

## Agents on your key

Agents run on the key too. Each agent's **Max per run** and **Monthly cap** still apply, and one more limit covers all agents on the key together: **Agents on your key**, under the keys. It starts at $250 a month; an admin can set it from $10 to $10,000, but can't turn it off. Only admins see it, with this month's use next to it. Chat you use yourself doesn't count toward it.

GetCito measures what agents use at the providers' list prices, so these numbers are estimates of your bill. At the limit, agents pause, and they can't be run by hand either. They start again by themselves when the month renews or when an admin raises the limit. Set a spending limit with your provider too: its bill is the real one.

## When agents near the limit

Every admin is told when agents have used 80% of the limit on your key, and again when they reach it: at most twice a month. Each time they get a notice at the top of their Chat **Inbox** and an e-mail, unless their Chat settings say Inbox only. **Review limit** or **Raise limit** opens **Settings › AI Providers**. The notices go away when the month renews, or when an admin raises the limit above what agents have used.

## Keys saved before Chat

If your workspace saved a key before Chat was turned on for it, that key keeps running Chat for 30 days, on any plan. **Settings › AI Providers** shows the date it stops. Until then you can replace that key, but you can't add keys for other providers. After that date, Chat runs on your plan's monthly AI limit, and the page shows the key as **Not used on your plan**. You can remove it at any time.

## Below Enterprise

On the other plans, Chat runs on the plan's monthly AI limit, and **Settings › AI Providers** says own AI keys come with the Enterprise plan. When the limit runs out, an admin can move to a bigger plan on the **Billing** page.

## Check a key

Under each saved key, a line says whether it works: **Working · checked …**, **Not working since …** with why, or **Not checked yet**. Click **Test** to check it now: GetCito makes one tiny call on the key, which costs your provider well under a cent. A key is also tested when you save it or click **Use for Chat**. A key the provider turns down, or one that can't reach its model, isn't saved. A key whose account is out of credit is saved with a warning.

## When your key stops working

If the key Chat uses stops working, Chat stops on it and the agents that run on it pause. Nothing moves to your plan's monthly AI limit. Once the key works again, after a passing **Test**, a save or an answer from Chat, the paused agents start again by themselves. If you remove the key, they start again on your plan's monthly AI limit.

Every admin is told once, with a notice at the top of their Chat **Inbox** and an e-mail. **Fix it** opens **Settings › AI Providers**. If the key still doesn't work 3 days later, they get one reminder. The notice goes away once the key works again, or is replaced or removed.
