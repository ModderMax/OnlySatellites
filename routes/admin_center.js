const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const router = express.Router();
const liveOutputPath = path.join(__dirname, '../live_output');

// Utility to get disk space (platform-dependent)
function getDiskStats() {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      const stdout = execSync(`wmic logicaldisk where "DeviceID='C:'" get Size,FreeSpace /format:value`).toString();
      const sizeMatch = stdout.match(/Size=(\d+)/);
      const freeMatch = stdout.match(/FreeSpace=(\d+)/);

      return {
        total: sizeMatch ? parseInt(sizeMatch[1]) : null,
        free: freeMatch ? parseInt(freeMatch[1]) : null,
      };
    } else {
      const stdout = execSync(`df -k --output=size,avail "${liveOutputPath}" | tail -1`).toString().trim();
      const [sizeK, availK] = stdout.split(/\s+/).map(Number);
      return {
        total: sizeK * 1024,
        free: availK * 1024,
      };
    }
  } catch (err) {
    console.error('Failed to get disk stats:', err);
    return { total: null, free: null };
  }
}

// Recursively get directory size (all files)
function getDirSize(dirPath, recentOnly = false, cutoffDate = null) {
  let totalSize = 0;

  function recurse(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      try {
        const stats = fs.statSync(fullPath);

        if (entry.isDirectory()) {
          recurse(fullPath);
        } else if (!recentOnly || stats.mtime >= cutoffDate) {
          totalSize += stats.size;
        }
      } catch (e) {
        console.warn('Failed to stat file:', fullPath);
      }
    }
  }

  try {
    recurse(dirPath);
  } catch (err) {
    console.error('Error calculating directory size:', err);
  }

  return totalSize;
}

// Main route
router.get('/disk-stats', (req, res) => {
  const disk = getDiskStats();
  if (!disk.total || !disk.free) {
    return res.status(500).json({ error: 'Unable to retrieve disk stats' });
  }

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const fullLiveSize = getDirSize(liveOutputPath);
  const recentLiveSize = getDirSize(liveOutputPath, true, twoWeeksAgo);
  const allocSize = fullLiveSize + disk.free;

  const retentionSpan = recentLiveSize > 0
    ? Math.floor(allocSize / recentLiveSize * 14)
    : null;

  const timeToFull = recentLiveSize > 0
    ? Math.floor(disk.free / recentLiveSize * 14)
    : null;

  res.json({
    disk: {
      total: disk.total,
      free: disk.free,
    },
    live_output: {
      totalSize: fullLiveSize,
      recentSize: recentLiveSize,
    },
    estimates: {
      dataRetentionDays: isFinite(retentionSpan) ? retentionSpan : 9999, // how long current dataset would take to accumulate
      timeToDiskFullDays: isFinite(timeToFull) ? timeToFull : 9999   // how long until free space fills at current rate
    }
  });
});

module.exports = router;
