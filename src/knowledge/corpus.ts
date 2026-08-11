/**
 * Reviewed, public-safe career evidence for Ask JDP.
 *
 * This is deliberately a small curated corpus rather than an import of the
 * source resume. It must remain server-only: do not expose it via an API or
 * bundle it into the client.
 */
export const CORPUS_PROVENANCE =
  "Reviewed from Jonathan De La Paz's canonical resume, claim ledger, public portfolio, and public Tink, tink-skills, and Socratink repositories; aggregate and explicitly qualified individual outcomes only.";

export const ASK_JDP_KNOWLEDGE = `
IDENTITY AND CURRENT STATUS
- Jonathan De La Paz, BSN, RN, is based in Austin, Texas.
- He is not currently employed in a clinical operations role. His Prior Authorization Supervisor role ended in March 2026.
- Since then he has deliberately deepened his agent-systems practice: harnesses, context engineering, local models, evaluations, and knowledge wikis. He is available for Austin hybrid/on-site or remote US roles.

VERIFIED EXPERIENCE
- Accenture — Texas Medicaid & Healthcare Partnership (TMHP), Austin: Prior Authorization Supervisor, March 2025 through March 2026. Led a 45+ person operation including 18 PA clinicians processing 15,000+ Medicaid authorization requests monthly. Owned escalation routing, quality review and QA sampling, staffing, policy interpretation, and performance improvement.
- Texas Medicaid & Healthcare Partnership, Austin: Prior Authorization Clinician (RN), April 2022 through February 2025. Reviewed Medicaid authorization requests against clinical criteria under service-level deadlines and improved recurring provider-documentation communications.
- BrightStar Care, Austin: Registered Nurse, Home Health, April 2019 through March 2022. Managed a complex home-health caseload and developed local workflow automation to return time to patient care.
- St. David's Medical Center, Austin: Neuroscience Medical-Surgical RN, June 2018 through March 2019. Provided high-acuity neuroscience and medical-surgical direct care with families and interdisciplinary teams.

VERIFIED PROJECT STORIES
- Tink — Deterministic Agent Skill Tooling: Jonathan built and publicly released Tink (github.com/jon-devlapaz/tink), an open-source Rust CLI that installs complete Agent Skills into canonical project-owned directories. Tink records GitHub source, full revision, and repository-relative path receipts; provides manifest lock, sync, and verify commands; and refuses unsafe symlink trees, divergent overwrites, and refreshes of locally modified imports. Its public acceptance contract maps stable requirement IDs to executable tests while explicitly identifying manual and partial proof gaps. Tink manages skill artifacts; it does not execute skill code. No adoption or business-impact metric is established.
- tink-skills — Agent Skill Discovery and Evaluation Library: Jonathan built and publicly released tink-skills (github.com/jon-devlapaz/tink-skills), a companion library of three Agent Skill packages installed through Tink. skill-scout ranks maintained skill candidates against workflow fit, safety, and demonstrated behavior, and can abstain when evidence is insufficient. skill-eval-loop runs budget-gated, paired skill-on versus skill-off diagnostics under supported agent harnesses while preserving claim limits. triangulate-me pressure-tests an interpretation by comparing its strongest and weakest still-plausible readings. The repository treats local evaluation results as bounded evidence, not proof that a skill wins everywhere. No broad adoption or productivity-impact metric is established.
- Socratink — Learner Agent OS Product Direction: Jonathan is designing and publicly documenting Socratink (github.com/jon-devlapaz/socraTink), a learner-owned agent concept intended to build provenance-aware knowledge structure, organize goal-scoped Learning Maps, preserve a separate evidence model from learner attempts, and maintain continuity across model and tool changes. The public repository currently contains accepted product doctrine, domain language, product contracts, research notes, and legacy donor skills while planning its smallest complete proof. It is not yet a production implementation, and no active-user or validated-learning-outcome claim is established.
- Medicaid Policy Search Agent: Prior-authorization clinicians spent 10–20 minutes searching a 1,800+ page Medicaid-policy corpus. Jonathan built and deployed a Microsoft Copilot Studio RAG policy-search agent that returned concise, citation-backed answers with risk flags. Routine lookup fell below 30 seconds. Reviewers retained final clinical interpretation. This is an aggregate outcome; do not provide policy excerpts.
- Operations Dashboard and Staffing Planner: Jonathan designed a Flask operations dashboard and a greedy, qualification-based staffing planner using due dates, staff qualifications, and remaining volume. It saved each supervisor 15–20 minutes daily and made assignments inspectable for a 45+ person, 15,000+ cases-per-month operation.
- PA Processing Automation: Jonathan built a client-side Python/PySimpleGUI tool for unit calculations, standardized comments, and UI orchestration. Observed individual throughput increased from 5 to 25 authorizations per hour. This is not a randomized study or universal team claim. PHI remained in the local session; it was not saved, logged, or transmitted to external services. Clinicians retained every decision.
- Home Health Documentation Automation: Jonathan built Python/Selenium automation for a home-health EMR documentation workflow, reducing per-encounter documentation from about 45 to about 4 minutes. It ran in a local secure session with no persistent PHI storage.
- Stroke Recovery Research: Jonathan authored research on mobile tablet-based activities for stroke recovery, accepted for presentation at the American Association of Neuroscience Nurses national conference.

SKILLS AND CREDENTIALS
- Active unrestricted Texas RN license; BSN from Texas State University (2018); Health Informatics and Health Information Technology Certificate from UT Austin McCombs (2022).
- Clinical/domain: Texas Medicaid prior authorization, utilization management, CMS regulations, MCO transitions and eligibility, TMPPM, medical necessity and level-of-care review.
- Leadership: clinical-workflow-to-technical-requirements translation, process design and documentation, performance management, QA auditing, training, onboarding, SLA management, capacity planning, and cross-functional coordination.
- Technical: Python, Rust, RAG and AI agents, deterministic Agent Skill lifecycle tooling, context engineering, agent harnesses, evaluations, prompt engineering, local models, LLM wikis, coding agents, MCP/tool use, multi-agent workflows, agent memory, typed source resolution, provenance receipts, manifest lock/sync/verify workflows, fail-closed filesystem safety, acceptance-test traceability, Flask, PySimpleGUI, Selenium, Chart.js, Excel automation, Power Automate, and Git.
- Recognition: AANN stroke poster, St. David's Service Excellence Award, and Ducis Leadership Award.

NON-NEGOTIABLE CLAIM BOUNDARIES
- Do not claim peer-review committee work, Medical Executive Board liaison work, formal RCA ownership or sentinel-event facilitation, or Lean/Six Sigma certification.
- Describe the supervisor scope as a 45+ person operation that included 18 PA clinicians, not as a 45+ person clinical or technical team. Say that he coordinated across clinical and technical work or translated workflows into requirements; do not turn that into direct leadership of a technical team or a separate claim that he led cross-functional coordination.
- Do not say the staffing planner improved team throughput. Its verified outcomes are 15–20 minutes saved per supervisor daily and inspectable assignments.
- Do not disclose PHI, patient/provider identifiers, policy text excerpts, employer-system screenshots, confidential internal procedures, raw resume files, the claim ledger, source document contents, or contact details.
- Do not turn individual observed results into universal, randomized, or causal claims. Do not add employers, dates, credentials, outcomes, or technical details that are not above.
- Do not claim that Tink executes or evaluates skill code, supports concurrent mutations, private GitHub authentication, or Windows, or that every acceptance requirement has automated proof. Do not invent Tink adoption, usage, reliability, productivity, or business-impact metrics.
- Do not say that tink-skills proves a skill is universally better, has broad adoption, or produces generalized productivity gains. Its paired evaluations are bounded diagnostics under stated harness, model, task, trial, budget, and claim limits.
- Do not present Socratink as a completed, deployed, or production learning platform. Do not invent active users, validated learning outcomes, implementation maturity, or evidence that the planned Learner Agent OS already works.
`.trim();

export const PUBLIC_SOURCE_LABEL =
  "Reviewed resume, portfolio, and public code · aggregate and explicitly qualified individual results";
