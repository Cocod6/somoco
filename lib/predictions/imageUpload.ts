// Somoco — prediction image uploads (client side)
//
// Images are a Somoco-layer thing, not an Intuition thing: the Triple on-chain
// stays exactly as it was (subject/claim/condition atoms). The picture is
// cosmetic feed metadata, so it lives in Supabase Storage alongside the rest of
// Somoco's private bookkeeping — same split as the DB (see lib/supabase.ts).
//
// Both writes go through /api/images (service-role key) rather than the browser
// anon key. That closed the last anon write path in the app: the bucket used to
// carry blanket anon insert AND delete policies, so anyone with the public key
// shipped in this bundle could delete other people's prediction images. Uploads
// are still open to any caller — submitters aren't authenticated anywhere in
// Somoco — but deletes are refused once an image belongs to a saved prediction,
// so the worst case is orphan junk instead of data loss. The admin Approve
// queue remains the moderation gate before anything reaches the public feed.

import { MAX_IMAGE_BYTES, isAllowedType } from '@/lib/predictions/imageRules'

export { IMAGE_BUCKET, MAX_IMAGE_BYTES } from '@/lib/predictions/imageRules'

/**
 * Checks a file before we bother uploading it.
 * Returns an error message to show the user, or null if the file is fine.
 * The route re-checks both rules — this is just for a fast, local error.
 */
export function validateImage(file: File): string | null {
  if (!isAllowedType(file.type)) {
    return 'that file type is not supported — use a JPG, PNG, WEBP or GIF'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `that image is ${mb}MB — the limit is 5MB`
  }
  return null
}

export interface UploadedImage {
  /** Public URL to render in the feed */
  url: string
  /** Path inside the bucket — kept so we can delete the file if it's abandoned */
  path: string
}

/**
 * Uploads an image via the server route.
 *
 * Files are namespaced by uploader address so one wallet's image can never sit
 * on top of another's, and named with a random id so re-uploading the same
 * photo doesn't collide. Throws with a user-readable message on failure.
 */
export async function uploadPredictionImage(file: File, address: string): Promise<UploadedImage> {
  const problem = validateImage(file)
  if (problem) throw new Error(problem)

  const form = new FormData()
  form.append('file', file)
  form.append('address', address || '')

  let response: Response
  try {
    response = await fetch('/api/images', { method: 'POST', body: form })
  } catch {
    throw new Error('image upload failed: could not reach the server')
  }

  const result = (await response.json().catch(() => ({}))) as Partial<UploadedImage> & {
    error?: string
  }

  if (!response.ok || !result.url || !result.path) {
    throw new Error(result.error ?? 'image upload failed')
  }

  return { url: result.url, path: result.path }
}

/**
 * Best-effort cleanup for an image the user uploaded and then removed before
 * submitting. Never throws — an orphaned file is not worth failing a flow over,
 * and the route legitimately refuses paths already attached to a prediction.
 */
export async function deletePredictionImage(path: string): Promise<void> {
  try {
    await fetch('/api/images', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  } catch {
    // ignore — orphan cleanup is not critical
  }
}
