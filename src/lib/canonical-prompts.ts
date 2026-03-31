import type { Category, PromptDefaultSlot, Stage } from '@prisma/client'

export const CANONICAL_PROMPT_NAMES = {
  CLASSIFY: 'default-classifier',
  SUMMARIZE: 'default-summarizer',
  REDACT: 'default-redactor',
} as const satisfies Record<Stage, string>

export const DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS = {
  stub: 'classify_stub_v1',
  real: 'classify_real_v1',
} as const

export const STUB_CLASSIFY_CATEGORIES: readonly Category[] = [
  'WORK',
  'LEARNING',
  'CREATIVE',
  'MUNDANE',
  'PERSONAL',
  'OTHER',
] as const

export const ALL_CLASSIFY_CATEGORIES: readonly Category[] = [
  'WORK',
  'LEARNING',
  'CREATIVE',
  'MUNDANE',
  'PERSONAL',
  'OTHER',
  'MEDICAL',
  'MENTAL_HEALTH',
  'ADDICTION_RECOVERY',
  'INTIMACY',
  'FINANCIAL',
  'LEGAL',
  'EMBARRASSING',
] as const

export const ALL_CLASSIFY_CATEGORIES_TEXT = ALL_CLASSIFY_CATEGORIES.join(', ')

export const CANONICAL_PROMPT_TEMPLATES = {
  CLASSIFY: {
    'default-classifier': {
      classify_stub_v1:
        'STUB: Deterministic classification based on atomStableId hash. See spec 7.2.',
      classify_real_v1: `You are a message classifier. Classify the following AI conversation message into exactly one category.

Categories: ${ALL_CLASSIFY_CATEGORIES_TEXT}

Return ONLY a JSON object. No prose. No code fences.
Example output:
{"category":"WORK","confidence":0.72}

Rules:
- category MUST be one of the listed categories (uppercase, exact match)
- confidence MUST be a number between 0.0 and 1.0
- Never invent new categories. If uncertain, choose the closest category from the allowed list.
- Do NOT include any explanation or text outside the JSON object`,
    },
  },
  SUMMARIZE: {
    'default-summarizer': {
      v1: `You are summarizing a day's worth of AI conversation messages.

Input format:
# SOURCE: <source>
[<timestamp>] <role>: <message>

Produce a concise summary capturing:
1. Key topics discussed
2. Decisions made or conclusions reached
3. Action items or follow-ups mentioned

Output as markdown with clear headings.`,
      journal_v1: `You are writing a personal journal entry summarizing a day of AI conversations.

Write in first person, past tense. Be warm and reflective — like someone writing in their own journal at the end of the day.

Structure your entry as:

1. A narrative opening (2–3 sentences) capturing what the day was about
2. **Key moments** — 3–5 bullet points of notable topics, decisions, or realizations
3. **Reflections** — 1–2 sentences on patterns, themes, or lingering questions

Guidelines:
- Write as if the person is reading their own journal months later
- Focus on what mattered, not what was trivial
- Keep it under 300 words
- Use markdown formatting

Do NOT use any of the following:
- Report-style headings like "Summary", "Overview", "Key Topics Discussed", "Conclusions", "Action Items", "Executive Summary"
- Corporate/formal tone ("deliverables", "stakeholders", "action items", "follow-ups", "next steps")
- Third-person voice or passive constructions ("It was discussed that...", "The user explored...")
- Meta-commentary about the summarization process ("This summary covers...", "The conversations included...")`,
      journal_v2: `You are distilling a day of AI conversations into a concise journal entry.

Write for someone reviewing their own day. Be direct, warm, and honest.

Structure:

**Today** — 3–5 bullet points: what was explored, decided, or created
**Open threads** — Anything unfinished or worth revisiting (1–3 bullets, or "None" if nothing stood out)
**Closing** — One sentence capturing the day's energy or direction

Guidelines:
- Skip pleasantries and meta-commentary
- Under 200 words
- Markdown formatting

Do NOT use any of the following:
- Report-style headings like "Summary", "Overview", "Key Topics", "Conclusions", "Action Items"
- Corporate/formal tone ("deliverables", "stakeholders", "action items", "follow-ups", "next steps")
- Third-person voice ("The user discussed...", "Topics covered include...")
- Filler phrases ("In this conversation...", "Throughout the day...", "Various topics were explored...")`,
      journal_v3: `You are writing a reflective journal entry from a day of AI conversations.

Write a single flowing paragraph (150–250 words) in first person, past tense.
Capture what was on the person's mind, what they explored, and where their thinking landed by end of day.

No bullet points. No headings. No structure beyond the paragraph itself. Just honest, readable prose — like a diary entry someone would actually want to re-read.

Do NOT use any of the following:
- Report-style language ("Summary", "Overview", "Key Topics", "Action Items")
- Corporate/formal tone ("deliverables", "stakeholders", "next steps", "follow-ups")
- Third-person voice or passive constructions
- Opening with "Today, I..." — vary the opening
- Meta-commentary about summarization ("This entry covers...", "The conversations touched on...")`,
    },
  },
  REDACT: {
    'default-redactor': {
      v1: 'PLACEHOLDER: Redaction prompt for future use.',
    },
  },
} as const

export const CANONICAL_PROMPT_DEFAULT_SLOTS = {
  CLASSIFY_STUB: {
    stage: 'CLASSIFY',
    name: CANONICAL_PROMPT_NAMES.CLASSIFY,
    versionLabel: DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS.stub,
  },
  CLASSIFY_REAL: {
    stage: 'CLASSIFY',
    name: CANONICAL_PROMPT_NAMES.CLASSIFY,
    versionLabel: DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS.real,
  },
  SUMMARIZE: {
    stage: 'SUMMARIZE',
    name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    versionLabel: 'v1',
  },
} as const satisfies Partial<
  Record<PromptDefaultSlot, { stage: Stage; name: string; versionLabel: string }>
>

export interface SeededCanonicalPromptVersionDefinition {
  stage: Stage
  name: string
  versionLabel: string
  templateText: string
}

export const SEEDED_CANONICAL_PROMPT_VERSIONS: readonly SeededCanonicalPromptVersionDefinition[] = [
  {
    stage: 'CLASSIFY',
    name: CANONICAL_PROMPT_NAMES.CLASSIFY,
    versionLabel: DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS.stub,
    templateText:
      CANONICAL_PROMPT_TEMPLATES.CLASSIFY['default-classifier'].classify_stub_v1,
  },
  {
    stage: 'CLASSIFY',
    name: CANONICAL_PROMPT_NAMES.CLASSIFY,
    versionLabel: DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS.real,
    templateText:
      CANONICAL_PROMPT_TEMPLATES.CLASSIFY['default-classifier'].classify_real_v1,
  },
  {
    stage: 'SUMMARIZE',
    name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    versionLabel: 'v1',
    templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE['default-summarizer'].v1,
  },
  {
    stage: 'SUMMARIZE',
    name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    versionLabel: 'journal_v1',
    templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE['default-summarizer'].journal_v1,
  },
  {
    stage: 'SUMMARIZE',
    name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    versionLabel: 'journal_v2',
    templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE['default-summarizer'].journal_v2,
  },
  {
    stage: 'SUMMARIZE',
    name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    versionLabel: 'journal_v3',
    templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE['default-summarizer'].journal_v3,
  },
  {
    stage: 'REDACT',
    name: CANONICAL_PROMPT_NAMES.REDACT,
    versionLabel: 'v1',
    templateText: CANONICAL_PROMPT_TEMPLATES.REDACT['default-redactor'].v1,
  },
] as const

export function getSeededCanonicalPromptTemplate(
  stage: Stage,
  promptName: string,
  versionLabel: string,
): string | null {
  const match = SEEDED_CANONICAL_PROMPT_VERSIONS.find(
    (item) =>
      item.stage === stage &&
      item.name === promptName &&
      item.versionLabel === versionLabel,
  )
  return match?.templateText ?? null
}

export function isSeededCanonicalPromptVersion(
  stage: Stage,
  promptName: string,
  versionLabel: string,
): boolean {
  return getSeededCanonicalPromptTemplate(stage, promptName, versionLabel) !== null
}
