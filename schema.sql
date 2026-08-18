-- Somoco — Supabase schema
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent-ish).

-- ---------------------------------------------------------------------------
-- predictions: Somoco's private bookkeeping for every prediction submitted
-- through the app. The real Triple lives on Intuition; this tracks approval +
-- resolution state that only Somoco's own flow controls.
-- ---------------------------------------------------------------------------
create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  triple_id text not null,
  creator_address text not null,
  subject text not null,
  claim text not null,
  condition text,
  category text,                                         -- feed section: 'politics' | 'crypto' | 'football' | ...
  resolution_date date,
  approval_status text not null default 'pending',      -- 'pending' | 'approved' | 'rejected'
  resolution_status text not null default 'unresolved', -- 'unresolved' | 'resolved_true' | 'resolved_false'
  resolution_tx_hash text,
  created_at timestamptz not null default now()
);

-- Add `category` to tables that predate this column (create table above only
-- runs on a fresh DB). Safe to re-run.
alter table predictions add column if not exists category text;

-- Structured resolution plan (method/sources/criteria/needsReview) written at
-- submit time by the parser. See lib/predictions/resolutionRules.ts.
alter table predictions add column if not exists resolution_plan jsonb;

-- Optional image the creator attached to the prediction. Public URL into the
-- prediction-images storage bucket created below. Cosmetic only — the Triple
-- on Intuition is unaffected. See lib/predictions/imageUpload.ts.
alter table predictions add column if not exists image_url text;

-- Friend markets (PvP). A private prediction never appears in the public feed
-- and is settled by the people invited to it rather than by Somoco — see
-- docs/friend-markets-v1-spec.md and contracts/src/FriendJury.sol.
--
-- These four columns are only ever a REQUEST. Nothing here can settle anything:
-- the binding version is the jury registered on-chain by the admin at approval
-- time, and the contract reads its voters from itself, never from this table.
-- (The RLS hole that made Supabase forgeable is exactly why the settlement
-- contracts never trust it — same rule applies here.)
alter table predictions add column if not exists is_private boolean not null default false;
alter table predictions add column if not exists invited_wallets text[];
alter table predictions add column if not exists judge_wallet text;
alter table predictions add column if not exists vote_window_seconds integer;

-- Feed/leaderboard queries hit these constantly.
create index if not exists predictions_approval_idx on predictions (approval_status);
create index if not exists predictions_creator_idx on predictions (lower(creator_address));
create index if not exists predictions_category_idx on predictions (category);

-- ---------------------------------------------------------------------------
-- users: one row per wallet that has connected to Somoco. trust_score is
-- computed on first connection (lib/trust.ts) and gates who can submit.
-- ---------------------------------------------------------------------------
create table if not exists users (
  address text primary key,                    -- lowercased wallet address
  trust_score integer not null default 0,      -- 0–100
  trust_signals jsonb,                          -- raw signals for display/debug
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The anon key is baked into the browser bundle, so it is PUBLIC — anyone can
-- call the Supabase REST API with it. RLS is therefore ON, with read-only
-- policies: the anon key can SELECT (the feed, the approval queue and the
-- leaderboard all read with it) but cannot INSERT, UPDATE or DELETE anything.
--
-- Every write now goes through a server route holding the service-role key,
-- which bypasses RLS:
--   POST /api/predictions      — create a pending record (server owns approval_status)
--   POST /api/users/ensure     — write a server-computed trust score
--   POST /api/admin/approve    — approve/reject   (requires an admin wallet signature)
--   POST /api/admin/resolve    — record an outcome (requires an admin wallet signature)
--
-- This is what makes AdminGate and the trust-score threshold real rather than
-- UI-only. Do NOT add write policies here without moving the corresponding
-- check somewhere the user cannot edit.
--
-- Nothing here is secret — predictions and trust scores are public by design —
-- so a blanket read policy matches the app's intent. Only writes are locked.
-- ---------------------------------------------------------------------------
alter table predictions enable row level security;
alter table users enable row level security;

drop policy if exists "predictions are publicly readable" on predictions;
create policy "predictions are publicly readable"
  on predictions for select
  using (true);

drop policy if exists "users are publicly readable" on users;
create policy "users are publicly readable"
  on users for select
  using (true);

-- ---------------------------------------------------------------------------
-- storage: prediction images
-- Public read (the feed renders them), NO anon write. Uploads and deletes both
-- go through /api/images with the service-role key, which bypasses these
-- policies — same pattern as the predictions/users tables. Nothing uploaded
-- here reaches the public feed until an admin approves the prediction.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prediction-images',
  'prediction-images',
  true,
  5242880,                                              -- 5 MB, matches MAX_IMAGE_BYTES
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage always enforces RLS, so the bucket needs explicit policies even
-- though the tables above don't. Drop-then-create keeps this re-runnable.
drop policy if exists "prediction images are publicly readable" on storage.objects;
create policy "prediction images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'prediction-images');

-- No insert/delete policies on purpose. These used to exist and were the last
-- anon write path in the app: the anon key ships in the browser bundle, so
-- "anyone can delete a prediction image" meant any visitor could wipe every
-- image in the feed. Writes now run server-side in app/api/images/route.ts,
-- which uses the service-role key and therefore isn't subject to RLS at all.
--
-- ⚠️ This block replaced two `drop policy if exists "<name>"` statements that
-- did nothing. `if exists` matches on the EXACT policy name, so if the live
-- policy was created under any other name — a different wording, or Supabase's
-- own dashboard naming — the drop silently matched zero rows and the file
-- reported success while the hole stayed open. It did: on 2026-08-07 the anon
-- key could still upload AND delete in this bucket, long after schema.sql was
-- believed to have closed it.
--
-- So: find them by what they DO, not by what they're called. Every INSERT /
-- UPDATE / DELETE policy touching this bucket gets dropped, whatever its name.
-- Other buckets are matched on their own names and left alone.
do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%prediction-images%'
  loop
    raise notice 'dropping anon write policy on storage.objects: %', policy_row.policyname;
    execute format('drop policy %I on storage.objects', policy_row.policyname);
  end loop;
end $$;
