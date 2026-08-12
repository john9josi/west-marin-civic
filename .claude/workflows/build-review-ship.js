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

0. FIRST, guard against building something that already exists. Run:
   gh pr list --repo john9josi/west-marin-civic --state open --json number,headRefName
   If any open PR's headRefName is exactly \`auto/${selected.issueNumber}-\` followed by anything, this issue ALREADY has a pipeline PR open. Do NOT build, do NOT clone, do NOT open a second PR. Return prNumber and branch as null with failureReason "Issue #${selected.issueNumber} already has open pipeline PR #<number> — nothing to build." and stop immediately. Opening a duplicate PR against a live repo is worse than doing nothing.

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
// Fail closed: anything short of a full 3-reviewer panel with a 2/3 majority
// is treated as "needs a human look", never as a pass.
const finalVerdict = (validVerdicts.length === 3 && passCount >= 2) ? 'CLEAN' : 'CONCERNS'
const allConcerns = validVerdicts.flatMap(v => v.concerns)

// Posted as a PR COMMENT, not a review state. GitHub does not permit
// APPROVE/REQUEST_CHANGES on a PR you authored, and this pipeline opens its
// PRs under the same account it reviews with — so COMMENTED is the only state
// available, and a comment says the same thing without pretending to be a gate
// it structurally cannot be. A real approving gate needs a second identity
// (GitHub App or bot collaborator); see the design doc.
const commentBody = finalVerdict === 'CLEAN'
  ? `🤖 **Automated adversarial review: no blocking concerns** (${passCount}/3 independent reviewers passed — correctness, security, test-quality)\n\nThis is advisory, not an approving review. A human still decides whether to merge.`
  : `🤖 **Automated adversarial review: concerns found** (${passCount}/3 independent reviewers passed)\n\n${allConcerns.map(c => '- ' + c).join('\n')}\n\nThis is advisory, not a blocking review. A human decides whether these are merge-blocking.`

await agent(
  `Post a comment on PR #${build.prNumber} in john9josi/west-marin-civic using this exact command:

gh pr comment ${build.prNumber} --repo john9josi/west-marin-civic --body <the body text below>

Body text to post verbatim (do not summarize, edit, or add to it):
---
${commentBody}
---

Note: this is deliberately a PR comment, not \`gh pr review\` — GitHub rejects APPROVE/REQUEST_CHANGES on a self-authored PR, and this pipeline authors the PRs it reviews.`,
  { phase: 'Review' }
)

log(`Review verdict: ${finalVerdict} (${passCount}/3 passed)`)

phase('Report')
await agent(
  `Post a status comment on issue #60 in john9josi/west-marin-civic. Issue #60 is this project's agent message bus — a GitHub Action relays its comments to Slack, so this is how the human finds out what the pipeline did.

Run: gh issue comment 60 --repo john9josi/west-marin-civic --body "<body>"

The body should say, in under 6 sentences:
- Pipeline run built issue #${selected.issueNumber} ("${selected.issueTitle}") as PR #${build.prNumber}
- Automated review verdict: ${finalVerdict}${allConcerns.length ? ` — ${allConcerns.length} concern(s) raised, detailed in a comment on the PR itself` : ' — no blocking concerns'}
- The PR link: https://github.com/john9josi/west-marin-civic/pull/${build.prNumber}
- That the review is advisory and a human still decides whether to merge
- Sign it "— build-review-ship pipeline"`,
  { phase: 'Report' }
)

return { status: 'done', issueNumber: selected.issueNumber, prNumber: build.prNumber, finalVerdict, concerns: allConcerns }
