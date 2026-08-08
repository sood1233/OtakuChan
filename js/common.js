// ─────────────────────────────────────────────────────────────
// COMMON HELPERS — shared by board.js and thread.js
// ─────────────────────────────────────────────────────────────

// ── ICONS + tweet-style post card rendering ──
const ICON = {
  reply:    '<svg viewBox="0 0 24 24"><path d="M12 3.5C7.03 3.5 3 6.96 3 11.2c0 2.35 1.24 4.46 3.2 5.88-.13.98-.55 2.5-1.6 3.9 1.72-.2 3.29-.98 4.4-1.76.94.3 1.96.46 3 .46 4.97 0 9-3.46 9-7.72s-4.03-8.46-9-8.46z"/></svg>',
  heart:    '<svg viewBox="0 0 24 24"><path d="M12 20.8s-6.9-4.2-9.5-8.4C.9 9.5 1.5 6 4.3 4.5c2.2-1.2 4.6-.5 6 1.3L12 8l1.7-2.2c1.4-1.8 3.8-2.5 6-1.3 2.8 1.5 3.4 5 1.8 7.9-2.6 4.2-9.5 8.4-9.5 8.4z"/></svg>',
  views:    '<svg viewBox="0 0 24 24"><path d="M4 21V10M12 21V3M20 21v7"/></svg>',
  share:    '<svg viewBox="0 0 24 24"><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/></svg>',
  menu:     '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1Z"/></svg>'
};

// ── SIDEBAR NAV — rendered into <nav id="side-nav"></nav> on every
// page, same idea as auth.js's auth-area: one source of truth so the
// "which link is Profile" / unread-count logic doesn't get copy-pasted
// across every HTML file. auth.js calls this once it knows who (if
// anyone) is logged in.
const NAV_ICON = {
  home:     '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"/></svg>',
  search:   '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  bell:     '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6v3.2c0 .6-.2 1.2-.6 1.7L4 16.5h16l-1.4-2.6c-.4-.5-.6-1.1-.6-1.7V9a6 6 0 0 0-6-6Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></svg>',
  chat:     '<svg viewBox="0 0 24 24"><path d="M4 4.5h16v12H8.5L4 20.5v-16Z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1Z"/></svg>',
  user:     '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.3" r="3.6"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/></svg>',
  gear:     '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5c0-.5.1-1 0-1.5l1.9-1.5-2-3.4-2.2.9c-.7-.6-1.5-1-2.3-1.3L14.4 4h-4l-.4 2.7c-.8.3-1.6.7-2.3 1.3l-2.2-.9-2 3.4L5.4 12c-.1.5 0 1 0 1.5l-1.9 1.5 2 3.4 2.2-.9c.7.6 1.5 1 2.3 1.3l.4 2.7h4l.4-2.7c.8-.3 1.6-.7 2.3-1.3l2.2.9 2-3.4-1.9-1.5Z"/></svg>',
  doc:      '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h8"/></svg>'
};

let unreadNotifCount = 0;

function renderSideNav() {
  const el = document.getElementById('side-nav');
  if (!el) return;
  const ownHref = (currentSession && currentProfile) ? `profile.html?u=${encodeURIComponent(currentProfile.username)}` : 'login.html';
  const badge = unreadNotifCount > 0 ? `<span class="navbadge">${unreadNotifCount > 99 ? '99+' : unreadNotifCount}</span>` : '';
  const here = location.pathname.split('/').pop() || 'index.html';
  const item = (href, icon, label, extra = '') => {
    const page = href.split('?')[0];
    return `<a href="${href}"${page === here ? ' class="cur"' : ''}><span class="navicon">${icon}</span><span class="navlabel">${label}</span>${extra}</a>`;
  };
  el.innerHTML =
    item('index.html', NAV_ICON.home, 'Home') +
    item('search.html', NAV_ICON.search, 'Search') +
    item('notifications.html', NAV_ICON.bell, 'Notifications', badge) +
    item('chat.html', NAV_ICON.chat, 'Chat') +
    item('bookmarks.html', NAV_ICON.bookmark, 'Bookmarks') +
    item(ownHref, NAV_ICON.user, 'Profile') +
    item('settings.html', NAV_ICON.gear, 'Settings') +
    item('rules.html', NAV_ICON.doc, 'Rules');
}

// Wires the (formerly decorative) sidebar search box: Enter jumps to
// the search results page with the typed query.
function wireSidebarSearch() {
  const input = document.getElementById('side-search');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim();
    if (q) location.href = `search.html?q=${encodeURIComponent(q)}`;
  });
}
document.addEventListener('DOMContentLoaded', wireSidebarSearch);

let liked = new Set(JSON.parse(localStorage.getItem('oc_liked') || '[]'));

async function toggleLike(postId, btn) {
  if (!requireLogin()) return;
  if (liked.has(postId)) return; // one like per account
  const { error } = await sb.from('likes').insert({ post_id: postId, user_id: currentSession.user.id });
  if (error) {
    if (error.code === '23505') { // unique violation — already liked
      liked.add(postId);
      localStorage.setItem('oc_liked', JSON.stringify([...liked]));
    }
    return;
  }
  liked.add(postId);
  localStorage.setItem('oc_liked', JSON.stringify([...liked]));
  btn.classList.add('liked');
  const newCount = (parseInt(btn.dataset.count, 10) || 0) + 1;
  btn.dataset.count = newCount;
  const lc = btn.querySelector('.lc');
  lc.textContent = fmtCount(newCount);
}

// ── BOOKMARKS ── (private per-user; unlike `liked`, this can't just
// live in localStorage since it needs to follow the user across
// devices, so it's fetched fresh from the DB whenever a page renders
// a list of posts.)
let bookmarked = new Set();

async function ensureBookmarksLoaded() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { bookmarked = new Set(); return; }
  const { data } = await sb.from('bookmarks').select('post_id').eq('user_id', session.user.id);
  bookmarked = new Set((data || []).map(b => b.post_id));
}

async function toggleBookmark(postId, btn) {
  if (!requireLogin()) return;
  const isBookmarked = bookmarked.has(postId);
  btn.disabled = true;
  try {
    if (isBookmarked) {
      const { error } = await sb.from('bookmarks').delete()
        .eq('post_id', postId).eq('user_id', currentSession.user.id);
      if (error) throw error;
      bookmarked.delete(postId);
    } else {
      const { error } = await sb.from('bookmarks').insert({ post_id: postId, user_id: currentSession.user.id });
      if (error) throw error;
      bookmarked.add(postId);
    }
    btn.classList.toggle('bookmarked', !isBookmarked);
    // On the bookmarks page itself, removing one should drop its card.
    if (isBookmarked && document.body.dataset.page === 'bookmarks') {
      document.getElementById(`post-${postId}`)?.remove();
      if (!document.querySelector('#feed-posts .pc')) {
        document.getElementById('feed-posts').innerHTML = `<div id="feed-empty">No bookmarks yet. Tap the bookmark icon on any post to save it here.</div>`;
      }
    }
  } catch (e) {
    alert(e.message || 'Could not update bookmark.');
  } finally {
    btn.disabled = false;
  }
}

// Copies a thread's permalink to the clipboard — the reference design's
// share icon, wired to something real instead of a decorative no-op.
function sharePost(id, btn) {
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}thread.html?id=${id}`;
  const done = () => {
    if (!btn) return;
    const label = btn.querySelector('.act-label');
    const prev = label ? label.textContent : null;
    btn.classList.add('copied');
    if (label) label.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('copied'); if (label && prev !== null) label.textContent = prev; }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copy link:', url));
  } else {
    prompt('Copy link:', url);
  }
}

// Toggles the small "···" dropdown (Report, etc.) on a post/reply header.
function togglePostMenu(id, ev) {
  if (ev) ev.stopPropagation();
  const wrap = document.getElementById(`pmenu-${id}`);
  if (!wrap) return;
  const willOpen = !wrap.classList.contains('open');
  document.querySelectorAll('.pc-menu-wrap.open').forEach(w => w.classList.remove('open'));
  if (willOpen) wrap.classList.add('open');
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.pc-menu-wrap.open').forEach(w => {
    if (!w.contains(e.target)) w.classList.remove('open');
  });
});

// Avatar + name/handle building blocks used by the tweet-style post card.
function pcAvatarHtml(profile, sizeClass = '') {
  const uname = profile?.username || 'unknown';
  return `<a class="pc-avatar-lnk" href="profile.html?u=${encodeURIComponent(uname)}">` +
         `<img class="avatar pc-avatar ${sizeClass}" src="${esc(avatarUrl(profile?.avatar_url))}" alt=""></a>`;
}
function pcNameHtml(profile) {
  const uname = profile?.username || 'unknown';
  return `<a class="nm" href="profile.html?u=${encodeURIComponent(uname)}">${esc(profile?.display_name || uname)}</a>` +
         `<span class="pc-handle">@${esc(uname)}</span>`;
}

// Renders the standard action row: reply / like / views / share, plus the
// "···" menu with Report — matches the reference layout's icon+count row.
// `replyAttr` is the href or onclick to use for the reply icon (feed cards
// link out to the thread; the thread's own OP scrolls to the reply box).
function postActionsHtml(p, { replyHref = null, replyOnclick = null, replyCount = null, bookmarkable = true } = {}) {
  const isLiked = liked.has(p.id);
  const isBookmarked = bookmarkable && bookmarked.has(p.id);
  const replyTag = replyHref
    ? `<a class="act reply" href="${replyHref}">`
    : `<button class="act reply" onclick="${esc(replyOnclick)}">`;
  const replyClose = replyHref ? '</a>' : '</button>';
  const rc = replyCount !== null ? replyCount : (p.reply_count || 0);
  return `
    <div class="acts">
      ${replyTag}${ICON.reply}<span class="act-label">${fmtCount(rc)}</span>${replyClose}
      <button class="act like${isLiked ? ' liked' : ''}" data-count="${p.like_count || 0}" onclick="toggleLike('${p.id}', this)">${ICON.heart}<span class="lc act-label">${fmtCount(p.like_count)}</span></button>
      <span class="act views" title="${p.view_count || 0} views">${ICON.views}<span class="act-label">${fmtCount(p.view_count)}</span></span>
      <button class="act share" onclick="sharePost('${p.id}', this)">${ICON.share}<span class="act-label">Share</span></button>
      ${bookmarkable ? `<button class="act bookmark${isBookmarked ? ' bookmarked' : ''}" onclick="toggleBookmark('${p.id}', this)">${ICON.bookmark}</button>` : ''}
    </div>`;
}

// The "···" header menu (Report, and Delete for your own posts).
// `replyId` set only for reply-card menus. `authorId` is the post's
// author_id — used to show Delete only when it's the logged-in
// user's own post.
function postMenuHtml(postId, replyId = null, authorId = null) {
  const target = replyId ? `'${postId}','${replyId}'` : `'${postId}'`;
  const isOwner = !replyId && currentSession && authorId && currentSession.user.id === authorId;
  return `
    <div class="pc-menu-wrap" id="pmenu-${replyId || postId}">
      <button class="pc-menu-btn" onclick="togglePostMenu('${replyId || postId}', event)">${ICON.menu}</button>
      <div class="pc-menu-dd">
        ${isOwner ? `<button class="pc-menu-danger" onclick="deletePost('${postId}', event)">Delete</button>` : ''}
        <button onclick="openReport(${target})">Report</button>
      </div>
    </div>`;
}

// Soft-deletes one of the current user's own posts (sets is_deleted =
// true; RLS already lets an author update their own post — see
// "users can edit own posts" in schema.sql — so no new policy is
// needed for this). Removes the card from whichever page it's on;
// on thread.html, where the post is the whole page, sends the user
// back to the board instead.
async function deletePost(postId, ev) {
  if (ev) { ev.stopPropagation(); togglePostMenu(postId, ev); }
  if (!requireLogin()) return;
  if (!confirm('Delete this post? This can\'t be undone.')) return;
  try {
    const { error } = await sb.from('posts').update({ is_deleted: true })
      .eq('id', postId).eq('author_id', currentSession.user.id);
    if (error) throw error;
    if (document.getElementById('op-post') && postId === (new URLSearchParams(location.search)).get('id')) {
      location.href = 'index.html';
      return;
    }
    document.getElementById(`post-${postId}`)?.remove();
  } catch (e) {
    alert(e.message || 'Could not delete that post.');
  }
}

// Full tweet-style post card — used by the main feed and profile page.
// The whole card is clickable (opens the post's comments), matching
// Twitter — but clicks on an actual link/button/menu inside it are
// left alone so those keep working normally.
function postCardHtml(p, flash = false) {
  return `
  <div class="pc${flash ? ' flash' : ''}" id="post-${p.id}" onclick="cardClick(event, '${p.id}')">
    <div class="pc-row">
      ${pcAvatarHtml(p.profile)}
      <div class="pc-main">
        <div class="ph">
          ${pcNameHtml(p.profile)}
          <span class="dt">${timeAgo(p.created_at)}</span>
          ${postMenuHtml(p.id, null, p.author_id)}
      </div>
    </div>
  </div>`;
}

// Clicking anywhere on a post card opens its comments — unless the
// click actually landed on a link, button, the "···" menu, or an
// input, all of which handle themselves.
function cardClick(ev, postId) {
  if (ev.target.closest('a, button, input, textarea, .pc-menu-wrap')) return;
  location.href = `thread.html?id=${postId}`;
}

// A random per-browser id used only to stop the same visitor
// double-liking a post. Not a tracking id — it never leaves
// the browser attached to anything but a like row.
function getDeviceId() {
  let id = localStorage.getItem('oc_device');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('oc_device', id);
  }
  return id;
}

// Plain grey silhouette shown when a user has no avatar_url set.
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23E1E8EA'/%3E%3Ccircle cx='20' cy='16' r='7' fill='%23AAB8C2'/%3E%3Cpath d='M6 36c1-9 8-14 14-14s13 5 14 14' fill='%23AAB8C2'/%3E%3C/svg%3E";

function avatarUrl(url) {
  return url || DEFAULT_AVATAR;
}

// Renders the "author" chunk of a post/reply header: avatar + username,
// linking to that user's profile page. `profile` is the joined row from
// `profiles` (author_id -> profiles.*).
function authorHtml(profile) {
  const uname = profile?.username || 'unknown';
  return `<a class="pfl" href="profile.html?u=${encodeURIComponent(uname)}">` +
         `<img class="avatar pfp-sm" src="${esc(avatarUrl(profile?.avatar_url))}" alt="">` +
         `${esc(profile?.display_name || uname)}</a>`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// Renders body text with basic greentext (> lines) support.
// Input is escaped first, so this cannot inject HTML.
function renderBody(body) {
  return esc(body)
    .split('\n')
    .map(line => line.trim().startsWith('&gt;') ? `<span class="gt">${line}</span>` : line)
    .join('\n');
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function shortId(id) {
  return id.slice(0, 8);
}

// Compact number formatting for counts (views, followers, etc): 1.2k, 3.4M
function fmtCount(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

// ── VIEW COUNTS ──
// Each browser only bumps a given post/reply's view count once per
// session (sessionStorage, not localStorage — a fresh visit later
// still counts as a new view). Fire-and-forget: a failed RPC call
// should never block rendering the page.
function seenThisSession(key) {
  const seen = new Set(JSON.parse(sessionStorage.getItem('oc_seen') || '[]'));
  if (seen.has(key)) return true;
  seen.add(key);
  sessionStorage.setItem('oc_seen', JSON.stringify([...seen]));
  return false;
}

function bumpPostView(postId) {
  if (seenThisSession('p:' + postId)) return;
  sb.rpc('increment_post_view', { p_id: postId }).then(({ error }) => {
    if (error) console.warn('view count rpc failed', error);
  });
}

function bumpReplyViews(replyIds) {
  const fresh = replyIds.filter(id => !seenThisSession('r:' + id));
  if (!fresh.length) return;
  sb.rpc('increment_reply_views', { p_ids: fresh }).then(({ error }) => {
    if (error) console.warn('view count rpc failed', error);
  });
}

// ── FOLLOW / UNFOLLOW ──
async function isFollowing(followeeId) {
  if (!currentSession) return false;
  const { data } = await sb.from('follows').select('follower_id')
    .eq('follower_id', currentSession.user.id).eq('followee_id', followeeId).maybeSingle();
  return !!data;
}

async function followUser(followeeId) {
  return sb.from('follows').insert({ follower_id: currentSession.user.id, followee_id: followeeId });
}

async function unfollowUser(followeeId) {
  return sb.from('follows').delete()
    .eq('follower_id', currentSession.user.id).eq('followee_id', followeeId);
}

function mediaTypeFor(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function validateFile(file, errEl) {
  if (!ALLOWED_MIME.includes(file.type)) {
    showErr(errEl, 'Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, MP4, WebM.');
    return false;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showErr(errEl, `File too large. Max ${MAX_FILE_MB}MB.`);
    return false;
  }
  return true;
}

function showErr(el, msg) {
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.display = 'block';
}

function clearErr(el) {
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

// Uploads a file to the media bucket and returns { media_url, media_type }
async function uploadMedia(file) {
  const type = mediaTypeFor(file);
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { media_url: data.publicUrl, media_type: type };
}

function renderMedia(url, type, extraClass = '') {
  if (!url) return '';
  if (type === 'video') {
    return `<div class="pm"><video src="${esc(url)}" controls preload="metadata"></video></div>`;
  }
  return `<div class="pm"><img src="${esc(url)}" class="${extraClass}" onclick="this.classList.toggle('exp')" loading="lazy"></div>`;
}

// ── FILE PREVIEW WIDGET ──
function wireFilePreview(inputId, previewId, errElId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  input.addEventListener('change', () => {
    preview.innerHTML = '';
    const file = input.files[0];
    if (!file) return;
    const errEl = errElId ? document.getElementById(errElId) : null;
    if (!validateFile(file, errEl)) { input.value = ''; return; }
    clearErr(errEl);
    const url = URL.createObjectURL(file);
    const type = mediaTypeFor(file);
    const el = type === 'video'
      ? Object.assign(document.createElement('video'), { src: url, controls: true })
      : Object.assign(document.createElement('img'), { src: url });
    preview.appendChild(el);
    const rm = document.createElement('span');
    rm.className = 'rm-f';
    rm.textContent = 'remove file';
    rm.onclick = () => { input.value = ''; preview.innerHTML = ''; };
    preview.appendChild(document.createElement('br'));
    preview.appendChild(rm);
  });
}

// Renders a compact row for a "follower/following list" modal —
// shared by profile.js. `profile` is a row from public.profiles.
function userRowHtml(profile) {
  const uname = profile?.username || 'unknown';
  return `
  <a class="ulrow" href="profile.html?u=${encodeURIComponent(uname)}">
    <img class="avatar pfp-md" src="${esc(avatarUrl(profile?.avatar_url))}" alt="">
    <div class="ulrow-txt">
      <span class="ulrow-name">${esc(profile?.display_name || uname)}</span>
      <span class="ulrow-handle">@${esc(uname)}</span>
    </div>
  </a>`;
}

// ── REPORT MODAL (shared across board + thread pages) ──
let reportTarget = null; // { postId, replyId }

function openReport(postId, replyId = null) {
  if (typeof requireLogin === 'function' && !requireLogin()) return;
  reportTarget = { postId, replyId };
  document.getElementById('modal-report').classList.add('open');
}
function closeReport() {
  document.getElementById('modal-report').classList.remove('open');
  reportTarget = null;
}
async function submitReport() {
  if (!reportTarget) return;
  const reason = document.getElementById('report-reason').value;
  const details = document.getElementById('report-details').value.trim().slice(0, 500);
  try {
    await sb.from('reports').insert({
      post_id: reportTarget.postId,
      reply_id: reportTarget.replyId,
      reporter_id: currentSession?.user?.id,
      reason,
      details
    });
    closeReport();
    alert('Report submitted. Moderators will review it.');
  } catch (e) {
    alert('Could not submit report: ' + e.message);
  }
}
