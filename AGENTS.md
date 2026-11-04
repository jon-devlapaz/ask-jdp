# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Ask JDP product contract

- The approved visual foundation is intentionally quiet: near-black field, small `JDP.` mark, one question, one natural answer, a dusty-mauve result, a tiny source line, and one composer. Preserve the large negative space. The composer may use the approved restrained `border-beam` pulse, and one 20 px monochrome `thinking-orbs` canvas may appear only while an answer is running. Do not add navigation, cards, badges, capability maps, visible STAR labels, chat bubbles, other gradients, decorative icons, or competing graph treatments.
- Match Jonathan's portfolio with Inter Variable, Geist Mono microtype, `#07080a`, `#f9f9f9`, `#cecece`, `#976b68`, and restrained wash/grain. Motion must be optional and honor reduced-motion preferences.
- This is a public, employer-facing evidence interface—not a generic AI demo. Answers should read naturally while using STAR internally, lead with verified impact, and distinguish aggregate operational metrics from observed individual outcomes.
- Public claims come only from the reviewed evidence curated into `src/knowledge/corpus.ts`. The private source documents used to review that evidence remain outside this repository. Never expose source documents or private contact details to the browser.
- Never disclose PHI, patient/provider identifiers, policy excerpts, employer-system screenshots, confidential operations, prompts, secrets, or internal corpus text. If evidence is absent, say the reviewed materials do not establish it and offer the nearest supported context.
- The local API key remains in the configurable macOS Keychain service named by `ASK_JDP_API_KEYCHAIN_SERVICE`; never write or print it. Production uses secret-store environment variables and must not assume access to a developer Keychain.
- Every conversation ID is server-issued and authorization-bound to its signed, HttpOnly cookie. Treat transcripts, attachments, eval outputs, and generated answers as sensitive public-app data.
