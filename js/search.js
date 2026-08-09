// ─────────────────────────────────────────────────────────────
// SEARCH PAGE — /search.html?q=<term>[&t=posts|people]
// ─────────────────────────────────────────────────────────────
const POST_SELECT = '*, profile:profiles(username,display_name,avatar_url)';

const searchParams = new URLSearchParams(location.search);
let searchQuery = searchParams.get('q') || '';
let searchTab = searchParams.get('t') === 'people' ? 'people' : 'posts';

function renderTabs() {
  const el = document.getElementById('search-tabs');
  el.innerHTML = `
    <button class="xtab${searchTab === 'posts' ? ' active' : ''}" onclick="setSearchTab('posts')">Posts</button>
    <button class="xtab${searchTab === 'people' ? ' active' : ''}" onclick="setSearchTab('people')">People</button>`;
}

function setSearchTab(tab) {
  if (tab === searchTab) return;
  searchTab = tab;
  renderTabs();
  runSearch();
}

async function runSearch() {
  document.getElementById('sp-input').value = searchQuery;
  const root = document.getElementById('search-root');
  if (!searchQuery.trim()) {
    root.innerHTML = `<div id="feed-empty">Search for posts or people on Otakuchan.</div>`;
    document.title = 'Search — Otakuchan';
    return;
  }
  document.title = `${searchQuery} — Search — Otakuchan`;
  root.innerHTML = `<span class="spinner">Searching&hellip;</span>`;
  if (searchTab === 'people') return searchPeople(root);
  return searchPosts(root);
}

async function searchPosts(root) {
  await ensureBookmarksLoaded();
  await ensureRepostsLoaded();
  const { data, error } = await sb.from('posts').select(POST_SELECT)
    .eq('is_deleted', false)
    .ilike('body', `%${searchQuery}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { root.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  if (!data.length) { root.innerHTML = `<div id="feed-empty">No posts found for &ldquo;${esc(searchQuery)}&rdquo;.</div>`; return; }
  await attachQuotedPosts(data);
  root.innerHTML = data.map(p => postCardHtml(p)).join('');
}

async function searchPeople(root) {
  const { data, error } = await sb.from('profiles').select('*')
    .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
    .order('followers_count', { ascending: false })
    .limit(50);

  if (error) { root.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  if (!data.length) { root.innerHTML = `<div id="feed-empty">No users found for &ldquo;${esc(searchQuery)}&rdquo;.</div>`; return; }
  root.innerHTML = data.map(profile => `
    <a class="ulrow" style="padding:12px 16px;border-bottom:1px solid var(--line);border-radius:0;" href="${profileUrl(profile.username)}">
      <img class="avatar pfp-md" src="${esc(avatarUrl(profile.avatar_url))}" alt="">
      <div class="ulrow-txt">
        <span class="ulrow-name">${esc(profile.display_name || profile.username)}</span>
        <span class="ulrow-handle">@${esc(profile.username)}</span>
      </div>
    </a>`).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise cards can render before we know who's logged in
  renderTabs();
  runSearch();
});
