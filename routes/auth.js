const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const router = express.Router();
const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../uAuth.json'), 'utf8'));

// Serve login page
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/html/login.html'));
});

// Handle login form
router.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);

  if (!user) return res.status(401).send('Invalid username or password');

  const match = await bcrypt.compare(password, user.hash);
  if (match) {
    req.session.authenticated = true;
    req.session.username = username;
    req.session.level = user.level;
    if (user.level === 0) {
      res.redirect('local/admin');
    } else {
      res.redirect('local/satdump')
    }
  } else {
    res.status(401).send('Invalid username or password');
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Middleware: Require authentication and minimum privilege level
function requireAuth(minLevel = 0) {
  return (req, res, next) => {
    if (req.session?.authenticated && req.session.level <= minLevel) {
      return next();
    }
    res.status(403).send('Access denied');
  };
}

module.exports = { router, requireAuth };