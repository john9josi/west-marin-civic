# West Marin Civic — Claude Instructions

## Issue-first workflow (mandatory)

**Before writing any code or editing any file, open a GitHub issue first.**

Steps every time, no exceptions:
1. `gh issue create` with a clear title and description
2. Note the issue number
3. Make the change and commit referencing the issue
4. Deploy to staging (`npx wrangler deploy --env dev`), review
5. Deploy to prod (`npx wrangler deploy`)
6. Push to GitHub (`git push origin main`)
7. Close the issue with the commit reference

If a change was already made without an issue, open one retroactively and close it with the commit before moving on.

**Never skip this.** Not for small fixes. Not for one-liners.

---

## Git is source of truth

Always commit before deploying. The PreToolUse hook enforces this for `wrangler deploy`, but the rule applies everywhere. Never deploy uncommitted changes.

---

## Staging before prod

All changes go to staging first:
- Staging: `npx wrangler deploy --env dev` → https://west-marin-civic-dev.john-b98.workers.dev (password: ask user)
- Prod: `npx wrangler deploy` → westmarincivic.org

Wait for user approval on staging before pushing to prod.
