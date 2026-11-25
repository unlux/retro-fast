# Deployment

Live at: **https://retro-fast.lakshaychoudhary77712.workers.dev**
Cloudflare account: unlux (`f639bee2e410e8f7c7a06a2821a18d88`), Worker name `retro-fast`.

Deploy: `npm run build && npx wrangler deploy`

## Secrets (set via `wrangler secret put`, values in fleet repo / ~/.secrets.env)

- `JIRA_SITE` — https://skillion.atlassian.net
- `JIRA_EMAIL` — lakshay@skillionailabs.com (must match the account the API token belongs to; a mismatched pair 401s on every call)
- `JIRA_API_TOKEN` — unscoped Atlassian token. Fleet `secrets/personal.env` stores it as
  `RETROFAST_JIRA_API_TOKEN`, so it isn't mistaken for a general Jira credential.
- `JIRA_TOKEN_EXPIRY` — 2027-11-25 (expiry Atlassian showed when the token was created on
  2026-11-25). Rotate: create new token → `wrangler secret put JIRA_API_TOKEN` →
  update fleet `RETROFAST_JIRA_API_TOKEN` + this date.

## Cloudflare Access

The live URL redirected to the `unlux.cloudflareaccess.com` login on 2026-09-25.
The Access application is configured. Check its email allowlist in the dashboard
before inviting a new teammate.

Inspect the application under **unlux → Zero Trust → Access → Applications → retro-fast**.
The public hostname is `retro-fast.lakshaychoudhary77712.workers.dev`. Verify any
required teammate address can pass the policy with a one-time PIN. The login redirect
alone does not establish which addresses are allowed.

## Post-setup TODOs

- Paste a copied retro into Apple Mail once to sanity-check the rich-HTML clipboard flavor.
