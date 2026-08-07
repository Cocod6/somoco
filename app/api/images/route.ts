// Somoco — prediction image storage API
// POST   /api/images   FormData { file, address }  → { url, path }
// DELETE /api/images   JSON { path }               → { ok: true }
//
// Uploads used to go straight from the browser with the public anon key, which
// meant the storage policies were the only gate — and a blanket anon DELETE
// policy let anyone holding that key wipe other people's prediction images.
// Both writes now run here with the service-role key, and schema.sql drops the
// anon insert/delete policies so this route is the ONLY way to write.
//
// What this can and can't enforce: submitters aren't authenticated anywhere in
// Somoco (embedded Privy wallets are deliberately exempt from the trust gate),
// so we can't prove the caller owns `address`. What we CAN do is make the
// damage bounded — uploads land under a random name nobody can guess or
// overwrite, and a delete is refused once the image belongs to a saved
// prediction. So the worst a forged request achieves is orphan junk in the
// bucket, never destroying someone else's image.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { IMAGE_BUCKET, MAX_IMAGE_BYTES, EXTENSIONS, sniffImageType } from '@/lib/predictions/imageRules'

/**
 * The shape uploadPredictionImage() creates: `{owner}/{uuid}.{ext}`, owner being
 * a lowercased wallet address (or `anon` when the wallet hasn't resolved yet).
 * Anything else is a caller trying to reach a path this route never wrote —
 * including `../` traversal attempts.
 */
const PATH_PATTERN = /^(0x[0-9a-f]{40}|anon)\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image file supplied.' }, { status: 400 })
  }

  // Size first, so an oversized file is rejected before we pull it into memory.
  // The client checks the same limits for a fast error message, but a direct
  // POST skips that entirely.
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return NextResponse.json({ error: `that image is ${mb}MB — the limit is 5MB` }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffImageType(bytes)
  if (!contentType) {
    return NextResponse.json(
      { error: 'that file type is not supported — use a JPG, PNG, WEBP or GIF' },
      { status: 400 }
    )
  }

  const rawAddress = String(form.get('address') ?? '').toLowerCase()
  const owner = /^0x[0-9a-f]{40}$/.test(rawAddress) ? rawAddress : 'anon'
  const path = `${owner}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`

  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Image storage unavailable.' },
      { status: 500 }
    )
  }

  const { error } = await db.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false })

  if (error) {
    if (/bucket|not found/i.test(error.message)) {
      return NextResponse.json(
        { error: 'image storage is not set up yet — run schema.sql in Supabase' },
        { status: 500 }
      )
    }
    console.error('image upload failed:', error.message)
    return NextResponse.json({ error: `image upload failed: ${error.message}` }, { status: 500 })
  }

  const { data } = db.storage.from(IMAGE_BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl, path })
}

export async function DELETE(request: Request) {
  let body: { path?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const path = typeof body.path === 'string' ? body.path : ''
  if (!PATH_PATTERN.test(path)) {
    return NextResponse.json({ error: 'Not an image path this app wrote.' }, { status: 400 })
  }

  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Image storage unavailable.' },
      { status: 500 }
    )
  }

  // Deletes are for abandoned uploads only — a picker "replace"/"remove" before
  // the prediction is submitted. Once a prediction row points at the file it is
  // someone's published image and stops being deletable through this route.
  const { data: attached, error: lookupError } = await db
    .from('predictions')
    .select('id')
    .like('image_url', `%${path}`)
    .limit(1)

  if (lookupError) {
    console.error('image delete lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Could not verify the image.' }, { status: 500 })
  }
  if (attached && attached.length > 0) {
    return NextResponse.json({ error: 'That image belongs to a prediction.' }, { status: 409 })
  }

  const { error } = await db.storage.from(IMAGE_BUCKET).remove([path])
  if (error) {
    console.error('image delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
