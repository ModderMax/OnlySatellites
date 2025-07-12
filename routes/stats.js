// routes/stats.js
const os = require('os');
const { execSync } = require('child_process');
const process = require('process');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hrs}h ${mins}m`;
}

function getPreferredIPv4() {
  const interfaces = os.networkInterfaces();
  const preferred = [];

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        iface.address !== '127.0.0.1' &&
        iface.netmask !== '255.255.255.255' // ignore non-standard masks
      ) {
        preferred.push({
          name,
          address: iface.address,
          hasGateway: name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('wi-fi')
        });
      }
    }
  }

  // Prefer Ethernet with gateway, then Wi-Fi
  const eth = preferred.find(i => i.name.toLowerCase().includes('ethernet') && i.hasGateway);
  const wifi = preferred.find(i => i.name.toLowerCase().includes('wi-fi') && i.hasGateway);
  const fallback = preferred[0];

  return eth?.address || wifi?.address || fallback?.address || '127.0.0.1';
}

function getOSInfo() {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  const type = os.type();
  return `${platform} ${arch} (${type} ${release} )`;
}

module.exports = (appStartTime) => (req, res) => {
  const memory = process.memoryUsage();
  const hostIp = getPreferredIPv4();

  res.json({
    hostIp,
    systemUptime: formatUptime(os.uptime()),
    serverUptime: formatUptime(Math.floor((Date.now() - appStartTime) / 1000)),
    osInfo: getOSInfo(),
    ipv4Addresses: Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address),
    memoryUsage: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
    }
  });
};