---
title: Generate a content brief
route: /dashboard/content
keywords: [content brief, generate brief, brief generated, outline, target keywords, send to workflow, webhook settings]
synonyms: [writing brief, article brief, content outline, brief for writers, rebuild brief]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-optimization.mdx, docs/guides/content-editor.mdx]
---
A content brief tells a writer what to write to close an opportunity's gap: the title, the type of content, the outline and the keywords. GetCito writes it with AI from the opportunity's data, in your brand's language. You can then write the page in the Content Editor, or hand the work on to the Action Center or your workflow tool.

## Generate a brief

On **Opportunities**, click an opportunity's title. The panel shows its source data and any brief it already has. Admins and managers click **Generate Brief**.

A brief is written once per opportunity: the button then reads **Brief Generated**. Each brief counts toward the month's content briefs, and on plans with monthly limits **This billing period** shows how many are left.

## What a brief holds

- a suggested title;
- a content type: blog post, comparison page, landing page, FAQ page, guide or case study;
- a target word count;
- keywords;
- a call to action;
- an outline of three to eight sections, each with its key points;
- competitor insights: the competitors cited and their visibility advantage.

## Write it, or hand it on

- **Send to Editor** opens **New content** with the opportunity picked; the draft starts with the brief's outline and keywords.
- **Send to Actions** puts the work in the Action Center.
- **Send to Workflow** sends it to your workflow tool.

Earned opportunities don't go to the editor: send them to the Action Center or your workflow tool.

## A fresh brief in the editor

An opportunity's brief is written once and stays as it is. Once the page is in the Content Editor, **Rebuild brief** there writes a new brief from the sources you keep in the draft.

## Send it to your workflow

In the opportunity's **…** menu, click **Send to Workflow**. GetCito sends the opportunity, the data behind it and its brief, if it has one, and its status becomes **Sent to Workflow**. The button then reads **Send Again**. To send several at once, tick them on the list and click **Send All**.

The webhook needs **Opportunity sent** ticked. An address that redirects isn't followed, so nothing is sent: use the address it redirects to.

## Set up your workflow once

Click **Webhook Settings** at the top of the Opportunities page:

- **Webhook URL**: your workflow tool's address, such as an n8n, Make or Zapier flow, or your own endpoint.
- **Secret Key (optional)**: lets your endpoint tell that a call came from GetCito.
- **Events to send**: **Opportunity sent**, **Daily Pulse created**, **Action Center task sent** and **Content page sent**. A new webhook has the first three ticked; **Content page sent** stays off until you tick it.
- **Active**: turn it off to pause sending without deleting the webhook.

**Test Webhook** always sends a test event. Click **Save Webhook** to keep it. Only admins and managers can change or test the webhook.

## After the work is done

Once the opportunity is in the Action Center, its status follows its action: **In Progress** once work starts, **Done** when it's complete. Your workflow tool can also move it on, for example to In Progress or Done.

Admins and managers can also tick opportunities on the list and click **Done**.
