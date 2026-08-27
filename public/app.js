const leaderboard   = document.getElementById('leaderboard');
const modal         = document.getElementById('modal');
const openModalBtn  = document.getElementById('open-bid-modal');
const closeModalBtn = document.getElementById('close-modal');
const usernameInput = document.getElementById('username-input');
const bidInput      = document.getElementById('bid-input');
const emailInput    = document.getElementById('email-input');
const platformInput = document.getElementById('platform-input');
const imageInput    = document.getElementById('image-input');
const imageRemove   = document.getElementById('image-remove');
const usernameLabel = document.getElementById('username-label');
const platformChoices = document.querySelectorAll('.platform-choice');
const usernameError = document.getElementById('username-error');
const payBtn        = document.getElementById('pay-btn');
const preview       = document.getElementById('preview');
const previewImg    = document.getElementById('preview-img');
const previewName   = document.getElementById('preview-name');
const minBidHint    = document.getElementById('min-bid-hint');
const bannerArea    = document.getElementById('banner-area');
const activityList  = document.getElementById('activity-list');
const themeToggle   = document.getElementById('theme-toggle');
const heroBid       = document.getElementById('hero-bid');
const nextBidAmount  = document.getElementById('next-bid-amount');

const INSTAGRAM_RE = /^[a-zA-Z0-9._]{1,30}$/;
const INITIAL_BID_ROWS = 8;
let showAllBids = false;
let leaderboardPage = 0;
const BIDS_PER_PAGE = 20;

// Keep the visitor's appearance preference across sessions.
const savedTheme = localStorage.getItem('theme');
if (savedTheme !== 'light') document.body.classList.add('dark');
function syncThemeIcon() {
    const dark = document.body.classList.contains('dark');
    themeToggle.textContent = dark ? '☀' : '☾';
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
syncThemeIcon();
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    syncThemeIcon();
});
heroBid?.addEventListener('click', openModal);
platformChoices.forEach((choice) => choice.addEventListener('click', () => {
    platformInput.value = choice.dataset.platform;
    platformChoices.forEach((item) => item.classList.toggle('active', item === choice));
    syncPlatformText();
}));
function syncPlatformText() {
    const name = platformInput.value === 'tiktok' ? 'TikTok' : 'Instagram';
    usernameLabel.textContent = `${name} username`;
    usernameInput.placeholder = name === 'TikTok' ? 'your_tiktok_username' : 'your_username';
    usernameInput.maxLength = name === 'TikTok' ? 24 : 30;
}
syncPlatformText();
imageInput.addEventListener('change', () => {
    const label = imageInput.closest('.image-picker');
    if (label && imageInput.files[0]) { label.querySelector('strong').textContent = imageInput.files[0].name; imageRemove.classList.remove('hidden'); }
});
imageRemove.addEventListener('click', () => { imageInput.value = ''; imageRemove.classList.add('hidden'); imageInput.closest('.image-picker').querySelector('strong').textContent = 'Choose an image'; });

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
    emailInput.value = '';
    imageInput.value = '';
    const imageLabel = imageInput.closest('.image-picker');
    if (imageLabel) imageLabel.querySelector('strong').textContent = 'Choose an image';
    imageRemove.classList.add('hidden');
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
        previewImg.src = `https://unavatar.io/${platformInput.value}/${val}`;
        previewImg.onerror = () => preview.classList.add('hidden');
        previewImg.onload  = () => preview.classList.remove('hidden');
    }, 700);
});

// ── Pay button ─────────────────────────────────────────
payBtn.addEventListener('click', async () => {
    const username   = usernameInput.value.replace('@', '').trim();
    const platform   = platformInput.value;
    let image_url = '';
    const amountRaw  = parseFloat(bidInput.value);
    const email      = emailInput.value.trim();

    const platformName = platform === 'tiktok' ? 'TikTok' : 'Instagram';
    if (!username) { showError(`Please enter your ${platformName} username.`); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { showError('Please enter a valid email for your receipt.'); return; }
    if (!INSTAGRAM_RE.test(username)) { showError(`Invalid ${platformName} username format.`); return; }
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
        const imageFile = imageInput.files?.[0];
        if (imageFile) {
            if (imageFile.size > 2 * 1024 * 1024) throw new Error('Image must be 2 MB or smaller.');
            const form = new FormData();
            form.append('image', imageFile);
            const upload = await fetch('/api/payment/upload-image', { method: 'POST', body: form });
            const uploaded = await upload.json();
            if (!upload.ok || !uploaded.url) throw new Error(uploaded.error || 'Could not upload image.');
            image_url = uploaded.url;
        }
        const res  = await fetch('/api/payment/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, bid_amount: amountCents, email, platform, image_url })
        });
        const data = await res.json();

        if (data.url) {
            window.location.href = data.url;
        } else {
            showError(data.error || 'Something went wrong. Please try again.');
            setPayBtnLoading(false);
        }
    } catch (err) {
        showError(err?.message || 'Could not start payment. Please try again.');
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
            const increment = top >= 100 ? 5 : 1;
            const next = top + increment;
            minBidHint.textContent = `Suggested next bid: €${next.toFixed(2)}`;
            bidInput.min = '1.00';
            if (nextBidAmount) nextBidAmount.textContent = `€${next.toFixed(2)}`;
        }
    } catch { /* keep default text */ }
}

// ── Leaderboard ────────────────────────────────────────
async function loadLeaderboard() {
    try {
        const res  = await fetch('/api/bids');
        const bids = await res.json();
        renderLeaderboard(bids);
        renderTodayRanking(bids);
        updateStats(bids);
        renderTicker(bids);
        renderActivity(bids);
        updateNextBidAmount(bids);
    } catch {
        leaderboard.innerHTML = '<div class="loading">Could not load rankings. Retrying…</div>';
    }
}

function updateNextBidAmount(bids) {
    if (!nextBidAmount) return;
    if (!bids.length) { nextBidAmount.textContent = '€1'; return; }
    const top = bids[0].bid_amount / 100;
    const increment = top >= 100 ? 5 : 1;
    nextBidAmount.textContent = `€${(top + increment).toFixed(2)}`;
}

function renderLeaderboard(bids) {
    if (!bids.length) {
        leaderboard.innerHTML = '<div class="loading">No bids yet — be the first! 🚀</div>';
        return;
    }

    const start = leaderboardPage * BIDS_PER_PAGE;
    const visibleBids = bids.slice(start, start + BIDS_PER_PAGE);
    leaderboard.innerHTML = visibleBids.map((bid, i) => {
        const rank   = start + i + 1;
        const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
        const badge  = medal
            ? `<div class="rank-num">${medal}</div>`
            : `<div class="rank-num plain">#${rank}</div>`;
        const amount = (bid.bid_amount / 100).toFixed(2);
        const safe   = escapeHtml(bid.username);
        const fallback = `https://ui-avatars.com/api/?name=${safe}&background=e1306c&color=fff&size=100`;

        return `
        <a class="bid-item${rank <= 3 ? ` rank-${rank}` : ''}"
           href="${escapeHtml(bid.profile_url)}" target="_blank" rel="noopener noreferrer"
           data-username="${safe}">
            ${badge}
            <img class="avatar"
                 src="${escapeHtml(bid.image_url)}" alt="@${safe}" loading="lazy"
                 onerror="this.onerror=null;this.src='${fallback}'">
            <div class="bid-info">
                <div class="bid-username">@${safe} <small class="platform-label">${bid.platform === 'tiktok' ? 'TikTok' : 'Instagram'}</small></div>
                <div class="bid-time">${timeAgo(bid.created_at)} · <span class="bid-clicks">${(bid.clicks || 0).toLocaleString()} clicks</span></div>
            </div>
            <div class="bid-amount">€${amount}</div>
        </a>`;
    }).join('');
    const restBoard = document.getElementById('leaderboard-rest');
    if (restBoard) {
        restBoard.innerHTML = '';
        if (leaderboardPage === 0) {
            const topItems = [...leaderboard.querySelectorAll('.bid-item')];
            topItems.slice(5).forEach(item => restBoard.appendChild(item));
        } else {
            visibleBids.forEach((_, i) => { const item = leaderboard.querySelectorAll('.bid-item')[i]; if (item) restBoard.appendChild(item); });
        }
    }
    const pageCount = Math.ceil(bids.length / BIDS_PER_PAGE);
    if (pageCount > 1) {
        const pagination = document.createElement('div');
        pagination.className = 'pagination';
        for (let page = 0; page < pageCount; page += 1) {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = String(page + 1);
            button.className = page === leaderboardPage ? 'active' : '';
            button.addEventListener('click', () => { leaderboardPage = page; renderLeaderboard(bids); window.scrollTo({top: leaderboard.offsetTop - 20, behavior:'smooth'}); });
            pagination.appendChild(button);
        }
        (restBoard || leaderboard).appendChild(pagination);
    }
    document.querySelectorAll('.leaderboard .bid-item').forEach((item) => {
        item.addEventListener('click', () => {
            const username = item.dataset.username;
            if (username) navigator.sendBeacon(`/api/bids/${encodeURIComponent(username)}/click`);
        });
    });
}

function renderTodayRanking(bids) {
    const target = document.getElementById('today-ranking');
    if (!target) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const today = bids.filter(b => parseDbDate(b.paid_at || b.created_at).getTime() >= cutoff).slice(0, 3);
    target.innerHTML = today.length ? today.map((bid, i) => { const safe = escapeHtml(bid.username); const fallback = `https://ui-avatars.com/api/?name=${safe}&background=e1306c&color=fff&size=100`; return `<a class="today-card" href="${escapeHtml(bid.profile_url)}" target="_blank" rel="noopener"><span class="today-rank">#${i + 1}</span><img src="${escapeHtml(bid.image_url)}" alt="@${safe}" onerror="this.onerror=null;this.src='${fallback}'"><span class="today-info"><strong>@${safe}</strong><small>€${(bid.bid_amount / 100).toFixed(2)}</small></span></a>`; }).join('') : '<p class="empty-today">No bids in the last 24 hours.</p>';
}

function updateStats(bids) {
    const bidCount = bids.reduce((sum, bid) => sum + (bid.payment_count || 1), 0);
    document.getElementById('total-bids').textContent   = bidCount;
    document.getElementById('top-bid').textContent      = bids.length ? `€${(bids[0].bid_amount / 100).toFixed(2)}` : '€0';
    const total = bids.reduce((s, b) => s + b.bid_amount, 0);
    const totalRaised = document.getElementById('total-raised');
    if (totalRaised) totalRaised.textContent = `€${(total / 100).toFixed(2)}`;
    const launchTotal = document.getElementById('launch-total');
    const launchHours = document.getElementById('launch-hours');
    if (launchTotal) launchTotal.textContent = `€${(total / 100).toFixed(2)}`;
    if (launchHours) {
        const first = bids.reduce((oldest, bid) => {
            const date = parseDbDate(bid.paid_at || bid.created_at);
            return !oldest || date < oldest ? date : oldest;
        }, null);
        launchHours.textContent = first ? Math.max(0, Math.floor((Date.now() - first.getTime()) / 3600000)).toLocaleString() : '0';
    }
}

// ── Activity Feed ──────────────────────────────────────
let lastSeenTime = null;

function renderActivity(bids) {
    if (!activityList || !bids.length) return;

    const recent = [...bids]
        .sort((a, b) => parseDbDate(b.paid_at || b.created_at) - parseDbDate(a.paid_at || a.created_at))
        .slice(0, 6);

    const isFirstLoad = lastSeenTime === null;
    lastSeenTime = recent[0] ? (recent[0].paid_at || recent[0].created_at) : lastSeenTime;

    if (isFirstLoad) {
        activityList.innerHTML = recent.map(b => activityItemHTML(b)).join('');
        return;
    }

    // Prepend genuinely new items with slide-in animation
    const newBids = recent.filter(b => parseDbDate(b.paid_at || b.created_at) > parseDbDate(lastSeenTime));
    lastSeenTime = recent[0] ? (recent[0].paid_at || recent[0].created_at) : lastSeenTime;
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
        <span class="act-time">${timeAgo(b.paid_at || b.created_at)}</span>
    </div>`;
}

// ── Ticker ────────────────────────────────────
function renderTicker(bids) {
    const track = document.getElementById('ticker-track');
    if (!bids.length || !track) return;

    // Sort by most recent for the ticker
    const recent = [...bids].sort((a, b) => parseDbDate(b.paid_at || b.created_at) - parseDbDate(a.paid_at || a.created_at));

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
    const diff = Math.floor((Date.now() - parseDbDate(dateStr).getTime()) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// SQLite CURRENT_TIMESTAMP is UTC but has no timezone suffix. Add one before
// parsing so browsers do not interpret it as local time.
function parseDbDate(value) {
    const raw = String(value || '');
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
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
    showPaymentStatus(params.get('session_id'));
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

async function showPaymentStatus(sessionId) {
    if (!sessionId) {
        showBanner('Payment completed. Your bid is being verified.', 'success');
        return;
    }
    const statusEl = document.getElementById('payment-status');
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Payment received. Confirming your bid...';
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            const res = await fetch(`/api/payment/status/${encodeURIComponent(sessionId)}`);
            if (res.ok) {
                const bid = await res.json();
                if (bid.status === 'paid') {
                    statusEl.textContent = `Payment confirmed for @${bid.username}. Your spot is now live.`;
                    loadLeaderboard();
                    return;
                }
            }
        } catch { /* retry while Stripe delivers the webhook */ }
        await new Promise(resolve => setTimeout(resolve, 2500));
    }
    statusEl.textContent = 'Payment received. Your bid is awaiting final confirmation.';
}

// ── Init ───────────────────────────────────────────────
loadLeaderboard();
setInterval(loadLeaderboard, 30000);
