# Otakuchan — Setup

A static, no-backend anon imageboard. All data (posts, replies, likes,
media files) lives in Supabase; the HTML/CSS/JS here just talks to it
directly from the browser.

## 1. Create a Supabase project
1. Go to https://supabase.com → New project.
2. Wait for it to finish provisioning.

## 2. Run the schema
1. In your project: **SQL Editor → New query**.
2. Paste in the entire contents of `supabase/schema.sql` and run it.
   This creates the `posts`, `replies`, `likes`, `reports` tables, the
   RLS policies, the realtime publication, and the `media` storage
   bucket with a 5MB / image-video-only limit.

## 3. Get your API keys
Project Settings → API:
- **Project URL**
- **anon public key**

Open `js/supabase-config.js` and paste them in:
```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```
The anon key is meant to be public — it's safe in frontend code because
every table has Row Level Security turned on (see schema.sql: anon can
only read non-deleted rows and insert new posts/replies/likes/reports —
it can never update or delete anything).

## 4. Run it
This is a plain static site — no build step, no Node server required.
- Locally: open `index.html` directly, or run `npx serve .`
- Hosted: drag the folder into Netlify/Vercel, or push to GitHub Pages.

## Pages
- `index.html` — board feed, new-thread form, trending sidebar, realtime new-post updates
- `thread.html?id=<uuid>` — single thread with all replies, realtime new-reply updates
- `rules.html` — rules, FAQ, DMCA contact info

## Moderation — read this before going public
Anyone can post anonymously, including images/video, with no login.
That's the point of an imageboard, but it also means you are legally
the operator of a place where a stranger could try to post something
illegal (most importantly CSAM). A few things this build already sets
up for you, and what's still on you:

**Already in place:**
- A "Report" link on every post/reply that writes to a `reports` table
  only your service_role key can read (moderation queue).
- File type + 5MB size limit enforced at the Supabase Storage level
  (not just in JS, so it can't be bypassed by hitting the API directly).
- RLS means the anon key can never edit or delete other people's posts,
  and reports are write-only for the public.

**Still on you before running this for real users:**
- Check reports regularly (Table Editor → `reports`, or build yourself
  a small admin page using your service_role key on a server you
  control — never ship the service_role key to the browser).
- Know your legal reporting obligations for CSAM in your jurisdiction
  (in the US this means reporting to NCMEC) and have a takedown process.
- Add basic abuse protection Supabase doesn't give you for free by
  default: something like Cloudflare Turnstile on the post form, and/or
  a Supabase Edge Function that rate-limits posts per IP before they
  hit the database — the current `likes` dedup uses a per-browser id
  stored in localStorage, which stops accidental double-likes but is
  not tamper-proof.
- Consider scanning uploads (e.g. via an Edge Function calling a hash-
  matching service like PhotoDNA/CSAI Match) before files go public,
  especially at any real scale.

## Customizing
- Colors/fonts/layout: `css/style.css`
- Feed/thread/like/report logic: `js/board.js`, `js/thread.js`, `js/common.js`
- Max file size / allowed types: change in **both** `js/supabase-config.js`
  (client-side check, instant feedback) **and** `supabase/schema.sql`'s
  storage bucket insert (server-side enforcement — this is the one that
  actually matters).
