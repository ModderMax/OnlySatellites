// Multi-instance iframe viewer for SatDump status HTML (cookie-scoped)
document.addEventListener('DOMContentLoaded', async () => {
  const iframe = document.getElementById('satdump-frame');

  // ---- helpers ----
  function currentInstanceFromPath() {
    const m = location.pathname.match(/\/local\/satdump\/([^\/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.$?*|{}()[]\\/+^]/g,'\\$&') + '=([^;]*)'));
    if (!m) return '';
    // Cookie is url-escaped, spaces may be '+' — normalize both
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return m[1].replace(/\+/g,' '); }
  }

  let current = currentInstanceFromPath();
  let cookieActive = getCookie('satdump_instance');

  // Build a tabbar above the iframe if not present
  let tabbar = document.getElementById('tabbar');
  if (!tabbar) {
    tabbar = document.createElement('div');
    tabbar.id = 'tabbar';
    tabbar.style.display = 'flex';
    tabbar.style.flexWrap = 'wrap';
    tabbar.style.gap = '.5rem';
    tabbar.style.margin = '.5rem 0 1rem';
    (iframe?.parentElement || document.body).insertBefore(tabbar, iframe || null);
  }

  async function listInstances() {
    try {
      const r = await fetch('/local/api/satdump', { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = await r.json();
      return Array.isArray(list) ? list.sort((a,b)=>String(a.name).localeCompare(String(b.name))) : [];
    } catch (e) {
      console.error('load instances failed', e);
      return [];
    }
  }

  function renderTabs(list) {
    const active = current || cookieActive || '';
    tabbar.innerHTML = '';
    for (const sd of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = sd.name || '(unnamed)';
      // inline styles so tabs are visible even without CSS
      b.style.padding = '.35rem .7rem';
      b.style.border = '1px solid #555';
      b.style.borderRadius = '.5rem';
      b.style.cursor = 'pointer';
      b.style.background = (sd.name === active) ? '#444' : 'transparent';
      b.style.color = (sd.name === active) ? '#fff' : 'inherit';
      b.addEventListener('click', () => {
        if (!sd.name || sd.name === active) return;
        // Navigate to set the cookie server-side, then reload page content
        location.assign('/local/satdump/' + encodeURIComponent(sd.name));
      });
      tabbar.appendChild(b);
    }
  }

  function updateIframe() {
    // Cookie-scoped endpoint; server uses cookie to pick instance
    iframe.src = '/local/satdump/html';
  }

  const list = await listInstances();
  renderTabs(list);

  // Initial load: if you land on /local/satdump (no {name} in URL),
  // your server route sets the cookie to the first instance. We just render.
  updateIframe();
  setInterval(updateIframe, 5000);
});
