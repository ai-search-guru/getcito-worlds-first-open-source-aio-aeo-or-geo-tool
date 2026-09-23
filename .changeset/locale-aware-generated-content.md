---
"@workspace/lib": patch
"@workspace/web": patch
"@workspace/worker": patch
---

Generated content now follows the brand's target language and market.

Suggested tracking prompts, brand descriptions, competitor suggestions and the
Opportunities report were written in the model's default language — English —
even for a brand with a target language and market configured, because those
settings only reached the assistants while running a tracked prompt. Onboarding,
the competitor and prompt generators, and the Opportunities report now receive
the brand's locale (as a provider system message and spelled out in the prompt),
and web-search research localizes to the brand's market.
