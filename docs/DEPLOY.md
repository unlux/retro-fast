# Deployment

Live at: **https://retro-fast.lakshaychoudhary77712.workers.dev**
Cloudflare account: unlux (`f639bee2e410e8f7c7a06a2821a18d88`), Worker name `retro-fast`.

Deploy: `npm run build && npx wrangler deploy`

## Secrets (set via `wrangler secret put`, values in fleet repo / ~/.secrets.env)

- `JIRA_SITE` — https://skillion.atlassian.net
- `JIRA_EMAIL` — lakshay@skillionvision.com
- `JIRA_API_TOKEN` — unscoped Atlassian token (fleet `secrets/personal.env`)
- `JIRA_TOKEN_EXPIRY` — 2027-08-20 (assumed 1-year from creation 2026-08-20; adjust if the
  real expiry differs). Rotate: create new token → `wrangler secret put JIRA_API_TOKEN` →
  update fleet secret + this date.

## Cloudflare Access — MANUAL SETUP REQUIRED (once, ~2 minutes)

The wrangler OAuth token cannot create Access apps (API returns `auth.forbidden`), so this
must be done in the dashboard. **Until this is done the app and its API routes are publicly
reachable at the URL above.**

1. Cloudflare dashboard → account **unlux** → **Zero Trust**. If first time: pick the free
   plan and a team domain (e.g. `unlux.cloudflareaccess.com`).
2. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
   - Application name: `retro-fast`
   - Public hostname: `retro-fast.lakshaychoudhary77712.workers.dev` (exact domain, no path)
   - **Session duration: 1 month**
3. Add a policy: name `skillion-team`, action **Allow**, include rule
   **Emails ending in** `@skillionvision.com` **OR** `@skillion.tech`.
4. Login method: the default **One-time PIN** is enough (teammates get a code by email).
5. Save. Verify: open the URL in a private window — it must show the Access login, and a
   `@skillion.tech` / `@skillionvision.com` email must get through.

## Post-setup TODOs

- Confirm "Peye" = Pete Cooper and that `pete@skillion.tech` is his address
  (`config/teams.json` — currently an inference, flagged in `_todo`).
- Fill in Julian Meyer's and Manya Sharma's emails in `config/teams.json` recipients
  (hidden by Atlassian privacy settings; not discoverable via API), then redeploy.
- Paste a copied retro into Apple Mail once to sanity-check the rich-HTML clipboard flavor.
