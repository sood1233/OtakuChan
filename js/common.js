// ─────────────────────────────────────────────────────────────
// COMMON HELPERS — shared by board.js and thread.js
// ─────────────────────────────────────────────────────────────

// ── URLS — every actual `<a href>` / `location.href = ...` in the
// app is built through the functions below, and they now build the
// pretty Twitter/X-style path directly (/marc, /marc/status/<id>,
// /marc/followers, /messages/marc, ...) instead of the plain
// file+query form. That only resolves correctly on a host that runs
// the `rewrites` in vercel.json (a real Vercel deploy, a Vercel
// Preview URL, or `vercel dev` locally) — see README.md. The
// `legacy*()` versions below build the old file+query form
// (profile.html?u=marc, thread.html?id=<uuid>, ...), which every
// page's own URL-reading code (currentProfileUsername(),
// currentStatusId(), chat.js, followlist.js) still accepts as a
// fallback, so old bookmarks/shared links and non-Vercel hosting
// (GitHub Pages, plain `npx serve .`, opening the file directly)
// keep working — they just won't show the pretty form in the
// address bar.
//
//   profileUrl('marc')                -> /marc
//   postUrl(post)                     -> /marc/status/<id> (or /i/status/<id>
//                                         before we know the author)
//   followListUrl('marc','following') -> /marc/following
//   messagesUrl('marc')               -> /messages/marc
function u_(s) { return encodeURIComponent(s); }

// ── SHARED SCROLL LOCK — the global compose modal, the GIF picker
// (opened *from inside* the compose modal), and the delete-confirm
// modal each need to lock body scroll while open. Previously each
// one set/cleared `document.body.style.overflow` independently, so
// closing an inner modal (e.g. the GIF picker) while an outer one
// (the composer) was still open would blindly clear the lock —
// the page behind would start scrolling/jumping under the still-open
// modal. A simple counter keeps the lock held until every open
// modal has released it.
let _scrollLockCount = 0;
function lockScroll() { _scrollLockCount++; document.body.style.overflow = 'hidden'; }
function unlockScroll() { _scrollLockCount = Math.max(0, _scrollLockCount - 1); if (_scrollLockCount === 0) document.body.style.overflow = ''; }


function profileUrl(username) { return `/${u_(username)}`; }
function postUrl(post, replyId = null) {
  const id = replyId || post?.id;
  const base = post?.profile?.username ? `/${u_(post.profile.username)}/status/${u_(post.id)}` : `/i/status/${u_(post?.id ?? id)}`;
  return replyId ? `${base}#reply-${u_(replyId)}` : base;
}
function postUrlById(id, username = null) {
  return username ? `/${u_(username)}/status/${u_(id)}` : `/i/status/${u_(id)}`;
}
function followListUrl(username, tab) { return `/${u_(username)}/${tab === 'following' ? 'following' : 'followers'}`; }
function messagesUrl(username = null) { return username ? `/messages/${u_(username)}` : '/messages'; }

// Kept as prettyXxx() aliases too — profile.js/thread.js/followlist.js/
// chat.js/common.js's sharePost() already call these names directly
// (for canonicalizing the address bar once a page's own data has
// loaded, and for building the "copy link" URL), so they still work
// unchanged now that the plain names above build the same thing.
function prettyProfileUrl(username) { return profileUrl(username); }
function prettyPostUrl(post, replyId = null) { return postUrl(post, replyId); }
function prettyPostUrlById(id, username = null) { return postUrlById(id, username); }
function prettyFollowListUrl(username, tab) { return followListUrl(username, tab); }
function prettyMessagesUrl(username = null) { return messagesUrl(username); }

// ── LEGACY file+query URLS — the pre-pretty-URL link form. No
// longer used to build any link in the app, but currentProfileUsername()
// still reads the `?u=` param it uses as a fallback (see below), and
// these stay here named/documented in case a host without the Vercel
// rewrites active needs them wired back in as the default.
function legacyProfileUrl(username) { return `profile.html?u=${u_(username)}`; }
function legacyPostUrl(post, replyId = null) {
  const id = replyId || post?.id;
  return `thread.html?id=${u_(post?.id ?? id)}${replyId ? `#reply-${u_(replyId)}` : ''}`;
}
function legacyPostUrlById(id) { return `thread.html?id=${u_(id)}`; }
function legacyFollowListUrl(username, tab) { return `followlist.html?u=${u_(username)}&tab=${tab === 'following' ? 'following' : 'followers'}`; }
function legacyMessagesUrl(username = null) { return username ? `chat.html?u=${u_(username)}` : 'chat.html'; }

// ── STATIC PRETTY-URL UPGRADE — pages with no dynamic id (home,
// search, settings, ...) can't wait for a data load before deciding
// their canonical address, so just swap it in right away. Safe on
// any host: replaceState never touches the network, so this runs
// fine even where the pretty rewrites themselves don't work.
(function upgradeStaticPrettyUrl() {
  const STATIC_PRETTY = {
    'index.html': '/home', '': '/home',
    'notifications.html': '/notifications',
    'bookmarks.html': '/bookmarks',
    'settings.html': '/settings',
    'rules.html': '/rules',
    'login.html': '/login',
    'signup.html': '/signup',
    'search.html': '/search',
  };
  const file = location.pathname.split('/').pop();
  const pretty = STATIC_PRETTY[file];
  // try/catch: some browsers throw on history.replaceState when the
  // page is opened straight off disk (file://) instead of served
  // over http(s) — never let that take the rest of common.js down.
  if (pretty) { try { history.replaceState(null, '', pretty + location.search + location.hash); } catch (e) {} }
})();

// Reads the post/reply id out of the current URL on thread.html,
// whether it arrived as a pretty path (/marc/status/123 or
// /i/status/123) or the legacy query form (thread.html?id=123 — kept
// as a fallback for old bookmarked links and for local dev without
// Vercel's rewrite engine, e.g. plain `npx serve`).
function currentStatusId() {
  const m = location.pathname.match(/\/status\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  return new URLSearchParams(location.search).get('id');
}

// Reads the profile username out of the current URL on profile.html,
// whether it arrived as a pretty path (/marc) or the legacy query
// form (profile.html?u=marc — used whenever the pretty-path rewrite
// isn't active, e.g. no Vercel rewrites configured, a plain static
// host, or local dev via `python -m http.server` / `npx serve`).
//
// Real usernames only ever match /^[a-zA-Z0-9_]{3,20}$/ (enforced at
// signup — see doSignUp() in auth.js), so that's used as the check
// for "is this path segment actually a pretty username" instead of
// just an exclude-list of reserved words. Without it, hitting the
// page at its own literal filename ("/profile.html") — i.e. every
// visit that isn't going through the pretty-URL rewrite — took
// "profile.html" itself as the first path segment, treated it as
// the username to look up, and always failed with "No user found",
// even for your own profile link.
const RESERVED_TOP_LEVEL = new Set(['home','notifications','messages','bookmarks','settings','search','login','signup','rules','i']);
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function currentProfileUsername() {
  const seg = location.pathname.split('/').filter(Boolean)[0];
  if (seg && USERNAME_RE.test(seg) && !RESERVED_TOP_LEVEL.has(seg.toLowerCase())) return decodeURIComponent(seg);
  return new URLSearchParams(location.search).get('u');
}


// ── ICONS + tweet-style post card rendering ──
const ICON = {
  reply:    '<svg viewBox="0 0 24 24"><path d="M12 3.5C7.03 3.5 3 6.96 3 11.2c0 2.35 1.24 4.46 3.2 5.88-.13.98-.55 2.5-1.6 3.9 1.72-.2 3.29-.98 4.4-1.76.94.3 1.96.46 3 .46 4.97 0 9-3.46 9-7.72s-4.03-8.46-9-8.46z"/></svg>',
  heart:    '<svg viewBox="0 0 24 24"><path d="M12 20.8s-6.9-4.2-9.5-8.4C.9 9.5 1.5 6 4.3 4.5c2.2-1.2 4.6-.5 6 1.3L12 8l1.7-2.2c1.4-1.8 3.8-2.5 6-1.3 2.8 1.5 3.4 5 1.8 7.9-2.6 4.2-9.5 8.4-9.5 8.4z"/></svg>',
  views:    '<svg viewBox="0 0 24 24"><path d="M4 21V10M12 21V3M20 21v7"/></svg>',
  share:    '<svg viewBox="0 0 24 24"><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/></svg>',
  menu:     '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1Z"/></svg>',
  repost:   '<svg viewBox="0 0 24 24"><path d="M6 4.5v9a2 2 0 0 0 2 2h10"/><path d="m14.5 12 3.5 3.5-3.5 3.5"/><path d="M18 19.5v-9a2 2 0 0 0-2-2H6"/><path d="m9.5 12-3.5-3.5L9.5 5"/></svg>',
  quote:    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 6c-2.5 1.4-4 3.6-4 6.3 0 2.6 1.7 4.2 3.8 4.2 1.9 0 3.3-1.4 3.3-3.2 0-1.7-1.2-3-2.8-3-.3 0-.6 0-.8.1.2-1.6 1.5-3.2 3.3-4.1L7 6Zm9 0c-2.5 1.4-4 3.6-4 6.3 0 2.6 1.7 4.2 3.8 4.2 1.9 0 3.3-1.4 3.3-3.2 0-1.7-1.2-3-2.8-3-.3 0-.6 0-.8.1.2-1.6 1.5-3.2 3.3-4.1L16 6Z"/></svg>'
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
  doc:      '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h8"/></svg>',
  dots:     '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>'
};

// ── THEME — Default (light) / Dim / Lights out (dark), applied via
// data-theme on <html>. A tiny inline script in every page's <head>
// reads THEME_KEY before first paint (no flash); this just gives
// settings.js (and anything else) a shared way to change/read it. ──
const THEME_KEY = 'oc-theme';
function applyTheme(theme) {
  if (theme && theme !== 'light') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_KEY, theme || 'light'); } catch (e) {}
}
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; }
}

// ── ACCENT COLOR — same idea as THEME above, but swaps the app's one
// accent color (buttons/links/active states) instead of the surface
// colors. Applied via data-accent on <html>; "blue" is the default and
// needs no attribute (matches the :root values in style.css). ──
const ACCENT_KEY = 'oc-accent';
const ACCENT_OPTIONS = [
  { id: 'blue',   label: 'Blue'   },
  { id: 'red',    label: 'Red'    },
  { id: 'green',  label: 'Green'  },
  { id: 'purple', label: 'Purple' },
  { id: 'orange', label: 'Orange' }
];
function applyAccent(accent) {
  if (accent && accent !== 'blue') document.documentElement.setAttribute('data-accent', accent);
  else document.documentElement.removeAttribute('data-accent');
  try { localStorage.setItem(ACCENT_KEY, accent || 'blue'); } catch (e) {}
}
function getAccent() {
  try { return localStorage.getItem(ACCENT_KEY) || 'blue'; } catch (e) { return 'blue'; }
}

let unreadNotifCount = 0;
let unreadChatCount = 0;

// Maps the current URL (pretty or legacy .html) to one of the fixed
// nav-item keys below, so highlighting "which tab is active" doesn't
// break now that most pages live at a clean path instead of a
// filename. Checked in order; first match wins.
function currentNavKey() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/home' || path.endsWith('/index.html')) return 'home';
  if (path === '/search' || path.endsWith('/search.html')) return 'search';
  if (path === '/notifications' || path.endsWith('/notifications.html')) return 'notifications';
  if (path === '/messages' || path.startsWith('/messages/') || path.endsWith('/chat.html')) return 'messages';
  if (path === '/bookmarks' || path.endsWith('/bookmarks.html')) return 'bookmarks';
  if (path === '/settings' || path.endsWith('/settings.html')) return 'settings';
  if (path === '/rules' || path.endsWith('/rules.html')) return 'rules';
  if (currentSession && currentProfile && path.toLowerCase() === profileUrl(currentProfile.username).toLowerCase()) return 'profile';
  return null;
}

function renderSideNav() {
  const el = document.getElementById('side-nav');
  if (!el) return;
  const ownHref = (currentSession && currentProfile) ? profileUrl(currentProfile.username) : 'login.html';
  const notifBadge = unreadNotifCount > 0 ? `<span class="navbadge">${unreadNotifCount > 99 ? '99+' : unreadNotifCount}</span>` : '';
  const chatBadge = unreadChatCount > 0 ? `<span class="navbadge">${unreadChatCount > 20 ? '20+' : unreadChatCount}</span>` : '';
  const here = currentNavKey();
  const item = (href, icon, label, key, extra = '') => {
    return `<a href="${href}"${key === here ? ' class="cur"' : ''}><span class="navicon">${icon}${extra}</span><span class="navlabel">${label}</span></a>`;
  };
  const morePage = here === 'settings' || here === 'rules';
  const postBtn = currentSession
    ? `<button class="sidebar-post-btn" onclick="mobileCompose();return false;">Post</button>`
    : `<a class="sidebar-post-btn" href="signup.html">Post</a>`;
  el.innerHTML =
    item('/home', NAV_ICON.home, 'Home', 'home') +
    item('/search', NAV_ICON.search, 'Explore', 'search') +
    item('/notifications', NAV_ICON.bell, 'Notifications', 'notifications', notifBadge) +
    item('/messages', NAV_ICON.chat, 'Chat', 'messages', chatBadge) +
    item('/bookmarks', NAV_ICON.bookmark, 'Bookmarks', 'bookmarks') +
    item(ownHref, NAV_ICON.user, 'Profile', 'profile') +
    `<div class="acct" id="more-wrap">
       <button class="navmore-btn"${morePage ? ' style="font-weight:800;"' : ''} onclick="toggleMoreMenu();return false;">
         <span class="navicon">${NAV_ICON.dots}</span><span class="navlabel">More</span>
       </button>
       <div class="acct-menu navmore-menu" id="more-menu">
         <a href="settings.html">${NAV_ICON.gear}Settings</a>
         <a href="rules.html">${NAV_ICON.doc}Rules</a>
       </div>
     </div>` +
    postBtn;
}

function toggleMoreMenu() { document.getElementById('more-wrap')?.classList.toggle('open'); }

// ── MOBILE APP CHROME — top bar, bottom tab bar, compose FAB, and
// slide-out drawer, built fresh into #m-chrome (created once, appended
// to <body>) on every page. CSS keeps all of this display:none above
// the mobile breakpoint, so it costs nothing on desktop. Called from
// auth.js alongside renderSideNav() any time session/profile/unread
// state changes, so the avatar, counts, and badge never go stale. ──
const PLUS_ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></svg>';

function mchrome() {
  let el = document.getElementById('m-chrome');
  if (!el) { el = document.createElement('div'); el.id = 'm-chrome'; document.body.appendChild(el); }
  return el;
}

function renderMobileChrome() {
  const el = mchrome();
  const here = currentNavKey();
  const cur = key => key === here ? ' cur' : '';
  const badge = unreadNotifCount > 0 ? `<span class="navbadge">${unreadNotifCount > 99 ? '99+' : unreadNotifCount}</span>` : '';
  const chatBadge = unreadChatCount > 0 ? `<span class="navbadge">${unreadChatCount > 20 ? '20+' : unreadChatCount}</span>` : '';
  const ownHref = (currentSession && currentProfile) ? profileUrl(currentProfile.username) : 'login.html';
  const avatar = currentSession ? avatarUrl(currentProfile?.avatar_url) : DEFAULT_AVATAR;

  // On the chat page the floating "+" FAB just detours to the board's
  // composer, which reads as a broken/unrelated button floating over
  // chat's own message composer — so skip it there in favor of chat's
  // own send controls. (The top-right "Post"/"Log in" pill has been
  // removed entirely — posting on mobile goes through the "+" FAB or
  // the drawer's Sign up/Log in CTAs, and the logo now sits centered
  // in the topbar instead of being pushed off-center by that pill.)
  const onChatPage = here === 'messages';

  el.innerHTML = `
    <div id="m-topbar">
      <button class="m-avatar-btn" onclick="openMobileDrawer();return false;" aria-label="Open menu">
        <img class="avatar" src="${esc(avatar)}" alt="">
      </button>
      <a class="m-logo" href="index.html">
        <svg class="onigiri" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 2C15 2 21 13 21 17.5C21 20 17 21.5 12 21.5C7 21.5 3 20 3 17.5C3 13 9 2 12 2Z" fill="#0EA5E9"/>
          <rect x="9.3" y="15" width="5.4" height="6" rx="1.4" fill="#fff"/>
        </svg>
      </a>
    </div>

    <div id="m-tabbar">
      <a class="${cur('home')}" href="index.html">${NAV_ICON.home}</a>
      <a class="${cur('search')}" href="search.html">${NAV_ICON.search}</a>
      <a class="${cur('bookmarks')}" href="bookmarks.html">${NAV_ICON.bookmark}</a>
      <a class="${cur('notifications')}" href="notifications.html">${NAV_ICON.bell}${badge}</a>
      <a class="${cur('messages')}" href="chat.html">${NAV_ICON.chat}${chatBadge}</a>
    </div>

    ${currentSession && !onChatPage ? `<button id="m-fab" onclick="mobileCompose();return false;" aria-label="Post">${PLUS_ICON}</button>` : ''}

    <div class="m-drawer-bg" id="m-drawer-bg" onclick="if(event.target===this)closeMobileDrawer();">
      <div class="m-drawer">
        ${currentSession ? `
          <a href="${ownHref}"><img class="avatar m-drawer-avatar" src="${esc(avatar)}" alt=""></a>
          <a href="${ownHref}" style="text-decoration:none;">
            <span class="m-drawer-name">${esc(currentProfile?.display_name || currentProfile?.username || 'You')}</span>
            <span class="m-drawer-handle">@${esc(currentProfile?.username || '')}</span>
          </a>
          <div class="m-drawer-stats">
            <a href="${currentProfile ? followListUrl(currentProfile.username, 'following') : '#'}"><b>${fmtCount(currentProfile?.following_count)}</b> Following</a>
            <a href="${currentProfile ? followListUrl(currentProfile.username, 'followers') : '#'}"><b>${fmtCount(currentProfile?.followers_count)}</b> Followers</a>
          </div>
          <hr>
          <div class="m-drawer-menu">
            <a href="${ownHref}">${NAV_ICON.user}Profile</a>
            <a href="bookmarks.html">${NAV_ICON.bookmark}Bookmarks</a>
            <a href="editprofile.html">${NAV_ICON.doc}Edit profile</a>
            <a href="settings.html">${NAV_ICON.gear}Settings and privacy</a>
            <a href="rules.html">${NAV_ICON.doc}Rules</a>
          </div>
          <hr>
          <button onclick="closeMobileDrawer();logOut();">Log out</button>
        ` : `
          <img class="avatar m-drawer-avatar" src="${DEFAULT_AVATAR}" alt="">
          <span class="m-drawer-name">Welcome to Otakuchan</span>
          <span class="m-drawer-handle">Log in to follow, post, and reply.</span>
          <div class="m-drawer-menu" style="margin-top:8px;">
            <a href="rules.html">${NAV_ICON.doc}Rules</a>
          </div>
          <div class="m-drawer-cta">
            <a class="cta-primary" href="signup.html">Sign up</a>
            <a class="cta-ghost" href="login.html">Log in</a>
          </div>
        `}
      </div>
    </div>`;
}

function openMobileDrawer() { document.getElementById('m-drawer-bg')?.classList.add('open'); }
function closeMobileDrawer() { document.getElementById('m-drawer-bg')?.classList.remove('open'); }

// ─────────────────────────────────────────────────────────────
// GLOBAL COMPOSE MODAL — the sidebar "Post" button, mobile top-bar
// "Post" pill, and mobile "+" FAB all open this, same as tapping
// the Post button in the real X app pops a compose modal over
// whatever page you're already on, instead of navigating away.
// Built once into <body> here (same lazy-inject pattern as
// mchrome()) so it works on every page, not just the board — no
// per-page HTML needed, unlike the quote-post modal.
// ─────────────────────────────────────────────────────────────
function gcModalEl() {
  let el = document.getElementById('gc-modal-bg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gc-modal-bg';
  el.className = 'modal-bg';
  el.addEventListener('click', e => { if (e.target === el) closeGlobalCompose(); });
  el.innerHTML = `
    <div class="modal gc-modal">
      <a class="modal-close" href="#" onclick="closeGlobalCompose();return false;">&#10005;</a>
      <div class="errmsg" id="gc-err" style="display:none;margin:0 16px 8px;"></div>
      <div class="pf-row gc-row">
        <span class="pf-avatar" id="gc-avatar"></span>
        <div class="pf-col">
          <textarea id="gc-body" maxlength="4000" placeholder="What's happening?"></textarea>
          <div id="gc-fp" class="fp"></div>
          <div class="cx-poll" id="gc-poll-box" hidden>
            <div class="cx-poll-opts" id="gc-poll-opts">
              <input type="text" class="cx-poll-opt" placeholder="Choice 1" maxlength="25">
              <input type="text" class="cx-poll-opt" placeholder="Choice 2" maxlength="25">
            </div>
            <div class="cx-poll-row">
              <button type="button" class="cx-poll-add" onclick="addPollOption('gc');return false;">+ Add option</button>
              <select id="gc-poll-dur"><option value="1">1 day</option><option value="3" selected>3 days</option><option value="7">7 days</option></select>
              <button type="button" class="cx-poll-remove" title="Remove poll" onclick="removePoll('gc');return false;">&#10005;</button>
            </div>
          </div>
          <div class="cx-sched" id="gc-sched-box" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>
            <input type="datetime-local" id="gc-sched-input">
            <button type="button" class="cx-sched-remove" title="Remove" onclick="removeSchedule('gc');return false;">&#10005;</button>
          </div>
        </div>
      </div>
      <div class="gc-reply-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.5 2"/></svg>
        Everyone can reply
      </div>
      <div class="pf-toolbar gc-toolbar">
        <div class="pf-icons">
          <button type="button" class="pf-ic" title="Media" onclick="document.getElementById('gc-file').click();return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="m4 17 5-5 3.5 3.5L17 11l3 3"/></svg>
          </button>
          <button type="button" class="pf-ic" title="GIF" onclick="openGifPicker('gc');return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9.5v5M13.5 9.5h-2.2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1H13v-2h-1M16 14.5v-5h2.4M16 12h1.8"/></svg>
          </button>
          <button type="button" class="pf-ic" title="Poll" onclick="togglePollBuilder('gc');return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15v2M12 11v6M17 8v10"/></svg>
          </button>
          <button type="button" class="pf-ic" title="Emoji" onclick="toggleEmojiPicker('gc', this);return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8 14.5c1 1.2 2.3 1.8 4 1.8s3-.6 4-1.8"/></svg>
          </button>
          <button type="button" class="pf-ic" title="Schedule" onclick="toggleScheduleBuilder('gc');return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h1M12 13.5h1M16 13.5h1M8 17h1M12 17h1"/></svg>
          </button>
          <button type="button" class="pf-ic" title="Location" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.4"/></svg>
          </button>
          <input type="file" id="gc-file" accept="image/*,video/*" style="display:none;">
        </div>
        <input type="submit" id="gc-btn" class="pf-btn" value="Post" onclick="submitGlobalCompose();return false;" disabled>
      </div>
      <span id="gc-st" class="gc-status"></span>
    </div>`;
  document.body.appendChild(el);

  wireFilePreview('gc-file', 'gc-fp', 'gc-err');
  const gcBody = document.getElementById('gc-body');
  gcBody.addEventListener('input', () => {
    updateGcBtnState();
    gcBody.style.height = 'auto';
    gcBody.style.height = Math.max(64, gcBody.scrollHeight) + 'px';
  });
  gcBody.addEventListener('keydown', e => { if (e.key === 'Escape') closeGlobalCompose(); });
  return el;
}

function updateGcBtnState() {
  const bodyEl = document.getElementById('gc-body');
  const btn = document.getElementById('gc-btn');
  if (!bodyEl || !btn) return;
  btn.disabled = bodyEl.value.trim().length === 0;
}

// The FAB, the mobile top-bar "Post" pill, and the desktop sidebar
// "Post" button all call this — same button, same modal, everywhere,
// matching how the real X app's Post button behaves on every screen.
function mobileCompose() { openGlobalCompose(); }

function openGlobalCompose() {
  if (!requireLogin()) return;
  const el = gcModalEl();
  if (el.classList.contains('open')) return; // already open — ignore a double tap of the FAB/pill
  const avEl = document.getElementById('gc-avatar');
  if (avEl) avEl.innerHTML = `<img src="${esc(avatarUrl(currentProfile?.avatar_url))}" alt="">`;
  el.classList.add('open');
  lockScroll();
  setTimeout(() => document.getElementById('gc-body')?.focus(), 50);
}

function closeGlobalCompose() {
  const el = document.getElementById('gc-modal-bg');
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  unlockScroll();
}

async function submitGlobalCompose() {
  if (!requireLogin()) return;
  const bodyEl = document.getElementById('gc-body');
  const fileEl = document.getElementById('gc-file');
  const btn    = document.getElementById('gc-btn');
  const stEl   = document.getElementById('gc-st');
  const errEl  = document.getElementById('gc-err');
  clearErr(errEl);

  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, "Post can't be empty."); return; }
  if (body.length > 4000) { showErr(errEl, 'Post too long (max 4000 chars).'); return; }
  if (!validatePollAndSchedule('gc', errEl)) return;

  btn.disabled = true;
  stEl.textContent = 'Posting…';
  try {
    let media_url = null, media_type = null;
    const gifUrl = composeExtras.gc?.gifUrl;
    const file = fileEl.files[0];
    if (gifUrl) {
      media_url = gifUrl; media_type = 'gif';
    } else if (file) {
      if (!validateFile(file, errEl)) { btn.disabled = false; stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading file…';
      ({ media_url, media_type } = await uploadMedia(file));
    }
    const poll = collectPoll('gc');
    const scheduled_at = collectSchedule('gc');
    const { data, error } = await sb.from('posts').insert({
      author_id: currentSession.user.id,
      body, media_url, media_type,
      poll_options: poll?.poll_options || null,
      poll_ends_at: poll?.poll_ends_at || null,
      scheduled_at
    }).select('*, profile:profiles(username,display_name,avatar_url)').single();
    if (error) throw error;

    bodyEl.value = ''; bodyEl.style.height = '';
    fileEl.value = ''; document.getElementById('gc-fp').innerHTML = '';
    resetComposeExtras('gc');
    stEl.textContent = '';
    closeGlobalCompose();

    if (scheduled_at) {
      alert(`Post scheduled for ${new Date(scheduled_at).toLocaleString()}.`);
      return;
    }
    // Already on the home feed showing "For you"? Drop it straight
    // in, same as posting from the inline composer would. Otherwise
    // (profile/search/chat/thread/anywhere else) jump to the new
    // post so posting from the modal is never a silent no-op.
    if (typeof addPostToFeed === 'function' && document.getElementById('feed-posts')
        && (typeof activeTab === 'undefined' || activeTab === 'foryou')) {
      addPostToFeed(data, true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      location.href = postUrlById(data.id, currentProfile?.username);
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post.');
    stEl.textContent = '';
  } finally {
    btn.disabled = false;
    updateGcBtnState();
  }
}

document.addEventListener('DOMContentLoaded', renderMobileChrome);


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

// ── WHO TO FOLLOW — right-column suggestion box (index.html, thread.html,
// etc.). Self-contained: only runs on pages that actually have a
// #who-to-follow container, same pattern renderSideNav() uses, so no
// other page/script needs to know this exists. Waits on authReady so it
// knows who to exclude (yourself + people already followed). ──
async function renderWhoToFollow() {
  const box = document.getElementById('who-to-follow');
  if (!box) return;
  box.innerHTML = `<div class="t-lbl">Who to follow</div><div class="no-t">Loading&hellip;</div>`;

  const excludeIds = new Set(currentSession ? [currentSession.user.id] : []);
  if (currentSession) {
    const { data: follows } = await sb.from('follows').select('followee_id')
      .eq('follower_id', currentSession.user.id);
    (follows || []).forEach(f => excludeIds.add(f.followee_id));
  }

  // Pull a small pool of recently-active accounts and filter client-side —
  // simplest thing that works for a suggestions box this size, no RPC needed.
  const { data, error } = await sb.from('profiles')
    .select('id,username,display_name,avatar_url')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data) { box.innerHTML = ''; return; }
  const suggestions = data.filter(p => !excludeIds.has(p.id)).slice(0, 3);
  if (!suggestions.length) { box.innerHTML = ''; return; }

  box.innerHTML = `<div class="t-lbl">Who to follow</div>` +
    suggestions.map(whoRowHtml).join('') +
    `<a class="show-more" href="search.html">Show more</a>`;
}

function whoRowHtml(profile) {
  const uname = profile.username || 'unknown';
  return `
    <div class="who-row">
      <a href="${profileUrl(uname)}">
        <img class="avatar pfp-md" src="${esc(avatarUrl(profile.avatar_url))}" alt="">
      </a>
      <a class="who-row-txt" href="${profileUrl(uname)}">
        <span class="who-row-name">${esc(profile.display_name || uname)}</span>
        <span class="who-row-handle">@${esc(uname)}</span>
      </a>
      <button class="who-follow-btn" onclick="whoToggleFollow('${profile.id}', this)">Follow</button>
    </div>`;
}

async function whoToggleFollow(userId, btn) {
  if (!requireLogin()) return;
  btn.disabled = true;
  try {
    const { error } = await followUser(userId);
    if (error) throw error;
    // Twitter's own sidebar just drops the card once you've followed —
    // simplest confirmation there is.
    btn.closest('.who-row')?.remove();
  } catch (e) {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('who-to-follow')) return;
  if (typeof authReady !== 'undefined') await authReady;
  renderWhoToFollow();
});

let liked = new Set(JSON.parse(localStorage.getItem('oc_liked') || '[]'));

function setLikeUiState(btn, isLiked, delta) {
  btn.classList.toggle('liked', isLiked);
  const newCount = Math.max((parseInt(btn.dataset.count, 10) || 0) + delta, 0);
  btn.dataset.count = newCount;
  const lc = btn.querySelector('.lc');
  if (lc) lc.textContent = fmtCount(newCount);
}

// Toggles like/unlike — mirrors toggleBookmark's insert-or-delete pattern.
async function toggleLike(postId, btn) {
  if (!requireLogin()) return;
  const isLiked = liked.has(postId);
  btn.disabled = true;
  try {
    if (isLiked) {
      const { error } = await sb.from('likes').delete()
        .eq('post_id', postId).eq('user_id', currentSession.user.id);
      if (error) throw error;
      liked.delete(postId);
      setLikeUiState(btn, false, -1);
    } else {
      const { error } = await sb.from('likes').insert({ post_id: postId, user_id: currentSession.user.id });
      if (error) {
        if (error.code === '23505') { // unique violation — already liked elsewhere
          liked.add(postId);
          setLikeUiState(btn, true, 0);
        } else throw error;
        return;
      }
      liked.add(postId);
      setLikeUiState(btn, true, 1);
    }
    localStorage.setItem('oc_liked', JSON.stringify([...liked]));
  } catch (e) {
    alert(e.message || 'Could not update like.');
  } finally {
    btn.disabled = false;
  }
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
    // Only present on the detail-page action row (opDetailActionsHtml)
    // — the compact feed/reply row has no visible bookmark count.
    const bc = btn.querySelector('.bc');
    if (bc) {
      const delta = isBookmarked ? -1 : 1;
      const n = Math.max((parseInt(btn.dataset.count, 10) || 0) + delta, 0);
      btn.dataset.count = n;
      bc.textContent = fmtCount(n);
    }
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

// ── REPOSTS ── (mirrors the bookmarks pattern above: private-ish per
// user "did I repost this" state, fetched fresh whenever a page is
// about to render a list of posts.)
let reposted = new Set();

async function ensureRepostsLoaded() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { reposted = new Set(); return; }
  const { data } = await sb.from('reposts').select('post_id').eq('user_id', session.user.id);
  reposted = new Set((data || []).map(r => r.post_id));
}

// Every post rendered as a card is stashed here by id, so the Quote
// modal (opened from a plain onclick with just the post id) can pull
// up the author/body/media to embed in the preview without a refetch.
const postCache = {};
function cachePost(p) { if (p && p.id) postCache[p.id] = p; }

// Opens/closes the small "Repost / Quote" dropdown anchored under the
// repost icon — same interaction pattern as the "···" pc-menu-wrap.
function toggleRepostMenu(id, ev) {
  if (ev) ev.stopPropagation();
  const wrap = document.getElementById(`rpmenu-${id}`);
  if (!wrap) return;
  const willOpen = !wrap.classList.contains('open');
  document.querySelectorAll('.rp-menu-wrap.open, .pc-menu-wrap.open').forEach(w => w.classList.remove('open'));
  if (willOpen) wrap.classList.add('open');
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.rp-menu-wrap.open').forEach(w => {
    if (!w.contains(e.target)) w.classList.remove('open');
  });
});

// Bumps the little repost count label + the reply-count-style icon
// state (green when you've reposted it) without a full card re-render.
function setRepostUiState(postId, isReposted, delta) {
  const wrap = document.getElementById(`rpmenu-${postId}`);
  if (!wrap) return;
  const btn = wrap.querySelector('.act.repost');
  const label = btn?.querySelector('.act-label');
  btn?.classList.toggle('reposted', isReposted);
  if (label) {
    const n = Math.max((parseInt(btn.dataset.count, 10) || 0) + delta, 0);
    btn.dataset.count = n;
    label.textContent = fmtCount(n);
  }
  const undoBtn = wrap.querySelector('.rp-undo');
  const doBtn = wrap.querySelector('.rp-do');
  if (undoBtn) undoBtn.style.display = isReposted ? '' : 'none';
  if (doBtn) doBtn.style.display = isReposted ? 'none' : '';
}

async function doRepost(postId, ev) {
  if (ev) ev.stopPropagation();
  if (!requireLogin()) return;
  toggleRepostMenu(postId);
  if (reposted.has(postId)) return;
  const { error } = await sb.from('reposts').insert({ post_id: postId, user_id: currentSession.user.id });
  if (error) {
    if (error.code === '23505') { reposted.add(postId); setRepostUiState(postId, true, 0); }
    else alert(error.message || 'Could not repost.');
    return;
  }
  reposted.add(postId);
  setRepostUiState(postId, true, 1);
}

async function undoRepost(postId, ev) {
  if (ev) ev.stopPropagation();
  if (!requireLogin()) return;
  toggleRepostMenu(postId);
  if (!reposted.has(postId)) return;
  const { error } = await sb.from('reposts').delete()
    .eq('post_id', postId).eq('user_id', currentSession.user.id);
  if (error) { alert(error.message || 'Could not undo repost.'); return; }
  reposted.delete(postId);
  setRepostUiState(postId, false, -1);
}

// The repost icon + count, plus its "Repost / Quote" dropdown. Kept
// separate from postActionsHtml's other buttons since it needs two
// distinct actions behind one icon, same as Twitter's retweet button.
function repostMenuHtml(p) {
  const isReposted = reposted.has(p.id);
  return `
    <div class="rp-menu-wrap" id="rpmenu-${p.id}">
      <button class="act repost${isReposted ? ' reposted' : ''}" data-count="${p.repost_count || 0}" onclick="toggleRepostMenu('${p.id}', event)">
        ${ICON.repost}<span class="act-label">${fmtCount(p.repost_count)}</span>
      </button>
      <div class="rp-menu-dd">
        <button class="rp-do" style="${isReposted ? 'display:none;' : ''}" onclick="doRepost('${p.id}', event)">${ICON.repost} Repost</button>
        <button class="rp-undo" style="${isReposted ? '' : 'display:none;'}" onclick="undoRepost('${p.id}', event)">${ICON.repost} Undo Repost</button>
        <button onclick="openQuoteModal('${p.id}', event)">${ICON.quote} Quote</button>
      </div>
    </div>`;
}

// ── QUOTE POSTS ── (a quote is just a normal post row with quote_of
// set — see submitQuote() below — so it shows up in feeds/profiles
// through the exact same postCardHtml() path as any other post.)
let quotingPostId = null;

function quotedPostHtml(qp) {
  if (!qp || qp.is_deleted) return `<div class="qp-embed-gone">Original post is no longer available.</div>`;
  return `
  <div class="qp-embed" onclick="event.stopPropagation();location.href='${postUrl(qp)}'">
    <div class="ph">${pcNameHtml(qp.profile)}<span class="dt">${timeAgo(qp.created_at)}</span></div>
    <div class="pb">${renderBody((qp.body || '').slice(0, 280))}</div>
    ${renderMedia(qp.media_url, qp.media_type)}
  </div>`;
}

// Batch-fetches the posts referenced by other posts' quote_of column
// and attaches them as p.quoted, for every post in the given array
// that has quote_of set. Deliberately a plain `.in('id', ids)` query
// instead of a PostgREST self-referencing embed (`posts!quote_of(...)`)
// — that embed needs PostgREST's schema cache to have already picked
// up the quote_of foreign key, which right after running the SQL
// migration (or if it hasn't been run yet) it may not have, and an
// embed that can't resolve fails the *entire* query it's attached to
// — breaking the whole feed, not just the quote-post cards. A plain
// id lookup can't do that: worst case, posts with a quote_of that
// doesn't exist yet just render without their embed.
async function attachQuotedPosts(posts) {
  const list = Array.isArray(posts) ? posts : [posts];
  const ids = [...new Set(list.map(p => p?.quote_of).filter(Boolean))];
  if (!ids.length) return;
  try {
    const { data } = await sb.from('posts')
      .select('id,body,media_url,media_type,created_at,is_deleted,author_id,profile:profiles(username,display_name,avatar_url)')
      .in('id', ids);
    const byId = Object.fromEntries((data || []).map(qp => [qp.id, qp]));
    list.forEach(p => { if (p?.quote_of) p.quoted = byId[p.quote_of] || null; });
  } catch (e) {
    console.warn('Could not load quoted posts (has supabase/quotes_and_reposts.sql been run yet?)', e);
  }
}

function openQuoteModal(postId, ev) {
  if (ev) ev.stopPropagation();
  if (!requireLogin()) return;
  const p = postCache[postId];
  quotingPostId = postId;
  const modal = document.getElementById('modal-quote');
  if (!modal) return; // page doesn't include the quote modal markup
  document.getElementById('qm-body').value = '';
  document.getElementById('qm-err').style.display = 'none';
  document.getElementById('qm-preview').innerHTML = p ? quotedPostHtml(p) : '<div class="qp-embed-gone">Loading…</div>';
  const avEl = document.getElementById('qm-avatar');
  if (avEl) avEl.innerHTML = `<img src="${esc(avatarUrl(currentProfile?.avatar_url))}" alt="">`;
  modal.classList.add('open');
  document.getElementById('qm-body').focus();
}
function closeQuoteModal() {
  document.getElementById('modal-quote')?.classList.remove('open');
  quotingPostId = null;
}

async function submitQuote() {
  if (!quotingPostId || !requireLogin()) return;
  const bodyEl = document.getElementById('qm-body');
  const errEl  = document.getElementById('qm-err');
  const btn    = document.getElementById('qm-btn');
  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, 'Add a comment before posting.'); return; }
  if (body.length > 4000) { showErr(errEl, 'Comment too long (max 4000 chars).'); return; }
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('posts').insert({
      author_id: currentSession.user.id,
      body,
      quote_of: quotingPostId
    }).select('*, profile:profiles(username,display_name,avatar_url)').single();
    if (error) throw error;
    // We already have the quoted post in postCache (it's whatever card
    // the Quote button was clicked from) — reuse it directly instead of
    // an extra fetch. Falls back to attachQuotedPosts() if it's missing.
    if (postCache[quotingPostId]) data.quoted = postCache[quotingPostId];
    else await attachQuotedPosts([data]);
    cachePost(data);
    closeQuoteModal();
    if (typeof addPostToFeed === 'function' && document.getElementById('feed-posts')) {
      addPostToFeed(data, true);
    } else {
      // Not on the main feed (profile/search/bookmarks/thread page) —
      // jump to the new quote post itself so posting it is never a
      // silent no-op.
      location.href = postUrlById(data.id, currentProfile?.username);
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post quote.');
  } finally {
    btn.disabled = false;
  }
}

// Copies a thread's permalink to the clipboard — the reference design's
// share icon, wired to something real instead of a decorative no-op.
function sharePost(id, btn) {
  const url = `${location.origin}${prettyPostUrlById(id, postCache?.[id]?.profile?.username)}`;
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
  return `<a class="pc-avatar-lnk" href="${profileUrl(uname)}">` +
         `<img class="avatar pc-avatar ${sizeClass}" src="${esc(avatarUrl(profile?.avatar_url))}" alt=""></a>`;
}
function pcNameHtml(profile) {
  const uname = profile?.username || 'unknown';
  return `<a class="nm" href="${profileUrl(uname)}">${esc(profile?.display_name || uname)}</a>` +
         `<span class="pc-handle">@${esc(uname)}</span>`;
}

// Renders the standard action row: reply / like / views / share, plus the
// "···" menu with Report — matches the reference layout's icon+count row.
// `replyAttr` is the href or onclick to use for the reply icon (feed cards
// link out to the thread; the thread's own OP scrolls to the reply box).
function postActionsHtml(p, { replyHref = null, replyOnclick = null, replyCount = null, bookmarkable = true, repostable = true } = {}) {
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
      ${repostable ? repostMenuHtml(p) : ''}
      <button class="act like${isLiked ? ' liked' : ''}" data-count="${p.like_count || 0}" onclick="toggleLike('${p.id}', this)">${ICON.heart}<span class="lc act-label">${fmtCount(p.like_count)}</span></button>
      <span class="act views" title="${p.view_count || 0} views">${ICON.views}<span class="act-label">${fmtCount(p.view_count)}</span></span>
      <button class="act share" onclick="sharePost('${p.id}', this)">${ICON.share}<span class="act-label">Share</span></button>
      ${bookmarkable ? `<button class="act bookmark${isBookmarked ? ' bookmarked' : ''}" onclick="toggleBookmark('${p.id}', this)">${ICON.bookmark}</button>` : ''}
    </div>`;
}

// The post-detail action row (thread.html's OP) — same reply/repost/
// like/bookmark/share buttons as postActionsHtml above (same classes,
// same onclick handlers, so toggleLike/toggleBookmark/the repost menu
// all keep working unmodified), just laid out full-width with bigger
// icons and a visible bookmark count, to match the reference
// post-detail screen instead of the feed's compact row. `replyOnclick`
// scrolls to/focuses the reply composer below, same as the compact
// row's OP variant.
function opDetailActionsHtml(p, replyOnclick) {
  const isLiked = liked.has(p.id);
  const isBookmarked = bookmarked.has(p.id);
  return `
    <div class="op-stats">
      <button class="act reply" onclick="${esc(replyOnclick)}">${ICON.reply}<span class="act-label">${fmtCount(p.reply_count || 0)}</span></button>
      ${repostMenuHtml(p)}
      <button class="act like${isLiked ? ' liked' : ''}" data-count="${p.like_count || 0}" onclick="toggleLike('${p.id}', this)">${ICON.heart}<span class="lc act-label">${fmtCount(p.like_count)}</span></button>
      <button class="act bookmark${isBookmarked ? ' bookmarked' : ''}" data-count="${p.bookmark_count || 0}" onclick="toggleBookmark('${p.id}', this)">${ICON.bookmark}<span class="bc act-label">${fmtCount(p.bookmark_count || 0)}</span></button>
      <button class="act share" onclick="sharePost('${p.id}', this)">${ICON.share}</button>
    </div>`;
}

// The "···" header menu (Report, and Delete for your own posts/replies).
// `replyId` set only for reply-card menus. `authorId` is the author_id
// of whichever row this menu belongs to (the post, or the reply when
// replyId is set) — used to show Delete only when it's the logged-in
// user's own row. Ownership no longer excludes replies: a reply you
// own gets a working Delete button too, deleting the reply itself
// (not the parent post).
function postMenuHtml(postId, replyId = null, authorId = null) {
  const target = replyId ? `'${postId}','${replyId}'` : `'${postId}'`;
  const isOwner = currentSession && authorId && currentSession.user.id === authorId;
  const deleteArgs = replyId ? `'${replyId}', event, true` : `'${postId}', event`;
  return `
    <div class="pc-menu-wrap" id="pmenu-${replyId || postId}">
      <button class="pc-menu-btn" onclick="togglePostMenu('${replyId || postId}', event)">${ICON.menu}</button>
      <div class="pc-menu-dd">
        ${isOwner ? `<button class="pc-menu-danger" onclick="deletePost(${deleteArgs})">Delete</button>` : ''}
        <button onclick="openReport(${target})">Report</button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// DELETE CONFIRMATION MODAL — tapping "Delete" in a post's "···"
// menu no longer fires the browser's plain confirm() popup; it opens
// this modal instead (same lazy-build-into-<body> pattern as
// gcModalEl()/gifModalEl(), so it works from any page with no
// per-page HTML needed). Matches the real "delete post?" dialog
// pattern: a clear warning, a filled red destructive action on top,
// a plain Cancel underneath — destructive action is never the
// visually-quiet option.
// ─────────────────────────────────────────────────────────────
let pendingDeletePostId = null;
let pendingDeleteIsReply = false;

function dcModalEl() {
  let el = document.getElementById('dc-modal-bg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dc-modal-bg';
  el.className = 'modal-bg';
  el.addEventListener('click', e => { if (e.target === el) closeDeleteConfirm(); });
  el.innerHTML = `
    <div class="modal dc-modal">
      <h2 class="dc-title">Delete post?</h2>
      <p class="dc-desc">This can't be undone. It will be removed from your profile, the timeline of anyone who follows you, and search results.</p>
      <div class="dc-actions">
        <button type="button" class="dc-btn dc-btn-delete" id="dc-confirm-btn" onclick="confirmDeletePost()">Delete</button>
        <button type="button" class="dc-btn dc-btn-cancel" onclick="closeDeleteConfirm()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('open')) closeDeleteConfirm();
  });
  return el;
}

// Soft-deletes one of the current user's own posts OR replies (sets
// is_deleted = true; RLS lets an author update their own row — see
// "users can edit own posts" / "users can edit own replies" in
// schema.sql — so no new policy is needed for this). Opens the
// confirmation modal above instead of deleting immediately.
// `isReply` = true means `id` is a reply id and the replies table is
// used instead of posts.
function deletePost(id, ev, isReply = false) {
  if (ev) { ev.stopPropagation(); togglePostMenu(id, ev); }
  if (!requireLogin()) return;
  pendingDeletePostId = id;
  pendingDeleteIsReply = isReply;
  const el = dcModalEl();
  if (el.classList.contains('open')) return;
  el.classList.add('open');
  lockScroll();
}

function closeDeleteConfirm() {
  const el = document.getElementById('dc-modal-bg');
  if (el?.classList.contains('open')) { el.classList.remove('open'); unlockScroll(); }
  pendingDeletePostId = null;
  pendingDeleteIsReply = false;
}

// Does the actual delete, called by the modal's red "Delete" button.
// Removes the card from whichever page it's on — using data-post-id +
// querySelectorAll rather than the (non-unique, once reposts can
// duplicate a post onto the same page) "post-<id>" element id, so
// every copy of the post disappears, not just the first one found.
// On thread.html, where the post is the whole page, sends the user
// back to the board instead.
async function confirmDeletePost() {
  const id = pendingDeletePostId;
  const isReply = pendingDeleteIsReply;
  const table = isReply ? 'replies' : 'posts';
  if (!id || !requireLogin()) return;
  const btn = document.getElementById('dc-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    // Re-check the session against Supabase itself right before deleting,
    // rather than trusting the in-memory currentSession variable — that
    // variable is only ever set once, at page load (see renderAuthArea()
    // in auth.js), so a session that expired or was signed out in
    // another tab since this page loaded would otherwise go undetected
    // until the delete itself fails with a confusing RLS error.
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      alert('Your session has expired. Please log in again and retry.');
      closeDeleteConfirm();
      location.href = 'login.html';
      return;
    }
    // Confirm ownership client-side before attempting the write, so a
    // real ownership mismatch (e.g. a stale card rendered before an
    // account switch) surfaces as a clear message instead of the raw
    // Postgres RLS error.
    const { data: existing, error: fetchErr } = await sb.from(table)
      .select('author_id').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) throw new Error(isReply ? 'This reply no longer exists.' : 'This post no longer exists.');
    if (existing.author_id !== session.user.id) {
      throw new Error(isReply ? "This isn't your reply, so it can't be deleted from here."
                               : "This isn't your post, so it can't be deleted from here.");
    }

    // Deliberately no .select() here: once is_deleted flips to true the
    // row stops matching the "read non-deleted posts/replies" RLS policy,
    // so a RETURNING clause would come back empty even on a successful
    // delete and make this look like it failed. An empty error is the
    // correct success signal for this particular update.
    const { error } = await sb.from(table).update({ is_deleted: true }).eq('id', id);
    if (error) throw error;
    closeDeleteConfirm();
    if (!isReply && document.getElementById('op-post') && id === currentStatusId()) {
      location.href = 'index.html';
      return;
    }
    // Reply cards use two different markup shapes depending on the page:
    // profile.js's Replies tab sets data-post-id="<reply id>" on the card,
    // while thread.js's in-thread comment tree uses id="reply-<reply id>"
    // instead (see replyHtml() in thread.js) — cover both so the row
    // actually disappears wherever it's shown.
    document.querySelectorAll(`[data-post-id="${id}"]`).forEach(el => el.remove());
    document.getElementById(`reply-${id}`)?.remove();
    // If we're looking at a profile page's post count, the only way a
    // Delete button can even show is on your own post, and the only
    // profile a Delete button can appear on is your own (other
    // people's posts never render Delete for you) — so this is always
    // safe to decrement when it's present. Replies aren't counted in
    // stat-posts, so skip the decrement for those.
    if (!isReply && typeof bumpStat === 'function' && document.getElementById('stat-posts')) bumpStat('stat-posts', -1);
  } catch (e) {
    // Full object (code/details/hint included) goes to the console so
    // it's inspectable via devtools if this ever needs debugging again
    // — the alert only has room for the short version.
    console.error('deletePost failed:', e);
    closeDeleteConfirm();
    alert(e.message || 'Could not delete that post.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

// The small "↻ [Name] reposted" line shown above a card that's in a
// feed/profile only because someone reposted it (not authored it) —
// same idea as Twitter. `reposter` is {id, username, display_name}.
// "You reposted" when the reposter is the person currently logged in
// (own profile's repost list, or your repost showing in your own
// view); otherwise it links to the reposter's profile.
function repostBannerHtml(reposter) {
  if (!reposter) return '';
  const isYou = currentSession && currentSession.user.id === reposter.id;
  const name = esc(reposter.display_name || reposter.username);
  const label = isYou ? 'You reposted' : `${name} reposted`;
  const inner = isYou
    ? `<span>${label}</span>`
    : `<a href="${profileUrl(reposter.username)}" onclick="event.stopPropagation()">${label}</a>`;
  return `<div class="repost-banner">${ICON.repost}${inner}</div>`;
}

// Full tweet-style post card — used by the main feed and profile page.
// The whole card is clickable (opens the post's comments), matching
// Twitter — but clicks on an actual link/button/menu inside it are
// left alone so those keep working normally. If `p._repostedBy` is
// set (see board.js/profile.js), a "[Name] reposted" banner is shown
// above the card, same as Twitter.
function postCardHtml(p, flash = false) {
  cachePost(p);
  return `
  <div class="pc${flash ? ' flash' : ''}" id="post-${p.id}" data-post-id="${p.id}" onclick="cardClick(event, '${p.id}', ${p.profile?.username ? `'${u_(p.profile.username)}'` : 'null'})">
    ${repostBannerHtml(p._repostedBy)}
    <div class="pc-row">
      ${pcAvatarHtml(p.profile)}
      <div class="pc-main">
        <div class="ph">
          ${pcNameHtml(p.profile)}
          <span class="dt">${timeAgo(p.created_at)}</span>
          ${postMenuHtml(p.id, null, p.author_id)}
        </div>
        <div class="pb">${renderBody(p.body)}</div>
        ${p.quote_of ? quotedPostHtml(p.quoted) : ''}
        ${renderMedia(p.media_url, p.media_type)}
        ${pollHtml(p)}
        ${postActionsHtml(p)}
      </div>
    </div>
  </div>`;
}

// Clicking anywhere on a post card opens its comments — unless the
// click actually landed on a link, button, the "···" menu, or an
// input, all of which handle themselves.
function cardClick(ev, postId, username = null) {
  if (ev.target.closest('a, button, input, textarea, .pc-menu-wrap')) return;
  location.href = postUrlById(postId, username);
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
  return `<a class="pfl" href="${profileUrl(uname)}">` +
         `<img class="avatar pfp-sm" src="${esc(avatarUrl(profile?.avatar_url))}" alt="">` +
         `${esc(profile?.display_name || uname)}</a>`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// Renders body text with basic greentext (> lines) support, plus
// Twitter-style rich text: @mentions, #hashtags, and bare URLs all
// become links. Input is escaped first, and linkifyText() only ever
// re-inserts the handful of <a> tags below, so this still cannot
// inject HTML no matter what the post body contains.
function renderBody(body) {
  return linkifyText(esc(body))
    .split('\n')
    .map(line => line.trim().startsWith('&gt;') ? `<span class="gt">${line}</span>` : line)
    .join('\n');
}

// Turns already-HTML-escaped text into Twitter-style rich text:
//   - https://... / http://... -> clickable link (opens in a new tab)
//   - @username -> link to that user's profile
//   - #hashtag  -> link to a search for that hashtag
// Runs on esc()'d input, so `escaped` can only ever contain entities
// (&amp; &lt; &gt; &quot; &#39;) plus plain text — there's no raw < or
// " left in it for a crafted post body to break out of the <a> tags
// added below with, so matching on whitespace alone is enough.
function linkifyText(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s]+)|(^|[^\w&])@([a-zA-Z0-9_]{3,20})|(^|[^\w&])#([a-zA-Z0-9_]+)/g,
    (match, url, mBefore, mHandle, hBefore, hTag) => {
      if (url) {
        // Trim trailing punctuation that's obviously sentence
        // punctuation rather than part of the URL (a period ending
        // the sentence, a closing paren that opened outside the URL,
        // etc.) off the link, but keep it in the surrounding text.
        const trailing = url.match(/[.,!?:;]+$/);
        const clean = trailing ? url.slice(0, -trailing[0].length) : url;
        const rest = trailing ? trailing[0] : '';
        if (!clean) return match;
        return `<a href="${clean}" target="_blank" rel="noopener noreferrer nofollow" class="body-link" onclick="event.stopPropagation()">${clean}</a>${rest}`;
      }
      if (mHandle) {
        return `${mBefore}<a href="${profileUrl(mHandle)}" class="body-mention" onclick="event.stopPropagation()">@${mHandle}</a>`;
      }
      return `${hBefore}<a href="search.html?q=${encodeURIComponent('#' + hTag)}" class="body-hashtag" onclick="event.stopPropagation()">#${hTag}</a>`;
    }
  );
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// "9:00 PM · Aug 8, 2026" — the full timestamp shown on a post's own
// detail page (thread.html), as opposed to the relative "3h ago" used
// everywhere else (see timeAgo() above).
function fullDateTime(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${time} \u00b7 ${date}`;
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

// ─────────────────────────────────────────────────────────────
// POLLS — poll_options/poll_ends_at live on the posts row itself;
// individual votes live in public.poll_votes (one row per voter,
// unique per post). Rendering is async (a second query for the vote
// tally) so pollHtml() drops a placeholder in synchronously and
// fills it in a moment later — same trick used for lazy quote lists.
// ─────────────────────────────────────────────────────────────
function pollHtml(p) {
  if (!p.poll_options || !p.poll_options.length) return '';
  setTimeout(() => renderPollInto(p.id), 0);
  return `<div class="poll-box" id="poll-${p.id}" onclick="event.stopPropagation()"><span class="spinner">Loading&hellip;</span></div>`;
}

async function renderPollInto(postId) {
  const box = document.getElementById(`poll-${postId}`);
  const post = postCache[postId];
  if (!box || !post || !post.poll_options) return;
  let votes = [];
  try {
    const { data, error } = await sb.from('poll_votes').select('option_index,user_id').eq('post_id', postId);
    if (error) throw error;
    votes = data || [];
  } catch (e) {
    box.innerHTML = `<div class="no-t">Poll (run supabase/gifs_polls_scheduling.sql to enable voting).</div>`;
    return;
  }
  const ended = post.poll_ends_at && new Date(post.poll_ends_at) <= new Date();
  const counts = post.poll_options.map((_, i) => votes.filter(v => v.option_index === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const myVote = currentSession ? votes.find(v => v.user_id === currentSession.user.id) : null;
  const locked = ended || !!myVote;
  box.innerHTML = post.poll_options.map((opt, i) => {
    const pct = total ? Math.round(counts[i] / total * 100) : 0;
    if (locked) {
      return `<div class="poll-opt-result${myVote && myVote.option_index === i ? ' mine' : ''}">` +
             `<div class="poll-opt-fill" style="width:${pct}%"></div>` +
             `<span class="poll-opt-label">${esc(opt)}</span><span class="poll-opt-pct">${pct}%</span></div>`;
    }
    return `<button type="button" class="poll-opt-btn" onclick="voteOnPoll('${postId}', ${i})">${esc(opt)}</button>`;
  }).join('') + `<div class="poll-meta">${fmtCount(total)} votes &middot; ${ended ? 'Final results' : pollTimeLeft(post.poll_ends_at)}</div>`;
}

function pollTimeLeft(endsAt) {
  if (!endsAt) return '';
  const ms = new Date(endsAt) - new Date();
  if (ms <= 0) return 'Final results';
  const h = Math.ceil(ms / 3600000);
  return h < 24 ? `${h}h left` : `${Math.ceil(h / 24)}d left`;
}

async function voteOnPoll(postId, optionIndex) {
  if (!requireLogin()) return;
  try {
    const { error } = await sb.from('poll_votes').insert({ post_id: postId, user_id: currentSession.user.id, option_index: optionIndex });
    if (error) throw error;
  } catch (e) {
    alert(e.message || 'Could not vote.');
    return;
  }
  renderPollInto(postId);
}

// ─────────────────────────────────────────────────────────────
// COMPOSER EXTRAS — GIFs (Giphy), emoji, polls, and scheduling,
// shared across every composer (main feed, the global compose
// modal, and the thread reply box) via a `prefix` naming
// convention: each composer's textarea is `${prefix}-body`, its
// file preview slot `${prefix}-fp`, its poll builder
// `${prefix}-poll-box`, its schedule picker `${prefix}-sched-box`.
// ─────────────────────────────────────────────────────────────
const GIPHY_API_KEY = 'a4SzSp8qCSlLKqPT5wtatv0YCop7VWBL';
let composeExtras = {}; // { [prefix]: { gifUrl } }
let gifPickerTarget = null;

function gifModalEl() {
  let el = document.getElementById('gif-modal-bg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gif-modal-bg';
  el.className = 'modal-bg';
  el.addEventListener('click', e => { if (e.target === el) closeGifPicker(); });
  el.innerHTML = `
    <div class="modal gif-modal">
      <a class="modal-close" href="#" onclick="closeGifPicker();return false;">&#10005;</a>
      <h2>GIFs</h2>
      <div class="gif-search-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="gif-search-input" placeholder="Search GIPHY">
      </div>
      <div class="gif-grid" id="gif-grid"><span class="spinner">Loading&hellip;</span></div>
      <div class="gif-attrib">Powered by GIPHY</div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#gif-grid').addEventListener('click', e => {
    const btn = e.target.closest('.gif-item');
    if (btn) pickGif(btn.dataset.url);
  });
  const input = el.querySelector('#gif-search-input');
  let deb;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => searchGifs(input.value.trim()), 350);
  });
  return el;
}

function openGifPicker(prefix) {
  if (!requireLogin()) return;
  gifPickerTarget = prefix;
  const el = gifModalEl();
  if (el.classList.contains('open')) return;
  el.classList.add('open');
  lockScroll();
  const input = el.querySelector('#gif-search-input');
  input.value = '';
  setTimeout(() => input.focus(), 50);
  loadTrendingGifs();
}
function closeGifPicker() {
  const el = document.getElementById('gif-modal-bg');
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  unlockScroll();
}
async function loadTrendingGifs() {
  await fetchGifs(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`);
}
async function searchGifs(q) {
  if (!q) { loadTrendingGifs(); return; }
  await fetchGifs(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13&q=${encodeURIComponent(q)}`);
}
async function fetchGifs(url) {
  const grid = document.getElementById('gif-grid');
  if (!grid) return;
  grid.innerHTML = `<span class="spinner">Loading&hellip;</span>`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const items = json.data || [];
    if (!items.length) { grid.innerHTML = `<div class="no-t">No GIFs found.</div>`; return; }
    grid.innerHTML = items.map(g => {
      const thumb = g.images?.fixed_width?.url || g.images?.original?.url || '';
      const full = g.images?.original?.url || thumb;
      return `<button type="button" class="gif-item" data-url="${esc(full)}"><img src="${esc(thumb)}" alt="${esc(g.title || 'GIF')}" loading="lazy"></button>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<div class="errmsg">Couldn't load GIFs. Check your connection.</div>`;
  }
}
function pickGif(url) {
  if (url && gifPickerTarget) setComposerGif(gifPickerTarget, url);
  closeGifPicker();
}
function setComposerGif(prefix, url) {
  if (!composeExtras[prefix]) composeExtras[prefix] = {};
  composeExtras[prefix].gifUrl = url;
  removePoll(prefix); // a post can carry media OR a poll, never both — same as X
  const fileEl = document.getElementById(`${prefix}-file`);
  if (fileEl) fileEl.value = '';
  const fp = document.getElementById(`${prefix}-fp`);
  if (fp) {
    fp.innerHTML = `<img src="${esc(url)}" alt="GIF"><br><span class="rm-f" id="${prefix}-gif-rm">remove GIF</span>`;
    document.getElementById(`${prefix}-gif-rm`).onclick = () => clearComposerGif(prefix);
  }
  if (prefix === 'pf' && typeof updatePostBtnState === 'function') updatePostBtnState();
  if (prefix === 'gc' && typeof updateGcBtnState === 'function') updateGcBtnState();
}
function clearComposerGif(prefix) {
  if (composeExtras[prefix]) composeExtras[prefix].gifUrl = null;
  const fp = document.getElementById(`${prefix}-fp`);
  if (fp) fp.innerHTML = '';
}
function clearComposerMedia(prefix) {
  clearComposerGif(prefix);
  const fileEl = document.getElementById(`${prefix}-file`);
  if (fileEl) fileEl.value = '';
  const fp = document.getElementById(`${prefix}-fp`);
  if (fp) fp.innerHTML = '';
}

// ── EMOJI ──
// Each entry is [emoji, search keywords]. Keywords are what the
// search box in the picker matches against (case-insensitive
// substring), so e.g. typing "laugh" finds 😂 and "fire" finds 🔥
// even though neither word appears in the emoji glyph itself.
const EMOJI_SET = [
  ['😀','grinning happy smile'], ['😁','beaming grin happy'], ['😂','joy laughing crying funny lol'],
  ['🤣','rofl laughing floor funny'], ['🙂','slight smile'], ['🙃','upside down silly'],
  ['😉','wink'], ['😊','blush smile happy'], ['😍','heart eyes love adore'],
  ['🥰','love hearts adore smiling'], ['😘','kiss love'], ['😋','yum tasty tongue'],
  ['😎','cool sunglasses'], ['🤩','star struck excited amazed'], ['🥳','party celebrate birthday'],
  ['😏','smirk sly'], ['😌','relieved content calm'], ['😴','sleep tired zzz'],
  ['🤤','drool hungry'], ['😪','sleepy tired'], ['🤔','think hmm thinking'],
  ['🫡','salute respect'], ['🤨','skeptical suspicious eyebrow'], ['😐','neutral meh'],
  ['😑','expressionless blank'], ['🙄','eyeroll annoyed whatever'], ['😬','grimace awkward cringe'],
  ['🤐','zip lips quiet secret'], ['😯','surprised shock'], ['😦','frown shock'],
  ['😧','anguish shock'], ['😮','wow surprised open mouth'], ['😲','astonished shock wow'],
  ['🥱','yawn bored tired'], ['😢','sad cry tear'], ['😭','sobbing crying sad bawling'],
  ['😤','frustrated huff angry steam'], ['😠','angry mad'], ['😡','rage angry mad furious'],
  ['🤬','swearing cursing angry furious'], ['🤯','mind blown shocked wow'], ['😳','flushed embarrassed shocked'],
  ['🥵','hot sweating heat'], ['🥶','cold freezing'], ['😱','scream fear shocked omg'],
  ['😨','fearful scared'], ['😰','anxious nervous sweat'], ['😥','sad relieved disappointed'],
  ['😓','sweat nervous tired'], ['🤗','hug welcoming'], ['🤭','giggle oops whoops'],
  ['🫢','gasp shock surprised'], ['🤫','shh quiet secret'], ['🤥','lying pinocchio liar'],
  ['😷','sick mask ill'], ['🤒','sick fever thermometer'], ['🤕','hurt injured bandage'],
  ['🤢','sick nauseous gross'], ['🤮','vomit sick gross throw up'], ['🥴','woozy dizzy drunk'],
  ['😵','dizzy dead knocked out'], ['😵‍💫','dizzy confused spinning'], ['🤠','cowboy hat'],
  ['🥸','disguise incognito glasses'], ['😈','devil mischievous evil'], ['👿','angry devil evil'],
  ['💀','skull dead lol'], ['☠️','skull crossbones danger dead'], ['👻','ghost spooky'],
  ['👽','alien ufo'], ['🤖','robot bot'], ['🎃','pumpkin halloween'],
  ['💩','poop crap'], ['🤡','clown joke'], ['👍','thumbs up yes good agree'],
  ['👎','thumbs down no bad disagree'], ['👌','ok okay perfect'], ['🤌','chefs kiss italian pinch'],
  ['✌️','peace victory'], ['🤞','fingers crossed hope luck'], ['🫰','finger heart'],
  ['🤟','love you rock'], ['🤘','rock horns metal'], ['👊','fist bump punch'],
  ['✊','fist power'], ['👏','clap applause'], ['🙌','praise hands up celebrate'],
  ['🫶','heart hands love'], ['🙏','pray please thanks'], ['🤝','handshake deal agree'],
  ['💪','muscle strong flex gym'], ['👀','eyes looking watching sus'], ['👋','wave hi hello bye'],
  ['🤙','call me shaka hang loose'], ['✋','stop hand high five'], ['🖐️','hand five'],
  ['🤦','facepalm annoyed'], ['🤷','shrug idk dunno whatever'], ['💃','dance party'],
  ['🕺','dance party'], ['❤️','love heart red'], ['🧡','heart orange'],
  ['💛','heart yellow'], ['💚','heart green'], ['💙','heart blue'],
  ['💜','heart purple'], ['🖤','heart black'], ['🤍','heart white'],
  ['🤎','heart brown'], ['💔','broken heart heartbreak sad'], ['❤️‍🔥','heart fire passion love'],
  ['💕','hearts love cute'], ['💞','hearts revolving love'], ['💓','heartbeat love'],
  ['💗','growing heart love'], ['💖','sparkling heart love'], ['💘','cupid heart arrow love'],
  ['💝','heart gift love'], ['💯','hundred perfect score'], ['🔥','fire lit hot amazing'],
  ['✨','sparkle shiny magic'], ['⭐','star'], ['🌟','glowing star special'],
  ['💫','dizzy star sparkle'], ['⚡','lightning bolt energy fast'], ['☀️','sun sunny weather'],
  ['🌙','moon night'], ['🌈','rainbow pride'], ['☁️','cloud weather'],
  ['🎉','party celebrate confetti'], ['🎊','confetti party celebrate'], ['🎈','balloon party'],
  ['🎁','gift present'], ['🏆','trophy win winner champion'], ['🥇','gold medal first winner'],
  ['🎮','gaming controller games'], ['🕹️','joystick arcade games'], ['🎧','headphones music'],
  ['🎵','music note'], ['🎶','music notes'], ['📱','phone mobile'],
  ['💻','laptop computer'], ['📷','camera photo'], ['🔔','bell notification alert'],
  ['💡','idea lightbulb'], ['🧠','brain smart mind'], ['👑','crown king queen royalty'],
  ['💎','gem diamond blue precious'], ['🎯','target bullseye goal'], ['🍕','pizza food'],
  ['🍔','burger food'], ['🍜','ramen noodles food'], ['🍣','sushi food'],
  ['🍩','donut sweet food'], ['🍰','cake dessert birthday'], ['☕','coffee drink caffeine'],
  ['🍺','beer drink'], ['🍷','wine drink'], ['🐶','dog puppy'],
  ['🐱','cat kitty'], ['🐼','panda cute'], ['🦋','butterfly'],
  ['🌸','cherry blossom flower spring'], ['🌹','rose flower love'], ['🍀','clover luck lucky'],
];
let emojiPickerTarget = null;
function renderEmojiGrid(filter) {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  const q = (filter || '').trim().toLowerCase();
  const matches = q
    ? EMOJI_SET.filter(([e, k]) => k.includes(q) || e === filter)
    : EMOJI_SET;
  grid.innerHTML = matches.length
    ? matches.map(([e]) => `<button type="button" class="cx-emoji-item" data-e="${e}">${e}</button>`).join('')
    : `<div class="cx-emoji-empty">No emoji found</div>`;
}
function toggleEmojiPicker(prefix, anchorBtn) {
  if (!requireLogin()) return;
  let pop = document.getElementById('emoji-pop');
  if (pop && emojiPickerTarget === prefix && !pop.hidden) { pop.hidden = true; return; }
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'emoji-pop';
    pop.className = 'cx-emoji-pop';
    pop.hidden = true;
    pop.innerHTML = `
      <input type="text" class="cx-emoji-search" id="emoji-search" placeholder="Search emoji" autocomplete="off">
      <div class="cx-emoji-grid" id="emoji-grid"></div>`;
    document.body.appendChild(pop);
    renderEmojiGrid('');
    pop.querySelector('#emoji-search').addEventListener('input', e => renderEmojiGrid(e.target.value));
    pop.addEventListener('click', e => {
      const btn = e.target.closest('.cx-emoji-item');
      if (!btn || !emojiPickerTarget) return;
      insertAtCursor(document.getElementById(`${emojiPickerTarget}-body`), btn.dataset.e);
    });
    document.addEventListener('click', e => {
      if (pop.hidden || e.target.closest('.cx-emoji-pop') || e.target.closest('[title="Emoji"]')) return;
      pop.hidden = true;
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !pop.hidden) pop.hidden = true;
    });
  }
  emojiPickerTarget = prefix;
  const search = pop.querySelector('#emoji-search');
  search.value = '';
  renderEmojiGrid('');
  const r = anchorBtn.getBoundingClientRect();
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.style.left = `${Math.max(8, r.left + window.scrollX - 100)}px`;
  pop.hidden = false;
  setTimeout(() => search.focus(), 30);
}
function insertAtCursor(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── POLL BUILDER ──
function togglePollBuilder(prefix) {
  if (!requireLogin()) return;
  const box = document.getElementById(`${prefix}-poll-box`);
  if (!box) return;
  if (box.hidden) {
    clearComposerMedia(prefix); // poll & media/GIF are mutually exclusive — same as X
    box.hidden = false;
    box.querySelector('.cx-poll-opt')?.focus();
  } else {
    removePoll(prefix);
  }
}
function addPollOption(prefix) {
  const wrap = document.getElementById(`${prefix}-poll-opts`);
  if (!wrap || wrap.querySelectorAll('.cx-poll-opt').length >= 4) return;
  const n = wrap.querySelectorAll('.cx-poll-opt').length;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'cx-poll-opt'; inp.maxLength = 25;
  inp.placeholder = `Choice ${n + 1}`;
  wrap.appendChild(inp);
  inp.focus();
}
function removePoll(prefix) {
  if (composeExtras[prefix]) composeExtras[prefix].poll = null;
  const box = document.getElementById(`${prefix}-poll-box`);
  if (!box) return;
  box.hidden = true;
  box.querySelectorAll('.cx-poll-opt').forEach((o, i) => { if (i > 1) o.remove(); else o.value = ''; });
  const dur = document.getElementById(`${prefix}-poll-dur`);
  if (dur) dur.value = '3';
}
function collectPoll(prefix) {
  const box = document.getElementById(`${prefix}-poll-box`);
  if (!box || box.hidden) return null;
  const opts = Array.from(box.querySelectorAll('.cx-poll-opt')).map(i => i.value.trim()).filter(Boolean);
  if (opts.length < 2) return null;
  const days = Number(document.getElementById(`${prefix}-poll-dur`)?.value || 1);
  return { poll_options: opts, poll_ends_at: new Date(Date.now() + days * 86400000).toISOString() };
}

// ── SCHEDULE PICKER ──
// Twitter/X caps scheduled posts at 1 year out; we cap this one further
// out at 4 years, per product decision. Computed via setFullYear (not
// a fixed millisecond offset) so it lands on the same calendar date 4
// years from now regardless of leap years.
function maxScheduleDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 4);
  return d;
}
function toggleScheduleBuilder(prefix) {
  if (!requireLogin()) return;
  const box = document.getElementById(`${prefix}-sched-box`);
  if (!box) return;
  if (box.hidden) {
    box.hidden = false;
    const input = document.getElementById(`${prefix}-sched-input`);
    if (input) {
      input.max = toLocalDatetimeValue(maxScheduleDate());
      if (!input.value) input.value = toLocalDatetimeValue(new Date(Date.now() + 30 * 60000));
    }
    input?.focus();
  } else {
    removeSchedule(prefix);
  }
}
function removeSchedule(prefix) {
  const box = document.getElementById(`${prefix}-sched-box`);
  if (box) box.hidden = true;
  const input = document.getElementById(`${prefix}-sched-input`);
  if (input) input.value = '';
}
function toLocalDatetimeValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function collectSchedule(prefix) {
  const box = document.getElementById(`${prefix}-sched-box`);
  if (!box || box.hidden) return null;
  const input = document.getElementById(`${prefix}-sched-input`);
  const d = input?.value ? new Date(input.value) : null;
  if (!d || isNaN(d.getTime()) || d.getTime() <= Date.now() || d.getTime() > maxScheduleDate().getTime()) return null;
  return d.toISOString();
}
function validatePollAndSchedule(prefix, errEl) {
  const pollBox = document.getElementById(`${prefix}-poll-box`);
  if (pollBox && !pollBox.hidden) {
    const opts = Array.from(pollBox.querySelectorAll('.cx-poll-opt')).map(i => i.value.trim()).filter(Boolean);
    if (opts.length < 2) { showErr(errEl, 'Add at least 2 poll options.'); return false; }
  }
  const schedBox = document.getElementById(`${prefix}-sched-box`);
  if (schedBox && !schedBox.hidden) {
    const input = document.getElementById(`${prefix}-sched-input`);
    const d = input?.value ? new Date(input.value) : null;
    if (!d || isNaN(d.getTime()) || d.getTime() <= Date.now()) { showErr(errEl, 'Pick a future date/time to schedule this post.'); return false; }
    if (d.getTime() > maxScheduleDate().getTime()) { showErr(errEl, 'You can schedule a post at most 4 years ahead.'); return false; }
  }
  return true;
}
function resetComposeExtras(prefix) {
  composeExtras[prefix] = { gifUrl: null };
  removePoll(prefix);
  removeSchedule(prefix);
}

// ── FILE PREVIEW WIDGET ──
function wireFilePreview(inputId, previewId, errElId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const prefix = inputId.replace(/-file$/, '');
  input.addEventListener('change', () => {
    preview.innerHTML = '';
    const file = input.files[0];
    if (!file) return;
    const errEl = errElId ? document.getElementById(errElId) : null;
    if (!validateFile(file, errEl)) { input.value = ''; return; }
    clearErr(errEl);
    if (composeExtras[prefix]) composeExtras[prefix].gifUrl = null; // file + GIF are mutually exclusive
    removePoll(prefix); // media & poll are mutually exclusive
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
  <a class="ulrow" href="${profileUrl(uname)}">
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
