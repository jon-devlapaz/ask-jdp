# Ask JDP deployment and rollback runbook

This is the operational record for the public, single-host path. It intentionally
does not contain credential values, provider credentials, Keychain contents, or
private source material.

## Released topology

```text
https://jon-devlapaz.github.io/project-portfolio-site/
  -> https://ask-jdp.marten-pollux.ts.net/ (Tailscale Funnel)
  -> 127.0.0.1:3000 (com.jondev.ask-jdp LaunchAgent; Node + SQLite)
  -> private Socratink provider
```

The public Funnel is the only public ingress. The Node listener remains loopback
only, and its persistent SQLite database and operator logs remain on the host.
Production pins the non-secret provider route `gpt-oss-120b`; the provider key
and stable session secret remain in their configured macOS Keychain items.

| Surface | Verified baseline before this deployment |
| --- | --- |
| Ask JDP | `3414ab07fd23e7d1dd33efdc2bdbe91de09bd007` (`3414ab0`) |
| Portfolio | `d1c06dfdb453f3cf29b27f19771b6ea509b49b27` (`d1c06df`) |
| Portfolio integration commits | `55d36bf` Add Ask JDP portfolio entry; `2ca1b1a` Update Ask JDP portfolio link; `65b50dc` Promote Ask JDP in portfolio navigation |

## Production release evidence — 2026-08-13

- Application code: `0a6aba1754379fbfeffcab9608f6e9a9766bfb36`
  (`0a6aba1`), pushed to `origin/main`.
- Deployment completed: `2026-08-13T03:02:53Z`.
- Runtime: the ownership-verified `com.jondev.ask-jdp` LaunchAgent was reloaded
  from this checkout with `SOCRATINK_MODEL_ID=gpt-oss-120b`; its replacement
  Node process listened only on `127.0.0.1:3000`.
- Ingress: Tailscale Funnel reported
  `https://ask-jdp.marten-pollux.ts.net/ -> http://127.0.0.1:3000`.
- Health: fresh loopback and public `/api/live` and `/api/health` probes returned
  HTTP 200 with `{ "ok": true }`; the public root returned HTTP 200 with the
  expected CSP and HSTS headers.
- Deterministic candidate verification: `npm run verify` passed 6 Vitest files
  with 44 tests, both production builds, and 8 Sites/runtime packaging tests.
- Live provider matrix: passed factual, leadership, technical (Tink,
  tink-skills, Socratink), unsupported-credential, direct/paraphrased/role-play/
  raw-corpus/encoded/multi-turn prompt-injection, PHI and policy-extraction,
  fictional-resume, third-person identity, and fabricated-citation cases on the
  pinned production model.
- Public browser: a clean unauthenticated session opened portfolio revision
  `d1c06df`, followed its Ask JDP link, and received the supported current-role
  answer plus visible evidence disclosure with no console or page errors.
- Recovery browser: an isolated tab-local read fault kept a harmless admitted
  question pending, produced the 60-second non-busy recovery alert, rotated to a
  fresh signed session with the question preserved, and completed after reads
  were restored. No shared service or provider process was changed for the test.

## Preflight and deploy

1. From the Ask JDP checkout, confirm the intended release with `git rev-parse HEAD`
   and `git status --short`. Do not deploy an unexplained working tree.
2. Run `npm run verify`. It covers the provider timeout path, pure
   recovery-policy invariants, security boundaries, TypeScript, production
   builds, and packaging. Browser timing and recovery are verified separately in
   step 7; the deterministic suite does not simulate a mounted browser timer.
3. Run the live matrix against the same Keychain service, base URL, and explicit
   model route as production:

   ```sh
   SOCRATINK_MODEL_ID=gpt-oss-120b npm run test:live
   ```

   Supply the configured non-secret Keychain service name and private provider
   URL through the operator environment when they differ from the documented
   defaults. The launcher reads the key without printing it. The matrix covers
   factual, leadership, technical, unsupported-credential, prompt-injection,
   privacy, fabricated-claim, and identity-boundary behavior.
4. Build the Node release with `npm run build:node`. Before disrupting any
   process, inspect `launchctl print "gui/$(id -u)/com.jondev.ask-jdp"` and the
   listener on port 3000. Continue only after the loaded program path and working
   directory prove that this checkout owns both. Confirm that the exact
   LaunchAgent plist uses `SOCRATINK_MODEL_ID` value `gpt-oss-120b` and contains
   only Keychain service names—not secret values. Validate it with `plutil -lint`,
   then reload only the proven label so the new build and plist are both loaded:

   ```sh
   launchctl bootout "gui/$(id -u)/com.jondev.ask-jdp"
   launchctl bootstrap "gui/$(id -u)" /Users/jondev/Library/LaunchAgents/com.jondev.ask-jdp.plist
   ```

   Re-run `launchctl print` and inspect the loopback listener to prove a new
   process now owns the release. Confirm that the reloaded
   `com.jondev.ask-jdp` LaunchAgent is healthy with:

   ```sh
   curl --fail --silent --show-error http://127.0.0.1:3000/api/live
   curl --fail --silent --show-error http://127.0.0.1:3000/api/health
   ```

   The first `/api/health` request after restart verifies SQLite and performs a
   bounded provider request. Later successes may be cached for up to five minutes
   and failures for 30 seconds. If the service needs recovery, use the procedure
   below; never put a secret in a shell command, plist, log, or repository file.
5. Inspect current Funnel state before changing it:

   ```sh
   tailscale funnel status
   ```

   If it is absent, establish only the existing loopback target:

   ```sh
   tailscale funnel --bg --yes 3000
   ```

   Do not expose a LAN address or bind Node publicly. If the tailnet rejects this
   action, obtain Funnel authorization in the Tailscale admin flow; no code or
   secret change is an appropriate workaround.
6. Confirm the generated public URL is `https://ask-jdp.marten-pollux.ts.net/` and
   that the portfolio release at `https://jon-devlapaz.github.io/project-portfolio-site/`
   links to it. Check the browser flow in a clean, unauthenticated session: open the
   portfolio, follow the Ask JDP entry, ask a supported question, and confirm a
   grounded response and visible evidence disclosure arrive through the public
   origin.
7. Exercise client recovery without touching the service or provider: in another
   clean browser session, block that browser's conversation-history/update reads
   after a harmless question is admitted. Confirm the 60-second recovery alert
   clears `aria-busy`, then restore reads, choose **Start fresh**, and confirm the
   question is preserved in the new session's composer. This is a browser-local
   fault; do not stop the LaunchAgent or private provider to create it.

Record the application-code SHA, UTC time, configured model ID, Funnel status,
local readiness result, public browser result, and scenario results in the
deployment ticket or release record.
Do not record prompts that contain private material, transcripts, cookies, or
generated-answer bodies.

## Recovery

If the public request fails but Funnel remains configured, first separate ingress
from service readiness:

```sh
tailscale funnel status
curl --fail --silent --show-error http://127.0.0.1:3000/api/live
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

For a verified Ask JDP LaunchAgent failure, restart only its known label:

```sh
launchctl kickstart -k "gui/$(id -u)/com.jondev.ask-jdp"
```

Then repeat both loopback probes, Funnel status, and the clean-browser public
request. Do not remove the SQLite database, WAL files, logs, Keychain items, or
unrelated launchd jobs as a recovery step.

## Default public rollback

To immediately withdraw public access while preserving the running Node service,
SQLite data, Keychain items, and LaunchAgent, remove the Funnel configuration:

```sh
tailscale funnel reset
```

This is the default rollback because it removes the public ingress without stopping
the loopback service or deleting data. Verify withdrawal with `tailscale funnel
status`, then verify the local service remains available with the two loopback
probes above. Record the time and resulting status.

## Application release rollback

After withdrawing Funnel, reverse the recorded application-code commit with a
new revert commit; do not reset the checkout or delete persistent data:

```sh
git revert --no-edit 0a6aba1754379fbfeffcab9608f6e9a9766bfb36
git push origin main
```

Run `npm run verify`, rebuild with `npm run build:node`, repeat the ownership
check, and reload only `com.jondev.ask-jdp` using the preflight procedure. Verify
both loopback probes and a clean-browser answer before re-establishing Funnel
with `tailscale funnel --bg --yes 3000`. If the revert conflicts or any check
fails, keep Funnel withdrawn and stop; do not reset the repository, remove the
SQLite database, or alter Keychain items.

## Portfolio discoverability rollback

If Ask JDP should no longer be discoverable from the portfolio, withdraw Funnel
first, then revert the three integration commits from newest to oldest in the
portfolio checkout:

```sh
git revert --no-edit 65b50dc
git revert --no-edit 2ca1b1a
git revert --no-edit 55d36bf
```

Review the resulting diff, push the portfolio's normal `main` deployment path,
and wait for GitHub Pages to serve the new revision. If a revert conflicts, stop
and resolve only the Ask JDP link/navigation change; do not discard unrelated
portfolio work.

Post-rollback verification: the portfolio no longer advertises or links Ask JDP,
the Funnel status reports no public target, the former public endpoint cannot
reach the service, and the two local probes still pass. Retain the release SHAs
and rollback timestamp as deployment evidence.
