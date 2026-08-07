# Otakuchan — Setup

A static, no-backend social imageboard with real accounts. All data
(profiles, posts, replies, likes, media/avatar files) lives in
Supabase; the HTML/CSS/JS here just talks to it directly from the
browser. Posting requires signing up with an email, username, and
password — there is no anonymous posting.

## 1. Create a Supabase project
1. Go to https://supabase.com → New project.
2. Wait for it to finish provisioning.

## 2. Run the schema
1. In your project: **SQL Editor → New query**.
2. Paste in the entire contents of `supabase/schema.sql` and run it.
   This creates:
   - `profiles` (username, display_name, avatar_url, bio) — one row
     per user, auto-created by a trigger the moment someone signs up
   - `posts`, `replies`, `likes`, `reports`, all tied to a `profiles.id`
   - RLS policies (public read, write only when logged in and only
     to your own rows)
   - the realtime publication for live post/reply updates
   - two storage buckets: `media` (post/reply images & video, 5MB
     limit) and `avatars` (profile pictures, 2MB limit)

## 3. Configure email auth
Project Settings → Authentication → Providers → Email is on by
default, which is all this app needs. Two things worth checking:
- **Authentication → URL Configuration**: set your Site URL to
  wherever you deploy this (e.g. `https://yoursite.com`) so
  confirmation email links point to the right place.
- **Authentication → Providers → Email → "Confirm email"**: if this
  is ON (default), new users must click a confirmation link before
  they can log in — `signup.html` already shows the right message
  for that. If you turn it OFF, new users are logged in immediately
  after signing up.

## 4. Get your API keys
Project Settings → API:
- **Project URL**
- **anon public key**

Open `js/supabase-config.js` and paste them in:
```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```
The anon key is meant to be public — it's safe in frontend code because
every table has Row Level Security turned on (see schema.sql: anyone
can read public data, but writes require a logged-in session and only
succeed against your own `author_id` / `user_id` / `id`).

## 5. Run it
This is a plain static site — no build step, no Node server required.
- Locally: open `index.html` directly, or run `npx serve .`
- Hosted: drag the folder into Netlify/Vercel, or push to GitHub Pages.

## Pages
- `index.html` — board feed, new-thread form (accounts only), trending sidebar, realtime new-post updates
- `thread.html?id=<uuid>` — single thread with all replies, realtime new-reply updates
- `signup.html` / `login.html` — create an account / sign in
- `profile.html?u=<username>` — a user's public profile (avatar, bio, their posts); viewing your own adds an "Edit Profile" panel for avatar/display name/bio
- `rules.html` — rules, FAQ, DMCA contact info

## How accounts work
- `js/auth.js` handles sign up, log in, log out, session state, and
  renders the header's login/signup links vs. avatar-and-username menu.
- Sign up calls `supabase.auth.signUp()` with the username tucked into
  `options.data`; a Postgres trigger (`handle_new_user`) reads that and
  creates the matching `profiles` row automatically — so there's no
  race condition between "user exists" and "profile exists."
- Every post/reply insert sets `author_id` to `auth.uid()`; RLS enforces
  that you can only ever insert/edit rows under your own id.
- Elements marked `data-requires-auth` / `data-requires-anon` in the
  HTML are shown/hidden automatically based on session state (see
  `refreshPostGates()` in `js/auth.js`) — that's how the post form vs.
  "log in to post" gate is toggled.

## Moderation — read this before going public
Every post/reply is now tied to a real account, which helps, but you
are still legally the operator of a place where a stranger could try
to post something illegal (most importantly CSAM). A few things this
build already sets up for you, and what's still on you:

**Already in place:**
- Posting requires an account — no drive-by anonymous uploads.
- A "Report" link on every post/reply that writes to a `reports` table
  only your service_role key can read (moderation queue), tagged with
  the reporting user's id.
- File type + size limits enforced at the Supabase Storage level (not
  just in JS, so it can't be bypassed by hitting the API directly).
- RLS means the anon/authenticated key can never edit or delete other
  people's posts, profiles, or files, and reports are write-only.

**Still on you before running this for real users:**
- Check reports regularly (Table Editor → `reports`, or build yourself
  a small admin page using your service_role key on a server you
  control — never ship the service_role key to the browser).
- Know your legal reporting obligations for CSAM in your jurisdiction
  (in the US this means reporting to NCMEC) and have a takedown process.
- Add basic abuse protection Supabase doesn't give you for free by
  default: something like Cloudflare Turnstile on the sign-up form,
  and/or a Supabase Edge Function that rate-limits posts/signups per
  IP before they hit the database.
- Consider scanning uploads (e.g. via an Edge Function calling a hash-
  matching service like PhotoDNA/CSAI Match) before files go public,
  especially at any real scale.
- Decide on a real username-squatting / impersonation policy and a
  process for suspending abusive accounts (this schema doesn't include
  a ban/suspend flag — add a `banned boolean` column to `profiles` and
  check it in RLS if you need that).

## Customizing
- Colors/fonts/layout: `css/style.css`
- Feed/thread/like/report logic: `js/board.js`, `js/thread.js`, `js/common.js`
- Auth/profile logic: `js/auth.js`, `js/profile.js`
- Max file size / allowed types: change in **both** `js/supabase-config.js`
  (client-side check, instant feedback) **and** `supabase/schema.sql`'s
  storage bucket insert (server-side enforcement — this is the one that
  actually matters).
