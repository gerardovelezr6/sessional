# sessional

White-label, multi-tenant conference management for Model UN.

Status: Phase 0 (foundation). See the roadmap for what comes next.

| Document | Contents |
|---|---|
| [`docs/audit/PHASE-0-AUDIT.md`](docs/audit/PHASE-0-AUDIT.md) | Every hard-coded assumption in the reference implementation |
| [`docs/adr/`](docs/adr) | Architecture decisions: stack, tenancy, routing, config, theming, languages, protocol, roles, billing, operations |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases, acceptance criteria, risks, effort |
| [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) | Decisions still open |
| [`docs/SETUP.md`](docs/SETUP.md) | Accounts, domain and keys: what the owner sets up |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What exists in the code today |

`brand/` holds the logo files exactly as supplied. They are never redrawn or re-traced.

## Working on it

```bash
npm install
npm run dev        # http://localhost:3000
npm run verify     # lint, types, unit tests, schema mirror, secret check, build
npm run test:db    # migrations and tenant-safety tests on a scratch Postgres
npm run test:e2e   # Playwright against the production build (run `npm run build` first)
```
