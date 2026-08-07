// Somoco — SERVER-ONLY Supabase client
//
// ⚠️  This uses the service-role key, which BYPASSES row level security
// entirely. It must never be imported from a Client Component or any file that
// ends up in the browser bundle. Import it only from files under app/api/.
//
// The `server-only` guard below turns an accidental client import into a build
// error rather than a silent key leak.
//
// Why this exists: RLS is now enabled on `predictions` and `users` with
// read-only public policies (see schema.sql). Every write therefore has to come
// through a server route holding this key — which is exactly what makes the
// admin gate and the trust-score gate real instead of UI-only.

import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const MISSING_KEY_MESSAGE =
  'SUPABASE_SERVICE_ROLE_KEY is missing, so this write cannot be saved. ' +
  'Get it from supabase.com → Project Settings → API → service_role and put it ' +
  'in .env.local WITHOUT the NEXT_PUBLIC_ prefix, then restart the dev server.'

let client: SupabaseClient | null = null

/**
 * The service-role client, created on first use.
 *
 * Built lazily on purpose: `next build` imports every route module to collect
 * page data, so constructing the client at module scope makes the whole build
 * fail on a machine that doesn't have the key (CI, a fresh clone). Failing here
 * instead means a missing key breaks only the writes that actually need it, and
 * says so in plain language.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(MISSING_KEY_MESSAGE)
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
