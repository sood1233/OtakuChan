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
3. Then run `supabase/settings.sql` (same SQL Editor → New query). This
   adds the account "options" behind `settings.html`:
   - `profiles.banner_url` — a cover photo, editable from `editprofile.html`
   - `user_settings` — one row per user (auto-created), holding
     notification toggles (likes / replies / follows) and a
     "who can message you" (everyone / people you follow) privacy
     setting, actually enforced by the `messages` table's RLS policy
   - updated versions of the like/reply/follow triggers from
     `schema.sql` that check those toggles before writing a
     `notifications` row

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
- `/home` (`index.html`) — board feed, new-thread form (accounts only), trending sidebar, realtime new-post updates
- `/<username>/status/<uuid>` (`thread.html`) — single thread with all replies, realtime new-reply updates. Also reachable as `/i/status/<uuid>` before the author is known (e.g. a raw copy-pasted id) — the address bar upgrades to the canonical `/<username>/status/<uuid>` automatically once the post loads, same as x.com.
- `/login`, `/signup` (`login.html` / `signup.html`) — create an account / sign in
- `/<username>` (`profile.html`) — a user's public profile (banner, avatar, bio, their posts). Your own profile shows an "Edit Profile" button that goes to `editprofile.html`; visiting your own profile no longer auto-opens an edit form.
- `editprofile.html` — its own page (Twitter's "Edit profile" screen) for banner, avatar, display name, and bio; logged-in users only, always edits your own account
- `/<username>/followers`, `/<username>/following` (`followlist.html`) — its own page (Twitter's followers/following screen) with tabs, a Follow/Following button per row, live counts
- `/search?q=<term>` (`search.html`) — search posts (body) or people (username/display name), tabbed
- `/bookmarks` (`bookmarks.html`) — posts you've bookmarked (private to you)
- `/notifications` (`notifications.html`) — likes, replies, and new followers; marks itself read on view, live badge count in the sidebar
- `/messages`, `/messages/<username>` (`chat.html`) — direct messages: conversation list, or a one-on-one thread with realtime delivery
- `/settings` (`settings.html`) — Notifications (toggle likes/replies/follows), Privacy (who can message you), Account (email/password), link to `editprofile.html`, log out
- `/rules` (`rules.html`) — rules, FAQ, DMCA contact info

All the pretty paths above are handled by the `rewrites` block in
`vercel.json` — Vercel serves the real `.html` file behind the scenes
while the address bar keeps the clean URL. Every internal link in the
app is built through one of the helpers at the top of `js/common.js`
(`profileUrl()`, `postUrl()`, `followListUrl()`, `messagesUrl()`), so
the whole scheme lives in one place if it ever needs to change.
Old-style links (`profile.html?u=marc`, `thread.html?id=<uuid>`) still
work as a fallback — useful for local dev with plain `npx serve .`,
which doesn't understand `vercel.json` rewrites. To test the pretty
URLs locally, use `vercel dev` instead, or just deploy — Vercel
Preview URLs get the rewrites too.

The left sidebar nav (`#side-nav`, filled in by `renderSideNav()` in
`js/common.js`) is shared across every page instead of being copy-pasted
HTML, so adding/reordering nav items only needs to happen in one place.

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

## Quotes & reposts
Run `supabase/quotes_and_reposts.sql` in the SQL Editor after `schema.sql`
(and `settings.sql`, if you're using it) — it's additive/idempotent like
the others, so it's safe to run again later too. It adds:
- **Quote posts** — a quote is just a normal `posts` row with `quote_of`
  set to the post being quoted, so it rides along in every existing
  feed/profile/search query for free.
- **Reposts** — a separate `reposts` table (one row per user/post,
  toggleable) rather than a new `posts` row, so it doesn't clutter reply
  counts. Liking, unliking (tap the heart again), and reposting/undoing
  a repost all work the same way: insert or delete your own row, RLS
  enforces it can only ever be your own.
- **View cascading** — a view on a quote post counts as a view of the
  post it's quoting too (and on up the chain if that post is itself a
  quote), the same way a quote-retweet's impressions roll up to the
  original tweet on Twitter. Likes/replies/reposts never cascade this
  way — only views.
- **"[Name] reposted" banners** — a repost shows up in the reposting
  user's own profile timeline (sorted by repost time, not the original
  post's time) and in the timeline of anyone who follows them, each
  tagged with a small banner above the card: "You reposted" on your own
  profile, "[Display name] reposted" everywhere else. See
  `repostBannerHtml()` in `js/common.js`.

## Mentions, hashtags & links
Post and reply bodies are rendered Twitter-style — no schema change
needed for the text itself, since `renderBody()`/`linkifyText()` in
`js/common.js` turn plain text into rich text on the fly, after
escaping (so a post can never inject HTML this way):
- **`@username`** becomes a link to that user's profile.
- **`#hashtag`** becomes a link to `search.html?q=%23hashtag`, which
  runs through the existing posts search (an `ILIKE` on `body`), so
  it needs no separate hashtags table.
- **`https://…` / `http://…`** becomes a clickable link that opens in
  a new tab.

Run `supabase/mentions.sql` in the SQL Editor after `schema.sql` and
`settings.sql` (additive/idempotent like the others) to wire up the
notification side: tagging someone with `@their_username` in a post
or reply drops a "mentioned you" row in their Notifications page,
same mechanism as likes/replies/follows — a security-definer trigger
on insert, gated by a `notify_mentions` toggle in `settings.html`
(on by default), never something the client inserts directly.

## Post detail page
`thread.html` (tapping into a post) uses its own larger layout —
`.op-detail` in `css/style.css`, built by `loadThread()` in
`js/thread.js` — separate from the compact card `postCardHtml()`
uses everywhere else (feed, profile, search, trending): bigger body
text, a "9:00 PM · Aug 8, 2026 · 64.5k Views" meta line instead of an
inline timestamp, a full-width reply/repost/like/bookmark/share row,
and a "View quotes ›" link (hidden unless the post has at least one)
that expands an inline list of the posts quoting it. Run
`supabase/bookmark_count.sql` after `schema.sql` to get the bookmark
count that row shows — bookmarks themselves stay exactly as private
as before (see "NOTIFICATIONS" section of `schema.sql`); this only
adds a plain aggregate counter, the same way `like_count`/
`reply_count`/`repost_count` already work.

## Customizing
- Colors/fonts/layout: `css/style.css`
- Feed/thread/like/report/bookmark/delete logic: `js/board.js`, `js/thread.js`, `js/common.js`.
  Deleting is a soft delete (`posts.is_deleted = true`, same mechanism
  replies already use) — the existing "users can edit own posts" RLS
  policy already covers it, no schema change needed. A "Delete" option
  appears in a post's "···" menu only for its own author.
- Auth/profile logic: `js/auth.js`, `js/profile.js`
- Search: `js/search.js` (ILIKE against `posts.body` / `profiles.username`,`display_name`;
  backed by the `pg_trgm` indexes added in `supabase/schema.sql`)
- Notifications: `js/notifications.js` — rows are only ever created by
  security-definer triggers on `likes`/`replies`/`follows`/`posts` (for
  mentions) inserts (see schema.sql / settings.sql / mentions.sql), never
  inserted directly by the client, and only when the recipient's
  `user_settings` toggle for that type is on
- Mentions/hashtags/links: `linkifyText()` in `js/common.js` (rendering)
  and `supabase/mentions.sql` (the "mentioned you" notification)
- Post detail page: `.op-detail` in `css/style.css`, `loadThread()` in
  `js/thread.js`, and `supabase/bookmark_count.sql` (the bookmark count
  it shows)
- Chat: `js/chat.js` — flat `messages` table, RLS-scoped to sender/recipient,
  realtime subscription per open thread; who's allowed to start a thread
  with you is controlled by `user_settings.dm_privacy`
- Settings: `js/settings.js` — email/password changes via `sb.auth.updateUser()`,
  plus notification toggles and DM privacy, both read/written against
  `user_settings` (see `supabase/settings.sql`)
- Edit profile: `js/editprofile.js` — its own page, separate from
  `profile.js`; banner/avatar upload + display name/bio, all against
  the current session's own row
- Followers/following: `js/followlist.js` — its own page, separate from
  `profile.js`; reads `follows` joined to `profiles`
- Max file size / allowed types: change in **both** `js/supabase-config.js`
  (client-side check, instant feedback) **and** `supabase/schema.sql`'s
  storage bucket insert (server-side enforcement — this is the one that
  actually matters).
