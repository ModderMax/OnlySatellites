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
        net.address !== '127.0.0.1' &&
        !net.address.startsWith('169.254') &&
        !/virtual|vmware|vbox|hyper-v|loopback/i.test(name)
      ) {
        candidates.push({
          name,
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

router.get('/', async (req, res) => {
  try {
    const [statusHtml, apiJson] = await Promise.all([
      fetch(`http://${hostIP}:8081/status`).then(res => res.text()),
      fetch(`http://${hostIP}:8081/api`).then(res => res.json())
    ]);

    res.render('satdump', {
      statusHtml,
      apiData: apiJson
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch satdump data');
  }
});

router.get('/live', async (req, res) => {
  try {
    const apiJson = await fetch(`http://${hostIP}:8081/api`).then(res => res.json());
    res.json(apiJson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live data' });
  }
});

router.get('/html', async (req, res) => {
  try {
    const statusHtml = await fetch(`http://${hostIP}:8081/status`).then(r => r.text());
    res.send(statusHtml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch status fragment');
  }
});

module.exports = router;