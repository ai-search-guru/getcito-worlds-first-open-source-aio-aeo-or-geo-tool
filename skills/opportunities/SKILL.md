---
name: opportunities
description: "Finds content gaps, prompts worth tracking, and the off-site sources AI cites instead of the brand."
license: MIT
metadata:
  title: "Find opportunities"
  hidden: "true"
  reads: "list_content_opportunities list_citations get_competitor_comparison get_fanouts list_prompt_suggestions get_prompt_insights get_gsc_summary list_brands open_page"
---

# Find opportunities

The playbook of the /opportunities shortcut ("Find content opportunities for …"): where the brand could be cited and isn't yet, on its own site and off it.

## Data plan

Read only these, for the chat's brand and the topic the person names:

1. `list_content_opportunities`: the prompts where the brand loses visibility, and the page that would win them.
2. `list_citations`: the domains and pages AI cites, and which of them cite competitors but not the brand.
3. `get_competitor_comparison`: who wins the prompts the brand loses.
4. `get_fanouts`: searches the engines run that no tracked prompt covers.
5. `list_prompt_suggestions` and `get_prompt_insights`: prompts worth tracking, with their demand.
6. `get_gsc_summary`, when Search Console is connected.

Use `list_brands` only when no brand is selected, and `open_page` to link Content Opportunities.

Scope: the last 30 days, every platform the plan tracks.

## Questions

- When the request doesn't say, ask whether to look at the brand's own site, off-site sources, or both.

## Steps

1. On the site: the opportunities with the highest score, each with the page to write or update.
2. Off the site: the domains AI cites for competitors and not for the brand (Reddit, directories, publishers), with what each would need.
3. Prompts to track: the fan-outs and suggestions with the most demand that aren't tracked yet.

## Output

A table: Opportunity, Where (site or off-site), Why (the prompts and engines), Next step.

## Next moves

Two or three, such as "Create content for #1" or "Track these prompts".

## Don't

- Never add prompts without the tool that does it, and the app asks the person first.
- Never promise rankings or citations.
