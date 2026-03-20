import { prisma } from '../db'
import { ConfigurationError } from '../errors'

export type DefaultClassifyPromptMode = 'stub' | 'real'

export const DEFAULT_CLASSIFY_PROMPT_NAME = 'default-classifier'

export const DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS: Record<DefaultClassifyPromptMode, string> = {
  stub: 'classify_stub_v1',
  real: 'classify_real_v1',
}

export async function resolveDefaultClassifyPromptVersion(mode: DefaultClassifyPromptMode) {
  const prompt = await prisma.prompt.findUnique({
    where: {
      stage_name: {
        stage: 'CLASSIFY',
        name: DEFAULT_CLASSIFY_PROMPT_NAME,
      },
    },
    select: {
      id: true,
      stage: true,
      name: true,
    },
  })

  if (!prompt) {
    throw new ConfigurationError(
      'Default classify prompt is not configured. Run `npx prisma db seed`.',
      {
        stage: 'CLASSIFY',
        promptName: DEFAULT_CLASSIFY_PROMPT_NAME,
      },
    )
  }

  const versionLabel = DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS[mode]
  const promptVersion = await prisma.promptVersion.findUnique({
    where: {
      promptId_versionLabel: {
        promptId: prompt.id,
        versionLabel,
      },
    },
    include: {
      prompt: {
        select: {
          stage: true,
          name: true,
        },
      },
    },
  })

  if (!promptVersion) {
    throw new ConfigurationError(
      'Default classify prompt version is not configured. Run `npx prisma db seed`.',
      {
        stage: 'CLASSIFY',
        promptName: DEFAULT_CLASSIFY_PROMPT_NAME,
        mode,
        versionLabel,
      },
    )
  }

  return promptVersion
}
