// ─────────────────────────────────────────────────────────────
// SERVER-RENDERED POST/HOME PAGES.
//
// Wired up in vercel.json: EVERY request (not just recognized bots)
// to "/", "/home", "/i/status/:id", and "/:username/status/:id" is
// rewritten here instead of being served the static index.html /
// thread.html directly.
//
// WHY THIS EXISTS: index.html/thread.html are otherwise empty shells
// until js/board.js / js/thread.js run in the browser and fetch the
// real content from Supabase client-side. That's invisible to a
// human, but it means anything that doesn't execute JS — most
// crawlers, link-unfurl bots (Slack, Discord, WhatsApp, iMessage,
// Telegram), and Googlebot's non-JS first indexing pass — sees a
// "Loading posts…" spinner and generic <title>/<meta>, not the post.
//
// HOW IT WORKS: this reads the *real* index.html / thread.html file
// (the same one the browser gets) and does a handful of targeted
// string replacements — unique <title>/<meta>/canonical/OG tags, a
// JSON-LD block, and real static markup in place of the loading
// spinner — using data fetched from Supabase server-side. Every
// original <script> tag is left in place, so once the page loads in
// a real browser, js/board.js / js/thread.js runs exactly as before
// and takes over (live updates, interactive buttons, etc.) — this
// only replaces what the first response looks like before JS runs.
//
// This used to run only for requests whose User-Agent matched a
// known bot/crawler pattern ("dynamic rendering") — that was fragile
// (any crawler not on the list got nothing) and meant two divergent
// code paths (this file vs. thread.js) to keep in sync. Serving the
// same real template to everyone removes both problems.
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://pyitivzoqleukuclajrf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aXRpdnpvcWxldWt1Y2xhanJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Nzg0ODcsImV4cCI6MjEwMTU1NDQ4N30.gKvqOaAREY5wcptIv7OHfjHhZR5ogIaMY8I98jHRmFs';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sbGet(tbl, query) {
  const url = `${SUPABASE_URL}/rest/v1/${tbl}?${query}`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return Array.isArray(data) ? data : null;
}

// Reads a static HTML file from the deployed project. Both index.html
// and thread.html ship alongside this function in the same deployment,
// so they're available on disk at request time — this is what lets us
// template the *real* page instead of hand-building a lookalike one.
function readTemplate(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

// Replaces the first (and, for these templates, only) occurrence of
// `line` with `replacement`. Throws loudly if the anchor text isn't
// found, so a future edit to index.html/thread.html that changes this
// text breaks the build instead of silently serving stale meta tags.
function replaceLine(html, line, replacement) {
  if (!html.includes(line)) {
    throw new Error(`prerender template anchor not found: ${JSON.stringify(line)}`);
  }
  return html.replace(line, replacement);
}

function injectHead(html, extra) {
  return html.replace('</head>', `${extra}\n</head>`);
}

// JSON.stringify does NOT escape "</script>" — a post body containing
// that literal string would otherwise close the JSON-LD <script> tag
// early and let the rest of the "JSON" be parsed as raw HTML/script.
// Escaping "<" as \u003c (valid inside a JSON string, and inert in
// HTML) neutralizes that without changing the JSON-LD's meaning.
function jsonLdScriptTag(obj) {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// ── HOME ("/", "/home") ──

async function renderHome(origin) {
  const posts = await sbGet('posts',
    `is_deleted=eq.false&select=id,body,created_at,like_count,reply_count,repost_count,profile:profiles!posts_author_id_fkey(username,display_name,avatar_url)&order=created_at.desc&limit=30`) || [];

  let html = readTemplate('index.html');

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    url: origin + '/', name: 'InteractInk',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((p, i) => ({
        '@type': 'ListItem', position: i + 1,
        url: p.profile?.username
          ? `${origin}/${encodeURIComponent(p.profile.username)}/status/${encodeURIComponent(p.id)}`
          : `${origin}/i/status/${encodeURIComponent(p.id)}`,
      })),
    },
  };

  const postsHtml = posts.map(p => {
    const uname = p.profile?.username;
    const href = uname
      ? `${origin}/${encodeURIComponent(uname)}/status/${encodeURIComponent(p.id)}`
      : `${origin}/i/status/${encodeURIComponent(p.id)}`;
    return `<article>
  <a href="${href}"><strong>${esc(p.profile?.display_name || uname || 'unknown')}</strong> @${esc(uname || 'unknown')}</a>
  &middot; <small>${new Date(p.created_at).toLocaleString()}</small>
  <p><a href="${href}">${esc((p.body || '').slice(0, 280))}</a></p>
  <small>${p.like_count || 0} likes &middot; ${p.reply_count || 0} replies &middot; ${p.repost_count || 0} reposts</small>
</article>`;
  }).join('\n');

  // index.html already ships a generic WebSite JSON-LD block — this
  // adds a second, more specific block alongside it rather than
  // replacing it (multiple JSON-LD <script> tags on one page is
  // valid and is how most sites layer WebSite + page-specific data).
  html = injectHead(html, jsonLdScriptTag(jsonLd));

  html = replaceLine(html,
    '<div id="feed-posts"><span class="spinner">Loading posts&hellip;</span></div>',
    `<div id="feed-posts">${postsHtml || '<p>No posts yet.</p>'}</div>`);

  return { status: 200, html };
}

// ── THREAD ("/i/status/:id", "/:username/status/:id") ──

async function renderThread(origin, username, id) {
  let html = readTemplate('thread.html');

  const posts = await sbGet('posts', `id=eq.${encodeURIComponent(id)}&is_deleted=eq.false&select=*,profile:profiles!posts_author_id_fkey(username,display_name,avatar_url)`);
  const post = posts && posts[0];

  if (!post) {
    html = replaceLine(html, '<title>Post — InteractInk</title>', '<title>Post not found — InteractInk</title>');
    html = replaceLine(html,
      '<meta name="description" content="A post and its replies on InteractInk.">',
      '<meta name="description" content="This post was not found or has been removed.">');
    html = injectHead(html, '<meta name="robots" content="noindex">');
    html = replaceLine(html,
      '<div id="thread-root"><span class="spinner">Loading&hellip;</span></div>',
      '<div id="thread-root"><p>This post was not found or has been removed.</p></div>');
    return { status: 404, html };
  }

  const uname = post.profile?.username || username;
  const canonicalPath = `/${encodeURIComponent(uname)}/status/${encodeURIComponent(post.id)}`;
  const canonical = origin + canonicalPath;

  const replies = await sbGet('replies',
    `post_id=eq.${encodeURIComponent(id)}&is_deleted=eq.false&select=body,created_at,profile:profiles(username,display_name)&order=created_at.asc&limit=50`) || [];

  const titleText = `${post.profile?.display_name || uname} on InteractInk: "${(post.body || '').slice(0, 60)}"`;
  const descText = (post.body || 'A post on InteractInk.').slice(0, 200);
  const image = post.media_url || post.profile?.avatar_url || '/img/logo-light.png';

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'SocialMediaPosting',
    url: canonical, datePublished: post.created_at, text: post.body,
    author: {
      '@type': 'Person',
      name: post.profile?.display_name || uname,
      url: `${origin}/${encodeURIComponent(uname)}`,
    },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.like_count || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ReplyAction', userInteractionCount: post.reply_count || 0 },
    ],
  };

  const repliesHtml = replies.map(r => `<li><strong>@${esc(r.profile?.username || 'unknown')}</strong>: ${esc((r.body || '').slice(0, 300))} <small>(${new Date(r.created_at).toLocaleString()})</small></li>`).join('\n');

  const threadRootHtml = `<article>
  <a href="/${esc(uname)}"><strong>${esc(post.profile?.display_name || uname)}</strong> @${esc(uname)}</a>
  &middot; <small>${new Date(post.created_at).toLocaleString()}</small>
  <p>${esc(post.body)}</p>
  <small>${post.like_count || 0} likes &middot; ${post.reply_count || 0} replies &middot; ${post.repost_count || 0} reposts</small>
</article>
<h2 class="sr-only">Replies</h2>
<ul>${repliesHtml || '<li>No replies yet.</li>'}</ul>`;

  // <title> and the OG/Twitter title tags currently share identical
  // default text ("Post — InteractInk"), same for the descriptions —
  // replace each full tag line individually so every tag ends up with
  // the real (escaped) value even though the source text matched.
  html = replaceLine(html, '<title>Post — InteractInk</title>', `<title>${esc(titleText)}</title>`);
  html = replaceLine(html,
    '<meta name="description" content="A post and its replies on InteractInk.">',
    `<meta name="description" content="${esc(descText)}">`);
  html = replaceLine(html,
    '<meta property="og:title" content="Post — InteractInk">',
    `<meta property="og:title" content="${esc(titleText)}">`);
  html = replaceLine(html,
    '<meta property="og:description" content="A post and its replies on InteractInk.">',
    `<meta property="og:description" content="${esc(descText)}">`);
  html = replaceLine(html,
    '<meta property="og:image" content="/img/logo-light.png">',
    `<meta property="og:image" content="${esc(image)}">`);
  html = replaceLine(html,
    '<meta name="twitter:title" content="Post — InteractInk">',
    `<meta name="twitter:title" content="${esc(titleText)}">`);
  html = replaceLine(html,
    '<meta name="twitter:description" content="A post and its replies on InteractInk.">',
    `<meta name="twitter:description" content="${esc(descText)}">`);
  html = replaceLine(html,
    '<meta name="twitter:image" content="/img/logo-light.png">',
    `<meta name="twitter:image" content="${esc(image)}">`);
  html = replaceLine(html, '<link rel="canonical">', `<link rel="canonical" href="${esc(canonical)}">`);
  html = replaceLine(html, '<meta property="og:url" content="">', `<meta property="og:url" content="${esc(canonical)}">`);

  html = injectHead(html, jsonLdScriptTag(jsonLd));

  html = replaceLine(html,
    '<div id="thread-root"><span class="spinner">Loading&hellip;</span></div>',
    `<div id="thread-root">${threadRootHtml}</div>`);

  return { status: 200, html };
}

module.exports = async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${host}`;
  const { type, username, id } = req.query;

  try {
    let result;
    if (type === 'home') {
      result = await renderHome(origin);
    } else if (type === 'thread' && id) {
      result = await renderThread(origin, username, id);
    } else {
      res.status(400).send('Bad request');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Short edge cache: keeps Supabase load down while still refreshing
    // often enough that like/reply counts and new posts don't go stale
    // for long. Applies to every visitor now (not just bots), so this
    // is also just... your CDN cache for the page.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.status(result.status).send(result.html);
  } catch (e) {
    res.status(502).send('Render failed: ' + e.message);
  }
}
