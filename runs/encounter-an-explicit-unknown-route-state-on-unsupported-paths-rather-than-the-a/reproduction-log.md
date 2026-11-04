$ ["sh", "-c", "npm test -- tests/unknown-routes.test.ts; n=$?; node --test --test-name-pattern=unknown-route tests/sites-worker.test.mjs; s=$?; [ $n -ne 0 ] && [ $s -ne 0 ] && exit 1; exit 0"]

> ask-jdp@0.0.0 test
> vitest run tests/unknown-routes.test.ts


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90m/home/tinker/dev/worktrees/ask-jdp/fix-4-unknown-routes[39m

[90mstderr[2m | tests/unknown-routes.test.ts
[22m[39mserveStatic: root path './dist/client' is not found, are you sure it's correct?
serveStatic: root path './dist/client' is not found, are you sure it's correct?

 [31m❯[39m tests/unknown-routes.test.ts [2m([22m[2m5 tests[22m[2m | [22m[31m3 failed[39m[2m)[22m[32m 193[2mms[22m[39m
[31m     [31m×[31m returns an explicit unknown-route document at /foo[39m[32m 134[2mms[22m[39m
[31m     [31m×[31m returns an explicit unknown-route document at /chat[39m[32m 8[2mms[22m[39m
[31m     [31m×[31m returns an explicit unknown-route document at /ask/xyz[39m[32m 6[2mms[22m[39m
     [32m✓[39m preserves the root client document and a supported asset[32m 9[2mms[22m[39m
     [32m✓[39m preserves API liveness and JSON misses[32m 12[2mms[22m[39m

[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 3 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m tests/unknown-routes.test.ts[2m > [22mNode document routing with isolated client fixtures[2m > [22mreturns an explicit unknown-route document at /foo
[41m[1m FAIL [22m[49m tests/unknown-routes.test.ts[2m > [22mNode document routing with isolated client fixtures[2m > [22mreturns an explicit unknown-route document at /chat
[41m[1m FAIL [22m[49m tests/unknown-routes.test.ts[2m > [22mNode document routing with isolated client fixtures[2m > [22mreturns an explicit unknown-route document at /ask/xyz
[31m[1mAssertionError[22m: expected '<!doctype html><html><body><div id="r…' to match /unknown route|page not found/i[39m

[32m- Expected:[39m
/unknown route|page not found/i

[31m+ Received:[39m
"<!doctype html><html><body><div id=\"root\"></div><script src=\"/assets/app.js\"></script></body></html>"

[36m [2m❯[22m tests/unknown-routes.test.ts:[2m33:18[22m[39m
    [90m 31|[39m     expect(response.headers.get("content-type")).toContain("text/html"…
    [90m 32|[39m     [35mconst[39m body [33m=[39m [35mawait[39m response[33m.[39m[34mtext[39m()[33m;[39m
    [90m 33|[39m     [34mexpect[39m(body)[33m.[39m[34mtoMatch[39m([36m/unknown route|page not found/i[39m)[33m;[39m
    [90m   |[39m                  [31m^[39m
    [90m 34|[39m     [34mexpect[39m(body)[33m.[39m[34mtoMatch[39m([36m/<a\b[^>]*\bhref=["']\/["'][^>]*>/i[39m)[33m;[39m
    [90m 35|[39m   })[33m;[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯[22m[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[31m3 failed[39m[22m[2m | [22m[1m[32m2 passed[39m[22m[90m (5)[39m
[2m   Start at [22m 18:24:41
[2m   Duration [22m 3.09s[2m (transform 339ms, setup 0ms, import 2.41s, tests 193ms, environment 0ms)[22m

✖ returns an explicit unknown-route document at /foo (115.064185ms)
✖ returns an explicit unknown-route document at /chat (4.181022ms)
✖ returns an explicit unknown-route document at /ask/xyz (3.812903ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 364.688102

✖ failing tests:

test at tests/sites-worker.test.mjs:25:1
✖ returns an explicit unknown-route document at /foo (115.064185ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /unknown route|page not found/i. Input:
  
  'app'
  
      at TestContext.<anonymous> (file:///home/tinker/dev/worktrees/ask-jdp/fix-4-unknown-routes/tests/sites-worker.test.mjs:47:10)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'app',
    expected: /unknown route|page not found/i,
    operator: 'match',
    diff: 'simple'
  }

test at tests/sites-worker.test.mjs:25:1
✖ returns an explicit unknown-route document at /chat (4.181022ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /unknown route|page not found/i. Input:
  
  'app'
  
      at TestContext.<anonymous> (file:///home/tinker/dev/worktrees/ask-jdp/fix-4-unknown-routes/tests/sites-worker.test.mjs:47:10)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'app',
    expected: /unknown route|page not found/i,
    operator: 'match',
    diff: 'simple'
  }

test at tests/sites-worker.test.mjs:25:1
✖ returns an explicit unknown-route document at /ask/xyz (3.812903ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /unknown route|page not found/i. Input:
  
  'app'
  
      at TestContext.<anonymous> (file:///home/tinker/dev/worktrees/ask-jdp/fix-4-unknown-routes/tests/sites-worker.test.mjs:47:10)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'app',
    expected: /unknown route|page not found/i,
    operator: 'match',
    diff: 'simple'
  }
