const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
//const { Worker } = require('worker_threads');
const sharp = require('sharp');
const { performance } = require('perf_hooks');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'image_metadata.db');
const liveOutputDir = path.join(__dirname, '..', 'live_output');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const db = new Database(dbPath);

// Setup DB schema
function initializeDatabase() {
  const passCols = db.prepare(`PRAGMA table_info(passes)`).all().map(c => c.name);
  if (!passCols.includes('satellite')) {
    db.exec(`DROP TABLE IF EXISTS passes`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      satellite TEXT,
      timestamp INTEGER,
      rawDataPath TEXT
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT,
      composite TEXT,
      mapOverlay INTEGER,
      corrected INTEGER,
      filled INTEGER,
      vPixels INTEGER,
      passId INTEGER,
      FOREIGN KEY (passId) REFERENCES passes(id)
    );
  `);
}

// Clear tables before repopulating
function clearTables() {
  db.exec(`DELETE FROM images;`);
  db.exec(`DELETE FROM passes;`);
}

function isImageFile(name) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
}

function isDirectoryStable(dirPath) {
  const maxDirAgeMs = 15 * 60 * 1000
  // const recentFileThresholdMs = 4 * 60 * 1000
  try {
    const dirStat = fs.statSync(dirPath);
    const now = Date.now();
    const dirAge = now - dirStat.mtimeMs;

    // If directory is older than 15 mins, assume stable
    if (dirAge > maxDirAgeMs) return true;
   
    // Recursively check all files
    // const noRecentFiles = isFileSystemStable(dirPath, now, recentFileThresholdMs);
    // return noRecentFiles; // Return the result of recurrent scanning
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Directory does not exist yet: ${dirPath}`);
    } else {
      console.error(`Failed to stat directory ${dirPath}:`, err.message); 
    } 
    return false; 
  } 
}

async function getImageDimensions(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return { vPixels: metadata.height, hPixels: metadata.width };
  } catch (err) {
    console.error(`Failed to get dimensions for ${imagePath}:`, err);
    return { vPixels: null, hPixels: null };
  }
}

function extractTimestampFromFolder(folderName) {
  const match = folderName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/);
  if (!match) return null;

  const [_, year, month, day, hour, minute] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  return Math.floor(date.getTime() / 1000); // Unix timestamp (seconds)
}

/**
function isFileSystemStable(dir, now, thresholdMs) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Unable to read directory ${dir}: ${err.message}`);
    return false;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    try {
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;
      const fileAge = now - mtime;
      if (entry.isFile()) {
        if (fileAge < thresholdMs) {
          return false; // yung file found
        }
      } else if (entry.isDirectory()) {
        if (fileAge < thresholdMs) {
          return false; // yung dir found
        }
        if (!isFileSystemStable(fullPath, now, thresholdMs)) {
          return false; // recurring found yung file / dir
        }
      }
    } catch (err) {
      console.warn(`big RIP cuz ${fullPath}: ${err.message} happened`);
    }
  }
  return true;
} */

  async function processNOAAPass(passPath, passName, dataset) {
    const images = fs.readdirSync(passPath).filter(isImageFile);
    return await Promise.all(images.map(async (file) => {
      const fullImagePath = path.join(passPath, file);
      const { vPixels } = await getImageDimensions(fullImagePath);
  
      return {
        path: `${passName}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: 1,
        filled: 1,
        mapOverlay: file.toLowerCase().includes('map'),
        vPixels
      };
    }));
  }

  async function processMeteorPass(passPath, passName, dataset) {
    const subdirs = ['MSU-MR', 'MSU-MR (Filled)'];
    let results = [];
    for (const subdir of subdirs) {
      const fullSubdir = path.join(passPath, subdir);
      if (!fs.existsSync(fullSubdir)) continue;
      const images = fs.readdirSync(fullSubdir).filter(isImageFile);
      for (const file of images) {
        const fullImagePath = path.join(fullSubdir, file);
        const { vPixels } = await getImageDimensions(fullImagePath);
  
        results.push({
          path: `${passName}/${subdir}/${file}`,
          composite: path.parse(file).name.toLowerCase(),
          corrected: file.toLowerCase().includes('corrected'),
          filled: subdir.toLowerCase().includes('filled') ? 1 : 0,
          mapOverlay: file.toLowerCase().includes('map'),
          vPixels
        });
      }
    }
    return results;
  }

function processElektroPass(passPath, passName, cacheData) {
  const elektroRoot = path.join(passPath, 'IMAGES', 'ELEKTRO-L3');
  if (!fs.existsSync(elektroRoot)) return [];

  const results = [];
  for (const subfolder of fs.readdirSync(elektroRoot)) {
    const fullFolder = path.join(elektroRoot, subfolder);
    const images = fs.readdirSync(fullFolder).filter(isImageFile);
    const timestamp = cacheData?.[`IMAGES/ELEKTRO-L3/${subfolder}`]?.time || null;

    for (const file of images) {
      results.push({
        path: `${passName}/IMAGES/ELEKTRO-L3/${subfolder}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: 1,
        filled: 1,
        mapOverlay: file.toLowerCase().includes('map'),
        timestamp,
        vPixels: 2784
      });
    }
  }
  return results;
}

function processSVISSRPass(passPath, passName) {
  const svissrRoot = path.join(passPath, 'IMAGE');
  if (!fs.existsSync(svissrRoot)) return [];

  const results = [];
  for (const subfolder of fs.readdirSync(svissrRoot)) {
    const fullFolder = path.join(svissrRoot, subfolder);
    const images = fs.readdirSync(fullFolder).filter(isImageFile);
    for (const file of images) {
      results.push({
        path: `${passName}/IMAGE/${subfolder}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: 1,
        filled: 1,
        mapOverlay: file.toLowerCase().includes('map'),
        vPixels: 2501
      });
    }
  }
  return results;
}

async function processPass(passFolder) {
  const insertPass = db.prepare(`
    INSERT OR REPLACE INTO passes (name, satellite, timestamp, rawDataPath)
    VALUES (?, ?, ?, ?)
  `);

  const insertImage = db.prepare(
    `INSERT INTO images (path, composite, mapOverlay, corrected, filled, vPixels, passId)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const passPath = path.join(liveOutputDir, passFolder);
  const datasetPath = path.join(passPath, 'dataset.json');
  const cachePath = path.join(passPath, '.composite_cache_do_not_delete.json');

  let rawDataPath = null;
  let satellite = 'Unknown';
  let timestamp = null;
  let images = [];

  if (fs.existsSync(datasetPath)) {
    const dataset = JSON.parse(fs.readFileSync(datasetPath));
    satellite = dataset.satellite || satellite;
    timestamp = Math.floor(dataset.timestamp || 0);

    if (satellite.toLowerCase().includes('noaa')) {
      images = await processNOAAPass(passPath, passFolder, dataset);
      rawDataPath = 0;
    } else if (satellite.toLowerCase().includes('meteor')) {
      images = await processMeteorPass(passPath, passFolder, dataset);
      const files = fs.readdirSync(passPath);
      const caduFile = files.find(file => file.toLowerCase().endsWith('.cadu'));
      if (caduFile) {
        rawDataPath = path.join('live_output', passFolder, caduFile);
      }
      if (timestamp < 1) {
        timestamp = extractTimestampFromFolder(passFolder);
      }
    }
  } else if (fs.existsSync(cachePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cachePath));
    satellite = 'Elektro-L3';
    timestamp = Object.values(cacheData)[0]?.time || null;
    images = processElektroPass(passPath, passFolder, cacheData);
    rawDataPath = 0;
  } else if (fs.existsSync(path.join(passPath, 'IMAGE'))) {
    satellite = 'FengYun';
    images = processSVISSRPass(passPath, passFolder);
    rawDataPath = 0;
    timestamp = extractTimestampFromFolder(passFolder);
  }

  const result = insertPass.run(passFolder, satellite, timestamp, rawDataPath);
  const passId = result.lastInsertRowid;

  /** Prepare thumbnail jobs
  const thumbJobs = images.map(img => {
    const inputPath = path.join(liveOutputDir, img.path);
    const thumbPath = getThumbnailPath(img.path);
    return {
      inputPath,
      outputPath: path.join(liveOutputDir, thumbPath),
    };
  }); */

  // Insert all image records into the DB
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    //const thumbPath = getThumbnailPath(img.path);
    insertImage.run(
      img.path,
      img.composite,
      img.mapOverlay ? 1 : 0,
      img.corrected ? 1 : 0,
      img.filled ? 1 : 0,
      img.vPixels || null,
      passId
    );
  }
  //return thumbJobs;
}

/**function runSingleThumbnailWorker(jobs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'thumbnail-worker.js'));

    worker.postMessage({ images: jobs });

    worker.on('message', (msg) => {
      if (msg.success) resolve();
      else reject(new Error(msg.error || 'Worker failed'));
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

// Returns a thumbnail path next to the image inside a "thumbnails" folder
function getThumbnailPath(imagePath) {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath)); // remove extension 
  const thumbDir = path.join(dir, 'thumbnails');

  return path.join(thumbDir, base + '.avif'); // compile path and add avif extension
}*/

async function runSetup(mode) {
  let addedCount = 0;
  const passFolders = fs.readdirSync(liveOutputDir).filter(folder => {
    const fullPath = path.join(liveOutputDir, folder);
    return fs.statSync(fullPath).isDirectory();
  });
  if (mode === '--update') {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='passes'`).get();
    if (!tableExists) {
      console.log('Table "passes" does not exist. Falling back to --repopulate.');
      return runSetup('--repopulate');
    }
    const passExists = db.prepare('SELECT 1 FROM passes WHERE name = ?');
    for (const passFolder of passFolders) {
      if (passExists.get(passFolder)) {
        continue; // Skip if already exists
      }
      if (!isDirectoryStable(path.join(liveOutputDir, passFolder))) {
        console.log(passFolder, 'may be updating at this time; skipping...')
        continue; // Skip if recently made
      }
      await processPass(passFolder);
      addedCount++;
    }
    console.log('Database has been updated. Added ', addedCount, ' passes');
    //await runSingleThumbnailWorker(thumbnailJobs);
  }
  if (mode === '--repopulate') {
    initializeDatabase();
    const startTime = performance.now()
    clearTables();
    for (const passFolder of fs.readdirSync(liveOutputDir)) {
      const fullPath = path.join(liveOutputDir, passFolder);
      if (!fs.statSync(fullPath).isDirectory()) continue;
      await processPass(passFolder);
      addedCount++;
    }
    const endTime = performance.now()
    console.log(`Call to doSomething took ${endTime - startTime} milliseconds`)
    console.log('Database population complete. Passes found:', addedCount);
  }
  if (mode === '--rebuild') {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Deleted existing database.');
    }
    initializeDatabase();
    console.log('Database initialized');
    for (const passFolder of fs.readdirSync(liveOutputDir)) {
      if (!fs.statSync(path.join(liveOutputDir, passFolder)).isDirectory()) continue;
      processPass(passFolder);
      addedCount++;
    }
    console.log('Database population complete. Passes found:', addedCount);
  }
}

module.exports = runSetup;

if (require.main === module) {
  runSetup(process.argv[2]);
}