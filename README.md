# Artisan Business Desk — first shared release

A GitHub Pages frontend with Supabase Auth, PostgreSQL and private Storage. This is the shared successor to the local Artisan quotation desk. No customer records are written into Git.

## Current status

Supabase project `artisan-crm` (`ernedfqavibltbdqadgm`, Mumbai) is provisioned with the initial schema, private file bucket and active team-admin Edge Function. Public frontend configuration is present. GitHub publication and the first admin login are still pending; no team accounts exist yet. See DEPLOYMENT.md for the exact checkpoint.

### Included

- Six account slots: exactly one admin and up to five staff accounts.
- Gmail addresses and other email addresses work as account IDs. Each person uses a separate CRM password; Google OAuth is not enabled by this release.
- Email/password sign-in, sign-out, session refresh, password change and recovery.
- Admin: clients, leads, quotations, revisions, internal costing, task handouts, team access, backups and audit overview.
- Staff: shared sales records, task visibility, progress/blocker/completion updates on their own tasks; internal quote costs and notes are removed by the server.
- Shared PostgreSQL records with optimistic version checks to prevent silent overwrites.
- Task deadlines, owners, priorities, blockers, completion notes and server-attributed history.
- Private proposal, drawing and proof uploads: PDF, PPTX, XLSX, JPEG, PNG and WebP; 10 MB per file, 25 files per record.
- PDF/Excel quotations, task/history Excel, JSON backup and admin restore.
- GitHub Pages workflow that runs checks and tests before publishing only `web/`.

The accounting expansion (invoices, purchase ledger, inventory and GST returns) is outside this release. Account permissions are deliberately simple: the admin edits sales/commercial records; staff update assigned work. Expand these when actual roles are confirmed.

## Launch sequence

### 1. Supabase project

The rollout project is already provisioned: do not rerun the initial schema there. For a separate fresh installation, use a new/dedicated project, inspect it first, then run `supabase/schema.sql` once in its SQL Editor. It is a transactional initial schema, not a repeatable update script; do not rerun against an already-provisioned workspace.

In Auth settings:

- Disable public sign-up and anonymous sign-in. Accounts are created by the admin.
- Enable email/password auth.
- Set Site URL to the final GitHub Pages URL, including the repository path.
- Allow that exact URL as a password-recovery redirect.
- Configure production SMTP for reliable recovery emails; do not treat the built-in test mail service as a production dependency.

The schema creates RLS-protected tables, private privileged functions, restricted public RPC entry points, and a private file bucket. Keep `crm_private` out of exposed Data API schemas.

### 2. First admin

Run `python3 scripts/bootstrap-admin.py` locally. It asks for the project URL, hidden server key, admin email/name and hidden initial password. It refuses to change a workspace that already has members. It does not save the server key or password.

Alternatively, create the first Auth user in the Supabase dashboard and insert their UUID/email/name into `public.crm_members` with role `admin` using a trusted SQL session. The admin identity must be explicitly selected; there is no public “claim admin” endpoint.

### 3. Team management function

Deploy `supabase/functions/team-admin/index.ts` as the `team-admin` Edge Function. `supabase/config.toml` sets gateway JWT verification off because the function performs its own Auth `get user` verification and checks the caller’s live, active admin membership on every request. Do not remove those checks.

The deployed function defaults to `https://d-pum.github.io`. To use another frontend origin, set Edge Function secret `APP_ORIGIN` to that origin only (no repository path or trailing slash). Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside the function. Never copy the server key into frontend files.

### 4. GitHub

Run `node scripts/configure.mjs` to write only the public Supabase project URL and publishable key into `web/config.js`.

Push this project to the selected GitHub repository on `main`. In repository Settings → Pages, select GitHub Actions as the source. `.github/workflows/pages.yml` runs tests and publishes `web/`.

Run `node scripts/check.mjs` before publishing. It deliberately fails if project configuration is missing or a server key is detected.

### 5. Six accounts and launch check

Sign in as the selected admin. Open **Team & access** and create the five staff logins with distinct names/emails and initial passwords. Share credentials privately; each person should change their password after signing in. No invitation emails are sent by the account creation function.

Verify with two browsers:

1. Admin creates a client, quotation and task for a staff account.
2. Staff signs in, sees their task and updates progress or completion.
3. Admin sees the update after refresh or the 15-second automatic refresh.
4. Staff cannot edit another person’s handout, change deadlines/owners, see internal costing or manage accounts.
5. Upload and download a private proposal/proof file.
6. Download a JSON backup, then test recovery in a separate non-production project.
7. Verify password recovery with the actual email provider and final deployment URL.

## Existing local records

Download a backup from the local quotation desk first. In the shared app, admin Settings → restore can import the JSON. Backups include record data and task history; cloud attachment bytes remain in the private Storage bucket and need a separate bucket backup.

Task owners must match actual team account names. Reassign unmapped legacy tasks before importing. An import replaces the shared workspace records, so import once before the team begins entering live data. The server records the restore as a workspace change.

## Verification performed

- PostgreSQL execution using PGlite: the full schema, membership checks, six-account limit, one-admin protection, cost redaction including historical revisions, task permissions, history attribution, stale-save conflicts, disabled accounts, private file registration, and audit events.
- JavaScript tests: task lifecycle/filters, legacy backups, completion/blocker requirements, HTML escaping, refresh-token rotation and concurrent refresh handling, public-key checks, and API error handling.
- Cloud browser with synthetic mock responses: admin task/team views, staff personal queue and successful task completion. No live Supabase account was used in this browser test.

Production auth, mail delivery, Storage API upload/download and two-device sync still require the actual project and deployed URL. Passing local tests is not proof those external services are configured.

## Running checks

`npm ci --ignore-scripts` installs the exact test dependency from the lockfile. Run `npm test`, then `npm run check`. Before project configuration exists, `node scripts/check.mjs --allow-unconfigured` verifies source while reporting the outstanding configuration.

## Operational limits

- This first release uses one versioned workspace document; competing writes show a conflict instead of overwriting each other. For six users this is a simple starting point. Copy unsaved text before reloading on conflict.
- Saved records are online; browser session storage holds only the active login session. Signing out clears the local app session. There is no offline record editing.
- Background refresh pauses while an editor or task dialog is open, avoiding loss of unsaved work.
- Disabling an account blocks further database and file-access requests. A file link issued just before disabling can remain valid for up to 60 seconds.
- Download record backups regularly and separately back up the Storage bucket. Confirm the project’s own retention/backups before relying on them.

## Sources

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Supabase password auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
