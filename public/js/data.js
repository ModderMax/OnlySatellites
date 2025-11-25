const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function jget(url)  {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function on(id, ev, fn){
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
}

function unixNow(){ return Math.floor(Date.now()/1000); }

function toLocalInputValue(d) {
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm   = pad(d.getMonth()+1);
  const dd   = pad(d.getDate());
  const hh   = pad(d.getHours());
  const mi   = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function getUnixFromInput(id, fallback) {
  const el = document.getElementById(id);
  if (!el || !el.value) return fallback;
  const d = new Date(el.value);
  if (Number.isNaN(d.getTime())) return fallback;
  return Math.floor(d.getTime()/1000);
}

function initDateRanges() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7*24*3600*1000);
  const toStr = toLocalInputValue(now);
  const fromStr = toLocalInputValue(weekAgo);

  const idsFrom = ['polarFrom', 'geoFrom'];
  const idsTo   = ['polarTo', 'geoTo'];

  idsFrom.forEach(id => { const el = $('#'+id); if (el) el.value = fromStr; });
  idsTo.forEach(id => { const el = $('#'+id); if (el) el.value = toStr; });
}

function setView(name){
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(name + 'View');
  if (target) target.classList.add('active');
}

async function loadSatNames(){
  const sel = $('#satNameSel');
  if(!sel) return;
  sel.innerHTML = '';
  const names = await jget('/api/satdump/names');
  if(!names || !names.length){
    const opt = document.createElement('option');
    opt.value=''; opt.textContent='(none found)';
    sel.appendChild(opt);
    return;
  }
  names.forEach(n=>{
    const opt = document.createElement('option');
    opt.value=n; opt.textContent=n;
    sel.appendChild(opt);
  });
}

async function genSatChart(){
  const name = ($('#satNameSel')||{}).value;
  if(!name){ alert('Pick a satellite'); return; }

  const to   = getUnixFromInput('polarTo', unixNow());
  const from = getUnixFromInput('polarFrom', to - 7*24*3600);

  const pts = await jget(`/api/analytics/tracks?name=${encodeURIComponent(name)}&from=${from}&to=${to}`);
  $('#satChartTitle').textContent = `${name} (${pts.length} points)`;
  drawPolar($('#satChart'), pts);
}

let geoMetricMode = 'snr';

async function genGeoChart(){
  const decEl = $('#geoDecoder');
  const decoder = (decEl && decEl.value.trim()) || '';
  if (!decoder) {
    alert('Enter a decoder key (e.g. ccsds_conv_concat_decoder)');
    return;
  }
  const to   = getUnixFromInput('geoTo', unixNow());
  const from = getUnixFromInput('geoFrom', to - 7*24*3600);

  const pts = await jget(`/api/analytics/decoder?decoder=${encodeURIComponent(decoder)}&from=${from}&to=${to}`);
  $('#geoChartTitle').textContent = `${decoder} (${pts.length} buckets)`;
  lastGeoPoints = pts;
  drawGeoSNR($('#geoChart'), pts);
}

function formatNumber(v){
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10)  return v.toFixed(1);
  if (abs >= 1)   return v.toFixed(2);
  return v.toFixed(3);
}

function formatNumber(v){
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10)  return v.toFixed(1);
  if (abs >= 1)   return v.toFixed(2);
  return v.toFixed(3);
}

function drawGeoSNR(canvas, points){
  if (!canvas) return;

  const dpr  = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 260;
  canvas.width  = Math.floor(cssW*dpr);
  canvas.height = Math.floor(cssH*dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const padL = 60, padR = 16, padT = 32, padB = 40;
  const W = cssW, H = cssH;

  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0,0,W,H);

  if (!points || !points.length) {
    ctx.fillStyle = '#a7afc0';
    ctx.font = '13px system-ui,sans-serif';
    ctx.fillText('No data', padL+12, padT+16);
    return;
  }

  const avgS  = [];
  const lowS  = [];
  const highS = [];
  const avgB  = [];
  const minB  = [];
  const maxB  = [];

  let minX = 0, maxX = 100;

  let minS = Infinity, maxS = -Infinity;
  let minBER = Infinity, maxBER = -Infinity;

  points.forEach(p => {
    const x = typeof p.pct === 'number' ? p.pct : parseFloat(p.pct);
    if (!Number.isFinite(x)) return;

    const sAvg  = p.avg_snr;
    const sLow  = p.low1pct_snr;
    const sHigh = p.high1pct_snr;
    const bAvg  = p.avg_ber;
    const bMin  = p.min_ber;
    const bMax  = p.max_ber;

    if (Number.isFinite(sAvg))  { avgS.push({x, y: sAvg});  minS = Math.min(minS, sAvg);  maxS = Math.max(maxS, sAvg); }
    if (Number.isFinite(sLow))  { lowS.push({x, y: sLow});  minS = Math.min(minS, sLow);  maxS = Math.max(maxS, sLow); }
    if (Number.isFinite(sHigh)) { highS.push({x, y: sHigh});minS = Math.min(minS, sHigh); maxS = Math.max(maxS, sHigh); }
    if (Number.isFinite(bAvg))  { avgB.push({x, y: bAvg});  minBER = Math.min(minBER, bAvg);  maxBER = Math.max(maxBER, bAvg); }
    if (Number.isFinite(bMin))  { minB.push({x, y: bMin});  minBER = Math.min(minBER, bMin);  maxBER = Math.max(maxBER, bMin); }
    if (Number.isFinite(bMax))  { maxB.push({x, y: bMax});  minBER = Math.min(minBER, bMax);  maxBER = Math.max(maxBER, bMax); }
  });

  const haveS = Number.isFinite(minS) && Number.isFinite(maxS);
  const haveB = Number.isFinite(minBER) && Number.isFinite(maxBER);

  if (!haveS && !haveB) {
    ctx.fillStyle = '#a7afc0';
    ctx.font = '13px system-ui,sans-serif';
    ctx.fillText('No SNR/BER in range', padL+12, padT+16);
    return;
  }

  if (haveS && maxS === minS) {
    maxS = minS + 1;
  }
  if (haveB && maxBER === minBER) {
    maxBER = minBER + 1e-6;
  }

  const activeMetric = geoMetricMode || 'snr';

  const yNorm = (v, kind) => {
    if (kind === 'ber') {
      if (!haveB || maxBER === minBER) return 0.5;
      return (v - minBER) / (maxBER - minBER);
    }
    if (!haveS || maxS === minS) return 0.5;
    return (v - minS) / (maxS - minS);
  };
  const yScaleVal = (norm) =>
    H - padB - Math.max(0, Math.min(1, norm)) * (H - padT - padB);
  const yScale = (v, kind) => yScaleVal(yNorm(v, kind));
  const xScale = (v) => padL + ((v - minX) / (maxX - minX)) * (W - padL - padR);

  let yMin, yMax, yKind;
  if (activeMetric === 'ber' && haveB) {
    yMin = minBER; yMax = maxBER; yKind = 'ber';
  } else if (haveS) {
    yMin = minS; yMax = maxS; yKind = 'snr';
  } else {
    yMin = minBER; yMax = maxBER; yKind = 'ber';
  }
  if (yMax === yMin) yMax = yMin + 1;

  // grid
  ctx.strokeStyle = '#223';
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillStyle = '#a7afc0';

  const yTicks = 5;
  for (let i=0;i<=yTicks;i++){
    const v = yMin + (i*(yMax-yMin))/yTicks;
    const yy = yScale(v, yKind);
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W-padR, yy); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(formatNumber(v), 4, yy+4);
  }

  const xTicks = 5;
  for (let i=0;i<=xTicks;i++){
    const v = minX + (i*(maxX-minX))/xTicks;
    const xx = xScale(v);
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, H-padB); ctx.stroke();
    ctx.globalAlpha = 1;
    const txt = `${v.toFixed(0)}%`;
    const tw = ctx.measureText(txt).width;
    ctx.fillText(txt, xx - tw/2, H-8);
  }

  // axes labels
  ctx.fillStyle = '#a7afc0';
  ctx.font = '12px system-ui,sans-serif';
  const xLabel = 'Time';
  const yLabel = (activeMetric === 'ber') ? 'BER' : 'SNR (dB)';
  const xw = ctx.measureText(xLabel).width;
  ctx.fillText(xLabel, (W - xw)/2, H-4);

  ctx.save();
  ctx.translate(16, (H - padB - padT)/2 + padT);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // axis box
  ctx.strokeStyle = '#334';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(padL, padT, W-padL-padR, H-padT-padB);
  ctx.stroke();

  ctx.font = '11px system-ui,sans-serif';
  ctx.fillStyle = '#a7afc0';
  let yInfo = padT - 8;
  if (haveS) {
    ctx.fillText(`SNR: ${formatNumber(minS)}–${formatNumber(maxS)} dB`, padL, yInfo);
    yInfo -= 14;
  }
  if (haveB) {
    ctx.fillText(`BER: ${formatNumber(minBER)}–${formatNumber(maxBER)}`, padL, yInfo);
  }

  const series = [
    {name:'Avg SNR',   pts:avgS,  color:'hsl(140 80% 60%)', metric:'snr'},
    {name:'Low 1% SNR',pts:lowS,  color:'hsl(0 80% 60%)',   metric:'snr'},
    {name:'High 1% SNR',pts:highS,color:'hsl(210 80% 60%)', metric:'snr'},
    {name:'Avg BER',   pts:avgB,  color:'hsl(50 85% 60%)',  metric:'ber'},
    {name:'Min BER',   pts:minB,  color:'hsl(30 80% 60%)',  metric:'ber'},
    {name:'Max BER',   pts:maxB,  color:'hsl(280 80% 70%)', metric:'ber'},
  ];

  const plotted = [];

  series.forEach(s => {
    if (!s.pts.length) return;
    const active = (s.metric === activeMetric);
    ctx.beginPath();
    let moved = false;
    s.pts.forEach(p => {
      const X = xScale(p.x), Y = yScale(p.y, s.metric);
      plotted.push({ name:s.name, metric:s.metric, X, Y, x:p.x, y:p.y });
      if (!moved) { ctx.moveTo(X, Y); moved=true; }
      else { ctx.lineTo(X, Y); }
    });
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = active ? 1 : 0.25;
    ctx.lineWidth = active ? 1.7 : 1.0;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // legend
  ctx.font = '12px system-ui,sans-serif';
  let lx = padL+6, ly = padT+18;
  series.forEach(s => {
    if (!s.pts.length) return;
    const active = (s.metric === activeMetric);
    ctx.globalAlpha = active ? 1 : 0.4;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, ly-8, 10, 10);
    ctx.fillStyle = '#a7afc0';
    ctx.fillText(' '+s.name, lx+12, ly);
    lx += ctx.measureText(' '+s.name).width + 36;
    if (lx > W-padR-120) { lx = padL+6; ly += 16; }
  });
  ctx.globalAlpha = 1;

  // hover tooltip
  const TIP_BG = 'rgba(20,24,32,0.95)';
  const thresh = 10;

  function redrawHover(hit){
    drawGeoSNR(canvas, points);
    if (!hit) return;

    const { X, Y } = hit;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI*2); ctx.fill();

    const labelMetric = (hit.metric === 'ber') ? 'BER' : 'SNR';
    const unit = (hit.metric === 'ber') ? '' : ' dB';
    const lines = [
      `Progress: ${hit.x.toFixed(1)}%`,
      `${hit.name}: ${formatNumber(hit.y)}${unit}`,
      `Metric: ${labelMetric}`
    ];
    ctx.font = '12px system-ui,sans-serif';
    const padding = 8;
    const tw = Math.max(...lines.map(t => ctx.measureText(t).width)) + padding*2;
    const th = (lines.length*14) + padding*2;
    let tx = X + 12, ty = Y - th - 12;
    if (tx + tw > W - 6) tx = X - tw - 12;
    if (ty < padT + 6)   ty = Y + 12;

    ctx.fillStyle = TIP_BG;
    ctx.strokeStyle = '#445';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#e8ebf0';
    lines.forEach((t, i)=> ctx.fillText(t, tx+padding, ty+padding+12+(i*14)));
  }

  if (!canvas._geoHandlers) {
    canvas._geoHandlers = true;
    canvas.addEventListener('mousemove', (e)=>{
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best=null, bestD=Infinity;
      for (const p of plotted) {
        const d = Math.hypot(p.X - mx, p.Y - my);
        if (d < bestD) { bestD=d; best=p; }
      }
      if (best && bestD <= thresh) redrawHover(best); else redrawHover(null);
    });
    canvas.addEventListener('mouseleave', ()=> redrawHover(null));
  }
}

function drawPolar(canvas, points){
  if(!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 360;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.fillStyle = '#0c1016'; ctx.fillRect(0,0,W,H);
  const cx = W/2, cy = H/2;
  const R  = Math.min(W,H)*0.42;

  // elevation rings
  ctx.strokeStyle = '#223'; ctx.lineWidth = 1;
  [0,30,60,90].forEach(deg=>{
    const r = R * (1 - deg/90);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#a7afc0';
    ctx.font = '11px system-ui,sans-serif';
    ctx.fillText(`${deg}°`, cx+4, cy - r - 2);
  });
  // spokes (N/E/S/W)
  ctx.beginPath();
  for(let k=0;k<4;k++){
    const ang = (k*Math.PI/2);
    const x = cx + R*Math.cos(ang - Math.PI/2);
    const y = cy + R*Math.sin(ang - Math.PI/2);
    ctx.moveTo(cx, cy); ctx.lineTo(x,y);
  }
  ctx.stroke();

  if(!points || !points.length) return;

  let minS = Infinity, maxS = -Infinity;
  points.forEach(p=>{
    const s = p.snr ?? p.SNR;
    if (s != null && Number.isFinite(s)) {
      if (s < minS) minS = s;
      if (s > maxS) maxS = s;
    }
  });
  if(!isFinite(minS) || !isFinite(maxS)) { minS = 0; maxS = 1; }
  if (maxS === minS) { maxS = minS + 1e-9; }

  const snrColor = (s)=>{
    if (!Number.isFinite(s)) return 'rgb(0,0,0)';
    if (s === 0) return 'rgb(0,0,0)';
    const t = Math.max(0, Math.min(1, (s - minS) / (maxS - minS)));
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * t);
    return `rgb(${r},${g},0)`;
  };

  const plotted = [];
  ctx.lineWidth = 1;
  points.forEach(p=>{
    const az = p.az ?? p.Az;
    const el = p.el ?? p.El;
    const sn = p.snr ?? p.SNR;
    if(az==null || el==null) return;

    const theta = (az * Math.PI/180) - Math.PI/2;
    const r = R * (1 - (Math.max(0, Math.min(90, el))/90));
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);

    ctx.fillStyle = snrColor(sn);
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI*2); ctx.fill();

    plotted.push({ x, y, az, el, sn });
  });

  const gradW = 100, gradH = 10;
  const g = ctx.createLinearGradient(40,0,gradW,0);
  g.addColorStop(0,   'rgb(255,0,0)');
  g.addColorStop(1.0, 'rgb(0,255,0)');
  ctx.fillStyle = g; ctx.fillRect(40, 0, gradW, gradH);
  ctx.strokeStyle = '#445'; ctx.strokeRect(40, 0, gradW, gradH);
  ctx.fillStyle = '#a7afc0'; ctx.font = '11px system-ui,sans-serif';
  ctx.fillText(`${minS.toFixed(2)} dB`, 0, gradH);
  ctx.fillText(`${maxS.toFixed(2)} dB`, 40+gradW+6, gradH);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 18, 14, 10);
  ctx.strokeStyle = '#445'; ctx.strokeRect(0, 18, 14, 10);
  ctx.fillStyle = '#a7afc0'; ctx.fillText('NoSync', 20, 26);

  canvas._polarState = { plotted, cx, cy, R, minS, maxS };

  const TIP_BG = 'rgba(20,24,32,0.95)';
  const thresh = 10;
  function formatNum(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(1);
    if (a >= 10)  return v.toFixed(2);
    return v.toFixed(3);
  }
  function redrawHover(pt){
    drawPolar(canvas, points);
    if (!pt) return;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI*2); ctx.fill();

    const lines = [
      `Az: ${formatNum(pt.az)}°`,
      `El: ${formatNum(pt.el)}°`,
      `SNR: ${formatNum(pt.sn)} dB`
    ];
    ctx.font = '12px system-ui, sans-serif';
    const padding = 8;
    const tw = Math.max(...lines.map(t => ctx.measureText(t).width)) + padding*2;
    const th = (lines.length*14) + padding*2;
    let tx = pt.x + 12, ty = pt.y - th - 12;
    if (tx + tw > W - 6) tx = pt.x - tw - 12;
    if (ty < 6)          ty = pt.y + 12;

    ctx.fillStyle = TIP_BG;
    ctx.strokeStyle = '#445';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#e8ebf0';
    lines.forEach((t, i)=> ctx.fillText(t, tx+padding, ty+padding+12+(i*14)));
  }

  if (!canvas._polarHandlers) {
    canvas._polarHandlers = true;
    canvas.addEventListener('mousemove', (e)=>{
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const { plotted } = canvas._polarState || { plotted: [] };
      let best=null, bestD=Infinity;
      for (const p of plotted) {
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && bestD <= thresh) redrawHover(best); else redrawHover(null);
    });
    canvas.addEventListener('mouseleave', ()=> redrawHover(null));
  }
}

async function init(){
  initDateRanges();
  await loadSatNames();
  setView('polar');
}

document.addEventListener('DOMContentLoaded', ()=>{
  $$('#sidebar .nav-btn').forEach(b=>{
    b.addEventListener('click', ()=> setView(b.dataset.view));
  });
  on('toggleSidebar', 'click', ()=>{
    const s = $('#sidebar'); s.classList.toggle('open');
    $('#toggleSidebar').textContent = s.classList.contains('open') ? '⟨' : '⟩';
  });

  on('genSatBtn', 'click', genSatChart);
  on('genGeoBtn', 'click', genGeoChart);

  const geoSwitch = $('#geoMetricSwitch');
  if (geoSwitch) {
  geoSwitch.addEventListener('change', () => {
    geoMetricMode = geoSwitch.checked ? 'ber' : 'snr';
    if (lastGeoPoints && $('#geoChart')) {
      drawGeoSNR($('#geoChart'), lastGeoPoints);
    }
  });}
  init();
});