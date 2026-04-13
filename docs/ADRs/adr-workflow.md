# ADR Workflow Rules

These rules apply to every coding session. No exceptions.

## Starting a session

Before writing ANY code, you must:
1. Check if there is an active ADR with an in-progress sprint. If yes, resume that sprint.
2. If starting new work, create a new ADR from the template at @docs/ADRs/ADR-template.md
3. Assign the next sequential number (check @docs/ADRs/ADR-index.md for the last used number)
4. Write the full ADR: context, decision, implementation plan with phases/sprints, testing plan for each sprint
5. Add the ADR to ADR-index.md
6. Only then begin coding

## During a sprint

- Work only on the deliverables listed in the current sprint
- If scope creep happens (you discover something else needs to change), document it in the ADR and either add it to the current sprint or create a new sprint for it
- At every logical checkpoint where something CAN be tested, STOP and test it
- Record test results in the ADR immediately — do not defer

## Completing a sprint

After all deliverables are done and all tests pass:
1. Update sprint status in the ADR: `[x] complete`
2. Record all test results with actual output
3. If any architecture changed, update the relevant architecture document AND note it in the ADR's Architecture Changes section
4. Write the changelog entry in the appropriate CHANGELOG-[area].md
5. Git commit everything: code + ADR + changelog + any architecture doc updates
6. Commit message format: `feat(ADR-NNNN): sprint X.Y — short description`

## If something goes wrong

- If a test fails, document the failure in the ADR, fix it, re-test, document the re-test
- If the plan needs to change mid-sprint, update the ADR first, then continue
- If the ADR needs to be abandoned, set status to Abandoned and document why
- Never delete an ADR — abandoned ADRs are valuable records of what was tried and why it didn't work

## Changelog discipline

- Each changelog file covers one area (schema, worker, dashboard, api, edge-functions, infra, docs)
- When a changelog file exceeds 500 lines, archive it as CHANGELOG-[area]-v1.md and start a fresh one
- Every sprint that produces code changes MUST have a changelog entry
- The changelog entry references the ADR number and sprint
