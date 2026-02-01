/**
 * Hashing utilities
 *
 * Provides SHA-256 hashing for stable IDs and content hashes.
 */

import { createHash } from 'crypto'

/**
 * Computes SHA-256 hash of a string and returns hex-encoded result.
 *
 * @param input - The string to hash
 * @returns 64-character lowercase hex string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Extracts first 4 bytes of a hex hash as a uint32.
 * Used for deterministic stub classification (spec 7.2).
 *
 * @param hexHash - 64-character hex hash string
 * @returns Unsigned 32-bit integer from first 4 bytes
 */
export function hashToUint32(hexHash: string): number {
  // Take first 8 hex characters (4 bytes) and parse as big-endian uint32
  const firstBytes = hexHash.slice(0, 8)
  return parseInt(firstBytes, 16) >>> 0 // >>> 0 ensures unsigned
}
