// shared.js
function formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  const date = new Date(ts * 1000);
  return document.getElementById('useUTC')?.checked
    ? date.toUTCString()
    : date.toLocaleString();
}

function getThumbnailPath(imagePath) {
  const lastSlashIndex = imagePath.lastIndexOf('/');
  const dir = imagePath.slice(0, lastSlashIndex);
  const filename = imagePath.slice(lastSlashIndex + 1);
  const filenameWebp = filename.replace(/\.[^/.]+$/, '.webp');
  return `${dir}/thumbnails/${filenameWebp}`;
}

function createImageCard(img) {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-card';
  const imagePath = "images/" + img.path.replace(/\\/g, '/');
  const tPath = getThumbnailPath(imagePath);

  wrapper.innerHTML = `
    <a href="${imagePath}" target="_blank">
      <img loading="lazy" src="${tPath}" alt="Image">
    </a>
    <div class="meta" onclick="openLightbox('${imagePath}')">
      <div><strong>Date:</strong> ${img.timestamp ? new Date(img.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'}</div>
      <div><strong>Satellite:</strong> ${img.satellite}</div>
      <div><strong>Composite:</strong> ${img.compositeDisplay}</div>
      <div><strong>Height:</strong> ${img.vPixels}px</div>
    </div>
  `;
  wrapper.classList.add('collapsed');
  return wrapper;
}

function openLightbox(src) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  lightbox.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

function togglePass(id) {
  const section = document.getElementById(id);
  const isVisible = section.style.display !== 'none';
  section.style.display = isVisible ? 'none' : 'flex';
  const arrow = section.previousElementSibling.querySelector('.arrow');
  arrow.textContent = isVisible ? '▶' : '▼';
}

function collapseAll() {
  const controller = document.getElementById('collapseAll')?.checked;
  const sections = document.getElementsByClassName('pass-section');

  for (const section of sections) {
    const images = section.querySelector('.pass-images');
    const arrow = section.querySelector('.arrow');
    if (!images || !arrow) continue;

    if (controller) {
      images.style.display = 'none';
      section.classList.add('collapsed');
      arrow.textContent = '▶';
    } else {
      images.style.display = 'flex';
      section.classList.remove('collapsed');
      arrow.textContent = '▼';
    }
  }
}
