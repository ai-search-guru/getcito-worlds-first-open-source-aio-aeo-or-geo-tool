---
name: add-changeset
description: Create a changeset file in .changeset/ that describes a user-facing change for the release notes
---

Create a markdown file in `.changeset/` documenting a user-facing change.

## When to create one

Consider a changeset for any PR, but write one only for *user-facing* changes — skip pure refactors and docs-only changes. Describe how the change affects the user, not the implementation. Most PRs need a single changeset; multiple is rare but occasionally appropriate.

## Filename

Pick something short and descriptive, the way you would choose a branch name (e.g. `remove-cli-status.md`).

## Format

```
---
"@elmohq/cli": patch
"@workspace/docs": patch
---

Description of the change.
```

List only the packages affected. Default to `patch` unless the user asks for a different bump.

## Writing the description

- Keep it to one concise sentence — roughly 160 characters or fewer. Length signals importance, so scale it to the change, but err short.
- Plain text — no headers, bold, italics, or newlines inside the description. Inline `code` with single backticks and links are fine when genuinely useful.
- End every sentence with a full stop.
- Past tense for what the PR did: "Added", "Fixed", "Changed".
- Present tense for Elmo's behavior: "Elmo now supports…", "{feature} now…".

Check existing files in `.changeset/` or recent `CHANGELOG.md` entries for examples.
