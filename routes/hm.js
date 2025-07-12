const express = require('express');
const os = require('os');

const router = express.Router();

function getHostIPv4() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        net.address !== '127.0.0.1' &&
        !net.address.startsWith('169.254') && // link-local
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

  // Sort by priority: Ethernet first, then Wi-Fi, then others
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0].address;
}

router.get('/stats', async (req, res) => {
  const hostIp = getHostIPv4();
  const url = `http://${hostIp}:8085`; // Directly fetching the JSON data from this endpoint

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    const jsonData = await response.json();  // Parsing the JSON response
    res.json(jsonData);  // Send the data to the client
  } catch (err) {
    console.error('Failed to proxy LHM stats:', err);
    res.status(500).json({ error: 'Failed to proxy LHM stats', details: err.message });
  }
});
module.exports = router;