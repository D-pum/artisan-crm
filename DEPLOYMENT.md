# Launch checkpoint

- Supabase organisation: Artisan & Co (`pdnkldgewbqrxhwihsgw`).
- New CRM project: `artisan-crm` / `ernedfqavibltbdqadgm`, Mumbai (`ap-south-1`), healthy.
- Public API URL: https://ernedfqavibltbdqadgm.supabase.co
- Initial migration applied: `artisan_crm_initial_workspace`.
- Four CRM tables and the private `crm-files` bucket exist; 10 MB file limit.
- No anonymous execute permission on workspace load; no anonymous or direct authenticated table reads.
- `team-admin` Edge Function is active, version 1; it authenticates each caller through Supabase Auth and checks live admin membership.
- Trial limit: six accounts total, one admin and five staff.
- Team accounts: none yet. The first admin Gmail address has not been supplied.
- GitHub destination: `D-pum/artisan-crm` (new, dedicated CRM repository). Do not modify any other repository.
- GitHub repository created successfully in D-pum. Source publication and Pages deployment are in progress.
- Auth configuration still to verify: public signup disabled, email/password enabled, final Site URL/redirect URL, recovery mail delivery.
- Browser QA used synthetic data; production authenticated flows require an admin account and final frontend deployment.

The source contains only a public Supabase publishable key. Server/service-role keys are not present.
