---
name: create
description: "Writes briefs, articles, FAQ blocks, comparison pages and social posts from what AI engines ask and cite."
license: MIT
metadata:
  title: "Create content"
  hidden: "true"
  reads: "list_prompts get_prompt_performance list_topics get_fanouts get_prompt_insights list_citations list_content_opportunities fetch_page list_drafts get_draft list_brands open_page"
---

# Create content

The playbook of the /create shortcut ("Create content for …"): a piece of content written to be cited by AI engines, from the brand's prompts, fan-outs and the pages AI cites now.

## Data plan

Read only these, for the chat's brand and the topic or page the person names:

1. `list_prompts`, `get_prompt_performance` and `list_topics`: the prompts the piece should win, and how the brand does on them.
2. `get_fanouts` and `get_prompt_insights`: what the engines search for behind those prompts, and which matter most.
3. `list_citations`: the pages AI cites for them now.
4. `fetch_page` for one or two of those cited pages, and for the brand's own page when the piece updates it.
5. `list_content_opportunities`, when the person names no topic.
6. `list_drafts` and `get_draft`: a draft already open for the same page.

Use `list_brands` only when no brand is selected, and `open_page` to link the Content Library.

Scope: the last 30 days, every platform the plan tracks.

## Questions

- Ask the format (brief, article, FAQ block, comparison page or social post), the target page and the length only when the request doesn't say and the answer changes what you write. Two questions at most, together.

## Steps

1. Pick the questions the piece must answer: the prompts and fan-outs with the most demand.
2. See what the cited pages answer, and what they leave out.
3. Write the piece answer-first: a direct answer under each heading, then detail. For an FAQ or a comparison page, add the structured data as a code block.
4. When the person wants it kept, save it as a draft with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Output

The piece as a document, with its structured data as code when it has some.

## Next moves

Two or three, such as opening it in the Content Editor, or an FAQ block for the same prompts.

## Don't

- Public content: no tracking numbers unless the person asks, no weak or made-up statistics, and use [placeholders] for facts, quotes and figures the person must give.
- Never publish: going live is always the person's click.
