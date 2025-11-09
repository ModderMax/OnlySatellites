(function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const rowsEl = $('#rows');
  const toastEl = $('#toast');

  const idEl = $('#messageId');
  const titleEl = $('#title');
  const typeEl = $('#type');
  const whenEl = $('#when');
  const msgEl = $('#message');
  const imgEl = $('#image');
  const imgPrevWrap = $('#imgPrev');
  const imgPreview = $('#imgPreview');
  const btnClearImage = $('#btnClearImage');
  const btnSave = $('#btnSave');
  const btnReset = $('#btnReset');
  const btnDelete = $('#btnDelete');
  const formTitle = $('#formTitle');

  const btnRefresh = $('#btnRefresh');

  function toast(text, ms=2200){
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    setTimeout(()=> toastEl.style.display='none', ms);
  }

  function toLocal(ts){
    if (!ts) return '';
    const d = new Date(ts*1000);
    return d.toLocaleString();
  }

  function setFormMode(mode){
    if(mode==='create'){
      formTitle.textContent = 'Create Message';
      btnDelete.style.display = 'none';
    } else {
      formTitle.textContent = 'Edit Message';
      btnDelete.style.display = '';
    }
  }

  function clearForm(){
  idEl.value = '';
  titleEl.value = '';
  typeEl.value = 'info';

  const d = new Date();
  d.setSeconds(0, 0);
  const pad = n => n.toString().padStart(2,'0');
  whenEl.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  msgEl.value = '';
  imgEl.value = '';
  imgPreview.src = '';
  imgPrevWrap.style.display = 'none';
  setFormMode('create');
}

  // Markdown toolbar
  function surroundSelection(startToken, endToken=startToken){
    const el = msgEl;
    const s = el.selectionStart, e = el.selectionEnd;
    const before = el.value.substring(0, s);
    const sel = el.value.substring(s, e);
    const after = el.value.substring(e);
    el.value = before + startToken + sel + endToken + after;
    const cursor = s + startToken.length + sel.length + endToken.length;
    el.focus();
    el.setSelectionRange(cursor, cursor);
  }

  $$('.toolbar button[data-md]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const token = btn.dataset.md;
      // **bold** or *italic*
      surroundSelection(token);
    });
  });

  $('#btnLink').addEventListener('click', ()=>{
    const url = prompt('Enter URL (https://...)');
    if(!url) return;
    surroundSelection('[', `](${url})`);
  });
  $('#btnCode').addEventListener('click', ()=> surroundSelection('`','`'));
  $('#btnList').addEventListener('click', ()=>{
    const el = msgEl;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = el.value.substring(s, e) || 'list item';
    const lines = sel.split(/\n/).map(t => t.trim()?`- ${t}`:'- ').join('\n');
    const before = el.value.substring(0, s);
    const after = el.value.substring(e);
    el.value = before + lines + after;
  });

  // Image preview/remove
  imgEl.addEventListener('change', ()=>{
    const f = imgEl.files && imgEl.files[0];
    if (!f){ imgPrevWrap.style.display='none'; imgPreview.src=''; return; }
    const url = URL.createObjectURL(f);
    imgPreview.src = url;
    imgPrevWrap.style.display = '';
  });
  btnClearImage.addEventListener('click', ()=>{
    imgEl.value = '';
    imgPreview.src='';
    imgPrevWrap.style.display='none';
  });

  // Convert datetime-local -> unix seconds (UTC)
  function dtLocalToUnix(dtl){
    if(!dtl) return 0;
    const d = new Date(dtl);
    if (isNaN(d.getTime())) return 0;
    return Math.floor(d.getTime()/1000);
  }

  async function fetchJSON(url){
    const res = await fetch(url, {credentials:'same-origin'});
    if(!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function listMessages(){
    const data = await fetchJSON('/api/messages');
    const arr = (data && data.data && data.data.messages) || [];
    rowsEl.innerHTML = '';
    for (const m of arr){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${m.id}</td>
        <td>${toLocal(m.timestamp)}</td>
        <td>${escapeHtml(m.title)}</td>
        <td><span class="pill ${m.type}">${m.type||''}</span></td>
        <td>${m.hasImage ? `<a href="${m.imageUrl}" target="_blank">view</a>` : ''}</td>
        <td>
          <button data-act="edit" data-id="${m.id}">Edit</button>
          <button class="danger" data-act="del" data-id="${m.id}">Delete</button>
        </td>`;
      rowsEl.appendChild(tr);
    }
  }

  rowsEl.addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'edit') {
      // Load existing list item data from table row (already present) by refetching a fresh list
      // Simpler: fetch all and find by id (we already have it)
      const res = await fetchJSON('/api/messages');
      const item = (res.data.messages||[]).find(x=> x.id === Number(id));
      if (!item){ toast('Message not found'); return; }
      idEl.value = item.id;
      titleEl.value = item.title || '';
      typeEl.value = item.type || 'info';
      msgEl.value = item.message || '';
      if(item.timestamp){
        const dt = new Date(item.timestamp*1000);
        // to yyyy-MM-ddTHH:mm for datetime-local
        const pad = n => n.toString().padStart(2,'0');
        const v = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        whenEl.value = v;
      } else whenEl.value = '';

      imgEl.value = '';
      if (item.hasImage && item.imageUrl){
        imgPreview.src = item.imageUrl;
        imgPrevWrap.style.display = '';
      } else { imgPreview.src=''; imgPrevWrap.style.display='none'; }

      setFormMode('edit');
    }

    if (act === 'del'){
      if (!confirm('Delete this message?')) return;
      try {
        const r = await fetch(`/local/api/messages/${id}`, { method:'DELETE', credentials:'same-origin' });
        if(!r.ok) throw new Error(await r.text());
        toast('Deleted');
        await listMessages();
        if (idEl.value == id) clearForm();
      } catch(e){ toast('Delete failed: '+e.message, 3000); }
    }
  });

  // Create / Update
  $('#messageForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();

    const id = idEl.value.trim();
    const fd = new FormData();
    fd.append('title', titleEl.value.trim());
    fd.append('message', msgEl.value);
    fd.append('type', typeEl.value);

    const ts = dtLocalToUnix(whenEl.value);
    if (ts>0) fd.append('ts', String(ts));

    if (imgEl.files && imgEl.files[0]){
      fd.append('image', imgEl.files[0]);
    }

    try {
      let url = '/local/api/messages';
      let method = 'POST';
      if (id){
        url = `/local/api/messages/${id}`;
        method = 'PUT';
      }
      const res = await fetch(url, { method, body: fd, credentials:'same-origin' });
      if(!res.ok) throw new Error(await res.text());
      toast(id? 'Updated' : 'Created');
      clearForm();
      await listMessages();
    } catch(e){
      toast('Save failed: '+e.message, 3500);
    }
  });

  btnReset.addEventListener('click', clearForm);

  btnDelete.addEventListener('click', async ()=>{
    const id = idEl.value.trim();
    if(!id) return;
    if(!confirm('Delete this message?')) return;
    try {
      const r = await fetch(`/local/api/messages/${id}`, { method:'DELETE', credentials:'same-origin' });
      if(!r.ok) throw new Error(await r.text());
      toast('Deleted');
      clearForm();
      await listMessages();
    } catch(e){ toast('Delete failed: '+e.message, 3000); }
  });

  btnRefresh.addEventListener('click', listMessages);

  // utils
  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  // init
  clearForm();
  listMessages().catch(e=> toast('Load failed: '+e.message));
})();