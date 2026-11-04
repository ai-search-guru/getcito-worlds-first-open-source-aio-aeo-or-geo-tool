---
title: Connect Webflow, WordPress, Framer or Wix
route: /dashboard/settings/integrations
keywords: [connect cms, webflow, wordpress, framer, wix, integrations, application password]
synonyms: [cms integration, link my blog, set up send to cms, connect my website]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/send-to-cms.mdx]
---
To send Content Editor pages straight to your CMS, connect it in **Settings › Integrations** with the brand selected. Each brand connects its own Webflow site, WordPress site, Framer project or Wix site. Only admins and managers can connect, change or disconnect a CMS; members see where the brand's pages go.

## Connect Webflow

In the **Webflow** card, open **How to get a site token** and follow its steps to generate a site token in Webflow. Webflow shows the token only once. Paste it in **Site token** and click **Connect**.

Then pick the **Collection** your pages go to, your blog's for example. If the token reaches more than one site, pick the **Site** first. Under **Which field takes what**, choose the field for the page content and, if you like, the meta title, meta description, structured data and date. The page's title and slug always go to the item's Name and Slug. Click **Save**. If the collection requires a field GetCito doesn't fill, **Save** names it: make it optional in Webflow first.

## Connect WordPress

In WordPress, sign in as the user pages should be written by. A separate user with the **Author** role is enough, since GetCito writes drafts only. Under **Users › Profile**, add an **Application Password** named GetCito and copy it; WordPress shows it once.

In the **WordPress** card, enter the **Site address** as you visit the site, the **User** and the **Application Password**, and click **Connect**. Paste the Application Password, not the user's own password. The site must use https. GetCito checks the site before it keeps anything.

## If WordPress won't connect

A message says why. The most common fixes:

- WordPress refused the user or password: check the user name, and paste the Application Password.
- There's no WordPress at that address: check the address, and in WordPress set **Settings › Permalinks** to anything but **Plain**.
- Application Passwords are turned off: update WordPress, and allow them in your security plugin.
- The site refused the request: a firewall or security plugin is blocking it, so allow it.
- This user can't write posts: use an Author, an Editor or an Administrator.

## Connect Framer

In Framer, open the project's **Site Settings › General** and make a key, as a user who can edit the CMS, then copy it. In the **Framer** card, paste the **Project address** as your browser shows it in Framer, and the key, and click **Connect**.

Pick the **Collection** your pages go to, then which field takes the title and the page content and, if you like, the meta title, meta description and structured data. Click **Save**. A collection with a required field GetCito can't fill is marked in the list and can't be saved: make that field optional in Framer first.

## Connect Wix

The site needs the Wix Blog: pages go there as draft posts. In Wix, the site's owner opens **Account Settings › API Keys Manager**, clicks **Generate API Key**, picks the site, gives the key **Manage Blog** and **Manage Ricos Document**, and copies it; Wix shows it once. In the **Wix** card, paste the **Site id** (or the whole address of the site's dashboard) and the **API key**, and click **Connect**. A Blog with no post can't be connected yet: write one post on it as the site's owner first.

## Replace or disconnect

Each card has its own way to change the sign-in: **Replace token** for Webflow, **Change sign-in** for WordPress, **Replace key** for Framer and **Change API key** for Wix. **Disconnect** removes the connection; pages already sent stay in your CMS. Framer and Wix don't let GetCito revoke a key, so delete it there too: in the project's **Site Settings › General**, or in Wix's **API Keys Manager**. If the CMS refuses the saved sign-in, the card says so, for example **Sign-in refused** or **Key refused**, and asks for a new one.

## Send through your workflow instead

Pages can also go to your workflow tool, such as n8n, Make or Zapier, which creates the post in your CMS and decides whether it lands as a draft or goes live. On the **Opportunities** page, open **Webhook Settings**, enter your workflow's address in **Webhook URL**, tick **Content page sent**, which is off by default, and save. Pages you send to **Your workflow** then reach it.
