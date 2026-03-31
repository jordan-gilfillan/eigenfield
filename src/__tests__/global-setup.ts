import { Client } from 'pg'
import { loadEnv } from 'vite'
import { PrismaClient, type PromptDefaultSlot } from '@prisma/client'
import { SEEDED_CANONICAL_PROMPT_VERSIONS } from '../lib/canonical-prompts'

const CANONICAL_DEFAULT_SLOTS: PromptDefaultSlot[] = [
  'CLASSIFY_STUB',
  'CLASSIFY_REAL',
  'SUMMARIZE',
  'REDACT',
]

interface PromptVersionSnapshot {
  stage: 'CLASSIFY' | 'SUMMARIZE' | 'REDACT'
  name: string
  versionLabel: string
  templateText: string
  isActive: boolean
}

async function restorePromptVersion(
  prisma: PrismaClient,
  snapshot: PromptVersionSnapshot,
) {
  const prompt = await prisma.prompt.upsert({
    where: {
      stage_name: {
        stage: snapshot.stage,
        name: snapshot.name,
      },
    },
    update: {},
    create: {
      stage: snapshot.stage,
      name: snapshot.name,
    },
  })

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: prompt.id,
        versionLabel: snapshot.versionLabel,
      },
    },
    update: {
      templateText: snapshot.templateText,
      isActive: snapshot.isActive,
    },
    create: {
      promptId: prompt.id,
      versionLabel: snapshot.versionLabel,
      templateText: snapshot.templateText,
      isActive: snapshot.isActive,
    },
  })
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const env = loadEnv('test', process.cwd(), '')
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Set it in .env or as an environment variable.\n' +
        'Example: DATABASE_URL="postgresql://postgres:postgres@localhost:5432/journal_distill"',
    )
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  })

  try {
    await client.connect()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Postgres is not reachable at DATABASE_URL.\n` +
        `Connection error: ${message}\n` +
        `Ensure Postgres is running: docker compose up -d db`,
    )
  } finally {
    await client.end().catch(() => {})
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })

  const seededVersionSnapshots = await Promise.all(
    SEEDED_CANONICAL_PROMPT_VERSIONS.map(async (item) => {
      const record = await prisma.promptVersion.findFirst({
        where: {
          versionLabel: item.versionLabel,
          prompt: {
            stage: item.stage,
            name: item.name,
          },
        },
        select: {
          versionLabel: true,
          templateText: true,
          isActive: true,
          prompt: {
            select: {
              stage: true,
              name: true,
            },
          },
        },
      })

      return record
        ? {
            stage: record.prompt.stage,
            name: record.prompt.name,
            versionLabel: record.versionLabel,
            templateText: record.templateText,
            isActive: record.isActive,
          }
        : null
    }),
  )

  const defaultSnapshots = await prisma.promptDefault.findMany({
    where: {
      slot: {
        in: CANONICAL_DEFAULT_SLOTS,
      },
    },
    select: {
      slot: true,
      promptVersion: {
        select: {
          versionLabel: true,
          templateText: true,
          isActive: true,
          prompt: {
            select: {
              stage: true,
              name: true,
            },
          },
        },
      },
    },
  })

  return async () => {
    try {
      const promptSnapshots = new Map<string, PromptVersionSnapshot>()

      for (const snapshot of seededVersionSnapshots) {
        if (!snapshot) continue
        promptSnapshots.set(
          `${snapshot.stage}:${snapshot.name}:${snapshot.versionLabel}`,
          snapshot,
        )
      }

      for (const snapshot of defaultSnapshots) {
        promptSnapshots.set(
          `${snapshot.promptVersion.prompt.stage}:${snapshot.promptVersion.prompt.name}:${snapshot.promptVersion.versionLabel}`,
          {
            stage: snapshot.promptVersion.prompt.stage,
            name: snapshot.promptVersion.prompt.name,
            versionLabel: snapshot.promptVersion.versionLabel,
            templateText: snapshot.promptVersion.templateText,
            isActive: snapshot.promptVersion.isActive,
          },
        )
      }

      for (const snapshot of promptSnapshots.values()) {
        await restorePromptVersion(prisma, snapshot)
      }

      for (const slot of CANONICAL_DEFAULT_SLOTS) {
        const snapshot = defaultSnapshots.find((item) => item.slot === slot)
        if (!snapshot) {
          await prisma.promptDefault.deleteMany({
            where: { slot },
          })
          continue
        }

        const prompt = await prisma.prompt.findUniqueOrThrow({
          where: {
            stage_name: {
              stage: snapshot.promptVersion.prompt.stage,
              name: snapshot.promptVersion.prompt.name,
            },
          },
          select: { id: true },
        })

        const promptVersion = await prisma.promptVersion.findUniqueOrThrow({
          where: {
            promptId_versionLabel: {
              promptId: prompt.id,
              versionLabel: snapshot.promptVersion.versionLabel,
            },
          },
          select: { id: true },
        })

        await prisma.promptDefault.upsert({
          where: { slot },
          update: {
            promptId: prompt.id,
            promptVersionId: promptVersion.id,
          },
          create: {
            slot,
            promptId: prompt.id,
            promptVersionId: promptVersion.id,
          },
        })
      }
    } catch (err) {
      console.warn('globalTeardown: failed to restore prompt snapshots:', err)
    } finally {
      await prisma.$disconnect().catch(() => {})

      try {
        const { closeLockPool } = await import('../lib/services/advisory-lock')
        await closeLockPool()
      } catch (err) {
        console.warn('globalTeardown: failed to close advisory lock pool:', err)
      }
    }
  }
}
