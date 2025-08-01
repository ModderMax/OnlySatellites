const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { spawnSync } = require('child_process');
const archiver = require('archiver');
const { requireAuth } = require('../routes/auth');

// Ensure the data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const router = express.Router();
const dbPath = path.join(dataDir, 'image_metadata.db');
const db = new Database(dbPath);
const contentDir = path.join(__dirname, '../public/userContent');

const COMPOSITE_TYPES = {
  'AVHRR_221': 'AVHRR 221',
  'AVHRR_3a21': 'AVHRR 3a21',
  'Cloud_Convection': 'Cloud Convection',
  'avhrr_3_rgb_MCIR_Rain_': 'MCIR Rain',
  'MSU-MR-': 'LRPT Channel',
  'L3_1': 'L3 Channel 1',
  'L3_2': 'L3 Channel 2',
  'L3_3': 'L3 Channel 3',
  'L3_4': 'L3 Channel 4',
  'L3_9': 'L3 Channel 9',
  '10.8um': '10.8um IR',
  'GS_321_': '321 False Color',
  'Natural_Color': 'Natural Color',
  'APT-A': 'APT Channel A',
  'APT-B': 'APT Channel B',
  'raw_': 'Raw APT',
  'AVHRR-2': 'AVHRR Channel 2',
  'AVHRR-4': 'AVHRR Channel 4',
  'fy-2x': 'SVISSR'
};

router.get('/images', (req, res) => {
  try {
    const filters = [];
    const params = [];

    // Map overlay
    if (req.query.map === 'only') {
      filters.push('images.mapOverlay = 1');
    }

    // Corrected only
    if (req.query.correctedOnly === '1') {
      filters.push('images.corrected = 1');
    }

    // Filled only
    if (req.query.filledOnly === '1') {
      filters.push('images.filled = 1');
    }

    // Satellite filter
    if (req.query.satellite) {
      filters.push('LOWER(passes.satellite) = LOWER(?)');
      params.push(req.query.satellite);
    }

    // Band filter (downlink)
    if (req.query.band) {
      filters.push('LOWER(passes.downlink) = LOWER(?)');
      params.push(req.query.band);
    }

    const useUTC = req.query.useUTC === '0';
    const localOffsetSec = new Date().getTimezoneOffset() * 60;

    function toEpochSeconds(dateStr, timeStr = '00:00') {
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hour, minute] = timeStr.split(':').map(Number);
      const date = useUTC
        ? new Date(Date.UTC(year, month - 1, day, hour, minute))
        : new Date(year, month - 1, day, hour, minute);
      return Math.floor(date.getTime() / 1000);
    }

    if (req.query.startDate) {
      filters.push('passes.timestamp >= ?');
      params.push(toEpochSeconds(req.query.startDate, '00:00'));
    }

    if (req.query.endDate) {
      filters.push('passes.timestamp <= ?');
      params.push(toEpochSeconds(req.query.endDate, '23:59'));
    }

    if (req.query.startTime) {
      const [sh, sm] = req.query.startTime.split(':').map(Number);
      let startSeconds = sh * 3600 + sm * 60;
      if (!useUTC) startSeconds = (startSeconds + localOffsetSec + 86400) % 86400;
      filters.push('(passes.timestamp % 86400) >= ?');
      params.push(startSeconds);
    }

    if (req.query.endTime) {
      const [eh, em] = req.query.endTime.split(':').map(Number);
      let endSeconds = eh * 3600 + em * 60;
      if (!useUTC) endSeconds = (endSeconds + localOffsetSec + 86400) % 86400;
      filters.push('(passes.timestamp % 86400) <= ?');
      params.push(endSeconds);
    }

    // Composite filter - updated to handle 'other' option
    if (req.query.composite) {
  const comps = Array.isArray(req.query.composite) ? req.query.composite : [req.query.composite];
  const subFilters = [];
  const subParams = [];

  const knownKeys = Object.keys(COMPOSITE_TYPES);
  const selectedKnownKeys = knownKeys.filter(key => comps.includes(key));

  // Add known composite filters
  if (selectedKnownKeys.length > 0) {
    const knownConditions = selectedKnownKeys.map(() => 'LOWER(images.composite) LIKE ?');
    subFilters.push(`(${knownConditions.join(' OR ')})`);
    subParams.push(...selectedKnownKeys.map(k => `%${k.toLowerCase()}%`));
  }

  // Add 'other' filter logic if 'other' is selected
  if (comps.includes('other')) {
    const notConditions = knownKeys.map(() => 'LOWER(images.composite) NOT LIKE ?');
    subFilters.push(`(${notConditions.join(' AND ')} AND images.composite IS NOT NULL AND images.composite != '')`);
    subParams.push(...knownKeys.map(k => `%${k.toLowerCase()}%`));
  }

  if (subFilters.length > 0) {
    filters.push(`(${subFilters.join(' OR ')})`);
    params.push(...subParams);
  }
}


    const sortBy = req.query.sortBy === 'vPixels' ? 'images.vPixels' : 'passes.timestamp';
    const sortOrder = req.query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const limit = parseInt(req.query.limit, 10) || 100;
    const limitType = req.query.limitType === 'passes' ? 'passes' : 'images';
    
    const filterStr = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
    let query, queryParams;

    if (limitType === 'images') {
      // Simple image-based query - This part is working correctly
      query = `
        SELECT images.*, passes.timestamp, passes.satellite, passes.rawDataPath, passes.name
        FROM images
        JOIN passes ON images.passId = passes.id
        ${filterStr}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT ?
      `;
      queryParams = [...params, limit];
    } else {
      // Pass-based query with proper handling of filters
      if (sortBy === 'images.vPixels') {
        // When sorting by vPixels for passes
        query = `
          WITH filtered_images AS (
            SELECT
              images.*
            FROM images
            JOIN passes ON images.passId = passes.id
            ${filterStr}
          ),
          pass_metrics AS (
            SELECT
              filtered_images.passId,
              MAX(filtered_images.vPixels) as maxVPixels
            FROM filtered_images
            GROUP BY filtered_images.passId
          ),
          ranked_passes AS (
            SELECT
              passes.id,
              passes.timestamp,
              passes.satellite,
              passes.rawDataPath,
              passes.name,
              COALESCE(pass_metrics.maxVPixels, 0) as maxVPixels
            FROM passes
            JOIN pass_metrics ON passes.id = pass_metrics.passId
            ORDER BY pass_metrics.maxVPixels ${sortOrder}, passes.timestamp DESC
            LIMIT ?
          )
          SELECT
            filtered_images.*,
            ranked_passes.timestamp,
            ranked_passes.satellite,
            ranked_passes.rawDataPath,
            ranked_passes.name
          FROM filtered_images
          JOIN ranked_passes ON filtered_images.passId = ranked_passes.id
          ORDER BY ranked_passes.maxVPixels ${sortOrder}, ranked_passes.timestamp DESC
        `;
        queryParams = [...params, limit];
      } else {
        // When sorting by timestamp for passes
        query = `
          WITH filtered_images AS (
            SELECT
              images.*
            FROM images
            JOIN passes ON images.passId = passes.id
            ${filterStr}
          ),
          filtered_passes AS (
            SELECT DISTINCT
              passes.id,
              passes.timestamp,
              passes.satellite,
              passes.rawDataPath,
              passes.name
            FROM passes
            JOIN filtered_images ON passes.id = filtered_images.passId
            ORDER BY passes.timestamp ${sortOrder}
            LIMIT ?
          )
          SELECT
            filtered_images.*,
            filtered_passes.timestamp,
            filtered_passes.satellite,
            filtered_passes.rawDataPath,
            filtered_passes.name
          FROM filtered_images
          JOIN filtered_passes ON filtered_images.passId = filtered_passes.id
          ORDER BY filtered_passes.timestamp ${sortOrder}, filtered_images.id ASC
        `;
        queryParams = [...params, limit];
      }
    }
    
    const stmt = db.prepare(query);
    const rows = stmt.all(...queryParams).map(img => {
      const displayKey = Object.keys(COMPOSITE_TYPES)
        .sort((a, b) => b.length - a.length)
        .find(prefix => img.composite?.toLowerCase().includes(prefix.toLowerCase()));
      return {
        ...img,
        compositeDisplay: displayKey ? COMPOSITE_TYPES[displayKey] : 'Other'
      };
    });
    
    res.json(rows);
  } catch (err) {
    console.error('Error in /api/images:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/satellites', (req, res) => {
  const stmt = db.prepare(`
    SELECT DISTINCT passes.satellite
    FROM images
    JOIN passes ON images.passId = passes.id
    WHERE passes.satellite IS NOT NULL
    ORDER BY passes.satellite DESC
  `);
  const satellites = stmt.all().map(row => row.satellite);
  res.json(satellites);
});

router.get('/bands', (req, res) => {
  const stmt = db.prepare(`
    SELECT DISTINCT passes.downlink
    FROM images
    JOIN passes ON images.passId = passes.id
    WHERE passes.downlink IS NOT NULL
    ORDER BY passes.downlink ASC
  `);
  const bands = stmt.all().map(row => row.downlink);
  res.json(bands);
});

router.get('/composites', (req, res) => {
  const satellite = req.query.satellite;

  if (satellite) {
    const stmt = db.prepare(`
      SELECT DISTINCT composite
      FROM images
      JOIN passes ON images.passId = passes.id
      WHERE passes.satellite = ?
    `);
    const rows = stmt.all(satellite);

    const composites = [...new Set(rows.map(r => r.composite).filter(name => typeof name === 'string' && name.trim() !== ''))];

    const response = [];
    let hasOther = false;
    
    // Add known composite types
    for (const key in COMPOSITE_TYPES) {
      if (composites.some(c => c?.toLowerCase().includes(key.toLowerCase()))) {
        response.push({ value: key, label: COMPOSITE_TYPES[key] });
      }
    }
    
    // Check if there are any composites not in COMPOSITE_TYPES
    const knownKeys = Object.keys(COMPOSITE_TYPES);
    hasOther = composites.some(composite => {
      return !knownKeys.some(key => composite?.toLowerCase().includes(key.toLowerCase()));
    });
    
    if (hasOther) {
      response.push({ value: 'other', label: 'Other' });
    }

    res.json(response);
  } else {
    const response = Object.entries(COMPOSITE_TYPES).map(([value, label]) => ({ value, label }));
    response.push({ value: 'other', label: 'Other' });
    res.json(response);
  }
});

router.get('/export', (req, res) => {
  const filePath = req.query.path;

  if (!filePath || !filePath.endsWith('.cadu')) {
    console.warn(`[EXPORT] Invalid request path: ${filePath}`);
    return res.status(400).send('Invalid file request');
  }

  const absPath = path.resolve(__dirname, '..', filePath);
  const safeBase = path.resolve(__dirname, '..', 'live_output');

  if (!absPath.startsWith(safeBase)) {
    console.warn(`[EXPORT] Path traversal detected: ${absPath}`);
    return res.status(400).send('Invalid file request');
  }

  fs.access(absPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.warn(`[EXPORT] File not found: ${absPath}`);
      return res.status(404).send('File not available on site');
    }

    res.download(absPath, (err) => {
      if (err) {
        console.error(`[EXPORT] Error during download:`, err);
        if (!res.headersSent) {
          res.status(500).send('Could not download file');
        }
      }
    });
  });
});

router.get('/zip', (req, res) => {
  const filePath = req.query.path;

  // Validate input path
  if (!filePath || !filePath.startsWith('live_output')) {
    console.warn(`[ZIP] Invalid request path: ${filePath}`);
    return res.status(400).send('Invalid request path');
  }

  const absPath = path.join(__dirname, '..', filePath);
  const zipName = path.basename(filePath) + '.zip';

  // Check if the directory exists
  fs.access(absPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.warn(`[ZIP] Path not found: ${absPath}`);
      return res.status(404).send('Path not found');
    }

    // Set response headers
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[ZIP] Archiving error:', err);
      res.status(500).send('Archiving failed');
    });

    // Pipe archive to the response
    archive.pipe(res);

    // Add the entire directory
    archive.directory(absPath, false);

    archive.finalize();
  });
});

// GET /api/userContent/about
router.get('/about', (req, res) => {
  const filePath = path.join(contentDir, 'about.txt');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(404).send('about.txt not found');
    res.send(data);
  });
});

router.get('/userImages', (req, res) => {
  fs.readdir(contentDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read directory' });

    const imageFiles = files.filter(file =>
      /\.(jpe?g|png|gif|bmp|webp)$/i.test(file)
    );

    res.json(imageFiles);
  });
});

router.post('/repopulate', requireAuth(1), (req, res) => {
  var exePath = path.join(__dirname, '../db-update.exe');
  var result = spawnSync(exePath, ['repopulate'], {
    shell: true,
    encoding: 'utf-8'
  });

  if (result.error) {
    console.error(`Repopulate failed: ${result.error}`);
    return res.status(500).send('Repopulate failed');
  }

  if (result.status !== 0) {
    console.error(`Repopulate stderr: ${result.stderr}`);
    return res.status(500).send('Repopulate failed');
  }
  console.log(`Repopulate stdout: ${result.stdout}`);


  exePath = path.join(__dirname, '../thumbgen.exe');
  result = spawnSync(exePath, {
    shell: true,
    encoding: 'utf-8'
  });

  if (result.error) {
    console.error('Failed to run thumbgen.exe:', result.error);
    return res.status(500).json({ message: 'Update failed.', error: result.error.toString() });
  }

  if (result.status !== 0) {
    console.error('thumbgen.exe exited with non-zero status:', result.stderr);
    return res.status(500).json({ message: 'Update failed.', stderr: result.stderr });
  }

  res.send('Repopulate complete');
});

module.exports = router;