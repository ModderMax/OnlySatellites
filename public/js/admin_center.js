document.addEventListener('DOMContentLoaded', async () => {
  const statsDiv = document.getElementById('admin-center-stats');
  const VAR_OPTIONS = [
    'bg','bg-dark','bg-light','border','border-muted',
    'danger','highlight','info','primary','secondary',
    'success','text','text-muted','warning'
  ];
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Supported encodings
  const ENCODINGS = ['hex', 'rgb', 'hsl', 'oklch'];

  // DOM nodes
  const modal = document.getElementById('themeModal');
  const openBtn = document.getElementById('openThemeBtn');
  const closeBtn = document.getElementById('themeCloseBtn');
  const cancelBtn = document.getElementById('themeCancelBtn');
  const saveBtn = document.getElementById('themeSaveBtn');
  const addRowBtn = document.getElementById('addThemeRowBtn');
  const rows = document.getElementById('themeRows');
  const msg = document.getElementById('themeMsg');
  //composites
  const cmodal = $('#composites-modal');
  const tbody = $('#composites-table tbody');
  const cmsg = $('#comp-msg');
  const btnOpen = $('#btn-open-composites');
  const btnAdd = $('#btn-add-composite');
  const btnSave = $('#btn-save-composites');
  //users
const umodal      = document.getElementById('users-modal');
const uOpenBtn    = document.getElementById('btn-open-users');
const uTbody      = document.querySelector('#users-table tbody');
const uMsg        = document.getElementById('users-msg');
const uBtnAdd     = document.getElementById('btn-add-user');
const uBtnSave    = document.getElementById('btn-save-users');
// Rate limiting inputs
const updateCdInput   = document.getElementById('update-cd');
const passLimitInput  = document.getElementById('pass-limit');
const satRateInput    = document.getElementById('satdump-rate');
const satSpanInput    = document.getElementById('satdump-span');

  // ---- Helpers: color conversions ----
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
  function rgbToHsl(r, g, b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h, s, l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{
      const d=max-min;
      s=l>0.5? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h=(g-b)/d + (g<b?6:0); break;
        case g: h=(b-r)/d + 2; break;
        case b: h=(r-g)/d + 4; break;
      }
      h/=6;
    }
    return {h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100)};
  }

  // sRGB -> linear
  const srgbToLinear = c => {
    c /= 255;
    return (c <= 0.04045) ? c/12.92 : Math.pow((c + 0.055)/1.055, 2.4);
  };
  // linear sRGB -> OKLab -> OKLCH
  function rgbToOKLCH(r8,g8,b8){
    const r = srgbToLinear(r8), g = srgbToLinear(g8), b = srgbToLinear(b8);

    // linear sRGB to LMS (via OKLab paper)
    const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b;
    const m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b;
    const s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;

    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);

    const L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_;
    const a = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_;
    const b2= 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_;

    const C = Math.sqrt(a*a + b2*b2);
    let H = Math.atan2(b2, a) * 180/Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  }

  function formatValue(enc, hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '';
    if (enc === 'hex') return hex.toLowerCase();
    if (enc === 'rgb') return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    if (enc === 'hsl') {
      const {h,s,l} = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return `hsl(${h} ${s}% ${l}%)`;
    }
    if (enc === 'oklch') {
      const {L,C,H} = rgbToOKLCH(rgb.r, rgb.g, rgb.b);
      // Round to sane precision
      const l = (Math.round(L*1000)/1000).toFixed(3);      // 0..1
      const c = (Math.round(C*1000)/1000).toFixed(3);      // ~0..0.4 typical
      const h = Math.round(H);                             // degrees
      return `oklch(${l} ${c} ${h})`;
    }
    return hex.toLowerCase();
  }

  function makeVarSelect(selected = '') {
    const sel = document.createElement('select');
    VAR_OPTIONS.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (v === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function makeEncodingSelect(selected = 'hex') {
    const sel = document.createElement('select');
    ENCODINGS.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (v === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function addThemeRow(initial = {variable: VAR_OPTIONS[0], encoding: 'hex', color: '#2a6df4', value: ''}) {
    const row = document.createElement('div');
    row.className = 'theme-row';

    const varSel = makeVarSelect(initial.variable);
    const encSel = makeEncodingSelect(initial.encoding);
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = initial.color || '#2a6df4';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'computed value…';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'theme-row-del';
    delBtn.title = 'Remove';
    delBtn.textContent = '−';

    // compute initial value
    valInput.value = initial.value || formatValue(encSel.value, colorInput.value);

    // wire interactions
    colorInput.addEventListener('input', () => {
      valInput.value = formatValue(encSel.value, colorInput.value);
    });
    encSel.addEventListener('change', () => {
      valInput.value = formatValue(encSel.value, colorInput.value);
    });
    delBtn.addEventListener('click', () => row.remove());

    row.appendChild(varSel);
    row.appendChild(encSel);
    row.appendChild(colorInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    rows.appendChild(row);
  }

  // ---- Modal plumbing ----
  function openThemePopup() {
    msg.textContent = '';
    msg.className = 'theme-msg';
    modal.setAttribute('aria-hidden', 'false');
    if (!rows.children.length) {
      addThemeRow(); // at least one
    }
    const firstInput = rows.querySelector('select, input');
    if (firstInput) firstInput.focus();
    document.addEventListener('keydown', escToClose);
  }
  function closeThemePopup() {
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', escToClose);
  }
  function escToClose(e) { if (e.key === 'Escape') closeThemePopup(); }

  // ---- Submit to API ----
  async function submitTheme() {
    // gather rows; later row with same var overrides earlier
    const payload = {};
    for (const row of rows.querySelectorAll('.theme-row')) {
      const varName = row.querySelector('select')?.value;
      const val = row.querySelector('input[type="text"]')?.value.trim();
      if (varName && val) payload[varName] = val;
    }
    const keys = Object.keys(payload);
    if (!keys.length) {
      msg.textContent = 'Please add at least one variable/value.';
      msg.className = 'theme-msg error';
      return;
    }

    saveBtn.disabled = true;
    msg.textContent = 'Saving…'; msg.className = 'theme-msg';
    try {
      const res = await fetch('/api/config/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text().catch(()=>'HTTP '+res.status));
      msg.textContent = 'Theme updated successfully.'; msg.className = 'theme-msg ok';
      setTimeout(closeThemePopup, 700);
    } catch (e) {
      msg.textContent = 'Failed to save: ' + e.message;
      msg.className = 'theme-msg error';
    } finally {
      saveBtn.disabled = false;
    }
  }

  const rowsEl = document.getElementById('satdump-rows');
  const addBtn = document.getElementById('satdump-add');
  const saveSatdumpBtn = document.getElementById('satdump-save');
  let satdumpOriginalNames = new Set();

  const hwSelect = document.getElementById('hwmonitor');
  const archToggle = document.getElementById('archive-active');
  const archBlock  = document.getElementById('archive-advanced');
  const archSpan   = document.getElementById('archive-span');
  const archRetain = document.getElementById('archive-retain');
  const cleanDays  = document.getElementById('archive-clean');
  const saveSettingsBtn    = document.getElementById('settings-save');
  const statusEl   = document.getElementById('settings-status');

  // --- Satdump instances UI helpers ---
function makeInstanceRow(name = '', address = '', port = '', isNew = true) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.new = isNew ? '1' : '0';
  row.dataset.orig = name; // used to detect renames/deletes

  row.innerHTML = `
    <input type="text"  class="sd-name"    placeholder="Name (e.g., APT Station)" value="${escapeHtml(name)}" aria-label="Satdump name">
    <input type="text"  class="sd-address" placeholder="Address (blank = local)"  value="${escapeHtml(address)}" aria-label="Satdump address">
    <input type="number" class="sd-port"   placeholder="Port (e.g., 8081)"        value="${escapeHtml(port)}" min="0" max="65535" step="1" aria-label="Satdump port">
    <button type="button" class="remove" title="Remove">×</button>
  `;
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  rowsEl.appendChild(row);
}

  function clearInstanceRows() {
    rowsEl.innerHTML = '';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // --- Archiving dependent block ---
  function updateArchiveVisibility() {
    archBlock.style.display = archToggle.checked ? 'block' : 'none';
  }
  archToggle.addEventListener('change', updateArchiveVisibility);

  // --- Prefill from server ---
  async function prefillSettings() {
    statusEl.textContent = 'Loading…';
    await loadSatdumpList();
    try {
      const res = await fetch('/local/api/settings', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const settings = await res.json(); 

      // Hardware monitor
      if (typeof settings['hwmonitor'] === 'string') {
        const v = settings['hwmonitor'].toLowerCase();
        if (['off', 'hwinfo', 'native'].includes(v)) {
          hwSelect.value = v;
        }
      }

      // Archiving
      const active = (settings['archive.active'] === '1');
      archToggle.checked = active;

      if (active) {
        if (settings['archive.span']) {
          const span = parseInt(settings['archive.span'], 10);
          if (!isNaN(span) && span > 0) archSpan.value = String(span);
        }
        if (typeof settings['archive.retainData'] === 'string') {
          archRetain.checked = (settings['archive.retainData'].toLowerCase() === 'true');
        }
      }
      updateArchiveVisibility();

      // Delete passes (always present)
      if (settings['archive.clean'] != null) {
        const clean = parseInt(settings['archive.clean'], 10);
        if (!isNaN(clean) && clean >= 0) cleanDays.value = String(clean);
      }
      if (settings['update_cd'] != null) {
  const v = parseInt(settings['update_cd'], 10);
  if (!isNaN(v) && v >= 0) updateCdInput.value = String(v);
}
if (settings['pass_limit'] != null) {
  const v = parseInt(settings['pass_limit'], 10);
  if (!isNaN(v) && v >= 0) passLimitInput.value = String(v);
}
if (settings['satdump_rate'] != null) {
  const v = parseInt(settings['satdump_rate'], 10);
  if (!isNaN(v) && v >= 0) satRateInput.value = String(v);
}
if (settings['satdump_span'] != null) {
  const v = parseInt(settings['satdump_span'], 10);
  if (!isNaN(v) && v >= 0) satSpanInput.value = String(v);
}

      statusEl.textContent = 'Loaded';
      setTimeout(()=>{ statusEl.textContent=''; }, 1500);
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Load failed: ${err.message}`;
    }
  }

async function loadSatdumpList() {
  satdumpOriginalNames = new Set();
  clearInstanceRows();
  try {
    const res = await fetch('/local/api/satdump', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json(); // [{name, address, port}, ...]
    if (Array.isArray(list) && list.length) {
      // Stable sort by name
      list.sort((a,b)=> String(a.name).localeCompare(String(b.name)));
      for (const sd of list) {
        makeInstanceRow(sd.name || '', sd.address || '', String(sd.port ?? '0'), /*isNew*/false);
        if (sd.name) satdumpOriginalNames.add(sd.name);
      }
    } else {
      // no rows — show one blank row to guide
      makeInstanceRow();
    }
  } catch (e) {
    console.error('Failed to load satdump list:', e);
    // still show one row so user can add
    makeInstanceRow();
  }
}

function clearInstanceRows() {
  rowsEl.innerHTML = '';
}

  // --- Build payload and POST ---
  async function saveSettings() {
    const payload = {};
    rowsEl.querySelectorAll('.row').forEach(row => {
      const name = row.querySelector('.sd-name').value.trim();
      const port = row.querySelector('.sd-port').value.trim();
      if (!name || !port) return;
      payload[`satdump.${name}`] = port;
    });

    payload['hwmonitor'] = hwSelect.value;

    const on = archToggle.checked;
    payload['archive.active'] = on ? '1' : '0';

    if (on) {
      const spanVal = Math.max(1, parseInt(archSpan.value || '60', 10));
      payload['archive.span'] = String(spanVal);
    }

    const cleanVal = Math.max(0, parseInt(cleanDays.value || '0', 10));
    payload['archive.clean'] = String(cleanVal);

    {
  const v = parseInt(updateCdInput.value || '0', 10);
  if (!isNaN(v) && v >= 0) payload['update_cd'] = String(v); // seconds
}
{
  const v = parseInt(passLimitInput.value || '0', 10);
  if (!isNaN(v) && v >= 0) payload['pass_limit'] = String(v); // whole number
}
{
  const v = parseInt(satRateInput.value || '0', 10);
  if (!isNaN(v) && v >= 0) payload['satdump_rate'] = String(v); // ms
}
{
  const v = parseInt(satSpanInput.value || '0', 10);
  if (!isNaN(v) && v >= 0) payload['satdump_span'] = String(v); // seconds
}

    statusEl.textContent = 'Saving…';

    try {
      const res = await fetch('/local/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
      statusEl.textContent = `Saved (${data.updated} updated)`;
      setTimeout(()=>{ statusEl.textContent=''; }, 2500);
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Save failed: ${err.message}`;
    }
  }

  async function copenModal() {
    clearMsg();
    cmodal.classList.remove('hidden');
    await loadComposites();
  }
  function ccloseModal() {
    cmodal.classList.add('hidden');
    tbody.innerHTML = '';
  }

  function toastOk(t){ cmsg.textContent = t; cmsg.classList.remove('comp-bad'); cmsg.classList.add('comp-ok'); }
  function toastErr(t){ cmsg.textContent = t; cmsg.classList.remove('comp-ok'); cmsg.classList.add('comp-bad'); }
  function clearMsg(){ cmsg.textContent=''; cmsg.classList.remove('comp-ok','comp-bad'); }
  function utoastOk(t){ uMsg.textContent = t; uMsg.classList.remove('comp-bad'); uMsg.classList.add('comp-ok'); }
  function utoastErr(t){ uMsg.textContent = t; uMsg.classList.remove('comp-ok'); uMsg.classList.add('comp-bad'); }
  function uclearMsg(){ uMsg.textContent=''; uMsg.classList.remove('comp-ok','comp-bad'); }
  function showToast(msg) {
  let toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.background = "rgba(0,0,0,0.8)";
  toast.style.color = "#fff";
  toast.style.padding = "10px 15px";
  toast.style.borderRadius = "6px";
  toast.style.zIndex = 9999;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.5s";
    toast.style.opacity = 0;
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

  async function loadComposites() {
    tbody.innerHTML = '';
    try {
      const res = await fetch('/local/api/composites', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch composites');
      const list = await res.json();
      list.forEach(c => caddRow({
        key: c.key, name: c.name, enabled: c.enabled === true || c.enabled === 1
      }, /*isNew*/false));
    } catch (e) {
      toastErr(e.message);
    }
  }

  function caddRow(c = {key:'', name:'', enabled:true}, isNew = true) {
    const tr = document.createElement('tr');
    tr.dataset.new = isNew ? '1' : '0';
    tr.innerHTML = `
      <td>
        <input type="text" class="comp-key" value="${escapeHtml(c.key)}" ${isNew ? '' : 'readonly'}>
      </td>
      <td>
        <input type="text" class="comp-name" value="${escapeHtml(c.name)}">
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="comp-enabled" ${c.enabled ? 'checked' : ''}>
      </td>
      <td>
        <button type="button" class="comp-del">Delete</button>
      </td>
    `;
    tr.querySelector('.comp-del').addEventListener('click', () => conDeleteRow(tr));
    tbody.appendChild(tr);
  }

  async function conDeleteRow(tr) {
    clearMsg();
    const key = tr.querySelector('.comp-key').value.trim();
    const isNew = tr.dataset.new === '1';
    if (isNew || !key) {
      tr.remove();
      return;
    }
    if (!confirm(`Delete composite "${key}"?`)) return;
    try {
      const res = await fetch('/local/api/composites/' + encodeURIComponent(key), {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Delete failed');
      tr.remove();
      toastOk(`Deleted ${key}`);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function csaveAll() {
    clearMsg();
    btnSave.disabled = true;
    try {
      const rows = $$('#composites-table tbody tr');
      const payloads = rows.map(tr => {
        return {
          key: tr.querySelector('.comp-key').value.trim(),
          name: tr.querySelector('.comp-name').value.trim(),
          enabled: tr.querySelector('.comp-enabled').checked
        };
      });

      // Basic validation
      for (const p of payloads) {
        if (!p.key || !p.name) {
          throw new Error('Each row needs a non-empty key and name.');
        }
      }

      // Upsert each row (server handles insert/update)
      for (const p of payloads) {
        const res = await fetch('/local/api/composites', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          credentials: 'include',
          body: JSON.stringify(p)
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          throw new Error(`Save failed for "${p.key}": ${txt || res.status}`);
        }
      }
      toastOk('All composites saved.');
      await loadComposites(); // refresh & lock keys
    } catch (e) {
      toastErr(e.message);
    } finally {
      btnSave.disabled = false;
    }
  }

  async function uopenModal() {
  uclearMsg();
  umodal.classList.remove('hidden');
  await uloadUsers();
}
function ucloseModal() {
  umodal.classList.add('hidden');
  uTbody.innerHTML = '';
}
umodal.addEventListener('click', (e) => { if (e.target.dataset.uclose) ucloseModal(); });
uOpenBtn?.addEventListener('click', uopenModal);

// Build a row (existing or new)
function uaddRow(u = { id:null, username:'', level:5 }, isNew = true) {
  const tr = document.createElement('tr');
  tr.dataset.new = isNew ? '1' : '0';
  tr.dataset.id  = u.id ?? '';

  tr.innerHTML = `
    <td>
      <input type="text" class="u-username" value="${escapeHtml(u.username||'')}" ${isNew ? '' : ''} aria-label="Username">
    </td>
    <td>
      <input type="number" class="u-level" min="0" max="10" step="1" value="${Number.isFinite(u.level)? u.level : 5}" aria-label="Auth level">
    </td>
    <td style="display:flex; gap:6px; align-items:center;">
      <input type="text" class="u-password" placeholder="(leave blank to keep)" aria-label="Password">
      <button type="button" class="u-gen" title="Generate">🎲</button>
    </td>
    <td>
      <button type="button" class="u-reset">Reset</button>
      <button type="button" class="u-del" ${isNew?'disabled':''} title="Delete">Delete</button>
    </td>
  `;

  // Wire buttons
  const genBtn   = tr.querySelector('.u-gen');
  const resetBtn = tr.querySelector('.u-reset');
  const delBtn   = tr.querySelector('.u-del');

  genBtn.addEventListener('click', () => {
    // client-side random; server will hash on reset
    const pw = Math.random().toString(36).slice(-10) + '!';
    tr.querySelector('.u-password').value = pw;
  });

  resetBtn.addEventListener('click', async () => {
    uclearMsg();
    const id = Number(tr.dataset.id||0);
    const pw = tr.querySelector('.u-password').value.trim();
    if (!id) { utoastErr('Save row first, then reset password.'); return; }
    if (!pw) { // ask server to generate if empty
      try {
        const res = await fetch(`/local/api/users/${id}/reset-password`, {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({ generate: true })
        });
        const data = await res.json().catch(()=> ({}));
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
        tr.querySelector('.u-password').value = data.newPassword || '';
        utoastOk('Password generated.');
      } catch (e) { utoastErr('Reset failed: '+e.message); }
      return;
    }
    // explicit new password
    try {
      const res = await fetch(`/local/api/users/${id}/reset-password`, {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
        body: JSON.stringify({ newPassword: pw })
      });
      if (!res.ok) throw new Error(await res.text().catch(()=>`HTTP ${res.status}`));
      utoastOk('Password updated.');
    } catch (e) { utoastErr('Reset failed: '+e.message); }
  });

  delBtn.addEventListener('click', async () => {
    uclearMsg();
    if (tr.dataset.new === '1') { tr.remove(); return; }
    const id = Number(tr.dataset.id||0);
    if (!id) return;
    if (!confirm(`Delete user "${tr.querySelector('.u-username').value}"?`)) return;
    try {
      const res = await fetch(`/local/api/users/${id}`, { method:'DELETE', credentials:'include' });
      if (!res.ok) throw new Error(await res.text().catch(()=>`HTTP ${res.status}`));
      tr.remove();
      utoastOk('User deleted.');
    } catch (e) { utoastErr('Delete failed: '+e.message); }
  });

  uTbody.appendChild(tr);
}

async function uloadUsers() {
  uTbody.innerHTML = '';
  try {
    const res = await fetch('/local/api/users', { credentials:'include' });
    if (!res.ok) throw new Error('Failed to fetch users');
    const list = await res.json();
    // list like: [{id, username, level}]
    if (list != null)
    {
      list.forEach(u => uaddRow({ id:u.id, username:u.username, level: u.level }, false));
    }
  } catch (e) {
    utoastErr(e.message);
  }
}

async function usaveAll() {
  uclearMsg();
  uBtnSave.disabled = true;
  try {
    // Validate + upsert all rows
    const rows = Array.from(uTbody.querySelectorAll('tr'));
    for (const tr of rows) {
      const isNew   = tr.dataset.new === '1';
      const id      = Number(tr.dataset.id||0);
      const user    = tr.querySelector('.u-username').value.trim();
      const level   = parseInt(tr.querySelector('.u-level').value, 10);
      const pwField = tr.querySelector('.u-password');
      const pw      = (pwField.value||'').trim();

      if (!user || isNaN(level) || level<0 || level>10) {
        throw new Error('Each row needs a username and a level 0..10.');
      }

      if (isNew) {
        if (!pw) throw new Error(`New user "${user}" requires a password (or use 🎲 then Save).`);
        const res = await fetch('/local/api/users', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          credentials:'include',
          body: JSON.stringify({ username:user, level, password: pw })
        });
        const data = await res.json().catch(()=> ({}));
        if (!res.ok) throw new Error(data.error || `Create failed for "${user}"`);
        // lock it as existing
        tr.dataset.new = '0';
        tr.dataset.id  = data.id;
        tr.querySelector('.u-del').disabled = false;
        pwField.value = ''; // clear
      } else {
        // update username if changed
        // (we’ll PUT both username and level every save to keep logic simple)
        {
          const res = await fetch(`/local/api/users/${id}/username`, {
            method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({ username: user })
          });
          if (!res.ok) throw new Error(`Update username failed for id=${id}`);
        }
        {
          const res = await fetch(`/local/api/users/${id}/level`, {
            method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({ level })
          });
          if (!res.ok) throw new Error(`Update level failed for id=${id}`);
        }
        // If a password was typed, do a reset in the same Save pass
        if (pw) {
          const res = await fetch(`/local/api/users/${id}/reset-password`, {
            method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
            body: JSON.stringify({ newPassword: pw })
          });
          if (!res.ok) throw new Error(`Password reset failed for "${user}"`);
          pwField.value = '';
        }
      }
    }
    utoastOk('All users saved.');
    await uloadUsers();
  } catch (e) {
    utoastErr(e.message);
  } finally {
    uBtnSave.disabled = false;
  }
}

async function saveSatdump() {
  saveSatdumpBtn.disabled = true;
  statusEl.textContent = 'Saving Satdump…';

  try {
    // Build current view
    const rows = Array.from(rowsEl.querySelectorAll('.row'));
    const current = rows.map(r => {
      const name = r.querySelector('.sd-name').value.trim();
      const address = r.querySelector('.sd-address').value.trim(); // may be ""
      const portStr = r.querySelector('.sd-port').value.trim();
      const port = portStr === '' ? 0 : Math.max(0, Math.min(65535, parseInt(portStr, 10) || 0));
      return { el: r, name, address, port, isNew: r.dataset.new === '1', orig: r.dataset.orig || '' };
    });

    // Basic validation: name required
    for (const c of current) {
      if (!c.name) throw new Error('Each Satdump row needs a non-empty name.');
      if (Number.isNaN(c.port) || c.port < 0 || c.port > 65535) {
        throw new Error(`Invalid port for "${c.name}" (must be 0..65535).`);
      }
    }

    // 1) Upserts (Create new, PUT existing — we treat rename as delete+create)
    for (const c of current) {
      const isRename = c.orig && c.orig !== c.name;
      if (c.isNew || isRename || !satdumpOriginalNames.has(c.name)) {
        // Try POST create; if 409 or duplicate, you could switch to PUT flow.
        const res = await fetch('/local/api/satdump', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          credentials: 'include',
          body: JSON.stringify({ name: c.name, address: c.address, port: c.port })
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          throw new Error(`Create failed for "${c.name}": ${txt || res.status}`);
        }
      } else {
        // Existing by name → PUT partial update (idempotent)
        const body = {};
        body.address = c.address; // allow empty string to persist empty
        body.port = c.port;
        const res = await fetch('/local/api/satdump/' + encodeURIComponent(c.name), {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          throw new Error(`Update failed for "${c.name}": ${txt || res.status}`);
        }
      }
    }

    // 2) Deletes: anything originally present but not in current names
    const currentNames = new Set(current.map(c => c.name));
    const toDelete = Array.from(satdumpOriginalNames).filter(n => !currentNames.has(n));
    for (const name of toDelete) {
      const res = await fetch('/local/api/satdump/' + encodeURIComponent(name), {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        throw new Error(`Delete failed for "${name}": ${txt || res.status}`);
      }
    }

    // Reload fresh to lock all rows as existing
    await loadSatdumpList();
    statusEl.textContent = 'Satdump saved';
    setTimeout(()=>{ statusEl.textContent=''; }, 1200);
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Satdump save failed: ${e.message}`;
  } finally {
    saveSatdumpBtn.disabled = false;
  }
}

addBtn?.addEventListener('click', () => makeInstanceRow());
saveSatdumpBtn?.addEventListener('click', saveSatdump);

uBtnAdd?.addEventListener('click', () => uaddRow());   // blank new row
uBtnSave?.addEventListener('click', usaveAll);

  saveSettingsBtn.addEventListener('click', saveSettings);

  updateArchiveVisibility();
  prefillSettings();

  // Wire controls
  openBtn?.addEventListener('click', openThemePopup);
  closeBtn?.addEventListener('click', closeThemePopup);
  cancelBtn?.addEventListener('click', closeThemePopup);
  modal?.querySelector('.theme-modal-backdrop')?.addEventListener('click', closeThemePopup);
  addRowBtn?.addEventListener('click', () => addThemeRow());
  saveBtn?.addEventListener('click', submitTheme);
  btnOpen.addEventListener('click', copenModal);
  cmodal.addEventListener('click', (e) => { if (e.target.dataset.close) ccloseModal(); });
  btnAdd.addEventListener('click', () => caddRow());
  btnSave.addEventListener('click', csaveAll);
  document.getElementById("repopulateBtn").addEventListener("click", async () => {
  try {
    const resp = await fetch("/api/repopulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await resp.json();

    if (resp.ok) {
      const dur = data.duration_ms ? `${data.duration_ms} ms` : "";
      showToast(`${data.message} (${dur})`);
    } else {
      showToast(`Error: ${data.message || "unknown error"}`);
    }
  } catch (err) {
    showToast("Network error: " + err.message);
  }
});

  // Expose if handy elsewhere
  window.openThemePopup = openThemePopup;

  if (!statsDiv) return;

  try {
    const res = await fetch('api/disk-stats');
    const data = await res.json();

    if (data.error) {
      statsDiv.innerHTML = `<p>Error fetching data: ${data.error}</p>`;
      return;
    }

    const formatBytes = (bytes) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
      }
      return `${bytes.toFixed(1)} ${units[i]}`;
    };

    statsDiv.innerHTML = `
      <h2>Disk & Retention Stats</h2>
      <ul>
        <li><strong>Total Disk Size:</strong> ${formatBytes(data.disk.total)}</li>
        <li><strong>Free Disk Space:</strong> ${formatBytes(data.disk.free)}</li>
        <li><strong>Live Output Total Size:</strong> ${formatBytes(data.live_output.totalSize)}</li>
        <li><strong>Live Output (Past 2 Weeks):</strong> ${formatBytes(data.live_output.recentSize)}</li>
        <li><strong>Approx. Data Retention Span:</strong> ${data.estimates.dataRetentionDays ?? 'Unknown'} days</li>
        <li><strong>Approx. Time Until Disk Full:</strong> ${data.estimates.timeToDiskFullDays ?? 'Unknown'} days</li>
      </ul>
    `;
  } catch (err) {
    console.error('Failed to fetch admin stats:', err);
    statsDiv.innerHTML = `<p>Error loading data.</p>`;
  }
});