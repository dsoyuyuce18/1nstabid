const leaderboard   = document.getElementById('leaderboard');
const modal         = document.getElementById('modal');
const openModalBtn  = document.getElementById('open-bid-modal');
const closeModalBtn = document.getElementById('close-modal');
const usernameInput = document.getElementById('username-input');
const bidInput      = document.getElementById('bid-input');
const usernameError = document.getElementById('username-error');
const payBtn        = document.getElementById('pay-btn');
const preview       = document.getElementById('preview');
const previewImg    = document.getElementById('preview-img');
const previewName   = document.getElementById('preview-name');
const minBidHint    = document.getElementById('min-bid-hint');
const bannerArea    = document.getElementById('banner-area');
const activityList  = document.getElementById('activity-list');

const INSTAGRAM_RE = /^[a-zA-Z0-9._]{1,30}$/;

// ── Session ID (for online tracking) ──────────────────
let sessionId = localStorage.getItem('_sid');
if (!sessionId) {
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('_sid', sessionId);
}

async function heartbeat() {
    try {
        const res  = await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sid: sessionId })
        });
        const data = await res.json();
        document.getElementById('online-count').textContent  = data.online;
        document.getElementById('visitor-count').textContent = data.visitors.toLocaleString();
    } catch { /* silent */ }
}

heartbeat();
setInterval(heartbeat, 30000);

// ── Modal open/close ───────────────────────────────────
openModalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function openModal() {
    modal.classList.remove('hidden');
    setTimeout(() => usernameInput.focus(), 60);
    updateMinBidHint();
}

function closeModal() {
    modal.classList.add('hidden');
    usernameInput.value = '';
    bidInput.value = '';
    hideError();
    preview.classList.add('hidden');
}

// ── Instagram username live preview ───────────────────
let previewTimeout;
usernameInput.addEventListener('input', () => {
    clearTimeout(previewTimeout);
    hideError();
    const val = usernameInput.value.replace('@', '').trim();
    if (!val) { preview.classList.add('hidden'); return; }
    if (!INSTAGRAM_RE.test(val)) {
        showError('Only letters, numbers, dots ( . ) and underscores ( _ ) — max 30 characters.');
        preview.classList.add('hidden');
        return;
    }
    previewTimeout = setTimeout(() => {
        previewName.textContent = `@${val}`;
        previewImg.src = `https://unavatar.io/instagram/${val}`;
        previewImg.onerror = () => preview.classList.add('hidden');
        previewImg.onload  = () => preview.classList.remove('hidden');
    }, 700);
});

// ── Pay button ─────────────────────────────────────────
payBtn.addEventListener('click', async () => {
    const username   = usernameInput.value.replace('@', '').trim();
    const amountRaw  = parseFloat(bidInput.value);

    if (!username) { showError('Please enter your Instagram username.'); return; }
    if (!INSTAGRAM_RE.test(username)) { showError('Invalid Instagram username format.'); return; }
    hideError();

    if (!amountRaw || amountRaw < 1) {
        bidInput.focus();
        minBidHint.style.color = '#ff4d6d';
        setTimeout(() => minBidHint.style.color = '', 2000);
        return;
    }

    const amountCents = Math.round(amountRaw * 100);
    setPayBtnLoading(true);

    try {
        const res  = await fetch('/api/payment/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, bid_amount: amountCents })
        });
        const data = await res.json();

        if (data.url) {
            window.location.href = data.url;
        } else {
            showError(data.error || 'Something went wrong. Please try again.');
            setPayBtnLoading(false);
        }
    } catch {
        showError('Network error. Please check your connection and try again.');
        setPayBtnLoading(false);
    }
});

function setPayBtnLoading(on) {
    payBtn.disabled    = on;
    payBtn.textContent = on ? 'Redirecting to payment…' : 'Pay with Card / Apple Pay / Google Pay';
}

function showError(msg) {
    usernameError.textContent = msg;
    usernameError.classList.remove('hidden');
}
function hideError() {
    usernameError.textContent = '';
    usernameError.classList.add('hidden');
}

// ── Min-bid hint ───────────────────────────────────────
async function updateMinBidHint() {
    try {
        const res  = await fetch('/api/bids');
        const bids = await res.json();
        if (bids.length > 0) {
            const top = bids[0].bid_amount / 100;
            minBidHint.textContent = `To outbid #1 you need more than €${top.toFixed(2)}`;
        }
    } catch { /* keep default text */ }
}

// ── Leaderboard ────────────────────────────────────────
async function loadLeaderboard() {
    try {
        const res  = await fetch('/api/bids');
        const bids = await res.json();
        renderLeaderboard(bids);
        updateStats(bids);
        renderTicker(bids);
        renderActivity(bids);
    } catch {
        leaderboard.innerHTML = '<div class="loading">Could not load rankings. Retrying…</div>';
    }
}

function renderLeaderboard(bids) {
    if (!bids.length) {
        leaderboard.innerHTML = '<div class="loading">No bids yet — be the first! 🚀</div>';
        return;
    }

    leaderboard.innerHTML = bids.map((bid, i) => {
        const rank   = i + 1;
        const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
        const badge  = medal
            ? `<div class="rank-num">${medal}</div>`
            : `<div class="rank-num plain">#${rank}</div>`;
        const amount = (bid.bid_amount / 100).toFixed(2);
        const safe   = escapeHtml(bid.username);
        const fallback = `https://ui-avatars.com/api/?name=${safe}&background=e1306c&color=fff&size=100`;

        return `
        <a class="bid-item${rank <= 3 ? ` rank-${rank}` : ''}"
           href="${escapeHtml(bid.profile_url)}" target="_blank" rel="noopener noreferrer">
            ${badge}
            <img class="avatar"
                 src="${escapeHtml(bid.image_url)}" alt="@${safe}" loading="lazy"
                 onerror="this.onerror=null;this.src='${fallback}'">
            <div class="bid-info">
                <div class="bid-username">@${safe}</div>
                <div class="bid-time">${timeAgo(bid.created_at)}</div>
            </div>
            <div class="bid-amount">€${amount}</div>
        </a>`;
    }).join('');
}

function updateStats(bids) {
    document.getElementById('total-bids').textContent   = bids.length;
    document.getElementById('top-bid').textContent      = bids.length ? `€${(bids[0].bid_amount / 100).toFixed(2)}` : '€0';
    const total = bids.reduce((s, b) => s + b.bid_amount, 0);
    document.getElementById('total-raised').textContent = `€${(total / 100).toFixed(2)}`;
}

// ── Activity Feed ──────────────────────────────────────
let lastSeenTime = null;

function renderActivity(bids) {
    if (!activityList || !bids.length) return;

    const recent = [...bids]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 6);

    const isFirstLoad = lastSeenTime === null;
    lastSeenTime = recent[0]?.created_at ?? lastSeenTime;

    if (isFirstLoad) {
        activityList.innerHTML = recent.map(b => activityItemHTML(b)).join('');
        return;
    }

    // Prepend genuinely new items with slide-in animation
    const newBids = recent.filter(b => new Date(b.created_at) > new Date(lastSeenTime));
    lastSeenTime = recent[0]?.created_at ?? lastSeenTime;
    for (const b of newBids.reverse()) {
        const el = document.createElement('div');
        el.innerHTML = activityItemHTML(b);
        activityList.prepend(el.firstElementChild);
    }
    while (activityList.children.length > 6) activityList.removeChild(activityList.lastChild);
}

function activityItemHTML(b) {
    const safe     = escapeHtml(b.username);
    const amount   = (b.bid_amount / 100).toFixed(2);
    const fallback = `https://ui-avatars.com/api/?name=${safe}&background=e1306c&color=fff&size=56`;
    return `<div class="activity-item">
        <img src="${escapeHtml(b.image_url)}" alt="" onerror="this.src='${fallback}'">
        <span class="act-user">@${safe}</span>
        <span style="color:var(--muted);font-size:12px">placed a bid</span>
        <span class="act-amount">\u20ac${amount}</span>
        <span class="act-time">${timeAgo(b.created_at)}</span>
    </div>`;
}

// ── Ticker ────────────────────────────────────
function renderTicker(bids) {
    const track = document.getElementById('ticker-track');
    if (!bids.length || !track) return;

    // Sort by most recent for the ticker
    const recent = [...bids].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const makeItems = () => recent.map(b => {
        const safe   = escapeHtml(b.username);
        const amount = (b.bid_amount / 100).toFixed(2);
        const fallback = `https://ui-avatars.com/api/?name=${safe}&background=e1306c&color=fff&size=40`;
        return `<span class="ticker-item">
            <span class="ticker-dot"></span>
            <img src="${escapeHtml(b.image_url)}" alt="" onerror="this.src='${fallback}'">
            <span>@${safe} bid <strong>€${amount}</strong></span>
        </span>`;
    }).join('<span class="ticker-sep">•</span>');

    // Duplicate for seamless loop
    track.innerHTML = makeItems() + '<span class="ticker-sep" style="padding:0 28px"></span>' + makeItems();
}

function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── URL banners (success / cancel) ────────────────────
const params = new URLSearchParams(window.location.search);
if (params.get('success') === 'true') {
    showBanner('🎉 Payment confirmed! Your spot will appear in the rankings shortly.', 'success');
    window.history.replaceState({}, '', '/');
} else if (params.get('canceled') === 'true') {
    showBanner('Payment was canceled — no charge was made. Try again anytime!', 'info');
    window.history.replaceState({}, '', '/');
}

function showBanner(msg, type) {
    const el = document.createElement('div');
    el.className = `banner ${type}`;
    el.textContent = msg;
    bannerArea.appendChild(el);
    setTimeout(() => el.remove(), 8000);
}

// ── Init ───────────────────────────────────────────────
loadLeaderboard();
setInterval(loadLeaderboard, 30000);
