# Journal Mirror Demo - Product Spec v1

This document is the product contract for a fresh-start journal mirror demo.

The product is not a general document QA system. It is a local, evidence-backed interactive journal built from AI assistant conversation archives, with an emphasis on user-authored text, reflective querying, and cautious self-insight.

It deliberately keeps only the parts of the current codebase that directly serve the core product:
- deterministic ingest
- stable source identity
- retrieval over a curated corpus
- grounded answers with inspectable evidence
- reflective outputs that remain reviewable against source material

Everything else is non-core until proven necessary.

## 1. Product Goal

The product helps a user import AI assistant conversation archives and ask questions about their own recorded thought processes, concerns, patterns, and recurring themes.

The product is successful when a user can:
- import a prepared conversation archive locally
- ask a concrete question about what they have expressed in that archive
- receive a useful answer quickly
- inspect the exact excerpts used to support that answer
- distinguish direct observations from higher-level inferences
- decide whether the answer is trustworthy

V1 should feel like an interactive journal with evidence, not a generic RAG demo over arbitrary files.

## 2. Non-Goals

The following are out of scope for v1:
- generalized workflow engines
- background jobs, schedulers, queues, or tick loops
- prompt CMS, prompt families, prompt version admin, or prompt slot management
- multi-user accounts, auth, or tenancy
- admin dashboards or control-plane UIs
- multi-step remediation workflows inside the product
- model/provider abstraction beyond what is needed to answer questions
- elaborate import management beyond loading a curated corpus
- automatic classification systems unless they directly improve answer quality for the initial demo
- optimization for scale, concurrency, or platform extensibility

## 3. Core User Flow

The v1 user flow is:
1. A user prepares or selects an AI assistant conversation archive for local analysis.
2. The system ingests the archive into normalized records with stable IDs.
3. The system extracts user-authored text and preserves enough metadata for later inspection.
4. A user asks a question in the UI.
5. The system retrieves relevant excerpts from the imported archive.
6. The system generates an answer grounded only in the retrieved excerpts.
7. The UI shows the answer and the supporting excerpts side by side.

No hidden work is allowed outside this flow.

## 4. Product Shape

V1 has only two product surfaces:
- a small ingest/indexing path used by the builder or curator
- a small question-answering UI used by the end viewer

Preferred implementation shape:
- scripts for ingest and indexing
- one simple app page for asking questions and inspecting evidence

If a feature does not improve this exact loop, it does not belong in v1.

## 5. Corpus Assumptions

V1 assumes a curated local archive, not an open-ended personal data platform.

Corpus rules:
- the primary input format is AI assistant `conversations.json` exports
- the archive is prepared intentionally by the user or builder for local analysis
- extraction should emphasize user-authored freeform text
- agent, system, and tool text should be excluded by default unless intentionally retained for a specific inspectable reason
- each stored record must retain enough metadata to support inspection
- the corpus is small enough to process in foreground scripts for demo use

V1 may later expand to other simple source formats, but those are not required for the initial demo.

V1 does not require:
- self-serve uploads for arbitrary end users
- continuous sync
- automatic background refresh

## 6. Ingest Contract

The good parts of the current backend should be preserved here.

### 6.1 Deterministic ingest

Given the same input and the same normalization rules, ingest must produce the same normalized records and stable IDs.

### 6.2 Normalized records

Each stored record must include, at minimum:
- stable ID
- source identifier
- source-local identifier when available
- timestamp when available
- role or speaker when relevant
- original text or a directly inspectable excerpt body
- a flag or equivalent metadata showing whether the text is user-authored, assistant-authored, system-authored, or tool-authored when that distinction is available
- enough metadata to link the excerpt back to its source context

### 6.3 No silent loss

Ingest must not silently discard legitimate records.

If deduplication exists, it must be deterministic and explainable.

### 6.4 Curator-visible failures

If ingest cannot parse or normalize a source, it must fail clearly enough for the builder to correct the input.

## 7. Retrieval Contract

Retrieval exists to support grounded answering, not to become a product of its own.

Rules:
- retrieval must return a bounded set of relevant excerpts for each question
- retrieved excerpts must preserve source linkage and stable IDs
- ranking behavior should be understandable and testable
- the system should prefer simple retrieval methods first

For v1, lexical search or straightforward SQL full-text retrieval is preferred unless there is strong evidence that embeddings materially improve the demo.

## 8. Answer Contract

Answers must be grounded in retrieved evidence.

Rules:
- the answering step may use only the retrieved excerpts plus the user question
- the answer must not present unsupported claims as settled fact
- when the evidence is weak, conflicting, or absent, the answer must say so plainly
- the system should prefer directness over stylistic flourish
- the system must distinguish between direct observations from the archive and higher-level inferences drawn from it
- higher-level interpretations must be framed as tentative and reviewable, not as final truths about the person
- the system must not imply that it knows the user's full self beyond what is present in the imported archive

V1 does not require autonomous reasoning features, chain orchestration, or multi-agent behavior.

## 8.5 Insight Contract

The product may support reflective answers, but only within clear limits.

Valid insight types for v1 include:
- recurring themes or concerns
- repeated self-descriptions
- unresolved questions that appear multiple times
- changes in emphasis over time when supported by dated excerpts
- tensions or contradictions that are visible in the source material

Invalid insight types for v1 include:
- diagnosis
- hidden-motive claims
- confident personality verdicts stated as fact
- claims that the system has discovered the user's true self
- interpretations that cannot be reviewed against source evidence

When reflective insight is offered, the system should make it clear whether it is reporting an observed pattern or offering a tentative interpretation.

## 9. Citation And Evidence Contract

Inspectable evidence is a core feature, not a debugging detail.

Each answer must include supporting excerpts with enough information for a user to inspect them.

Each excerpt should include, when available:
- source
- date or timestamp
- stable ID or equivalent inspectable handle
- excerpt text

Citation rules:
- citations must map directly to stored corpus records or deterministic chunks
- the user must be able to open or view the supporting excerpt without hidden steps
- the UI must make it obvious which excerpts were used for the answer

## 10. Minimal UI Contract

The v1 UI should be a single focused experience.

Required elements:
- question input
- submit action
- answer area
- citations or excerpt list
- excerpt inspection panel or inline viewer

Optional in builder mode only:
- archive import or archive selection entry point

UI rules:
- one clear primary action
- no background processes the user did not trigger
- no control panel language like runs, jobs, stages, batches, or prompt slots
- no architecture-shaped UI

The interface should feel closer to an interactive journal reader with evidence than an operations console.

## 11. Failure Behavior

Failure handling should be direct and minimal.

If retrieval finds little or no evidence:
- say that clearly
- show whatever weak matches were found, if any
- avoid fabricated certainty

If answer generation fails:
- preserve the retrieved excerpts if available
- show a concise error state
- let the user retry the same question

## 12. Data Handling

The corpus may contain sensitive personal content.

V1 rules:
- do not expose raw corpus content outside the answering and evidence flow
- do not log raw journal text unnecessarily
- prefer local processing and explicit data handling over opaque background behavior
- prefer curated demo data over live personal data when demonstrating the system publicly
- keep data handling simple and explicit

## 13. Implementation Guidance

This section is guidance, not architecture ceremony.

Good candidates to salvage from the current repo:
- parsing and normalization logic
- stable ID and hashing logic
- simple corpus storage patterns
- retrieval patterns based on direct search
- pure evidence/export rendering utilities where useful

Poor candidates to salvage into v1:
- run orchestration systems
- job lifecycle machinery
- prompt management systems
- administrative surfaces
- process-heavy product concepts

## 14. Hard Scope Limits

The following additions require a deliberate spec change and should otherwise be rejected:
- more than one core end-user workflow
- background processing infrastructure
- generalized configuration systems where hardcoded defaults would work
- platform features for future hypothetical use cases
- abstraction layers added before the simplest direct implementation has been tried

## 15. Definition Of Done For V1

V1 is done when:
- an AI assistant conversation archive can be ingested reproducibly
- user-authored text can be extracted and stored with stable inspectable records
- a user can ask a question about that archive
- the system returns a useful answer with inspectable supporting excerpts
- reflective answers clearly separate observation from inference
- the UI is simple enough that its behavior can be explained in a minute
- there is no major subsystem whose main purpose is managing other subsystems

## 15.5 Trust Boundary

This product reflects patterns found in an imported conversation archive. It does not know the user's full self, and any higher-level interpretation must remain reviewable against source evidence.

## 16. Decision Rule

When a design choice is unclear, prefer the smaller, more direct, more testable option.

Complexity is guilty until it clearly improves:
- answer quality
- citation trust
- corpus inspection
- or the speed of the core ask-and-verify loop
