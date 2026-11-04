---
title: Track conversions from AI visits
route: /dashboard/traffic
keywords: [conversions, ai visit conversions, signups from ai, consent, shopify pixel]
synonyms: [track leads from chatgpt, orders from ai, demo requests from ai, first touch]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
Google Analytics' key events say how many AI sessions converted. To see which pages AI visitors went through on the way to a signup, a demo form or an order, turn on conversions for the brand. The snippet then follows visitors who came from an AI assistant for 30 days, and credits each conversion to the assistant that first sent them.

## Turn conversions on

In **Brand Settings › Tracking**, under **Conversions from AI visits**, tick **Track conversions from AI visits** and choose **Consent**:

- **Wait for the visitor's consent** (recommended): no journey is followed until your site says the visitor agreed. AI visits themselves are counted as before.
- **Don't wait: our own banner covers it**: only if your cookie banner already asks for analytics storage, or where no consent is needed.

Conversions are off by default, and only admins and managers can change them.

## Replace the tag

Under **Use this tag**, copy the tag with the copy button on its code, and use it in place of the one you have, on every page. The tag carries your choices, so after you change **Consent**, copy it again.

To turn conversions off, untick **Track conversions from AI visits** and put the tag without them back.

## Tell GetCito when a visitor agrees

With **Wait for the visitor's consent**, your cookie banner has to tell the snippet when the visitor agrees, and when they say no or take consent back. Google Consent Mode needs nothing more. A banner set up inside Google Tag Manager needs a tag there for agreeing and one for refusing.

The visitor has to agree on the page the AI assistant sent them to: agreeing on a later page doesn't bring the journey back.

## What counts as a conversion

- A form with an email field counts as a signup on its own, once per page load. Contact and newsletter forms count too, unless you give them their own goal. Login forms don't count, and nothing typed in a form is sent.
- Anything else, such as a thank-you page or a purchase, needs a conversion call from your site's own code.
- On Shopify, orders come from a Customer events pixel. Copy it under **Shopify store** in **Brand Settings › Tracking** and add it in Shopify admin as a custom pixel.

## Where you see the results

The Content Editor shows what came of it: the **Live page** tab for each page, and the **From AI visits** line on the Content **Plan** for the whole site.

## What it can't see

- Visitors who refuse cookies, or who agree only after leaving the page the AI assistant sent them to.
- AI visits that arrive without a referrer: they count as Direct.
- Google's AI Overviews and AI Mode.
- Journeys from one subdomain to another.
- Forms inside an embedded widget, forms sent from a script, and posts without a form. These need a conversion call from your site's code.
- Conversions after the browser has cleared the visitor's id, as Safari can after about a week without a visit to your site.
