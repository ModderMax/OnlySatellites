// literally just forwards the satdump http server from local server
document.addEventListener('DOMContentLoaded', () => {
  const iframe = document.getElementById('satdump-frame');

  const updateIframe = () => {
    iframe.src = `../api/satdump/status`;
  };

  updateIframe(); // initial load
  setInterval(updateIframe, 5000); // update every 5 seconds
});