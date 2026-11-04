---
title: Write a page in the Content Editor
route: /dashboard/content/editor
keywords: [content editor, draft, placeholders, your input needed, side panel, instructions, sources, live page, rebuild brief, mark ready, mark published, history, export, site audit estimate, health claims, supplements]
synonyms: [write an article, edit a draft, page editor, finish a page]
plan: all
updated: 2026-11-04
last_checked: 2026-11-03
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
The Content Editor is where pages are written. It opens from the Library, from the Plan, or when you start a page in New content. **Editor** in the sidebar takes you back to the draft you last opened for this brand in this browser; with none, or if that draft was deleted or archived, it opens New content. The page saves as you write.

## The header

The header shows the title, which you can click to rename the page, and whether your changes are saved. Under them come the page type, the method and status, a **Rules** chip with how many rules the page meets now (for example **13/15 rules**; click it to open the rules) and the **Quality** score. On a page that optimizes a live one, a chip counts the cited passages kept.

On the right are the month's AI usage and the buttons **History**, **Copy HTML**, **Export**, **Send to CMS** (the paper-plane icon, for admins and managers) and **Mark ready**, and a button to show or hide the side panel.

## Site Audit estimate

In the side panel's **Quality**, **Site Audit estimate** (for example **≈62**) is about where the page would score in Site Audit once published, with the score by category: Structure, Content, Authority, Trust and E-E-A-T. It's free, and it's read again each time you pause typing.

It runs Site Audit's checks on the page as it would go out. The checks of your whole site, such as robots.txt, llms.txt and HTTPS, come from your latest Site Audit; with none yet, they're left out.

The 13 checks AI reads aren't in it at first, so it runs a few points under the full audit. **Estimate AI checks** adds them, using a little of your monthly AI usage. They stay in the score as you keep writing; **Read AI checks again** reads them anew.

## Status and runs

Where your workspace has Chat, a pill next to the title says where the page stands: **Working** while the Content Agent works on it, **Needs you** while its suggestions wait or the page is in review, **Ready**, **Done** once published, or **Draft**. **Runs** at the top lists your own Chat runs and this brand's Content Agent runs, this page's among them; click one to open it. Once the agent's work has started on the server, its card says you can leave the page: it keeps going.

## Write and paste

The page starts with its H1, which is also its title. A page has one H1: the toolbar won't add a second one. A paste keeps headings, lists, links and tables, and drops fonts, colors and styles. Press Command or Ctrl + Shift + V to paste plain text.

**Attach a file** inserts Excel, CSV, Word, Markdown, HTML or text, up to 10 MB each; a sheet comes in as a table. **Add HTML** adds an embed, a widget or a form, kept exactly as written; GetCito never runs it. **Edit as HTML** shows the page's source; scripts, iframes and inline styles are removed when you switch back.

## Facts and your input

The Content Agent looks up the facts a page needs, such as a price, a plan's limits or a statistic, and links each to the page it came from, never a forum or a social post. A fact no trusted page has is left out of its sentence.

A fact it couldn't look up stays in square brackets for you, as do up to three only your brand has, such as your customer count. Each is tinted amber; **Your input needed** in the toolbar counts them and jumps to the next one, selected so you can type over it.

Ones in alt text, structured data or HTML count too. **Send to CMS** waits until none is left. With Quality on, **Export** offers **Fill now** or **Export without them**, which drops those sentences. One in the title or a heading has to be filled.

## Health and supplement brands

The Content Agent never writes a health benefit, a treatment, a prevention or a dose your brand didn't give in its own words, such as that a product helps you sleep or eases stress, and never looks one up. One it wrote anyway is taken out of the page, or its suggestion is dropped. A claim your page, your brand's description or **Your input** already makes can stay, and safety lines such as "talk to your doctor" always do.

A brand counts as a health brand when its industry is Healthcare, or its industry, name or description names supplements, vitamins, a pharmacy, a clinic or wellness.

## The side panel

The side panel's tabs are **Instructions**, **Sources** and **Live page**. **Instructions** holds what the Content Agent follows: **Brief** and **Rules**, and **Quality** when it's on, switched at its top. The panel opens on **Instructions**, on **Rules**.

While the panel is closed, its tabs run down the editor's right edge: click one to open the panel there.

Building the brief and running the Content Agent use your workspace's monthly AI usage.

## The brief

**Brief** shows the page type, target URL, goal, audience, length, outline and keywords; **Edit brief** changes them. With no brief yet, **Build brief** writes the goal, audience and outline from your sources; once there is one, the button reads **Rebuild brief**. Either writes the outline from the sources you keep, each H2 answering a search AI ran for your prompts. If you edited the brief, rebuilding asks first: **Rebuild anyway** or **Keep my brief**.

A draft started from an opportunity with a brief starts with that brief's outline and keywords.

## What the brief reads from cited pages

Building the brief also reads a few of the pages AI cited. Their typical length shows beside **Length**, and **Cited pages have** lists what Site Audit's checks find on at least half of them, such as an FAQ schema, tables or statistics. The Content Agent then writes the page toward what its text can carry, not its schema, dates or byline, which your site sets.

Once the brief has an outline, **Rewrite from brief**, for a new page, or **Suggest changes from brief**, for an existing one, hands the page to the Content Agent. The page you have now stays in History.

## Sources

**Sources** shows what the draft is built from: **Prompts**, **Fan-outs** (the searches AI ran for your prompts), **Cited pages**, which AI quotes today, and **Search Console** queries. Each source shows where the draft uses it.

Uncheck a source to leave it out, or click **Add source** to add a prompt, a page address or a Search Console query. Then click **Rebuild with selection**.

## Live page

For a draft that optimizes a live page, **Live page** shows how that page does now: **Citations**, **AI visits**, **Google clicks** and **Prompts cited**, over 7 days to a year, against the period before. It is not a forecast of what the draft will get.

- Prompts that stopped citing the page are marked **Lost**. **Use the lost prompts in this draft** adds them to the sources and rebuilds the brief.
- **Results from AI visits** shows the AI visits that landed on the page and, with Google Analytics connected, their key events, orders and revenue, by AI source.
- **Your other pages for these prompts** lists your other pages cited for the same prompts.
- With conversions from AI visits on, **Conversions from AI journeys** shows what the journeys through the page brought in.

A new page has nothing to measure until it's marked published with its live address.

## Passages AI cites are locked

When a draft optimizes a live page brought in by its URL, the passages AI answers quoted in the last 30 days are marked in green, and a chip in the header counts them. The Content Agent never changes these passages. If you edit one, the editor asks first: **Keep wording** or **Edit anyway**. Changing a quoted passage may cost the page those citations.

## History, Copy HTML and Export

- **History** keeps earlier versions for 90 days: the live page as imported, the page before agent changes, each Mark ready and publish, each Hand off, and the page before a restore. **Restore** makes a new version, so nothing is lost.
- **Copy HTML** copies the whole page as HTML, HTML blocks and schema included, to paste into your CMS. An article also gets the Article schema GetCito adds, with its author.
- **Export** downloads the page as **Word**, **Excel**, **CSV**, **HTML** or **Markdown**. Excel and CSV hold the page as one row, for a CMS's import. Only the HTML file carries the schema.

With Quality on, **Export** opens a dialog instead: the same files, and under **Platforms** a copy of the page to paste into Webflow, WordPress, Shopify or Google Docs.

## Add products from your catalog

On an online shop's draft, **Products** in the toolbar adds products from your catalog: search by name, pick one to four that are in stock, and click **Insert**. One shows as a card, more as a grid, each with its picture, name and price, linked to its page. A card keeps its price: to show today's, delete the card and add the product again.

## Mark ready

**Mark ready** saves the page, sets it to **Ready** and keeps a version in History. If the draft was sent to the Action Center, it also completes its task there. With Quality on, **Mark ready** opens **Before you publish** first.

GetCito doesn't publish the page: copy or export it to your site, or send it to your CMS.

Click **Ready** in the header to move the page back to **In review**. A task that Mark ready completed is open again, unless someone changed it in the Action Center since or the action is closed.

## Mark published

Once the page is live, tell GetCito where with **Mark published**, in the Library's **Status** menu or, with Quality on, under the header's **Next step** once the page is ready. It asks for the live address, starting from the page it optimizes or your site with the page's slug, and **Live page** measures that address from then. If the draft came from the Action Center, its Publish task is completed once all the action's work is live.

On a published page, the header's **Published** button changes the address. A page your CMS reports live, or one published in Webflow, WordPress, Framer or Wix, gets its address on its own. Restore an archived page in the Library first.
