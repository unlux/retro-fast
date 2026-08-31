# Deployment

Live at: **https://retro-fast.lakshaychoudhary77712.workers.dev**
Cloudflare account: unlux (`f639bee2e410e8f7c7a06a2821a18d88`), Worker name `retro-fast`.

Deploy: `npm run build && npx wrangler deploy`

## Secrets (set via `wrangler secret put`, values in fleet repo / ~/.secrets.env)

- `JIRA_SITE` — https://skillion.atlassian.net
- `JIRA_EMAIL` — lakshay@skillionvision.com
- `JIRA_API_TOKEN` — **classic unscoped** Atlassian token (fleet `secrets/personal.env`).
  Must be classic: scoped tokens are OAuth-bearer credentials and fail Basic auth outright
  (401 on every route, including `/myself`) — verified 2026-08-31, see `PLAN.md`. Do not
  retry this; it is not a scope-selection problem.
- `JIRA_TOKEN_EXPIRY` — set to the **real** date shown on the Atlassian token page at creation,
  in `YYYY-MM-DD`. We create tokens with a short lifetime — roughly a quarter — rather than
  the 1-year maximum (rationale in `PLAN.md` Operational notes). Currently **2026-12-25**.
  The API cannot report a token's expiry, so this is hand-maintained; if it drifts, the
  30-day warning banner silently lies.

### Rotation (all four steps — the last is the one that gets forgotten)

```sh
# 1. fleet repo — source of truth
cd ~/code/personal/fleet
sops set secrets/personal.env '["JIRA_API_TOKEN"]' '"<new-token>"'
git add secrets/personal.env && git commit -m "Rotate Jira API token" && git push

# 2. regenerate the auto-sourced derived file on origglux
sops -d ~/code/personal/fleet/secrets/personal.env > ~/.secrets.env

# 3. Worker secrets — piping from sops keeps the token out of shell history
sops -d ~/code/personal/fleet/secrets/personal.env \
  | grep '^JIRA_API_TOKEN=' | cut -d= -f2- | tr -d '"' | tr -d '\n' \
  | npx wrangler secret put JIRA_API_TOKEN
npx wrangler secret put JIRA_TOKEN_EXPIRY    # the real date, YYYY-MM-DD

# 4. REQUIRED: the expiry banner is prerendered at build time, so the new
#    date does not appear until a rebuild. The token itself is live already.
npm run build && npx wrangler deploy
```

Verify afterwards — both must return 200:

```sh
sops exec-env ~/code/personal/fleet/secrets/personal.env 'curl -s -o /dev/null -w "myself: %{http_code}\n" \
  -u "lakshay@skillionvision.com:$JIRA_API_TOKEN" "https://skillion.atlassian.net/rest/api/3/myself"
curl -s -o /dev/null -w "greenhopper: %{http_code}\n" \
  -u "lakshay@skillionvision.com:$JIRA_API_TOKEN" "https://skillion.atlassian.net/rest/greenhopper/1.0/rapidview"'
```

The greenhopper check matters: it is the undocumented endpoint the velocity chart depends on,
and it is the first thing that would break under a credential change.

## Cloudflare Access — DONE (verified 2026-08-31)

Both `/` and `/api/sprints` return a 302 to the Access login rather than serving data, so the
app is gated. This matters for more than privacy: the API routes call Jira using the Worker's
token on behalf of whoever reaches them, so an ungated route would let an anonymous caller
exercise the token's full permissions without ever stealing it.

Re-verify after any change to routing or the Worker's domain:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://retro-fast.lakshaychoudhary77712.workers.dev/api/sprints?team=rex
# expect 302 (redirect to Access login) — a 200 here means the routes are exposed
```

<details>
<summary>Original setup steps (kept for rebuilding from scratch)</summary>

The wrangler OAuth token cannot create Access apps (API returns `auth.forbidden`), so this
must be done in the dashboard.

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

</details>

## Post-setup TODOs

- Confirm "Peye" = Pete Cooper and that `pete@skillion.tech` is his address
  (`config/teams.json` — currently an inference, flagged in `_todo`).
- Fill in Julian Meyer's and Manya Sharma's emails in `config/teams.json` recipients
  (hidden by Atlassian privacy settings; not discoverable via API), then redeploy.
- Paste a copied retro into Apple Mail once to sanity-check the rich-HTML clipboard flavor.
