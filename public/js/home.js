(async function () {
  const FEED_SEL = '#messagesFeed';
  const FEED_URL = 'api/messages/latest';

  const el = document.querySelector(FEED_SEL);
  if (!el) return;

  const h = (s, ...v) => s.reduce((a, b, i) => a + b + (v[i] ?? ''), '');
  const esc = (s) =>
    (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const typeClass = (t) => (t === 'alert' ? 'type-alert' : t === 'warn' ? 'type-warn' : 'type-info');
  const messageHref = (id) => `messages/${id}`;

  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    // Local time, short but explicit
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // --- Minimal, safe-ish Markdown -> HTML ---
  // Features: **bold**, *italic*, `code`, [text](https://...), unordered lists (- or *)
  // plus newline => <br> (outside lists). Everything starts escaped to prevent XSS.
  function mdToHtml(md) {
    let s = esc(md || '');

    // Inline code first to avoid messing with inner markers
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**text**) before italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic (*text*)
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Links: [text](url) — restrict to http/https
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const u = String(url).trim();
      if (!/^https?:\/\//i.test(u)) return `${text} (${u})`; // don’t create javascript: links
      const t = esc(text);
      const uu = esc(u);
      return `<a href="${uu}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    });

    // Lists: group consecutive lines starting with - / *
    const lines = s.split(/\r?\n/);
    const out = [];
    let list = null;
    const endList = () => { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } };

    for (const line of lines) {
      const m = /^\s*[-*]\s+(.*)$/.exec(line);
      if (m) {
        if (!list) list = [];
        list.push('<li>' + m[1] + '</li>');
      } else {
        endList();
        out.push(line);
      }
    }
    endList();

    // Remaining newlines => <br>
    return out.join('\n').replace(/\n/g, '<br>');
  }

  async function fetchLatest() {
    const res = await fetch(FEED_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    return (j && j.data && j.data.messages) || [];
  }

  function render(messages) {
    el.innerHTML = '';

    messages.forEach((m) => {
      const hasImg = !!m.hasImage && !!m.imageUrl;
      const cls = typeClass((m.type || '').toLowerCase());
      const title = esc(m.title);
      const bodyHTML = mdToHtml(m.message);
      const timeText = fmtTime(m.timestamp);

      const node = document.createElement('article');
      node.className = `msg ${cls} ${hasImg ? '' : 'no-image'}`;

      node.innerHTML = h`
        <div class="msg__media">
          ${hasImg ? `<img class="msg__img" src="${m.imageUrl}" alt="">` : ``}
        </div>
        <div class="msg__title">
          <span class="msg__titletext">${title}</span>
          <span class="msg__time">${timeText}</span>
        </div>
        <a class="msg__bodylink" href="${messageHref(m.id)}" aria-label="Open message: ${title}">
          <div class="msg__body">${bodyHTML}</div>
        </a>
      `;

      el.appendChild(node);
    });
  }

  try {
    render(await fetchLatest());
  } catch {
  }
})();
