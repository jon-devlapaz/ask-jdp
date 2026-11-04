# Independent review 2 of the revised regression tests

Reviewer: fresh Pi session (openai/gpt-6.1-sol, thinking low, no tools; name askjdp-test-review-2), not the build worker. Prompt: ~/dev/run-notes/ask-jdp-test-review-2-prompt.md

Verdict and findings, verbatim:

accept

1. **`tests/unknown-routes.test.ts:13–23,27–52`** — No blocking finding. Temporary client fixtures remove the Node regression’s prior-build dependency. The supplied clean-tree run shows exactly three intended failures and two passing preservation cases.

2. **`tests/sites-worker.test.mjs:24–48`** — No blocking finding. All three required paths now assert an explicit unknown-route message and a return link, replacing the old index-fallback expectation without imposing status, script, or cookie restrictions.

3. **`tests/sites-worker.test.mjs:72–81`** — The clean-tree log also reports missing-build-artifact failures in the retained packaging checks. These are existing build-dependent checks explicitly preserved by the operator’s scope, not wrong-reason failures in the new routing regressions. They do not block this lock.
