const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

let lastUpdate = 0;
const COOLDOWN_MS = 60 * 1000;
let updateInProgress = false;

router.post('/', (req, res) => {
  const now = Date.now();

  if (updateInProgress || now - lastUpdate < COOLDOWN_MS) {
    return res.status(429).json({ updated: false, message: 'Update on cooldown or in progress.' });
  }

  updateInProgress = true;
  lastUpdate = now;
  res.json({ updated: true, message: 'Update started.' });

  // Run db-update.exe
  const dbUpdate = spawn(path.join(__dirname, '../db-update.exe'), ['update'], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  });

  dbUpdate.on('close', (code) => {
    if (code !== 0) {
      console.error('db-update.exe exited with code', code);
      updateInProgress = false;
      return;
    }

    // Run thumbgen.exe only if db-update succeeds
    const thumbGen = spawn(path.join(__dirname, '../thumbgen.exe'), {
      shell: true,
      detached: true,
      stdio: 'ignore'
    });

    thumbGen.on('close', (thumbCode) => {
      if (thumbCode !== 0) {
        console.error('thumbgen.exe exited with code', thumbCode);
      }
      updateInProgress = false;
    });
  });
});

module.exports = router;