document.addEventListener('DOMContentLoaded', () => {
  loadSimplifiedImages();
  document.getElementById('collapseAll')?.addEventListener('change', collapseAll);
});

async function loadSimplifiedImages() {
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  gallery.classList.remove('flat-gallery');

  const res = await fetch('/api/simplified');
  const passes = await res.json();
  const fragment = document.createDocumentFragment();

  passes.forEach((pass, index) => {
    const passId = `pass-${index}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'pass-section';

    const exportLink = pass.rawDataPath && pass.rawDataPath !== '0.0'
      ? `<a href="/api/export?path=${encodeURIComponent("live_output/" + pass.name + "/" + pass.rawDataPath)}" download class="export-raw" title="Download raw data">⭳</a>`
      : '';

    const zipLink = pass.name
      ? `<a href="/api/zip?path=${encodeURIComponent('live_output/' + pass.name)}" class="export-zip" title="Download full pass as .zip">🗀</a>`
      : '';

    wrapper.innerHTML = `
      <div class="pass-header">
        <div class="pass-title"><strong>${pass.satellite || 'Unknown'} - ${formatTimestamp(pass.timestamp)}</strong></div>
        <div class="pass-actions">
          ${zipLink}
          ${exportLink}
          <span class="arrow" onclick="togglePass('${passId}')">▶</span>
        </div>
      </div>
      <div class="pass-images" id="${passId}"></div>
    `;

    const passImagesContainer = wrapper.querySelector(`#${passId}`);
    pass.images.forEach(img => {
      passImagesContainer.appendChild(createImageCard(img));
    });

    passImagesContainer.style.display = 'none';
    wrapper.classList.add('collapsed');

    fragment.appendChild(wrapper);
  });

  gallery.appendChild(fragment);
}
