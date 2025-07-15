const express = require('express');
const router = express.Router();
const fs = require('fs');
const Database = require('better-sqlite3');
const isSimplified = mode => mode === 'simple';
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'image_metadata.db');
const db = new Database(dbPath);

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

router.get('/', async (req, res) => {
  const mode = req.query.mode === 'advanced' ? 'advanced' : 'simple';
  const simplified = mode === 'simple';

  let initialData = [];

  if (simplified) {
    try {
      const query = `
      WITH recent_passes AS (
        SELECT DISTINCT
          passes.id,
          passes.timestamp,
          passes.satellite,
          passes.rawDataPath,
          passes.name
        FROM passes
        JOIN images ON passes.id = images.passId
        WHERE images.corrected = 1 AND images.filled = 1
        ORDER BY passes.timestamp DESC
        LIMIT 10
      )
      SELECT
        images.*,
        recent_passes.timestamp,
        recent_passes.satellite,
        recent_passes.rawDataPath,
        recent_passes.name
      FROM images
      JOIN recent_passes ON images.passId = recent_passes.id
      WHERE images.corrected = 1 AND images.filled = 1
      ORDER BY recent_passes.timestamp DESC, images.id ASC
    `;
      const stmt = db.prepare(query);
      const rows = stmt.all().map(img => {
      const displayKey = Object.keys(COMPOSITE_TYPES)
        .sort((a, b) => b.length - a.length)
        .find(prefix => img.composite?.toLowerCase().includes(prefix.toLowerCase()));
      return {
        ...img,
        compositeDisplay: displayKey ? COMPOSITE_TYPES[displayKey] : 'Other'
      };
    });
      initialData = rows;
    } catch (err) {
      console.error('Error fetching simplified data:', err);
    }
  }

  res.render('gallery', {
    mode,
    simplified,
    initialData
  });
});

module.exports = router;