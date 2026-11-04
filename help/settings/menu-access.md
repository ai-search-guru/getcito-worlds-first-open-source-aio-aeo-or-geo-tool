---
title: Choose who sees which menu sections
route: /dashboard/settings/menu-access
keywords: [menu access, hide menu sections, role menu, customize menu, sidebar sections, fold menu group]
synonyms: [hide pages from users, left menu per role, restrict menu, simplify sidebar]
plan: all
updated: 2026-11-04
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/menu-access.mdx]
---
**Menu access** in Settings decides which sections are on each person's left menu, so everyone sees the part of GetCito they use. It only hides: a section off someone's menu still opens from a link, and what their role can do there doesn't change. To change what someone can do, change their role in **Settings › Team**.

## Fold a group on your menu

Click a group's title on the left menu, **Execution** or **Analytics**, to fold it, and again to open it; the arrow on its right shows which. This browser remembers it, and a folded group opens by itself when you go to one of its pages. **Chat** and **Agent Center** sit above the groups, and **Reports** and **Competitors** below them, so they don't fold.

## Who can change menus

Admins change menus, and can let managers do it too: under **Who can change menus**, switch a manager on. That manager then sees **Menu access** in Settings, and nothing else of the admins' settings. They change what each role sees and every non-admin's menu, never an admin's.

Only admins choose who changes menus. A manager who becomes another role stops changing menus.

## Choose what each role sees

**Sections each role sees** lists the left menu's sections, by group, with a column for each role. Tick what a role sees; each box is saved as you click it.

- **Admin** always sees **Everything**.
- **Action Center** is on everyone's menu and can't be turned off.
- **Use a set…** fills a role's column from a work area's ready-made set, or **Everything**. Adjust it from there. **Agent Center** is in every set: right after Chat where the set has Chat, else right after Action Center.

Until an admin hides something, every role sees every section.

## Change one person's menu

**People** lists everyone but the admins, with their role, the work areas they picked, their menu and how many sections it keeps. A menu reads like **Analyst's menu**, or **Custom: +Prompts, −Content** when it differs from their role's.

Click **Customize** to tick or untick a section for that person alone, even one their role hides. Each change is marked **shown for them** or **hidden for them**, and saved as you click. **Use Analyst's menu**, named after their role, takes their changes back.

## How a menu is worked out

A person's menu is their role's sections, changed by their own exceptions from **People**, then narrowed to the sections of their work areas, when they picked any.

**Action Center** always stays, and nobody takes a section off an admin's menu; only an admin's own work areas narrow it. A section added to GetCito later is on everyone's menu until someone hides it.
