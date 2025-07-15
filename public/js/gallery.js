document.addEventListener('DOMContentLoaded', () => {
  
});

window.addEventListener('load', async () => {
  await fetchOptions();
  await loadImages();

  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const data = await res.json();

    if (data.updated) {
      console.log('New data received, reloading images...');
      await loadImages();
    } else {
      console.log('No update needed.');
    }
  } catch (err) {
    console.warn('Update failed or on cooldown.', err);
  }
});

document.getElementById('sortByPass')?.addEventListener('change', () => {
  updateCountLimit();
  loadImages();
});
document.getElementById('satelliteFilter')?.addEventListener('change', updateCompositeOptions);
document.getElementById('satelliteFilter')?.addEventListener('change', loadImages);
document.getElementById('bandFilter')?.addEventListener('change', loadImages);
document.getElementById('correctedOnly')?.addEventListener('change', loadImages);
document.getElementById('showUnfilled')?.addEventListener('change', loadImages);
document.getElementById('mapsOnly')?.addEventListener('change', loadImages);
document.getElementById('sortFilter')?.addEventListener('change', loadImages);
document.getElementById('useUTC')?.addEventListener('change', loadImages);
document.getElementById('showNotes')?.addEventListener('change', loadImages);
document.getElementById('collapseAll')?.addEventListener('change', collapseAll);

document.getElementById('showCountSelect')?.addEventListener("keypress", () => {
  if (event.key === "Enter") {
    loadImages();
  }
});

document.getElementById('repopulate-btn')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to repopulate the database?')) return;
  try {
    const res = await fetch('/api/repopulate', { method: 'POST' });
    const text = await res.text();
    alert(text);
  } catch (err) {
    alert('Failed to repopulate.');
    console.error(err);
  }
});

function getCountLimit() {
  const groupByPass = document.getElementById('sortByPass')?.checked;
  const showCountInput = document.getElementById('showCountSelect');
  const baseCount = parseInt(showCountInput?.value, 10) || 50;

  if (groupByPass) {
    return { limit: baseCount, type: 'passes' };
  } else {
    return { limit: baseCount, type: 'images' };
  }
}

function updateCountLimit() {
  const groupByPass = document.getElementById('sortByPass')?.checked;
  const showCountLabel = document.getElementById('showCountLabel');
  const showCountInput = document.getElementById('showCountSelect');

  if (groupByPass) {
    showCountLabel.textContent = 'Passes';
    showCountInput.value = showCountInput.value * 0.1;
  } else {
    showCountLabel.textContent = 'Images';
    showCountInput.value = showCountInput.value * 10;
  }
}

function getPassDir(rawPath) {
  const parts = rawPath.split('/');
  parts.pop();
  return parts.join('/');
}

function formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  const date = new Date(ts * 1000);
  if (document.getElementById('useUTC')?.checked)
  {
  return isNaN(date.getTime()) ? 'Unknown' : date.toUTCString();
  }
  return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function toggleDropdown(event, dropdownId = 'settingsDropdown') {
  event.stopPropagation();

  const button = event.currentTarget;
  const dropdownWrapper = button.closest('.dropdown');
  const dropdown = dropdownWrapper.querySelector('.dropdown-content');

  // First toggle visibility so we can measure dimensions
  dropdownWrapper.classList.toggle('show');

  if (dropdownWrapper.classList.contains('show')) {
    // Reset styles before measuring
    dropdown.style.left = '';
    dropdown.style.right = '';
    
    const rect = dropdown.getBoundingClientRect();
    const overflowRight = rect.right > window.innerWidth;

    if (overflowRight) {
      // Align the right edge of the dropdown with the right edge of the button
      const offset = rect.right - window.innerWidth + 10; // 10px padding
      dropdown.style.left = `-${offset}px`;
    }
  }
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

function openLightbox(imageSrc) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = imageSrc;
  lightbox.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-content').forEach(dropdown => {
    dropdown.classList.remove('show');
  });
});

async function fetchOptions() {
  const satSelect = document.getElementById('satelliteFilter');
  const bandSelect = document.getElementById('bandFilter');

  const satellites = await fetch('/api/satellites').then(res => res.json());
  satSelect.innerHTML = '<option value="">All Satellites</option>' + satellites.map(s => `<option value="${s}">${s}</option>`).join('');

  const bands = await fetch('/api/bands').then(res => res.json());
  bandSelect.innerHTML = '<option value="">All Bands</option>' + bands.map(b => `<option value="${b}">${b}</option>`).join('');

  satSelect.addEventListener('change', async () => {
    await updateCompositeOptions(satSelect.value);
  });

  await updateCompositeOptions(''); 
}

async function updateCompositeOptions(satellite) {
  const compFilter = document.getElementById('compositeFilter');
  const query = satellite ? `?satellite=${encodeURIComponent(satellite)}` : '';
  const composites = await fetch(`/api/composites${query}`).then(res => res.json());

  compFilter.innerHTML = `
    <div class="composite-actions">
      <button type="button" onclick="selectAllComposites(true)">All</button>
      <button type="button" onclick="selectAllComposites(false)">None</button>
      <button type="button" onclick="loadImages()">Apply</button>
    </div>
    ${composites.map(c => `
      <label>
        <input type="checkbox" value="${c.value}" class="composite-checkbox" checked>
        ${c.label}
      </label>
    `).join('')}
  `;
}

function selectAllComposites(selectAll) {
  document.querySelectorAll('#compositeFilter .composite-checkbox').forEach(cb => {
    cb.checked = selectAll;
  });
}

function getFilters() {
  const satellite = document.getElementById('satelliteFilter')?.value;
  const band = document.getElementById('bandFilter')?.value;
  const selectedComposites = Array.from(document.querySelectorAll('.composite-checkbox:checked')).map(cb => cb.value);
  const sort = document.getElementById('sortFilter')?.value;
  const { limit, type: limitType } = getCountLimit();

  const startDate = document.getElementById('startDate')?.value;
  const endDate = document.getElementById('endDate')?.value;
  const startTime = document.getElementById('startTime')?.value;
  const endTime = document.getElementById('endTime')?.value;

  let sortBy = 'timestamp';
  let sortOrder = 'DESC';
  if (sort === 'oldest') sortOrder = 'ASC';
  if (sort === 'hpix') sortBy = 'vPixels';
  if (sort === 'lpix') {
    sortBy = 'vPixels';
    sortOrder = 'ASC';
  }

  const params = new URLSearchParams();
  if (satellite) params.append('satellite', satellite);
  if (band) params.append('band', band);
  selectedComposites.forEach(c => params.append('composite', c));
  if (limit) params.append('limit', limit);
  if (limitType) params.append('limitType', limitType);
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (startTime) params.append('startTime', startTime);
  if (endTime) params.append('endTime', endTime);
  params.append('sortBy', sortBy);
  params.append('sortOrder', sortOrder);

  const mapsOnly = document.getElementById('mapsOnly')?.checked;
  if (mapsOnly) params.append('map', 'only');

  const correctedOnly = document.getElementById('correctedOnly')?.checked;
  if (correctedOnly) params.append('correctedOnly', '1');

  const showUnfilled = document.getElementById('showUnfilled')?.checked;
  if (!showUnfilled) params.append('filledOnly', '1');

  const utcTime = document.getElementById('useUTC')?.checked;
  if (utcTime) params.append('useUTC', '0');

  return params;
}

async function loadImages() {
  console.log("loadImages called");
  const groupByPass = document.getElementById('sortByPass')?.checked;
  const params = getFilters();

  let images = [], notes = [];

  try {
    const [imagesRes, notesRes] = await Promise.all([
      fetch(`/api/images?${params.toString()}`),
      fetch('/api/userControls')
    ]);

    if (imagesRes.ok) images = await imagesRes.json();
    else console.error('Failed to fetch images');

    if (notesRes.ok) notes = await notesRes.json();
    else console.error('Failed to fetch notes');
  } catch (err) {
    console.error('Error fetching image/note data:', err);
    return;
  }

  const showNotes = document.getElementById('showNotes')?.checked;

  let unified = [
    ...images.map(img => ({ ...img, type: 'image' }))
  ];
  
  if (showNotes) {
    unified = unified.concat(notes.map(note => ({ ...note, type: 'note' })));
  }

  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  const fragment = document.createDocumentFragment();

  if (groupByPass) {
    gallery.classList.remove('flat-gallery');
  
    const passGroups = {};
    const renderQueue = [];
  
    unified.forEach(item => {
      if (item.type === 'image') {
        const key = item.passId;
        if (!passGroups[key]) {
          passGroups[key] = {
            type: 'pass',
            satellite: item.satellite,
            timestamp: item.timestamp,
            rawDataPath: item.rawDataPath || 0,
            name: item.name,
            images: [],
            passId: key,
            added: false
          };
        }
        passGroups[key].images.push(item);
      }
  
      if (item.type === 'note') {
        renderQueue.push(item);
      }
    });
  
    Object.values(passGroups).forEach(group => {
      if (!group.added) {
        renderQueue.push(group);
        group.added = true;
      }
    });
    
    const sorting = document.getElementById('sortFilter')?.value
    if(sorting === 'newest')
    {
      renderQueue.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sorting === 'oldest') {
      renderQueue.sort((a, b) => a.timestamp - b.timestamp);
    } else {
      renderQueue.sort((a, b) => b.type - a.type);
    }
  
    renderQueue.forEach((item, index) => {
      if (item.type === 'note') {
        const wrapper = document.createElement('div');
        wrapper.className = 'pass-section note-section collapsed';
        wrapper.innerHTML = `
          <div class="pass-header" onclick="togglePass('note-${item.timestamp}')">
            <strong>📝 ${item.title} ${formatTimestamp(item.timestamp)}</strong>
            <span class="arrow">▼</span>
          </div>
          <div class="pass-images" id="note-${item.timestamp}">
            <div class="note-description">${item.description}</div>
          </div>
        `;
        fragment.appendChild(wrapper);
      } else if (item.type === 'pass') {
        const passId = `pass-${index}`;
        const passName = item.name || '';
        const wrapper = document.createElement('div');
        wrapper.className = 'pass-section';
  
        const exportLink = (item.rawDataPath && item.rawDataPath !== '0.0')
          ? `<a href="/api/export?path=${encodeURIComponent("live_output/" + passName + "/" + item.rawDataPath)}" download class="export-raw" title="Download raw data">⭳</a>`
          : '';

        const zipLink = passName
          ? `<a href="/api/zip?path=${encodeURIComponent('live_output/' + passName)}" class="export-zip" title="Download full pass as .zip">🗀</a>`
          : '';
  
        wrapper.innerHTML = `
          <div class="pass-header">
            <div class="pass-title"><strong>${item.satellite || 'Unknown'} - ${formatTimestamp(item.timestamp)}</strong></div>
            <div class="pass-actions">
              ${zipLink}
              ${exportLink}
              <span class="arrow" onclick="togglePass('${passId}')">▼</span>
            </div>
          </div>
          <div class="pass-images" id="${passId}"></div>
        `;
  
        const passImagesContainer = wrapper.querySelector(`#${passId}`);
        item.images.forEach(img => {
          passImagesContainer.appendChild(createImageCard(img));
        });
  
        fragment.appendChild(wrapper);
      }
    });
  } else {
    // Flat gallery view (no grouping by pass)
    gallery.classList.add('flat-gallery');
    
    // Sort the unified array based on user selection
    const sorting = document.getElementById('sortFilter')?.value;
    if (sorting === 'newest') {
      unified.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sorting === 'oldest') {
      unified.sort((a, b) => a.timestamp - b.timestamp);
    } else {
      unified.sort((a, b) => b.type - a.type);
    }
    
    // Render all items in a flat structure
    unified.forEach(item => {
      if (item.type === 'image') {
        fragment.appendChild(createImageCard(item));
      } else if (item.type === 'note' && showNotes) {
        const noteCard = document.createElement('div');
        
        noteCard.innerHTML = `
          <div class="note-header">
            <strong>📝 ${item.title}</strong>
          </div>
          <div>
            <div class="note-description">${formatTimestamp(item.timestamp)}\n${item.description}</div>
          </div>
        `;
        fragment.appendChild(noteCard);
      }
    });
  }
  gallery.appendChild(fragment);
}

function getThumbnailPath(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') {
    console.warn('Invalid imagePath:', imagePath);
    return '';
  }

  const lastSlashIndex = imagePath.lastIndexOf('/');
  if (lastSlashIndex === -1) return '';

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
      <div><strong>Date:</strong> ${img.timestamp ?
        new Date(img.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'}</div>
      <div><strong>Satellite:</strong> ${img.satellite}</div>
      <div><strong>Composite:</strong> ${img.compositeDisplay}</div>
      <div><strong>Height:</strong> ${img.vPixels}px</div>
    </div>
  `;
  return wrapper;
}

function openNotePopup() {
  document.getElementById('notePopup').style.display = 'flex';
  document.getElementById('noteTime').value = new Date().toISOString().slice(0,16);
}

function closeNotePopup() {
  document.getElementById('notePopup').style.display = 'none';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteDescription').value = '';
}

async function submitNote() {
  const isoInput = document.getElementById('noteTime').value;
  let timestamp = new Date (isoInput).getTime(); 
  timestamp = Math.floor(timestamp / 1000);
  const title = document.getElementById('noteTitle').value.trim();
  const description = document.getElementById('noteDescription').value.trim();

  if (!timestamp || !title || !description) {
    alert("Please fill out all fields.");
    return;
  }

  const res = await fetch('/api/userControls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, title, description })
  });

  if (res.ok) {
    closeNotePopup();
    loadImages();
  } else {
    alert("Failed to save note.");
  }
}