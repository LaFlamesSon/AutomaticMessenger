# CaughtUp public site

Static, dependency-free site deployed with Cloudflare Workers Static Assets. The asset directory is `web/`; no build command is required. The earlier Pages project remains available as a preview/rollback surface.

## Local preview

From the repository root:

```powershell
npx --yes wrangler@latest dev -c web/wrangler.jsonc
```

This uses only local static files. Do not add `--remote`.

## Required before any public deployment

- Provision the dedicated reviewer account and deliver its password only through TikTok's protected form.
- Confirm TikTok Creator OAuth allowlist/testing-account status before describing it as live.
- Authenticate Cloudflare, verify the `getcaughtup.io` zone, deploy a preview, and visually accept it before touching DNS or custom domains.

## Cloudflare deployment

- Deploy command: `npx --yes wrangler@latest deploy -c web/wrangler.jsonc`
- Static asset directory: `web/`
- Canonical host: `getcaughtup.io`
- `www.getcaughtup.io`: handled by the separate `caughtup-www-redirect` Worker

The `_headers` and `_redirects` files are included in the static output and are supported natively by Workers Static Assets.
