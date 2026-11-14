# Load test: projection screens

`npm run load:screens -- [options]` (script: `scripts/load-test.mjs`) registers screens, pairs them
with committees as a chair, and polls the way screens do. It fails when p95 latency is 800 ms or more
or more than 1 % of requests fail.

The conference-day target (ADR-0010) is 60 committees x 26 screens (one projector and 25 viewers)
= 1,560 screens.

## Results so far (local, one instance)

Run on the development container: one `next start` instance, the stand-in database and the test
client on the same 4 CPUs. Not representative of Vercel and Supabase, but it shows where the limits
are.

| Scenario | Screens | Requests/s | Errors | p50 | p95 | p99 | Result |
|---|---|---|---|---|---|---|---|
| Realtime working (a fetch about every 6 s per screen) | 1,560 | 260 | 0 % | 5 ms | 17 ms | 27 ms | Pass |
| Degraded mode, a sixth of the target (every 2 s) | 156 | 78 | 0 % | 5 ms | 10 ms | 17 ms | Pass |
| Degraded mode, full target (every 2 s) | 1,560 | 511 | 0 % | 281 ms | 7,275 ms | 18,294 ms | **Fail** on one instance |

Degraded mode at full size needs more than one server instance (Vercel adds instances under load) or
working realtime. This must be confirmed on staging before launch:

```
SCREEN_REGISTRATIONS_PER_HOUR=5000   # on the staging deployment, for the test only
npm run load:screens -- --base https://<school>.<staging host> --supabase https://<project>.supabase.co \
  --anon-key <publishable key> --email <chair> --password <password> \
  --committees <id1>,<id2>,... --per-committee 26 --seconds 120 --interval 2000
```

Not covered here: Supabase Realtime itself (connections and fan-out of 60 channels). The realtime
messages are tiny ("revision N") and screens fetch only after one, so the fetch rate above is the
load that matters for Sessional's servers.
