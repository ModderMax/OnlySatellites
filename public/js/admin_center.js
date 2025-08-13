document.addEventListener('DOMContentLoaded', async () => {
  const statsDiv = document.getElementById('admin-center-stats');
  if (!statsDiv) return;

  try {
    const res = await fetch('../api/admin/disk-stats');
    const data = await res.json();

    if (data.error) {
      statsDiv.innerHTML = `<p>Error fetching data: ${data.error}</p>`;
      return;
    }

    const formatBytes = (bytes) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
      }
      return `${bytes.toFixed(1)} ${units[i]}`;
    };

    statsDiv.innerHTML = `
      <h2>Disk & Retention Stats</h2>
      <ul>
        <li><strong>Total Disk Size:</strong> ${formatBytes(data.disk.total)}</li>
        <li><strong>Free Disk Space:</strong> ${formatBytes(data.disk.free)}</li>
        <li><strong>Live Output Total Size:</strong> ${formatBytes(data.live_output.totalSize)}</li>
        <li><strong>Live Output (Past 2 Weeks):</strong> ${formatBytes(data.live_output.recentSize)}</li>
        <li><strong>Approx. Data Retention Span:</strong> ${data.estimates.dataRetentionDays ?? 'Unknown'} days</li>
        <li><strong>Approx. Time Until Disk Full:</strong> ${data.estimates.timeToDiskFullDays ?? 'Unknown'} days</li>
      </ul>
    `;
  } catch (err) {
    console.error('Failed to fetch admin stats:', err);
    statsDiv.innerHTML = `<p>Error loading data.</p>`;
  }
});