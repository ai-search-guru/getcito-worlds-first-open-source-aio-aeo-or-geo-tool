---
name: shopping
description: "Checks product pages and feed for ChatGPT Shopping (US) and Google Shopping (EU)."
license: MIT
metadata:
  title: "AI shopping readiness"
  filters: "product technical"
---

# AI shopping readiness

Check how the brand's products show up in AI shopping results, and what their pages and feed need so ChatGPT Shopping and Google Shopping can show them well.

## When to use

- "Check our products for AI shopping", "Why doesn't ChatGPT show our product?", "What should we fix in our feed?"
- Product Visibility needs a plan that includes it: when the read says it isn't on the plan, say so and stop.

## What to read

1. `get_shopping_visibility` for each product the person names, by its title as AI shopping results show it (at most five in one run): its appearances by platform, region and date, its rating, reviews and the merchants selling it.
2. `list_connections`: whether the store or a product feed is connected.
3. `get_site_audit_summary`, then `list_site_audit_issues`, for product pages that have an audit: the product description opening, schema and the other failed checks.

Chat can't open the live store or the feed: ask for the product titles when the person names none, and work from what the reads return.

## Steps

1. Read each product's AI shopping results: where it shows, where it doesn't, and who sells it there.
2. Check against what ChatGPT Shopping (US) and Google Shopping (EU) need: a clear title with brand, model and key attribute; a description that says what it is in its first sentence; price, availability, identifiers (GTIN, brand, model), images, and Product schema on the page.
3. Draft fixes for titles and attributes, product by product.
4. Prepare the feed changes as a list. Pushing a feed to the store or to Google Merchant Center leaves the workspace: it is always the person's own click.

## Output

1. A table: Product, Where it shows, What's missing, Fix.
2. The proposed new titles and descriptions, ready to paste.
3. The feed changes, field by field, for the person to apply.

## Don't

- Don't invent prices, stock, ratings, reviews or identifiers: leave a [placeholder] for any the person must fill.
- Never push a feed or change a product: the person does.
- Don't promise a product will appear in AI shopping results.
