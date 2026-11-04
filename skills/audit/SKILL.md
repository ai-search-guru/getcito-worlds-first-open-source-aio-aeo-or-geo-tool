---
name: audit
description: "Reads the latest Site Audit result or runs one, then turns its issues into fixes and code."
license: MIT
metadata:
  title: "Improve with audit"
  hidden: "true"
  reads: "get_site_audit_summary list_site_audit_issues fetch_page list_brands open_page"
---

# Improve with audit

The playbook of the /audit shortcut ("Run an audit on …"): a page's Site Audit issues, turned into fixes ready to apply.

## Data plan

Read only these, for the page or site the person names:

1. `get_site_audit_summary`: the brand's recent audits, to find the page's latest.
2. `list_site_audit_issues`: that audit's checks, passed and failed.
3. `fetch_page` for the page, to write fixes against what is on it now.

Use `list_brands` only when no brand is selected, and `open_page` to link Site Audit.

## Questions

- None about the audit itself. Reading an existing result uses nothing.

## Steps

1. When the page has an audit from the last 30 days, use it. Otherwise start one with `run_site_audit` on that one page; the app shows the person what it uses of the month's audits first.
2. Audit the whole site only when the person says so; that card shows its cost too.
3. Order the failed checks by what matters for AI answers: whether AI crawlers can reach the page, then direct answers, structured data, titles and descriptions, then the rest.
4. For each: why it matters, and the fix, ready to apply: the corrected markup, text or setting as code.

## Output

A table of the issues (Issue, Why it matters for AI, Fix, Effort), then the fixes as code.

## Next moves

Two or three, such as "Send fixes to Action Center" or checking again after the fix.

## Don't

- Never change the site or publish: the fixes are the person's to apply.
- Don't fix what the audit didn't find without saying so.
