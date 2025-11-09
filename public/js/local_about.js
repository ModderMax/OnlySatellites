document.addEventListener('DOMContentLoaded', () => {
  // Load text
  fetch('../api/about')
    .then(res => res.text())
    .then(text => {
      document.getElementById('text-panel').textContent = text;
    })
    .catch(err => {
      document.getElementById('text-panel').textContent = 'Error loading about.txt';
      console.error(err);
    });

  // Load images
  fetch('../api/userImages')
    .then(res => res.json())
    .then(images => {
      const gallery = document.getElementById('image-gallery');
      gallery.innerHTML = '';
      images.forEach(file => {
        const img = document.createElement('img');
        img.src = `../userContent/${file}`;
        img.alt = file;
        img.className = 'gallery-img';
        gallery.appendChild(img);
      });
    })
    .catch(err => {
      document.getElementById('image-gallery').textContent = 'Error loading images';
      console.error(err);
    });
});