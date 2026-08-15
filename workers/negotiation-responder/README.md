# CaughtUp negotiation responder

This is a temporary, test-only Cloudflare Email Routing Worker for the
`CUCF20-20260814B` stress run. It turns replies sent from the CaughtUp extension
to six simulated brand aliases into one fixed, threaded brand response.

Safety boundaries:

- only six exact `@getcaughtup.io` recipients are configured;
- the SMTP envelope sender must be `yafet2132@gmail.com`;
- the subject must contain the authorized run tag;
- inbound bodies are never read, parsed, stored, logged, or used as instructions;
- responses contain no price, availability, turnaround, acceptance, or rejection;
- Cloudflare permits at most one `message.reply()` call per inbound event.

The live routing rules are intentionally exact-address rules. The domain catch-all
must remain disabled.
