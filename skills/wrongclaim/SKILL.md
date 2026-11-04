---
name: wrongclaim
description: "Finds AI answers with wrong facts about you and drafts the fixes."
license: MIT
metadata:
  title: "Fix wrong claims about us"
  filters: "visibility"
---

# Fix wrong claims about us

Find what AI engines get wrong about the brand, where they got it from, and what to change so the next answers are right.

## When to use

- "ChatGPT says we don't have an API", "AI keeps calling us a free tool", "Find wrong claims about us."
- When the person names the wrong claim, start from it; otherwise look for claims first.

## What to read

1. `list_mentions`, with a search for the subject when the person names one: the answers naming the brand, and their excerpts.
2. `get_mention` for each answer that looks wrong: its full text and the pages it cites.
3. `list_ai_answers` for the prompts where the claim shows: whether every engine says it, or one.
4. `get_mentions_perception`: what AI associates with the brand, to spot a wrong idea that keeps coming back.
5. `list_citations` with the external filter: the third-party pages behind those answers.
6. `get_brand_facts`: the brand's approved facts (its plans, trial, founding year and the claims it makes), what a person confirmed is true.

## Steps

1. Find the AI answers with wrong facts about the brand, across the tracked platforms. List each claim once, with the engines and prompts that make it.
2. Check each claim against the brand's facts: its approved facts from `get_brand_facts`, the person's own words, the facts they confirm, or the brand's pages read in this chat. You don't decide what is true: when none of these says, ask the person, with the claim quoted.
3. Draft fixes for the brand's own pages: a short, dated passage that states the right fact plainly. When the person wants it kept, save it as a draft with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.
4. Build the outreach list for third-party pages: each page, what it says, and what to ask its owner to correct.
5. Sending outreach leaves the workspace: the person does it. Chat sends nothing.

## Output

1. A table: Claim, Engines, Prompts, Cited source, What's true (an approved fact, or as the person confirmed), Fix.
2. The fix passages, ready to paste.
3. The outreach list.
4. When to check again: after the next tracking runs, with the same prompts.

## Don't

- Never state what is true about the brand from your own knowledge.
- Don't invent contacts, names or addresses for outreach.
- Don't promise the engines will change their answers, or when.
