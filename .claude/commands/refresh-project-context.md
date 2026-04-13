---
description: Refresh the project context by reading changelogs, documentation, and memories
---

# Refresh Project Context

Regenerate the project context file using direct file reads, incorporating all saved memories.

## Memory Directory

All persistent memories are stored in:
```
/Users/sudhindra/.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/
```

## Instructions

1. **Read all memories first** (these inform everything else)
2. **Read CLAUDE.md** — project knowledge base
3. **Read design docs** in `docs/design/`
4. **Scan app structure** — Glob source files across all directories
5. **Update the file** at `.claude/project-context.md`
6. **Compress for brevity** — reduce 30-50% without losing facts
7. **Check for stale memories** — flag contradictions
8. **Confirm** to user with summary

## Output Format

```markdown
# ConsentShield Project Context

**Last Updated**: YYYY-MM-DD
**Active Memories**: X (Y user, Z feedback, W project, V reference)

## Product Overview
## Repository Layout
## Rules (from feedback memories)
## Recent Changes
## Current App Structure
## Key Decisions
## Open Items
## Active Memories
```
