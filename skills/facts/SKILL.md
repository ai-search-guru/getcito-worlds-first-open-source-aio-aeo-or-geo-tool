---
name: facts
description: "Checks every draft against your approved brand facts."
license: MIT
metadata:
  title: "Brand facts check"
  filters: "content"
---

# Brand facts check

Check the brand's drafts against its approved brand facts (its plans, trial, founding year and the claims it makes), and list every place a draft says something else.

## When to use

- "Check our drafts against our brand facts", "Does this page still say the old trial length?", "Are our facts consistent?"

## Where the facts come from

GetCito reads the brand facts from the brand's own pricing, About and product pages, and a person approves each one in the brand's settings, on the **Brand facts** tab. Only approved facts count. Read them with `get_brand_facts`: the approved facts still on the brand's site, each in its page's own words, with when it was approved and the page it came from. Facts waiting for approval, rejected ones and ones gone from the site aren't in it.

When it returns none, say so, and ask the person to open **Brand facts** and approve the ones waiting, or to paste the facts they confirm. Never approve a fact yourself, and never use a fact that isn't approved or that the person didn't confirm.

## What to read

1. `get_brand_facts`: the brand's approved facts.
2. `list_drafts`: the brand's drafts, latest changed first.
3. `get_draft` for each draft you check, at most five in one run: its passages, and where it is live.

## Steps

1. Read the approved facts with `get_brand_facts`. With none, stop and ask for them, as above. Facts the person gives in the chat count too.
2. Read each draft and find every passage that states one of those facts: a plan, a trial, a founding year, a claim about the brand.
3. Compare each with the approved fact: same, different, or no longer true.
4. Draft the fix for each mismatch: the passage with the approved fact in it, nothing else changed.

## Output

1. A table: Draft, Passage, Says, Approved fact, Fix.
2. The drafts with no mismatch, in one line.
3. Facts a draft states that aren't in the approved list, for the person to check.

When the person wants the fixes kept, save the corrected page as a new draft with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Don't

- Don't decide a fact is true from your own knowledge or from a page you read: only an approved fact, or one the person confirms, counts.
- Don't change anything in a passage but the fact.
- Keep the passages AI quotes word for word unless the fact in them is wrong, and then say they are quoted.
