(() => {
  const body = document.body;
  if (localStorage.getItem('theme') === 'light') body.classList.remove('dark');
  else body.classList.add('dark');
  const header = document.querySelector('.site-header');
  if (header && !document.querySelector('.ticker-wrap')) {
    const ticker = document.createElement('div'); ticker.className = 'ticker-wrap';
    ticker.innerHTML = '<div class="ticker-track"><span class="ticker-item"><span class="ticker-dot"></span>1nstaBid · Live leaderboard · New bids from €1</span></div>';
    header.before(ticker);
  }
  const nav = document.querySelector('.site-header .header-nav');
  if (nav && !nav.querySelector('.theme-toggle')) {
    const button = document.createElement('button'); button.className='theme-toggle'; button.type='button';
    nav.appendChild(button);
    const sync = () => { const dark=body.classList.contains('dark'); button.textContent=dark?'☀':'☾'; button.setAttribute('aria-label', dark?'Switch to light mode':'Switch to dark mode'); };
    sync(); button.addEventListener('click', () => { body.classList.toggle('dark'); localStorage.setItem('theme', body.classList.contains('dark')?'dark':'light'); sync(); });
  }
})();
