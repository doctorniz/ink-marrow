# Cursor & AI workflow (Ink by Marrow)

This project uses **Cursor rules** under `.cursor/rules/` so the assistant stays aligned with team habits.

## Active rules

| Rule | Purpose |
|------|---------|
| `greeting-and-docs.mdc` (`alwaysApply: true`) | Greet with **Assalamualaikum** on substantive replies; after meaningful changes, update `docs/` (and `README.md` when relevant) and note what changed in the closing message. |

## For maintainers

- Edit rules in `.cursor/rules/*.mdc` (YAML frontmatter + markdown body).
- When you change how the AI should behave, update this file and keep `docs/CONVENTIONS.md` in sync if it’s a team-wide convention.
