// ─────────────────────────────────────────────────────────────
// BOT-FACING SERVER RENDER for /<username> and /<username>/status/<id>
// (and their /i/status/<id> form). Wired up in vercel.json: requests
// whose User-Agent matches a known crawler/link-unfurler pattern get
// rewritten here *instead of* profile.html/thread.html; every other
// visitor still gets the normal client-rendered app, unchanged.
//
// WHY THIS EXISTS: profile.html/thread.html are empty shells until
// js/profile.js / js/thread.js run and fetch the real content from
// Supabase client-side. Googlebot can execute JS (with a delay — a
// "second wave" indexing pass), but most other crawlers can't or
// won't: Bingbot's JS rendering is limited, and link-unfurl bots
// (Slack, Discord, WhatsApp, iMessage, Twitter/X, Facebook, Telegram)
// never run JS at all — they just read <title>/<meta> straight out of
// the initial HTML. Without this, every shared profile/post link
// unfurls as generic "Profile — InteractInk" text, and most search
// engines never see real content on these pages at all.
//
// This returns real, already-escaped text content (not just meta
// tags) so it's a legitimate, content-matching version of the page —
// same technique commonly called "dynamic rendering", not cloaking,
// because a human opening the same URL sees the same information
// (just rendered by JS instead of by this function).
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://pyitivzoqleukuclajrf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5aXRpdnpvcWxldWt1Y2xhanJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Nzg0ODcsImV4cCI6MjEwMTU1NDQ4N30.gKvqOaAREY5wcptIv7OHfjHhZR5ogIaMY8I98jHRmFs';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sbGet(path, query) {
  const url = `${SUPABASE_URL}/rest/v1/${path}?${query}`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return Array.isArray(data) ? data : null;
}

function shell({ title, description, canonical, image, type, jsonLd, bodyHtml, notFound }) {
  const status = notFound ? 404 : 200;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${esc(type || 'website')}">
<meta property="og:site_name" content="InteractInk">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${notFound ? '<meta name="robots" content="noindex">' : ''}
<link rel="stylesheet" href="/css/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<main style="max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;">
${bodyHtml}
</main>
</body>
</html>`;
  return { status, html };
}

async function renderProfile(origin, username) {
  const profiles = await sbGet('profiles', `username=ilike.${encodeURIComponent(username)}&select=*`);
  const profile = profiles && profiles[0];
  const canonical = `${origin}/${encodeURIComponent(username)}`;
  if (!profile) {
    return shell({
      title: 'User not found — InteractInk', description: 'No user found with that username.',
      canonical, notFound: true, bodyHtml: `<p>No user found with that username.</p>`,
    });
  }
  const posts = await sbGet('posts',
    `author_id=eq.${profile.id}&is_deleted=eq.false&select=id,body,created_at&order=created_at.desc&limit=20`) || [];

  const title = `${profile.display_name || profile.username} (@${profile.username}) — InteractInk`;
  const description = (profile.bio || `@${profile.username}'s posts on InteractInk.`).slice(0, 200);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ProfilePage',
    dateCreated: profile.created_at, url: canonical,
    mainEntity: {
      '@type': 'Person', name: profile.display_name || profile.username,
      alternateName: profile.username, description: profile.bio || undefined,
      image: profile.avatar_url || undefined, url: canonical,
    },
  };
  const postsHtml = posts.map(p => `<li><a href="${origin}/${encodeURIComponent(profile.username)}/status/${encodeURIComponent(p.id)}">${esc((p.body || '').slice(0, 140))}</a> <small>(${new Date(p.created_at).toLocaleDateString()})</small></li>`).join('\n');
  const bodyHtml = `
<h1>${esc(profile.display_name || profile.username)}</h1>
<p>@${esc(profile.username)}</p>
${profile.bio ? `<p>${esc(profile.bio)}</p>` : ''}
<p>Joined ${new Date(profile.created_at).toLocaleDateString()} &middot; ${profile.followers_count || 0} followers &middot; ${profile.following_count || 0} following &middot; ${profile.posts_count || 0} posts</p>
<h2>Recent posts</h2>
<ul>${postsHtml || '<li>No posts yet.</li>'}</ul>`;

  return shell({ title, description, canonical, image: profile.avatar_url, type: 'profile', jsonLd, bodyHtml });
}

async function renderThread(origin, username, id) {
  const posts = await sbGet('posts', `id=eq.${encodeURIComponent(id)}&is_deleted=eq.false&select=*,profile:profiles!posts_author_id_fkey(username,display_name,avatar_url)`);
  const post = posts && posts[0];
  if (!post) {
    return shell({
      title: 'Post not found — InteractInk', description: 'This post was not found or has been removed.',
      canonical: `${origin}/i/status/${encodeURIComponent(id)}`, notFound: true,
      bodyHtml: `<p>This post was not found or has been removed.</p>`,
    });
  }
  const uname = post.profile?.username || username;
  const canonical = `${origin}/${encodeURIComponent(uname)}/status/${encodeURIComponent(post.id)}`;
  const replies = await sbGet('replies', `post_id=eq.${encodeURIComponent(id)}&is_deleted=eq.false&select=body,created_at,profile:profiles(username,display_name)&order=created_at.asc&limit=50`) || [];

  const title = `${post.profile?.display_name || uname} on InteractInk: "${(post.body || '').slice(0, 60)}"`;
  const description = (post.body || 'A post on InteractInk.').slice(0, 200);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'SocialMediaPosting',
    url: canonical, datePublished: post.created_at, text: post.body,
    author: { '@type': 'Person', name: post.profile?.display_name || uname, url: `${origin}/${encodeURIComponent(uname)}` },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.like_count || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ReplyAction', userInteractionCount: post.reply_count || 0 },
    ],
  };
  const repliesHtml = replies.map(r => `<li><strong>@${esc(r.profile?.username || 'unknown')}</strong>: ${esc((r.body || '').slice(0, 300))}</li>`).join('\n');
  const bodyHtml = `
<p><a href="${origin}/${encodeURIComponent(uname)}">@${esc(uname)}</a> &middot; ${new Date(post.created_at).toLocaleString()}</p>
<h1>${esc(post.body)}</h1>
<p>${post.like_count || 0} likes &middot; ${post.reply_count || 0} replies &middot; ${post.repost_count || 0} reposts</p>
<h2>Replies</h2>
<ul>${repliesHtml || '<li>No replies yet.</li>'}</ul>`;

  return shell({ title, description, canonical, image: post.media_url || post.profile?.avatar_url, type: 'article', jsonLd, bodyHtml });
}

module.exports = async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${host}`;
  const { type, username, id } = req.query;

  try {
    let result;
    if (type === 'thread' && id) {
      result = await renderThread(origin, username, id);
    } else if (type === 'profile' && username) {
      result = await renderProfile(origin, username);
    } else {
      res.status(400).send('Bad request');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.status(result.status).send(result.html);
  } catch (e) {
    res.status(502).send('Render failed: ' + e.message);
  }
}
