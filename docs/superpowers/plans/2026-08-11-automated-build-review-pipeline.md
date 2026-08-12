# Automated Build/Review/Ship Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace west-marin-civic's opaque, toothless Usain/Kipchoge review loop with a repo-versioned, scheduled Workflow that selects a backlog item by priority, builds it with TDD, reviews it with genuinely independent adversarial subagents that submit real GitHub reviews, and escalates instead of silently stalling.

**Architecture:** A single Workflow script at `.claude/workflows/build-review-ship.js` runs four sequential phases (stale-check → select → build → review/report), each phase implemented as one or more `agent()` calls that do the actual GitHub/git/test work (the orchestrating script itself has no filesystem or GitHub access — only `agent()`, `parallel()`, `phase()`, `log()`). A Claude Code scheduled task invokes it weekly.

**Tech Stack:** Claude Code Workflow tool (multi-agent orchestration), `gh` CLI, GitHub REST API (branch protection, PR reviews), Vitest (existing test suite), Claude Code scheduled tasks (`mcp__scheduled-tasks__*`).

## Global Constraints

- Full `npm test` (all 3 projects: unit, worker-auth, worker-routing) must pass before any PR is opened by the Build phase — not just a new test, the whole suite.
- Pipeline-created branches MUST use the prefix `auto/<issue-number>-<slug>` (e.g. `auto/18-sheriff-oes-alerts`) — this is how the stale-PR check distinguishes pipeline PRs from manual/human work.
- Review verdicts default to fail-closed: if reviewers split or any reviewer is uncertain, treat as `REQUEST_CHANGES`, never `APPROVE`.
- All GitHub operations target `john9josi/west-marin-civic` via the already-authenticated `gh` CLI.
- Repo root for all local work in this plan: clone fresh per-task into `/tmp/wmc-<purpose>` (each task's Build-phase agent also clones fresh — pipeline runs must never depend on a specific pre-existing local checkout, since they'll run unattended on a schedule).

---

### Task 1: Label the current backlog by priority

**Files:** None (GitHub issue metadata only, no repo files).

**Interfaces:**
- Produces: every open issue except #60 carries exactly one of `p0`/`p1`/`p2`/`p3`, or `blocked`, or `needs-research` — this labeling is what Task 4's Select phase reads.

- [ ] **Step 1: Create the priority and pipeline-infra labels**

```bash
gh label create p0 --repo john9josi/west-marin-civic --color B60205 --description "Safety/data-accuracy critical" --force
gh label create p1 --repo john9josi/west-marin-civic --color D93F0B --description "Safety-relevant, ready to build" --force
gh label create p2 --repo john9josi/west-marin-civic --color FBCA04 --description "Ready, non-safety-critical" --force
gh label create p3 --repo john9josi/west-marin-civic --color C5DEF5 --description "Backlog / needs a decision first" --force
gh label create needs-research --repo john9josi/west-marin-civic --color 5319E7 --description "Not concretely buildable yet" --force
gh label create pipeline-infra --repo john9josi/west-marin-civic --color 000000 --description "Permanent infra issue, never auto-selected" --force
```

Expected: 6 `✓ ...created label...` lines (or silent success on `--force` update if any already exist).

- [ ] **Step 2: Apply labels to every open issue**

```bash
gh issue edit 15 --repo john9josi/west-marin-civic --add-label p0
gh issue edit 18 --repo john9josi/west-marin-civic --add-label p1
gh issue edit 19 --repo john9josi/west-marin-civic --add-label p1
gh issue edit 3  --repo john9josi/west-marin-civic --add-label p2
gh issue edit 5  --repo john9josi/west-marin-civic --add-label p2
gh issue edit 6  --repo john9josi/west-marin-civic --add-label p2
gh issue edit 39 --repo john9josi/west-marin-civic --add-label p2
gh issue edit 7  --repo john9josi/west-marin-civic --add-label p3
gh issue edit 8  --repo john9josi/west-marin-civic --add-label p3
gh issue edit 10 --repo john9josi/west-marin-civic --add-label p3
gh issue edit 12 --repo john9josi/west-marin-civic --add-label p3
gh issue edit 16 --repo john9josi/west-marin-civic --add-label p3
gh issue edit 17 --repo john9josi/west-marin-civic --add-label p3
gh issue edit 49 --repo john9josi/west-marin-civic --add-label blocked
gh issue edit 50 --repo john9josi/west-marin-civic --add-label needs-research
gh issue edit 60 --repo john9josi/west-marin-civic --add-label pipeline-infra
```

Note: #42 already carries `blocked` (confirmed this session) — no change needed there.

- [ ] **Step 3: Verify every open issue has exactly one qualifying label**

```bash
gh issue list --repo john9josi/west-marin-civic --state open --json number,labels \
  --jq '.[] | select([.labels[].name] | any(. == "p0" or . == "p1" or . == "p2" or . == "p3" or . == "blocked" or . == "needs-research" or . == "pipeline-infra") | not) | .number'
```

Expected: empty output (no issue numbers printed — every open issue matched one of the labels).

- [ ] **Step 4: No commit needed** (this task only changes GitHub issue metadata, not repo files).

---

### Task 2: Add required-review branch protection

**Files:** None (GitHub API call).

**Interfaces:**
- Consumes: existing branch protection on `main` (required_status_checks: `test`, enforce_admins: false) set up earlier this session.
- Produces: `main` now also requires 1 approving PR review before merge (still admin-exempt) — this is what makes Task 6's real `APPROVE`/`REQUEST_CHANGES` review meaningful.

- [ ] **Step 1: Read current protection to confirm starting state**

```bash
gh api repos/john9josi/west-marin-civic/branches/main/protection --jq '{status_checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, reviews: .required_pull_request_reviews}'
```

Expected: `status_checks: ["test"]`, `enforce_admins: false`, `reviews: null`.

- [ ] **Step 2: Add the required-review rule, keeping everything else unchanged**

```bash
gh api repos/john9josi/west-marin-civic/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF
```

- [ ] **Step 3: Verify**

```bash
gh api repos/john9josi/west-marin-civic/branches/main/protection --jq '{status_checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, review_count: .required_pull_request_reviews.required_approving_review_count}'
```

Expected: `status_checks: ["test"]`, `enforce_admins: false`, `review_count: 1`.

---

### Task 3: Workflow script skeleton + stale-PR escalation phase

**Files:**
- Create: `.claude/workflows/build-review-ship.js`

**Interfaces:**
- Produces: a runnable Workflow script with `meta` and a first phase that either escalates a stale PR and stops, or falls through to a placeholder `return` (replaced in Task 4) — this establishes the pattern every later task extends.

- [ ] **Step 1: Write the skeleton with the stale-PR check**

```js
export const meta = {
  name: 'build-review-ship',
  description: 'Select next-priority issue, build with TDD, adversarially review, report/escalate',
  phases: [
    { title: 'Stale check' },
    { title: 'Select' },
    { title: 'Build' },
    { title: 'Review' },
    { title: 'Report' },
  ],
}

const STALE_SCHEMA = {
  type: 'object',
  properties: {
    staleFound: { type: 'boolean' },
    prNumber: { type: ['number', 'null'] },
    hoursOpen: { type: ['number', 'null'] },
  },
  required: ['staleFound', 'prNumber', 'hoursOpen'],
}

phase('Stale check')
const stale = await agent(
  `You're checking whether a previous automated run of west-marin-civic's build pipeline left a PR stuck. Repo: john9josi/west-marin-civic (gh CLI already authenticated).

Run: gh pr list --repo john9josi/west-marin-civic --state open --json number,createdAt,headRefName

Filter to only PRs whose headRefName starts with "auto/" — those are pipeline-created, distinct from manual work. For each, compute hours elapsed since createdAt (compare against the current time via the Bash \`date\` command, e.g. \`date -u +%s\`). If any is open more than 72 hours, report the OLDEST one as stale. If none qualify, report staleFound false with prNumber and hoursOpen both null.`,
  { schema: STALE_SCHEMA, phase: 'Stale check' }
)

if (stale.staleFound) {
  await agent(
    `Post a comment on issue #60 in john9josi/west-marin-civic (gh issue comment 60 --repo john9josi/west-marin-civic --body "...") escalating that pipeline PR #${stale.prNumber} has been open ${Math.round(stale.hoursOpen)} hours with no merge/close decision, and that this run is pausing new work until it's resolved. Keep the comment under 5 sentences.`,
    { phase: 'Report' }
  )
  return { status: 'escalated_stale_pr', prNumber: stale.prNumber, hoursOpen: stale.hoursOpen }
}

log('No stale pipeline PR found, continuing.')
return { status: 'stale_check_passed' }
```

- [ ] **Step 2: Verify the file has no syntax errors and matches the Workflow script contract**

Confirm: file starts with `export const meta = {...}` as a pure literal (no variables/spreads inside it), uses only `agent`/`phase`/`log`/`return` (no `import`, no `require`, no `fs.*`, no `Date.now()`/`Math.random()`/bare `new Date()`).

- [ ] **Step 3: Dry-run just this phase**

Call the Workflow tool with `script` set to the file's contents above and no `args`. Expect the run to complete with `{ status: 'stale_check_passed' }` (assuming no `auto/*` PRs exist yet, which is true before Task 4 ever runs) — note the returned `runId` from the tool result; it's needed for `resumeFromRunId` in Task 4.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/build-review-ship.js
git commit -m "Add build-review-ship workflow: skeleton + stale-PR escalation phase"
```

---

### Task 4: Workflow script — Select phase

**Files:**
- Modify: `.claude/workflows/build-review-ship.js`

**Interfaces:**
- Consumes: `stale` result from Task 3 (script-local variable, same file).
- Produces: `selected.issueNumber` (number or null) and `selected.issueTitle` (string or null) — consumed by Task 5's Build phase.

- [ ] **Step 1: Replace the `return { status: 'stale_check_passed' }` line with the Select phase**

```js
const SELECT_SCHEMA = {
  type: 'object',
  properties: {
    issueNumber: { type: ['number', 'null'] },
    issueTitle: { type: ['string', 'null'] },
    reason: { type: 'string' },
  },
  required: ['issueNumber', 'issueTitle', 'reason'],
}

phase('Select')
const selected = await agent(
  `You're selecting the next backlog item for west-marin-civic's automated build pipeline. Repo: john9josi/west-marin-civic (gh CLI authenticated).

Fetch open issues: gh issue list --repo john9josi/west-marin-civic --state open --json number,title,labels,body --limit 100

Priority labels are p0 (highest) through p3. Skip any issue labeled "blocked", "needs-research", or "pipeline-infra" entirely.

For any open issue with NONE of p0/p1/p2/p3/blocked/needs-research/pipeline-infra yet (a newly-filed issue since the backlog was last triaged), judge and apply exactly one label now, then treat it accordingly:
- p0: affects road/evacuation/status data accuracy, or safety-critical reliability
- p1: safety-relevant feature with an already-verified data source (check the issue body for a "Data source:" line marked verified)
- p2: well-scoped feature/fix, not safety-critical
- p3: exploratory, large/ambiguous, or needs a product decision before it can be scoped
- needs-research: not concretely buildable as a single PR yet (e.g. an open research question)
Apply via: gh issue edit <number> --repo john9josi/west-marin-civic --add-label <label>

Among remaining eligible issues (excluding all skipped labels above), pick the single lowest-priority-number one (p0 first, then p1, p2, p3); if multiple share the lowest number, pick the lowest issue number as a tiebreak. Return that issue's number and title, and a one-sentence reason. If nothing is eligible, return issueNumber and issueTitle as null with a reason explaining why.`,
  { schema: SELECT_SCHEMA, phase: 'Select' }
)

if (!selected.issueNumber) {
  await agent(
    `Post a comment on issue #60 in john9josi/west-marin-civic (gh issue comment 60 --repo john9josi/west-marin-civic --body "...") reporting that this pipeline run found nothing ready to build. Reason: ${selected.reason}. Keep it under 3 sentences.`,
    { phase: 'Report' }
  )
  return { status: 'nothing_ready', reason: selected.reason }
}

log(`Selected issue #${selected.issueNumber}: ${selected.issueTitle}`)
return { status: 'selected', issueNumber: selected.issueNumber, issueTitle: selected.issueTitle }
```

- [ ] **Step 2: Dry-run through this phase using the cached stale-check result**

Call the Workflow tool with the updated script and `resumeFromRunId` set to Task 3's `runId`. The Stale-check `agent()` call should return instantly from cache (identical prompt/opts); only Select should actually run. Expect a real issue number back — per Task 1's labeling, the lowest-priority-number eligible issue is **#15** (p0). Confirm the tool result shows `{ status: 'selected', issueNumber: 15, issueTitle: 'Ship to live — merge sprint branch to main from This Sprint panel' }`.

- [ ] **Step 3: Commit**

```bash
git add .claude/workflows/build-review-ship.js
git commit -m "Add Select phase to build-review-ship workflow"
```

---

### Task 5: Workflow script — Build phase

**Files:**
- Modify: `.claude/workflows/build-review-ship.js`

**Interfaces:**
- Consumes: `selected.issueNumber`, `selected.issueTitle` from Task 4.
- Produces: `build.prNumber` (number or null), `build.branch` (string or null), `build.failureReason` (string or null) — consumed by Task 6's Review phase.

- [ ] **Step 1: Replace the `return { status: 'selected', ... }` line with the Build phase**

```js
const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    prNumber: { type: ['number', 'null'] },
    branch: { type: ['string', 'null'] },
    failureReason: { type: ['string', 'null'] },
  },
  required: ['prNumber', 'branch', 'failureReason'],
}

phase('Build')
const build = await agent(
  `Implement GitHub issue #${selected.issueNumber} ("${selected.issueTitle}") in john9josi/west-marin-civic using test-driven development.

1. Clone fresh: git clone https://github.com/john9josi/west-marin-civic /tmp/wmc-build-${selected.issueNumber} && cd /tmp/wmc-build-${selected.issueNumber}
2. Read the full issue body (gh issue view ${selected.issueNumber} --repo john9josi/west-marin-civic) plus DOCS.md and CLAUDE.md in this checkout for architecture and conventions.
3. Create a branch off latest main named exactly: auto/${selected.issueNumber}-<short-kebab-slug-of-the-title>
4. Write a failing test first in whichever file matches what you're changing (tests/lib.test.js for src/lib.js logic, tests/worker-routing.test.js or tests/worker-auth.test.js for worker.js routing). Run npm test and confirm it fails for the right reason.
5. Implement the minimal change to make it pass. Run npm test and confirm the FULL suite passes (all 3 projects: unit, worker-auth, worker-routing) — not just your new test.
6. Commit, push the branch, and open a PR: gh pr create --repo john9josi/west-marin-civic --title "..." --body "Fixes #${selected.issueNumber}\\n\\n<summary + test plan>"

If you cannot get the full suite passing after reasonable effort, or the issue turns out to be genuinely ambiguous (more than one valid interpretation, or missing information you can't resolve from the issue/docs alone), do NOT open a PR. Instead return prNumber and branch as null with a clear failureReason explaining what blocked you.

Return the PR number and exact branch name on success.`,
  { schema: BUILD_SCHEMA, phase: 'Build' }
)

if (!build.prNumber) {
  await agent(
    `Post a comment on issue #60 in john9josi/west-marin-civic (gh issue comment 60 --repo john9josi/west-marin-civic --body "...") reporting that this pipeline run tried issue #${selected.issueNumber} but could not produce a working PR. Reason: ${build.failureReason}. Suggest a human take a look. Keep it under 5 sentences.`,
    { phase: 'Report' }
  )
  return { status: 'build_failed', issueNumber: selected.issueNumber, failureReason: build.failureReason }
}

log(`Built PR #${build.prNumber} on branch ${build.branch}`)
return { status: 'built', prNumber: build.prNumber, branch: build.branch }
```

- [ ] **Step 2: Dry-run through this phase using the cached prior results**

Call the Workflow tool with the updated script and `resumeFromRunId` set to Task 4's `runId`. Stale-check and Select return from cache; Build actually runs against real issue #15. This is a genuine build attempt — expect either a real PR number back, or (if #15 turns out too ambiguous for autonomous implementation, which is plausible since it involves the dev-bar sprint-panel UI) a `failureReason`. Either outcome is valid — do NOT hand-hold the agent past a genuine `failureReason`; that's the escalation path working as designed. Note the `runId` either way.

- [ ] **Step 3: If a PR was opened, sanity-check it before proceeding**

```bash
gh pr view <prNumber> --repo john9josi/west-marin-civic --json title,body,headRefName
gh pr checks <prNumber> --repo john9josi/west-marin-civic
```

Confirm the branch name matches `auto/15-*` and the `test` check is passing (wait for it if still pending — this PR needs to exist and be green for Task 6's review to have something real to review).

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/build-review-ship.js
git commit -m "Add Build phase to build-review-ship workflow"
```

---

### Task 6: Workflow script — Review phase

**Files:**
- Modify: `.claude/workflows/build-review-ship.js`

**Interfaces:**
- Consumes: `build.prNumber` from Task 5.
- Produces: a real GitHub PR review (`APPROVE` or `REQUEST_CHANGES`) submitted on the PR; `finalVerdict` (string) consumed by Task 7's Report phase.

- [ ] **Step 1: Replace the `return { status: 'built', ... }` line with the Review phase**

```js
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'concerns'],
}

phase('Review')
const reviewPrompt = (lens) => `Adversarially review PR #${build.prNumber} in john9josi/west-marin-civic through a ${lens} lens. You have NOT seen how or why it was built — form your own judgment from the diff alone.

Run: gh pr diff ${build.prNumber} --repo john9josi/west-marin-civic
And: gh pr view ${build.prNumber} --repo john9josi/west-marin-civic --json body

If judging this properly requires empirically verifying a claim (e.g. reverting a change and re-running tests to see what a regression would actually look like), clone into an isolated path — git clone https://github.com/john9josi/west-marin-civic /tmp/wmc-review-${build.prNumber}-${lens} — never operate in an ambient or shared working directory, since another process may depend on its state.

Assess, through the ${lens} lens specifically:
- correctness: does the change actually address what the linked issue asked for, and is the logic right
- security: any injection risk, secret exposure, unsafe eval/innerHTML-equivalent, or auth/CORS weakening
- test-quality: are the tests genuine (would actually fail without the fix, not tautological), and if the diff touches src/lib.js's road-status classification logic, is there a regression test at a SPECIFIC real coordinate (not just a value comfortably far from any boundary) — this exact class of bug has recurred 3 times in this repo's history

This is a safety-critical app. Default to pass: false if you're at all uncertain — err toward requiring another look rather than rubber-stamping. Return pass (boolean) and concerns (array of specific strings, empty if none).`

const verdicts = await parallel([
  () => agent(reviewPrompt('correctness'), { schema: VERDICT_SCHEMA, phase: 'Review', label: 'review:correctness' }),
  () => agent(reviewPrompt('security'), { schema: VERDICT_SCHEMA, phase: 'Review', label: 'review:security' }),
  () => agent(reviewPrompt('test-quality'), { schema: VERDICT_SCHEMA, phase: 'Review', label: 'review:test-quality' }),
])

const validVerdicts = verdicts.filter(Boolean)
const passCount = validVerdicts.filter(v => v.pass).length
const finalVerdict = (validVerdicts.length === 3 && passCount >= 2) ? 'APPROVE' : 'REQUEST_CHANGES'
const allConcerns = validVerdicts.flatMap(v => v.concerns)

await agent(
  `Submit a real GitHub PR review on #${build.prNumber} in john9josi/west-marin-civic.

Run exactly one of:
- If approving: gh pr review ${build.prNumber} --repo john9josi/west-marin-civic --approve --body "Automated adversarial review (correctness/security/test-quality, 3 independent passes) found no blocking concerns."
- If requesting changes: gh pr review ${build.prNumber} --repo john9josi/west-marin-civic --request-changes --body "Automated adversarial review found concerns:\\n${allConcerns.map(c => '- ' + c).join('\\n')}"

Use the ${finalVerdict === 'APPROVE' ? 'approve' : 'request-changes'} form.`,
  { phase: 'Review' }
)

log(`Review verdict: ${finalVerdict} (${passCount}/3 passed)`)
return { status: 'reviewed', prNumber: build.prNumber, finalVerdict, concerns: allConcerns }
```

- [ ] **Step 2: Dry-run through this phase using the cached prior results**

Call the Workflow tool with the updated script and `resumeFromRunId` set to Task 5's `runId` (from whichever sub-step actually produced a `runId` — if Build failed in Task 5, this phase has nothing to review; skip to Task 7 in that case and revisit Task 6's dry-run once a future run produces a real PR). Expect 3 independent verdicts, a computed `finalVerdict`, and a real review visible on the PR:

```bash
gh pr view <prNumber> --repo john9josi/west-marin-civic --json reviews --jq '.reviews[-1] | {state, body}'
```

Confirm `state` is `APPROVED` or `CHANGES_REQUESTED` (not `COMMENTED` — that's the exact defect this whole pipeline exists to fix).

- [ ] **Step 3: Commit**

```bash
git add .claude/workflows/build-review-ship.js
git commit -m "Add Review phase to build-review-ship workflow"
```

---

### Task 7: Workflow script — Report phase

**Files:**
- Modify: `.claude/workflows/build-review-ship.js`

**Interfaces:**
- Consumes: `build.prNumber`, `finalVerdict`, `allConcerns` from Task 6.
- Produces: final workflow return value; a status comment on issue #60 (which the existing `agent-notify.yml` relays to Slack — no changes needed there).

- [ ] **Step 1: Replace the final `return { status: 'reviewed', ... }` line with the Report phase**

```js
phase('Report')
await agent(
  `Post a comment on issue #60 in john9josi/west-marin-civic (gh issue comment 60 --repo john9josi/west-marin-civic --body "...") summarizing this pipeline run: issue #${selected.issueNumber} ("${selected.issueTitle}") was built as PR #${build.prNumber}, automated review verdict: ${finalVerdict}${allConcerns.length ? ' (concerns: ' + allConcerns.join('; ') + ')' : ''}. Include the PR link. Keep it under 6 sentences.`,
  { phase: 'Report' }
)

return { status: 'done', issueNumber: selected.issueNumber, prNumber: build.prNumber, finalVerdict }
```

- [ ] **Step 2: Full dry-run from scratch (no resumeFromRunId)**

Call the Workflow tool fresh (no `resumeFromRunId`) to exercise the complete script end-to-end exactly as the scheduled task will invoke it. This is the real validation, not a resumed/cached partial run.

- [ ] **Step 3: Verify the end-to-end artifact trail**

```bash
gh issue view 60 --repo john9josi/west-marin-civic --json comments --jq '.comments[-1].body'
```

Confirm the final comment on issue #60 matches the run's outcome, and (if a PR was built) that it has a real `APPROVE`/`CHANGES_REQUESTED` review per Task 6.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/build-review-ship.js
git commit -m "Add Report phase to build-review-ship workflow — pipeline complete end-to-end"
```

---

### Task 8: Open a PR for the workflow script itself

**Files:** None new — this packages Tasks 1–7's commits.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin <branch-used-for-tasks-3-7>
gh pr create --repo john9josi/west-marin-civic \
  --title "Add automated build/review/ship pipeline (.claude/workflows/build-review-ship.js)" \
  --body "Implements docs/superpowers/specs/2026-08-11-automated-build-review-pipeline-design.md. Replaces reliance on Kipchoge's always-COMMENTED reviews with real APPROVE/REQUEST_CHANGES from 3 independent adversarial subagents, gated by branch protection's new required-review rule (Task 2). Adds stale-PR escalation to fix the failure mode that let #63 sit unmerged for 10 weeks. Dry-run results for each phase are in the task history above.

Test plan:
- [x] Each phase dry-run individually via resumeFromRunId (Tasks 3-6)
- [x] Full end-to-end dry-run from scratch (Task 7)
- [x] Confirmed a real (non-COMMENTED) review lands on the built PR"
```

- [ ] **Step 2: Wait for the `test` check, then this needs a human (or a genuinely separate reviewer) approval before merge**, since branch protection now requires 1 approving review and this PR is itself part of the pipeline that would normally provide that review — merge this one manually.

---

### Task 9: Create the scheduled task

**Files:** None (Claude Code scheduled-task config, not a repo file).

**Interfaces:**
- Consumes: the merged `.claude/workflows/build-review-ship.js` from Task 8.

- [ ] **Step 1: Only after Task 8 is merged and you've reviewed at least one full dry-run's actual output by hand**, create the scheduled task:

Use `mcp__scheduled-tasks__create_scheduled_task` with:
- A weekly cadence (e.g. Monday 8am PT, matching the existing Usain slot) — exact cron/schedule syntax per that tool's own parameters.
- A prompt instructing the task to run the `build-review-ship` workflow against `john9josi/west-marin-civic` (working directory: a fresh clone, or wherever the task runtime expects — check `mcp__scheduled-tasks__create_scheduled_task`'s parameters for how it expects a working directory/repo to be specified before finalizing this).

- [ ] **Step 2: Verify it's registered**

```
mcp__scheduled-tasks__list_scheduled_tasks
```

Confirm the new task appears with the correct schedule and `enabled: true`.

- [ ] **Step 3: Note the rollout stance explicitly** (per the spec's Testing/rollout section): this starts at a conservative weekly cadence, tightened to 2x/week later once several runs have been manually spot-checked. Do not tighten the cadence as part of this task.

---

## Self-Review Notes

- **Spec coverage:** Select (Task 4) ✓, Build (Task 5) ✓, Review with real GitHub review states (Task 6) ✓, Report/escalate + stale-PR pre-check (Tasks 3, 7) ✓, branch protection addition (Task 2) ✓, priority-label operationalization (Task 1) ✓, manual dry-run before scheduling (Tasks 3–7 dry-runs, Task 9 gate) ✓, scheduled task (Task 9) ✓, fail-closed error handling (Global Constraints + Task 6) ✓.
- **Type consistency checked:** `selected.issueNumber`/`selected.issueTitle` (Task 4) match the names Task 5's prompt interpolates; `build.prNumber`/`build.branch` (Task 5) match Task 6; `finalVerdict`/`allConcerns` (Task 6) match Task 7. All four schemas are complete JSON Schema objects with `required` arrays, no placeholders.
- **Known open risk, not a blocker:** Task 9's exact scheduled-task working-directory mechanism wasn't fully specified here because it depends on that tool's actual parameters, which should be read at execution time rather than guessed now.
