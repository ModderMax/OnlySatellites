const express = require('express');
const router = express.Router();
const db = require('../scripts/db-userControls');
const { requireAuth } = require('../routes/auth');
router.get('/', (req, res) => {
  try {
    const notes = db.getAllNotes();
    res.json(notes);
  } catch (err) {
    console.error('Failed to fetch notes:', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/', requireAuth, (req, res) => {
  const { timestamp, title, description } = req.body;
  try {
    db.addNote(timestamp, title, description);
    res.json({ message: 'Note added' });
  } catch (err) {
    console.error('Failed to add note:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

router.delete('/:timestamp', requireAuth, (req, res) => {
  try {
    db.deleteNote(Number(req.params.timestamp));
    res.json({ message: 'Note deleted' });
  } catch (err) {
    console.error('Failed to delete note:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;