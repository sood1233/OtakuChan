// ─────────────────────────────────────────────────────────────
// PROFILE PAGE — /profile.html?u=<username>
// Editing your own profile lives on its own page (editprofile.html).
// Followers/following lists live on their own page (followlist.html).
// ─────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const viewUsername = params.get('u');
let viewedProfile = null;
let isOwnProfile = false;

const POST_SELECT = '*, profile:profiles(username,display_name,avatar_url)';

async function loadProfile() {
  const root = document.getElementById('profile-root');
  if (!viewUsername) {
    root.innerHTML = `<div class="errmsg">No user specified.</div>`;
    return;
  }

  const { data: { session } } = await sb.auth.getSession();

  const { data: profile, error } = await sb.from('profiles')
    .select('*').ilike('username', viewUsername).single();

  if (error || !profile) {
    root.innerHTML = `<div class="errmsg">No user found with that username.</div>`;
    return;
  }
  viewedProfile = profile;
  isOwnProfile = session && session.user.id === profile.id;
  document.title = `@${profile.username} — Otakuchan`;

  const flu = kind => `followlist.html?u=${encodeURIComponent(profile.username)}&tab=${kind}`;

  root.innerHTML = `
    <div class="profile-hdr" style="${profile.banner_url ? `--banner-img:url('${esc(profile.banner_url)}')` : ''}">
      <img class="avatar pfp-lg" id="pv-avatar" src="${esc(avatarUrl(profile.avatar_url))}" alt="">
      <div class="profile-id">
        <div class="uname-row">
          <div class="uname">${esc(profile.display_name || profile.username)}</div>
          ${!isOwnProfile && session ? `<button class="follow-btn" id="follow-btn" onclick="toggleFollow()">Follow</button>` : ''}
          ${!isOwnProfile && !session ? `<a class="follow-btn" href="login.html">Follow</a>` : ''}
          ${isOwnProfile ? `<a class="profile-edit-btn" href="editprofile.html">Edit Profile</a>` : ''}
        </div>
        <div class="handle">@${esc(profile.username)}</div>
        <div class="bio">${esc(profile.bio || '')}</div>
        <div class="profile-stats">
          <span class="stat-item stat-static"><b id="stat-posts">${fmtCount(profile.posts_count)}</b> Posts</span>
          <a class="stat-item" href="${flu('followers')}"><b id="stat-followers">${fmtCount(profile.followers_count)}</b> Followers</a>
          <a class="stat-item" href="${flu('following')}"><b id="stat-following">${fmtCount(profile.following_count)}</b> Following</a>
        </div>
        <div class="profile-meta">Joined ${new Date(profile.created_at).toLocaleDateString()}</div>
      </div>
    </div>

    <div class="sec-bar">Posts by @${esc(profile.username)}</div>
    <div id="profile-posts"><span class="spinner">Loading posts&hellip;</span></div>
  `;

  if (!isOwnProfile && session) {
    isFollowing(profile.id).then(f => setFollowBtnState(f));
  }

  loadUserPosts(profile.id);
}

// ── FOLLOW BUTTON ──
let followBusy = false;
function setFollowBtnState(following) {
  const btn = document.getElementById('follow-btn');
  if (!btn) return;
  btn.textContent = following ? 'Following' : 'Follow';
  btn.classList.toggle('following', following);
}

async function toggleFollow() {
  if (!requireLogin() || followBusy || !viewedProfile) return;
  const btn = document.getElementById('follow-btn');
  const following = btn.classList.contains('following');
  followBusy = true;
  btn.disabled = true;
  try {
    if (following) {
      const { error } = await unfollowUser(viewedProfile.id);
      if (error) throw error;
      setFollowBtnState(false);
      bumpStat('stat-followers', -1);
    } else {
      const { error } = await followUser(viewedProfile.id);
      if (error) throw error;
      setFollowBtnState(true);
      bumpStat('stat-followers', 1);
    }
  } catch (e) {
    alert(e.message || 'Could not update follow status.');
  } finally {
    followBusy = false;
    btn.disabled = false;
  }
}

function bumpStat(elId, delta) {
  const el = document.getElementById(elId);
  if (!el) return;
  const raw = parseInt((el.textContent || '0').replace(/[^\d]/g, ''), 10) || 0;
  el.textContent = fmtCount(Math.max(raw + delta, 0));
}

// Profile timeline = this user's own posts + posts they've reposted,
// merged and sorted like Twitter does — a repost slots in at the time
// it was reposted, not the original post's time, and carries a
// "You reposted" / "[Name] reposted" banner (see repostBannerHtml in
// common.js).
//
// Reposts are fetched as a plain reposts row lookup + a separate
// posts-by-id lookup, rather than one query with a `post:posts(...)`
// embed — same reasoning as attachQuotedPosts() below: `reposts` and
// its FK to `posts` are recent additions, and until PostgREST's schema
// cache has definitely picked them up, an embed that can't resolve
// fails its *entire* query rather than just that part of it. Two
// plain queries can't do that.
async function loadUserPosts(userId) {
  const el = document.getElementById('profile-posts');
  await ensureBookmarksLoaded();
  await ensureRepostsLoaded();

  const [ownRes, repostRowsRes] = await Promise.all([
    sb.from('posts').select(POST_SELECT)
      .eq('author_id', userId).eq('is_deleted', false)
      .order('created_at', { ascending: false }).limit(50),
    sb.from('reposts').select('post_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(50)
  ]);

  if (ownRes.error) {
    el.innerHTML = `<div class="errmsg">${esc(ownRes.error.message)}</div>`;
    return;
  }

  const ownPosts = (ownRes.data || []).map(p => ({ ...p, _sortTime: p.created_at }));

  let repostedPosts = [];
  const repostRows = repostRowsRes.data || [];
  if (repostRowsRes.error) console.warn('reposts lookup failed', repostRowsRes.error);
  if (repostRows.length) {
    const postIds = [...new Set(repostRows.map(r => r.post_id))];
    const { data: repostedPostRows, error: postsErr } = await sb.from('posts').select(POST_SELECT)
      .in('id', postIds).eq('is_deleted', false);
    if (postsErr) console.warn('reposted posts lookup failed', postsErr);
    const postById = new Map((repostedPostRows || []).map(p => [p.id, p]));
    const reposterInfo = { id: viewedProfile.id, username: viewedProfile.username, display_name: viewedProfile.display_name };
    repostedPosts = repostRows
      .map(r => {
        const p = postById.get(r.post_id);
        return p ? { ...p, _sortTime: r.created_at, _repostedBy: reposterInfo } : null;
      })
      .filter(Boolean);
  }

  const combined = [...ownPosts, ...repostedPosts]
    .sort((a, b) => new Date(b._sortTime) - new Date(a._sortTime));

  if (!combined.length) {
    el.innerHTML = `<div class="empty-note">No posts yet.</div>`;
    return;
  }
  await attachQuotedPosts(combined);
  el.innerHTML = combined.map(p => postCardHtml(p)).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise cards can render before we know who's logged in
  loadProfile();
});
