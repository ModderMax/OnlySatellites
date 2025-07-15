const express = require('express');
const router = express.Router();
const os = require('os');
const fetch = require('node-fetch').default;

function getHostIPv4() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254') &&
        !/virtual|vmware|vbox|hyper-v|loopback/i.test(name)
      ) {
        candidates.push({
          address: net.address,
          priority: name.toLowerCase().includes('ethernet') ? 1 :
                    name.toLowerCase().includes('wi-fi') ? 2 : 99
        });
      }
    }
  }

  if (candidates.length === 0) return '127.0.0.1';
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0].address;
}

const hostIP = getHostIPv4();

router.get(/^\/.*\.(jpeg|jpg|png|gif)$/i, async (req, res) => {
  const imageUrl = `http://${hostIP}:8081${req.originalUrl.replace('/local', '')}`;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);

    res.set('Content-Type', response.headers.get('Content-Type') || 'image/jpeg');
    response.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Image fetch error');
  }
});

module.exports = router;