const API = {
  listPassTypes: () => fetchJson('/local/api/pass-types'),
  upsertPassType: (body) => fetchJson('/local/api/pass-types', {method:'POST', body}),
  deletePassType: (code) => fetchJson(`/local/api/pass-types/${encodeURIComponent(code)}`, {method:'DELETE'}),

  listFolderIncludes: () => fetchJson('/local/api/folder-includes'),
  upsertFolderInclude: (body) => fetchJson('/local/api/folder-includes', {method:'POST', body}),
  deleteFolderInclude: (prefix) => fetchJson(`/local/api/folder-includes/${encodeURIComponent(prefix)}`, {method:'DELETE'}),

  listImageDirs: (code) => fetchJson(`/local/api/pass-types/${encodeURIComponent(code)}/image-dirs`),
  upsertImageDir: (code, body) => fetchJson(`/local/api/pass-types/${encodeURIComponent(code)}/image-dirs`, {method:'POST', body}),
  deleteImageDir: (code, dir) => fetchJson(`/local/api/pass-types/${encodeURIComponent(code)}/image-dirs/${encodeURIComponent(dir || '__ROOT__')}`, {method:'DELETE'}),
};

const RuleKeys = ['sensor','is_filled','is_corrected','v_pix','composite'];

function toast(msg, ok=true){ const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast ' + (ok?'ok':'err'); t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 2200); }
async function fetchJson(url, {method='GET', body}={}){ const resp = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined, credentials:'same-origin'}); if(!resp.ok){ const txt = await resp.text().catch(()=> ''); throw new Error(txt || (resp.status+' '+resp.statusText)); } const ct = resp.headers.get('content-type')||''; return ct.includes('application/json')? resp.json():{}; }
function $(sel){ return document.querySelector(sel); }
function el(tag, cls){ const e=document.createElement(tag); if(cls) e.className=cls; return e; }
function codepill(txt){ const c=el('code'); c.textContent=txt; return c; }
function input(type, val, oninput, ph=''){ const i=document.createElement('input'); i.type=type; if(val!==undefined&&val!==null) i.value=val; if(ph) i.placeholder=ph; if(oninput) i.addEventListener('input', e=>oninput(e.target.value)); return i; }
function select(opts, val, onchange){ const s=document.createElement('select'); opts.forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; if(o===val) op.selected=true; s.appendChild(op); }); if(onchange) s.addEventListener('change', e=>onchange(e.target.value)); return s; }
function button(txt, cls, onclick){ const b = el('button','btn '+(cls||'')); b.textContent = txt; b.onclick = onclick; return b; }

let passTypes = []; let folderIncludes = []; let imageMap = {}; // code -> rules[]

async function loadAll(){
  passTypes = await API.listPassTypes();
  folderIncludes = await API.listFolderIncludes();
  const codes = [...new Set(folderIncludes.map(f=>f.pass_type_code))];
  const pairs = await Promise.all(codes.map(async c=>[c, await API.listImageDirs(c)]));
  imageMap = Object.fromEntries(pairs);
  renderTemplates();
}

function renderTemplates(){
  const grid = $('#templatesGrid'); grid.innerHTML='';
  folderIncludes.forEach(fi => {
    const pt = passTypes.find(p=>p.code===fi.pass_type_code) || {code: fi.pass_type_code, dataset_file:'', rawdata_file:'', downlink:''};
    const dirs = imageMap[fi.pass_type_code] || [];
    grid.appendChild(templateCard(fi, pt, dirs));
  });
}

function templateCard(fi, pt, dirs){
  const card = el('div','card template');

  const head = el('div','template-head');
  const title = el('div','title');
  const name = el('div'); 
  name.innerHTML = `<strong>filename contains:</strong> <code>${fi.prefix}</code>`;
  
  title.appendChild(codepill(pt.code));
  title.appendChild(name); 
  head.appendChild(title);
  const del = button('Remove Template','danger', async()=>{ await API.deleteFolderInclude(fi.prefix); toast('Template removed'); loadAll(); });
  head.appendChild(del);

  // Basic settings
  const basics = el('div','kv');
  const dsInput = input('text', pt.dataset_file, v=> pt.dataset_file=v, '.json');
  const rdInput = input('text', pt.rawdata_file, v=> pt.rawdata_file=v, '.cadu');
  const dlSelect = input('text', pt.downlink, v=> pt.downlink=v, 'VHF');
  basics.appendChild(kvRow('Dataset File', dsInput));
  basics.appendChild(kvRow('Raw Data File', rdInput));
  basics.appendChild(kvRow('Downlink', dlSelect));
  const savePt = button('Save Pass Type','success', async()=>{ await API.upsertPassType({ code: pt.code, dataset_file: pt.dataset_file||'', rawdata_file: pt.rawdata_file||'', downlink: pt.downlink||'' }); toast('Saved pass type'); loadAll(); });

  // Image directories
  const dirsWrap = el('div');
  const dirsHead = el('div','card-head');
  const h2 = el('h3'); h2.textContent = 'Image Directories';
  const addBar = el('div','form-inline');
  const dirInput = input('text','', null, 'path (empty = root)');
  const addDir = button('Add','primary', async()=>{
  await API.upsertImageDir(pt.code, {
    dir_name: dirInput.value.trim(),
    sensor: '',
    composite: '',
    is_filled: true,
    v_pix: 0,
    is_corrected: true
  });
  dirInput.value='';
  toast('Directory added'); loadAll();
});
  addBar.appendChild(dirInput); addBar.appendChild(addDir);
  dirsHead.appendChild(h2); dirsHead.appendChild(addBar);
  dirsWrap.appendChild(dirsHead);
  dirs.forEach(r => dirsWrap.appendChild(dirBlock(pt.code, r)));

  card.appendChild(head);
  card.appendChild(basics);
  card.appendChild(savePt);
  card.appendChild(dirsWrap);
  return card;
}

function dirBlock(code, r){
  const wrap = el('div','dir');
  const head = el('div','dir-head');
  const title = el('div','dir-title');
  title.appendChild(codepill(r.dir_name || '(root)'));
  const chips = el('div','chips');
  if (r.sensor) chips.appendChild(chip(`sensor: ${r.sensor}`));
  chips.appendChild(chip(`filled: ${!!r.is_filled}`));
  if (r.composite) chips.appendChild(chip(`composite: ${r.composite}`));
  chips.appendChild(chip(`corrected: ${!!r.is_corrected}`));
  if (r.v_pix>0) chips.appendChild(chip(`v_pix: ${r.v_pix}`));
  title.appendChild(chips);
  const del = button('Remove directory','danger', async()=>{ await API.deleteImageDir(code, r.dir_name); toast('Directory removed'); loadAll(); });
  head.appendChild(title); head.appendChild(del);

  const add = ruleAddRow(code, r);

  wrap.appendChild(head);
  wrap.appendChild(add);
  return wrap;
}

function chip(text){ const c=el('span','chip'); c.textContent=text; return c; }

function ruleAddRow(code, r){
  const row = el('div','rule-add');
  const keySel = select(RuleKeys, 'sensor');
  row.appendChild(keySel);
  const valueWrap = el('div'); row.appendChild(valueWrap);

  const renderValue = ()=>{
  valueWrap.innerHTML='';
  const k = keySel.value;
  if (k==='sensor')      valueWrap.appendChild(input('text', r.sensor||'(none)'));
  else if (k==='composite') valueWrap.appendChild(input('text', r.composite||'(none)'));
  else if (k==='is_filled' || k==='is_corrected') valueWrap.appendChild(select(['false','true'], 'true'));
  else if (k==='v_pix')  valueWrap.appendChild(input('number', r.v_pix||0));
};
  keySel.addEventListener('change', renderValue);
  renderValue();

  const save = button('Add rule','primary', async()=>{
  const k = keySel.value; const elVal = valueWrap.querySelector('select, input');
  const clone = {...r};
  if (k==='sensor')         clone.sensor = elVal.value === '(none)' ? '' : elVal.value;
  else if (k==='is_filled') clone.is_filled = (elVal.value==='true');
  else if (k==='is_corrected') clone.is_corrected = (elVal.value==='true');
  else if (k==='v_pix')     clone.v_pix = parseInt(elVal.value||'0',10) || 0;
  else if (k==='composite') clone.composite = elVal.value === '(none)' ? '' : elVal.value;

  await API.upsertImageDir(code, {
    dir_name: clone.dir_name,
    sensor: clone.sensor||'',  
    is_filled: !!clone.is_filled,
    v_pix: clone.v_pix||0,
    is_corrected: !!clone.is_corrected,
    composite: clone.composite||''
  });
  toast('Rule applied'); loadAll();
});
  row.appendChild(save);
  return row;
}

function kvRow(k, inputEl){ const row = el('div','kv-row'); const kEl = el('div'); kEl.textContent = k; row.appendChild(kEl); const vEl = el('div'); vEl.appendChild(inputEl); row.appendChild(vEl); return row; }

$('#createTemplateBtn').addEventListener('click', async ()=>{
  const prefix = $('#tplPrefix').value.trim();
  let code = $('#tplCode').value.trim();
  const dataset_file = $('#tplDataset').value.trim();
  const rawdata_file = $('#tplRawdata').value.trim();
  const downlink = $('#tplDownlink').value;
  if (!prefix){ toast('Filename contains is required', false); return; }
  if (!code){ code = prefix.toLowerCase().replace(/\s+/g,'_'); }
  await API.upsertPassType({code, dataset_file, rawdata_file, downlink});
  await API.upsertFolderInclude({prefix, pass_type_code: code});
  $('#tplPrefix').value=''; $('#tplCode').value=''; $('#tplDataset').value=''; $('#tplRawdata').value=''; $('#tplDownlink').value='';
  toast('Template created'); loadAll();
});

loadAll().catch(err=> toast('Load failed: '+err.message, false));