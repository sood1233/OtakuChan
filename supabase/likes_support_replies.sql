-- Likes were only ever wired up for posts: `likes.post_id` is NOT NULL
-- with a FK to posts(id), so every row has to point at a real post.
-- The UI lets you like replies too (thread.js renders a heart on every
-- reply card), but a reply's id was being sent into that same post_id
-- column — since no post exists with that id, Postgres rejects the
-- insert with:
--   insert or update on table "likes" violates foreign key
--   constraint "likes_post_id_fkey"
--
-- This migration lets a like point at a post OR a reply: post_id
-- becomes nullable, a nullable reply_id + FK to replies(id) is added,
-- and a check constraint enforces exactly one of the two is set.
-- Matching client change: js/common.js toggleLike()/ensureLikesLoaded()
-- and every postActionsHtml() call site that renders replies now pass
-- isReply so the like goes in the right column.
--
-- Safe to run against the existing table — run this in the Supabase
-- SQL editor.

alter table public.likes
  alter column post_id drop not null;

alter table public.likes
  add column if not exists reply_id uuid references public.replies(id) on delete cascade;

alter table public.likes
  add constraint likes_post_xor_reply
  check (
    (post_id is not null and reply_id is null) or
    (post_id is null and reply_id is not null)
  );

-- Replace the old single unique(post_id, user_id) constraint (if it
-- exists under this name — adjust if yours is named differently) with
-- two partial unique indexes, one per target, so "like a post twice"
-- and "like a reply twice" are both still blocked, and a post-like and
-- a reply-like never collide with each other.
alter table public.likes
  drop constraint if exists likes_post_id_user_id_key;

create unique index if not exists likes_unique_post_like
  on public.likes (post_id, user_id) where post_id is not null;

create unique index if not exists likes_unique_reply_like
  on public.likes (reply_id, user_id) where reply_id is not null;

-- If you have RLS policies on `likes` scoped with `post_id = ...` or
-- similar, double-check they still make sense now that reply_id can
-- carry the target instead — this migration doesn't touch policies.
