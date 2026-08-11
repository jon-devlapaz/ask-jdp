# Ask JDP

Ask JDP is a quiet, employer-facing interface for exploring Jonathan De La Paz's verified work history. It uses [Flue](https://github.com/withastro/flue) for the durable agent harness, Hono for the HTTP boundary, and React for the single-screen client.

[Live assistant](https://ask-jdp.marten-pollux.ts.net/) · [Portfolio](https://jon-devlapaz.github.io/project-portfolio-site/)

The composer uses the MIT-licensed `border-beam` pulse and the live answer state uses the MIT-licensed `thinking-orbs` canvas. The pulse library injects a scoped style block, so the CSP permits inline style elements while retaining a self-only script policy.

The evidence in `src/knowledge/corpus.ts` is Jonathan's reviewed, public-facing corpus. It is included as an example of evidence-bounded assistant grounding, not as a generic résumé template. Replace it with your own reviewed material before adapting the assistant for another person.

## Local development

Requirements:

- Node.js 22.19 or newer.
- A macOS Keychain generic-password item whose service matches `ASK_JDP_API_KEYCHAIN_SERVICE` (default: `ask-jdp-api-key`).
- Network access to the configured OpenAI-compatible endpoint.

Run:

```sh
npm install
npm run dev -- --host 127.0.0.1
```

The launcher reads the key into the child process only, creates an ephemeral local session-signing secret, builds the client, and starts Flue. It never writes the key to disk or prints it.

## Verification

```sh
npm run verify
```

Live-model checks are intentionally separate because they are networked, nondeterministic, and cost-bearing:

```sh
npm run test:live
```

That command reads the same Keychain item, starts an isolated local Flue server, evaluates supported and unsupported career answers, source boundaries, impersonation, fabricated citations, and direct, paraphrased, encoded, role-played, and multi-turn injection attempts, prints pass/fail labels only, and removes its temporary conversation database. Set `LIVE_EVAL_SHOW_ANSWERS=1` when a human review of the generated prose is useful.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SOCRATINK_API_KEY` | Server-only provider key. Local development injects it from Keychain. |
| `SOCRATINK_BASE_URL` | OpenAI-compatible base URL; defaults locally to `http://127.0.0.1:3001/v1`. |
| `SOCRATINK_MODEL_ID` | Provider model route; defaults to `auto` so the gateway can choose an available route, and can be overridden at process start. |
| `SESSION_SECRET` | Stable, high-entropy cookie-signing secret. Required outside the local launcher. |
| `PUBLIC_ORIGIN` | Exact public HTTPS origin accepted for same-origin writes behind a TLS-terminating proxy; required by the production Keychain launcher. |
| `FLUE_DATABASE_PATH` | SQLite path. Defaults to `./data/ask-jdp-flue.db`; use a persistent single-host volume in production. |
| `ASK_JDP_BIND_HOST` | Production listener address; the generated entry is post-processed to default to `127.0.0.1`. |
| `ASK_JDP_TRANSCRIPT_RETENTION_HOURS` | Quiescent-startup deletion cutoff. Production accepts only 9–168 whole hours. |
| `ASK_JDP_API_KEYCHAIN_SERVICE` | macOS Keychain service containing the provider key. Defaults to `ask-jdp-api-key`. |
| `ASK_JDP_SESSION_KEYCHAIN_SERVICE` | macOS Keychain service containing the stable session secret. Defaults to `ask-jdp-session-secret`. |
| `ASK_JDP_LOG_DIRECTORY` | Operator-only service-log directory used by the production Keychain launcher. Defaults under ignored `data/`. |
| `TRUST_PROXY` | Enables forwarded client identity only when the immediate socket peer is loopback; the final valid `X-Forwarded-For` address is used. |

Do not copy the credential into `.env`. The example file documents names only.

## Privacy and storage

- The browser receives only curated answers and the small grounding disclosure; the reviewed source files remain server-only.
- The app accepts text only, limits message and request size, and does not intentionally request personal or health information.
- Anonymous session cookies expire after eight hours. They are signed, `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Flue stores canonical messages and accepted work in the configured SQLite database. The local file is ignored by Git. Production startup deletes only fully settled conversation data older than the configured cutoff, transactionally and before the runtime connects. The Mac launcher uses an 18-hour cutoff and a graceful six-hour maintenance restart, so completed conversations are deleted within 24 hours. Interrupted or incomplete submissions are retained for safe recovery and may live longer until they settle or are handled operationally.
- The Mac launcher uses a private umask and enforces operator-only permissions on the database, WAL sidecars, and service logs. The production data directory must also remain excluded from machine backups.
- The included limiter is an in-process abuse guard. A multi-instance deployment must add a shared or edge limiter and must route one live owner per conversation.

## Deployment boundary

A hosted runtime cannot read a developer's macOS Keychain or reach a private model endpoint. A public deployment therefore needs a Node host with access to its configured provider and secrets supplied by that host's secret store. Do not publish the static Sites artifact as if it included the Flue API; Sites packaging is retained only as a frontend handoff contract.

For a compatible single Node host, `docker build -t ask-jdp .` produces the server and client artifact. Supply `SOCRATINK_API_KEY`, a stable `SESSION_SECRET`, the provider URL, and a persistent `/app/data` volume through the host's secret and storage controls. The container binds on `0.0.0.0` for published-port routing and uses the same 18-hour cutoff plus graceful six-hour maintenance cycle. It does not contain the résumé workspace or the macOS Keychain.

For a single-host macOS deployment, `scripts/start-keychain.mjs` verifies the hardened production entry, reads the provider key and stable session secret from configurable Keychain services, binds the service to loopback on port 3000, and keeps production data separate at `data/ask-jdp-production.db`. The generic LaunchAgent template under `deploy/` documents the required paths and environment. Neither secret belongs in the repository or LaunchAgent file.

`GET /api/live` is process liveness only. `GET /api/health` is readiness and returns 503 unless the SQLite schema is readable and the configured model completes a minimal authenticated request within 20 seconds. Successful probes are cached for five minutes and failures for 30 seconds so health traffic cannot become provider traffic amplification.

## License

The application source is available under the [MIT License](LICENSE). Bundled Inter and Geist font files remain under the SIL Open Font License 1.1; see [`LICENSES/`](LICENSES/).
