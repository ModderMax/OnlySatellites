const fs = require('fs');
const path = require('path');
const appdata = require('appdata-path');

const pathsConfigPath = path.join(__dirname, '../config/paths.json');
const backupDir = path.join(__dirname, '../backups/satdump_logs');

function getSatDumpPaths() {
  if (!fs.existsSync(pathsConfigPath)) return [];

  try {
    const config = JSON.parse(fs.readFileSync(pathsConfigPath, 'utf8'));
    if (Array.isArray(config.satdumpLogPaths)) {
      return config.satdumpLogPaths
        .filter(entry => entry && typeof entry.name === 'string' && typeof entry.path === 'string');
    }
  } catch (e) {
    console.warn('Invalid paths.json config:', e);
  }

  // Fallback default
  const defaultDir = path.join(appdata(), 'SatDump');
  return [{ name: 'default', path: defaultDir }];
}

function copyLogsFromDirectory(sourceName, srcDir, destDir) {
  if (!srcDir || typeof srcDir !== 'string' || !fs.existsSync(srcDir)) {
    console.warn(`Invalid or missing source path: ${srcDir}`);
    return;
  }

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.log'));
  for (const file of files) {
    const src = path.join(srcDir, file);
    const destFilename = `${sourceName}_${file}`;
    const dest = path.join(backupDir, destFilename);

    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      console.warn(`Failed to copy ${file}:`, err);
    }
  }
}

function runBackup() {
  const paths = getSatDumpPaths();
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  for (const { name, path: srcPath } of paths) {
  copyLogsFromDirectory(name, srcPath, backupDir);
}

  console.log(`[${new Date().toISOString()}] SatDump logs backed up.`);
}

module.exports = { runBackup };