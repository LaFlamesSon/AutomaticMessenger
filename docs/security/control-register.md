# CaughtUp Security Control Register

Last reviewed: August 10, 2026

## Confirmed

- The public site enforces HTTPS and sends a restrictive Content Security Policy,
  frame denial, content type protection, referrer controls, and permissions policy.
- Microsoft Defender antivirus, real-time protection, behavior monitoring, and
  network inspection are enabled on the verified company endpoint.
- OAuth credentials and service secrets are stored server-side and are not stored
  in extension browser storage.
- Supabase Vault is used for sensitive integration configuration.
- User requests require authenticated identity or controlled server credentials.
- Owner-scoped data access and row-level security protect service-only tables.
- Media-kit files are stored privately and are accessed through authorized flows.
- Email content is treated as untrusted data and cannot change system settings.
- Commercial negotiations require creator review.
- A public privacy policy, support channel, deletion-request process, and security
  reporting channel are available.

## Adopted operating requirements

- Unique accounts and multi-factor authentication are required for administrative
  services wherever the provider supports MFA.
- Access is granted only for a documented operational need and is reviewed at
  least quarterly and whenever a role or provider changes.
- Company endpoints must use automatic security updates, antivirus, an enabled
  firewall, screen locking, storage encryption where supported, and no shared
  administrator account.
- Suspected incidents are reported to support@getcaughtup.io, triaged promptly,
  contained, investigated, documented, and communicated within applicable legal
  and contractual deadlines.
- Vulnerabilities are reviewed at least monthly and after material releases, with
  remediation prioritized by exploitability, exposure, and impact.

## Open owner attestations

- Confirm that MFA is enabled on every administrative Cloudflare, Supabase,
  Google, TikTok, source-control, and email account.
- Confirm that every additional company endpoint meets the endpoint baseline.
- Confirm whether any reportable personal-data breach occurred in the past three
  years.
- Confirm whether any regulatory, customer, or individual privacy complaint was
  received in the past three years.
- No Data Protection Officer has been appointed.
- CaughtUp has not obtained ISO 27001, ISO 27701, SOC 2 Type 2, ePrivacy, or an
  equivalent independent certification.
