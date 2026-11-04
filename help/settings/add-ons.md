---
title: Buy AI credits and storage packs
route: /dashboard/settings/billing
keywords: [add-ons, AI credits, buy credits, storage pack, extra storage, AI limit used up, get more, storage full]
synonyms: [get more AI usage, top up credits, more storage, buy more AI, credit pack]
plan: starter
updated: 2026-11-04
last_checked: 2026-10-30
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [frontend/src/components/settings/AddOnsCard.tsx, frontend/src/components/ai-usage/GetMore.tsx, frontend/src/lib/actions/addOns.ts]
---
These options apply only when your deployment has billing enabled. Check the plans and terms shown in your workspace.

**Add-ons** in **Settings › Billing** sell extra AI credits and storage for when your plan's monthly limits run out. Packs are paid with Stripe and added to your plan only after the payment goes through, and each one shows on your invoice.

## AI credit packs

Each AI credit pack says what it adds as a share of your plan's monthly AI limit, such as **+20% of the monthly limit** or **+5 monthly limits**, and is valid 12 months from the payment. The monthly limit is your workspace's included AI usage, shared by every seat.

Credits are used only once the month's included AI usage is spent, the oldest pack first, so the monthly reset never wipes them. Usage on your own AI keys never touches them. The line **AI credit: … left · expires …** shows what is left and when the oldest pack ends.

## Storage packs

A storage pack adds a fixed amount of storage every month. It joins your plan's subscription: the rest of the current period is charged at once to the card on file, and it renews with your plan until it is removed. Storage packs need a plan billed monthly.

## Get more from where a limit shows

You don't have to go to Billing: wherever a limit shows, **Get more AI credits** or **Get more storage** opens the same window. It is in the AI usage meter's popover, on the red banner once the month's AI usage is used up, on the Files page's storage meter and its **Storage is full** line, and on an output Chat couldn't save to Files. When Chat stops at the AI limit, the window opens once by itself.

## What the Get more window shows

The window shows your plan and what the next plan would add, where the limit stands (for example "AI usage this month: 100% · Growth · resets Nov 1" or "Storage 24.6 of 25 GB"), and the packs on two tabs, **AI credits** and **Storage**. Pick a pack and click **Continue to payment**, as below.

On AI credits, a table shows roughly how many Chat answers or articles each pack covers. These are only examples: credits work for everything Chat does, and expensive models, long tasks, higher effort and images use more.

On Enterprise, the window also has **Use your own key**: on the other plans, Chat runs on the plan's AI limit and credit packs.

## Buy a pack

1. Open **Settings › Billing** and find **Add-ons**.
2. Choose **AI credits** or **Storage**, then pick a pack. **Most picked** marks the one most workspaces choose.
3. Click **Continue to payment**. AI credits open Stripe's secure checkout; storage asks you to confirm with **Add to plan**.

Once the payment is confirmed, the pack is listed under **Purchases**.

## Who can buy

Only admins buy packs. Everyone else sees the packs and **Ask your Admin**, which sends the request to your workspace's admins. A workspace in its free trial can't buy packs: choose a plan first.

## Purchases and invoices

Admins see **Purchases**: the date, the pack, the price, its status (**Processing**, **Active**, **Used up**, **Expired**, **Ended** or **Refunded**), what is left, and a download for its invoice. Refunds are handled by your deployment's operator; a refund takes back what the pack hasn't used yet.
