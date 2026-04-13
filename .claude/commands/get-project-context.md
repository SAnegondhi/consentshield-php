---
description: Display the current project context summary and active memories
---

# Get Project Context

Read and display the project context file and all active memories for the ConsentShield project.

## Memory Directory

All persistent memories are stored in:
```
/Users/sudhindra/.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/
```

## Instructions

1. Read the project context file at `.claude/project-context.md`
2. Read the memory index at `/Users/sudhindra/.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/MEMORY.md`
3. Read **every memory file** listed in the MEMORY.md index
4. Display the project context to the user
5. Display a **Memories** section summarizing each memory by type (user, feedback, project, reference)
6. Note the "Last Updated" date so the user knows if context needs refreshing
7. Flag any memories that appear outdated or contradictory

If the project context file doesn't exist, inform the user to run `/refresh-project-context` to generate it.
