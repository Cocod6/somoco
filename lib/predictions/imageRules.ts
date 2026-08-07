// Somoco — prediction image rules
//
// Plain constants shared by the browser picker and the server upload route
// (app/api/images/route.ts). Kept in their own file so the route can import the
// limits without pulling in the client-side Supabase instance, and so the two
// sides can never drift out of sync — the bucket in schema.sql enforces the
// same size cap and mime allowlist a third time.

export const IMAGE_BUCKET = 'prediction-images'

/** Formats a browser can reliably render inline. */
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/** 5 MB — big enough for a phone photo, small enough to not wreck the feed. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function isAllowedType(type: string): boolean {
  return (ALLOWED_TYPES as readonly string[]).includes(type)
}

/**
 * Identifies an image from its leading bytes ("magic numbers").
 * Returns the mime type, or null if the bytes aren't one of our four formats.
 *
 * The upload route uses this INSTEAD of the browser-supplied type, because that
 * type is just a label the caller chose — a direct POST can claim image/png for
 * anything at all. The bucket then stores whatever we tell it, so trusting the
 * label would let someone park arbitrary files in a public bucket under an
 * image content-type. Reading the bytes is the only check that can't be lied to.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte)

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  // "GIF87a" / "GIF89a"
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  // "RIFF" .... "WEBP" — the 4 bytes between are the file length.
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}
