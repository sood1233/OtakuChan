// ─────────────────────────────────────────────────────────────
// CHAT PAGE — /messages (conversation list) or /messages/<username> (thread)
// Also reachable via the legacy chat.html?u=<username> form.
// ─────────────────────────────────────────────────────────────
const chatWithUsername = (() => {
  const m = location.pathname.match(/^\/messages\/([^/]+)\/?$/);
  if (m) return decodeURIComponent(m[1]);
  return new URLSearchParams(location.search).get('u');
})();
let chatOther = null;   // the other user's profile, once a thread is open
let chatChannel = null;

// Same address-bar upgrade as profile.js/thread.js/followlist.js —
// safe to run immediately since chatWithUsername (if any) already
// came off the URL itself, no data load needed to know it.
(function () {
  const canonical = prettyMessagesUrl(chatWithUsername);
  if (location.pathname + location.search !== canonical) { try { history.replaceState(null, '', canonical); } catch (e) {} }
})();

async function loadChat() {
  const root = document.getElementById('chat-root');
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    root.innerHTML = `<div class="post-login-gate" style="border-top:none;">Log in to send and receive messages. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.</div>`;
    return;
  }

  if (chatWithUsername) {
    return loadThread(session, root);
  }
  return loadConversationList(session, root);
}

// ── CONVERSATION LIST ──
async function loadConversationList(session, root) {
  document.getElementById('chat-sec-bar').innerHTML = 'Chat';

  const { data, error } = await sb.from('messages')
    .select(`*, sender:profiles!messages_sender_id_fkey(username,display_name,avatar_url),
                recipient:profiles!messages_recipient_id_fkey(username,display_name,avatar_url)`)
    .or(`sender_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) { root.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }

  // Collapse the flat message log into one row per other participant,
  // keeping only the most recent message (list is already newest-first).
  const seen = new Map();
  (data || []).forEach(m => {
    const mine = m.sender_id === session.user.id;
    const otherId = mine ? m.recipient_id : m.sender_id;
    if (!seen.has(otherId)) {
      seen.set(otherId, { other: mine ? m.recipient : m.sender, last: m, mine });
    }
  });

  const newMsgBox = `
    <div class="chat-new">
      <input id="chat-new-user" placeholder="Message a username&hellip;" onkeydown="if(event.key==='Enter'){startChat();}">
      <button class="pf-btn" onclick="startChat()">Message</button>
    </div>
    <div class="errmsg" id="chat-new-err" style="display:none;margin:0 16px 10px;"></div>`;

  if (!seen.size) {
    root.innerHTML = newMsgBox + `<div id="feed-empty">No conversations yet. Message someone to get started.</div>`;
    return;
  }

  const rows = [...seen.values()].map(({ other, last, mine }) => {
    const unread = !mine && !last.read;
    const uname = other?.username || 'unknown';
    return `
    <a class="conv-row${unread ? ' unread' : ''}" href="${messagesUrl(uname)}">
      <img class="avatar" src="${esc(avatarUrl(other?.avatar_url))}" alt="">
      <div class="conv-txt">
        <div class="conv-top">
          <span class="conv-name">${esc(other?.display_name || uname)}</span>
          <span class="conv-handle">@${esc(uname)}</span>
          <span class="conv-time">${timeAgo(last.created_at)}</span>
        </div>
        <div class="conv-snip">${mine ? 'You: ' : ''}${esc((last.body || '').slice(0, 80))}</div>
      </div>
      ${unread ? '<span class="conv-dot"></span>' : ''}
    </a>`;
  }).join('');

  root.innerHTML = newMsgBox + rows;
}

async function startChat() {
  const input = document.getElementById('chat-new-user');
  const errEl = document.getElementById('chat-new-err');
  clearErr(errEl);
  const uname = input.value.trim().replace(/^@/, '');
  if (!uname) return;
  const { data: profile, error } = await sb.from('profiles').select('username').ilike('username', uname).maybeSingle();
  if (error || !profile) { showErr(errEl, 'No user found with that username.'); return; }
  location.href = messagesUrl(profile.username);
}

// ── ONE-ON-ONE THREAD ──
async function loadThread(session, root) {
  const { data: other, error: otherErr } = await sb.from('profiles').select('*').ilike('username', chatWithUsername).maybeSingle();
  if (otherErr || !other) { root.innerHTML = `<div class="errmsg">No user found with that username.</div>`; return; }
  if (other.id === session.user.id) { root.innerHTML = `<div class="errmsg">You can't message yourself.</div>`; return; }
  chatOther = other;

  document.getElementById('chat-sec-bar').innerHTML = `<a class="back" href="chat.html" style="margin:0 10px 0 0;">&larr;</a> ${esc(other.display_name || other.username)}`;

  const { data: msgs, error } = await sb.from('messages').select('*')
    .or(`and(sender_id.eq.${session.user.id},recipient_id.eq.${other.id}),and(sender_id.eq.${other.id},recipient_id.eq.${session.user.id})`)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) { root.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }

  root.innerHTML = `
    <div class="chat-thread">
      <div class="chat-hdr">
        <a href="${profileUrl(other.username)}"><img class="avatar" src="${esc(avatarUrl(other.avatar_url))}" alt=""></a>
        <div>
          <a class="nm" href="${profileUrl(other.username)}">${esc(other.display_name || other.username)}</a>
          <span class="pc-handle">@${esc(other.username)}</span>
        </div>
      </div>
      <div class="chat-msgs" id="chat-msgs">${renderMsgsHtml(msgs || [], session.user.id)}</div>
      <div class="chat-composer">
        <textarea id="chat-body" maxlength="2000" placeholder="Start a message&hellip;" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage();}"></textarea>
        <button class="pf-btn" onclick="sendMessage()">Send</button>
      </div>
    </div>`;

  sizeChatThread();
  scrollChatToBottom();

  const unreadIds = (msgs || []).filter(m => m.recipient_id === session.user.id && !m.read).map(m => m.id);
  if (unreadIds.length) {
    await sb.from('messages').update({ read: true }).in('id', unreadIds);
    if (typeof unreadChatCount === 'number') {
      unreadChatCount = Math.max(0, unreadChatCount - unreadIds.length);
      renderSideNav(); renderMobileChrome();
    }
  }

  subscribeChatRealtime(session.user.id, other.id);
}

// "Today" / "Yesterday" / "Monday" / "Aug 6" — same day-grouping
// labels used by real chat apps, shown as dividers between messages.
function chatDayLabel(iso) {
  const d = new Date(iso);
  const startOfDay = dt => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function chatClockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Renders the full message list with day-divider headers inserted
// wherever the calendar day changes between consecutive messages.
function renderMsgsHtml(msgs, myId) {
  let html = '';
  let lastDay = null;
  msgs.forEach(m => {
    const day = chatDayLabel(m.created_at);
    if (day !== lastDay) { html += `<div class="chat-daydivider">${esc(day)}</div>`; lastDay = day; }
    html += msgBubbleHtml(m, myId);
  });
  return html;
}

function msgBubbleHtml(m, myId) {
  const mine = m.sender_id === myId;
  return `
  <div class="msg-row ${mine ? 'mine' : 'theirs'}" id="msg-${m.id}" data-day="${esc(chatDayLabel(m.created_at))}">
    <div class="msg-bubble">${renderBody(m.body)}</div>
    <span class="msg-time-inline">${chatClockTime(m.created_at)}</span>
  </div>`;
}

// Appends one new message (from sendMessage() or the realtime
// subscription below), inserting a fresh day-divider first if it
// falls on a different day than the last message already shown.
function appendChatMsg(m, myId) {
  const container = document.getElementById('chat-msgs');
  if (!container) return;
  const day = chatDayLabel(m.created_at);
  const rows = container.querySelectorAll('.msg-row');
  const lastDay = rows.length ? rows[rows.length - 1].dataset.day : null;
  let html = '';
  if (day !== lastDay) html += `<div class="chat-daydivider">${esc(day)}</div>`;
  html += msgBubbleHtml(m, myId);
  container.insertAdjacentHTML('beforeend', html);
}

function scrollChatToBottom() {
  const el = document.getElementById('chat-msgs');
  if (el) el.scrollTop = el.scrollHeight;
}

// Sizes .chat-thread to exactly fill the space between wherever it
// starts (below the sticky section bar / mobile top bar) and the
// bottom of the screen (above the mobile tab bar, if present), so
// the message list scrolls internally and the composer stays pinned
// to the bottom of the screen instead of trailing after the last
// message. Recomputed on resize / orientation change / keyboard
// open, since all of those change the available viewport height.
function sizeChatThread() {
  const wrap = document.querySelector('.chat-thread');
  if (!wrap) return;
  const top = wrap.getBoundingClientRect().top;
  const isMobile = window.matchMedia('(max-width:700px)').matches;
  const bottomGap = isMobile ? 'calc(50px + env(safe-area-inset-bottom))' : '0px';
  wrap.style.height = `calc(100vh - ${top}px - ${bottomGap})`;
}
window.addEventListener('resize', sizeChatThread);
if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeChatThread);

async function sendMessage() {
  const bodyEl = document.getElementById('chat-body');
  const body = bodyEl.value.trim();
  if (!body || !chatOther || !currentSession) return;
  bodyEl.value = '';
  const { data, error } = await sb.from('messages').insert({
    sender_id: currentSession.user.id,
    recipient_id: chatOther.id,
    body
  }).select('*').single();
  if (error) { alert(error.message || 'Failed to send.'); return; }
  if (!document.getElementById(`msg-${data.id}`)) {
    document.getElementById('chat-msgs').insertAdjacentHTML('beforeend', msgBubbleHtml(data, currentSession.user.id));
    scrollChatToBottom();
  }
}

function subscribeChatRealtime(myId, otherId) {
  if (chatChannel) sb.removeChannel(chatChannel);
  chatChannel = sb.channel(`dm-${[myId, otherId].sort().join('-')}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${otherId}` }, payload => {
      const m = payload.new;
      if (m.recipient_id !== myId) return;
      if (document.getElementById(`msg-${m.id}`)) return;
      document.getElementById('chat-msgs')?.insertAdjacentHTML('beforeend', msgBubbleHtml(m, myId));
      scrollChatToBottom();
      sb.from('messages').update({ read: true }).eq('id', m.id);
      // subscribeChatBadge() (auth.js) also reacts to this INSERT and
      // bumps the badge — since we mark it read immediately (thread's
      // open), undo that bump right back down.
      if (typeof unreadChatCount === 'number' && unreadChatCount > 0) {
        unreadChatCount--;
        renderSideNav(); renderMobileChrome();
      }
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', loadChat);
