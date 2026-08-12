# Automated Build/Review/Ship Pipeline — Design

## Context

West Marin Civic currently relies on four scheduled Claude Code personas — Switzer, Usain, Kipchoge, Prefontaine — configured on `claude.ai/code/routines`, external to this repository. Investigating the #63/#68 stall (2026-08-11) showed why it silently rotted for ~10 weeks: Kipchoge submits real GitHub PR reviews, but always with review state `COMMENTED`, never `APPROVE`/`REQUEST_CHANGES` — so even with branch protection, its review can't gate a merge. There's also no mechanism that forces a human decision when a PR stalls; the agents just kept re-reporting status weekly. And because the personas' instructions live entirely on an external dashboard, nobody looking at this repo — including future Claude Code sessions — can see or edit what "Kipchoge" is actually told to do.

The goal: an automated build → review → ship pipeline that (a) has a review gate with real teeth, (b) can't silently stall — a stuck PR forces visibility on a fixed clock, and (c) is transparent — its logic lives in this repo, version-controlled and PR-reviewable, not on a dashboard only one account can see.

## Architecture

A **Claude Code scheduled task** fires on a cadence (recommend weekly to start; tighten to 2x/week once trusted) and runs a **Workflow** checked into the repo at `.claude/workflows/build-review-ship.js`. The workflow has four phases:

1. **Select** — read open GitHub issues by priority label (`p0`/`p1`/`p2`/`p3`, applied to the current backlog as part of this implementation, reflecting the 2026-08-11 triage: P0 safety/data-accuracy, P1 verified-source safety features, P2/P3 everything else), skip anything labeled `blocked` or `needs-research`, pick the lowest-numbered ready item. An issue with no priority label yet gets a lightweight judgment pass (same criteria: safety/data-accuracy impact, is a data source already verified) and is labeled accordingly before selection — so the logic stays operational as new issues arrive, not just a one-time label snapshot. If nothing qualifies, report "nothing ready" and stop — no forced busywork.
2. **Build** — one agent implements the item with TDD (write a failing test, implement, verify green), following this repo's existing patterns (Vitest, the `src/lib.js` / `worker.js` split). Opens a PR referencing the issue. If tests can't be made to pass, no PR is opened — failure is reported instead.
3. **Review** — 3 independent subagents, each seeing only the diff (not the builder's reasoning), adversarially assess correctness-against-the-issue, security, and test quality. Majority-pass submits a real `APPROVE` review; otherwise `REQUEST_CHANGES` with the specific concerns as review comments. This is the actual fix for Kipchoge's toothlessness — a genuine independent check, not the same context grading its own work.
4. **Report/escalate** — posts a summary (what was built, review verdict, PR link) to issue #60, which already relays to Slack via the existing `agent-notify.yml` — no new plumbing needed. Before starting new work, the run first checks for any PR from a *previous* run still open past 72h; if found, it escalates that instead of starting something new (directly fixes the "piling new sprints on a stuck one" pattern that produced the #63 backlog).

Branch protection on `main` gets one addition: require 1 approving review, still admin-exempt (John keeps override capability). Combined with phase 3, this is now a real gate rather than the current pass-through.

## Error handling

- Split/uncertain review verdicts fail closed (`REQUEST_CHANGES`), matching the project's stated QA-over-speed priority.
- Build failures never produce a PR.
- A stale PR from a prior run blocks new Select/Build work until resolved.

## Testing / rollout

Before scheduling anything: manually invoke the workflow once via the Workflow tool against a real backlog item, inspect the PR and review output by hand, confirm quality. Only then create the scheduled task, starting at a conservative weekly cadence.

## Out of scope

- Migrating or disabling the existing Switzer/Usain/Kipchoge/Prefontaine routines — they can keep running in parallel initially; this doesn't touch `claude.ai/code/routines` at all (can't, from here).
- Multi-repo/general-purpose reuse — this is scoped to west-marin-civic; the pattern generalizes later if wanted.
