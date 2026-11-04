# Independent review of tests/unknown-routes.test.ts

Reviewer: fresh Pi session (openai/gpt-6.1-sol, thinking low, no tools), not the build worker. Session: ~/dev/run-notes/review-sessions (name askjdp-test-review). Prompt: ~/dev/run-notes/ask-jdp-test-review-prompt.md

Verdict and findings, verbatim:

request changes

1. **`tests/unknown-routes.test.ts:26,30` — Unprovisioned build dependency causes wrong-reason failures.** These reads require `dist/client/index.html` and `dist/client/assets`, but `verify` runs `npm test` before building. On a clean checkout without those artifacts, the preservation test fails with a filesystem error, and unknown-route requests cannot exercise the intended index fallback. The supplied red log establishes the intended failure only with `dist` already present. Naming the prerequisite in line 7 does not provision it.

2. **`tests/unknown-routes.test.ts:18–20` — Assertions exclude explicitly permitted implementations.** Line 20 rejects every script, including a bootstrap that renders an explicit unknown-route state without restoring a conversation. Lines 18–19 additionally require the message and return link in raw response HTML, excluding a valid client-rendered state. The seed expressly permits that approach. Even a standalone page with harmless scripts would fail line 20.

3. **`tests/unknown-routes.test.ts:9–12,21–22` — Session checks do not establish conversation isolation.** Issuing a session cookie does not seed the existing tab conversation in `sessionStorage`. An ordinary index shell also typically contains no conversation ID and sets no cookie, so these negative assertions can pass while client execution silently restores a prior chat. Conversely, prohibiting any `Set-Cookie` adds a restriction not required by the seed.

4. **`tests/unknown-routes.test.ts:8–23` — HTTP-only coverage misses required navigation behavior.** These requests do not execute the client, follow the return link, reload, or exercise Back/Forward. Matching an `href="/"` string does not establish a usable visible return control. A response containing matching hidden markup could pass while still presenting the Ask UI or restoring a conversation.

5. **`tests/unknown-routes.test.ts:5,8–44` — The baseline exercises only Node routing.** It never invokes `worker/index.js`; the unrestricted Sites index retry can remain unchanged while this suite passes. The seed requires both applicable serving paths, and the existing Sites fallback expectation would continue protecting the unwanted behavior.

**Required changes**
- Provision deterministic client fixtures or build prerequisites before tests, including clean-checkout execution.
- Replace implementation-specific script/raw-HTML restrictions with assertions compatible with both permitted presentation approaches.
- Add browser-level coverage for a stored conversation, visible unknown-route state, usable return, reload, and Back/Forward; remove unsupported cookie restrictions.
- Include compatible Sites unknown-route regressions while preserving root, assets, APIs, and handoff checks.

## Operator scope for the test revision (written by the operator, not the reviewer)

Revise only the regression tests; change no production code (src/, worker/, scripts/, package.json, configs).

1. No dependence on a prior build. The tests must go red for the right reason on a clean checkout with no dist/ (provide any client index or asset the test needs as a fixture under tests/, or have the test create it in a temp dir). Prove it: rm -rf dist, then run the test file alone.
2. Assert what the server returns for /foo, /chat and /ask/xyz: an explicit unknown-route message and a link to "/" in the response. Scripts in the response are allowed. Do not assert on Set-Cookie. (A purely client-rendered state is out of scope for this lock; the issue forbids adding a client router.)
3. Keep 3 red cases (the three paths) and 2 preservation cases (root document plus a supported asset; API liveness plus JSON API miss).
4. Cover the Sites worker too: replace the existing expectation in tests/sites-worker.test.mjs that an unknown app route returns the index with an unknown-route expectation for the same three paths, keeping its asset, API and packaging checks.
5. Browser-level coverage (reload, Back/Forward, stored conversation) stays with seed-1 and is out of scope here.
6. Write a fresh red log to runs/encounter-an-explicit-unknown-route-state-on-unsupported-paths-rather-than-the-a/03-build/output/unknown-routes-red-2.log covering both test commands, run from a tree with no dist/.
