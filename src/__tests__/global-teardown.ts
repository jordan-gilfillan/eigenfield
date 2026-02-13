export default async function globalTeardown(): Promise<void> {
  try {
    const { closeLockPool } = await import('../lib/services/advisory-lock')
    await closeLockPool()
  } catch (err) {
    console.warn('globalTeardown: failed to close advisory lock pool:', err)
  }
}
