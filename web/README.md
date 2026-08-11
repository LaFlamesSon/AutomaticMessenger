# CaughtUp public site

Static, dependency-free site prepared for Cloudflare Pages. The deploy directory is `web/`; no build command is required.

## Local preview

From the repository root:

```powershell
npx --yes wrangler@latest pages dev web
```

This uses only local static files. Do not add `--remote`.

## Required before any public deployment

- Provision the dedicated reviewer account and deliver its password only through TikTok's protected form.
- Confirm TikTok Creator OAuth allowlist/testing-account status before describing it as live.
- Authenticate Cloudflare, verify the `getcaughtup.io` zone, deploy a preview, and visually accept it before touching DNS or custom domains.

## Cloudflare settings

- Framework preset: None
- Build command: leave empty
- Build output directory: `web` when configured from repository root
- Canonical host: `getcaughtup.io`
- `www.getcaughtup.io`: configure a host-level redirect only after preview acceptance

The `_headers` and `_redirects` files are included in the static output.
