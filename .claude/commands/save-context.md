---
description: Save conversation context and update memories from session learnings
---

# Save Context

You are tasked with:
1. **Save** the entire conversation context to a timestamped file in the `session-context/` directory
2. **Review the conversation for new memories** that should be persisted

## Memory Directory

All persistent memories are stored in:
```
/Users/sudhindra/.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/
```

The index file `MEMORY.md` lists all active memories.

## What to Save

Save the complete conversation history including:
1. All user messages
2. All assistant responses
3. Tool calls and results (deduplicated)
4. System reminders (deduplicated)
5. File reads (show once, reference subsequent reads)
6. Bash commands executed
7. Session metadata

## Memory Review (REQUIRED)

Before saving, scan the conversation for information that should be persisted as memories:

### Check for new memories to create:
- **User memories**: Did the user reveal their role, preferences, or expertise?
- **Feedback memories**: Did the user correct your approach or give guidance?
- **Project memories**: Did you learn about deadlines, ongoing work, or decisions not in the code?
- **Reference memories**: Did the user mention external systems, URLs, or tools?

### Check for memories to update:
- Read `MEMORY.md` index first
- Read any memory files that might be affected by this session's work
- Update memories that are now outdated based on changes made in this session

## Implementation Steps

### Step 1: Review conversation for memories
### Step 2: Prepare Directory
```bash
mkdir -p /Users/sudhindra/projects/aiSpirit/consent-sheild/session-context
```

### Step 3: Generate Timestamp
```bash
date +"%Y-%m-%d-%H-%M-%S"
```

### Step 4: Collect and deduplicate conversation data
### Step 5: Write context file to `session-context/context-YYYY-MM-DD-HH-mm-ss.md`
### Step 6: Confirm Save
### Step 7: Update `.claude/session-handoff.md` with current state
