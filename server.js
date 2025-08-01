const express = require('express');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const schedule = require('node-schedule');

const apiRoutes = require('./routes/api');
const statsHandler = require('./routes/stats');
const gallery = require('./routes/gallery');
const satdump = require('./routes/satdump');
const satdumpImages = require('./routes/local');
const updateRoute = require('./routes/update');
const hmRoute = require('./routes/hm');
const userControls = require('./routes/userControls');
const adminCenter = require('./routes/admin_center');
const { spawnSync } = require('child_process');
const { router: authRoutes, requireAuth } = require('./routes/auth');
const { runBackup } = require('./scripts/log-backup');


const app = express();
const PORT = 1500;
const appStartTime = Date.now();
var exePath = path.join(__dirname, 'db-update.exe');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

console.log("Server starting, please wait... \nthis may take a few minutes on the first run.")

var result = spawnSync(exePath, ['update'], {
  stdio: 'inherit',
  shell: true,
  stdio: 'ignore'
});

if (result.error) {
  console.error('Failed to run db-update.exe:', result.error);
  process.exit(1);
}

exePath = path.join(__dirname, 'thumbgen.exe');

result = spawnSync(exePath, {
  stdio: 'inherit',
  shell: true,
  stdio: 'ignore'
});

if (result.error) {
  console.error('Failed to run thumbgen.exe:', result.error);
  process.exit(1);
}

// Middleware
app.use(express.json());
app.use(session({
  secret: '1278fafazxuas8fehuaso72fi01927t28t98427goawbvas7vd7aw7egvxcbjae7921',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) res.set('Content-Type', 'text/css');
  }
}));

app.use('/images', express.static(path.join(__dirname, 'live_output')));

// Use API routes
app.use('/api', apiRoutes);
app.use('/api/hm', requireAuth(2), hmRoute);
app.use('/api/update', updateRoute);
app.use('/api/userControls', userControls);
app.use('/api/satdump', requireAuth(3), satdump);
app.use('/local', satdumpImages);
app.use('/api/admin', requireAuth(0), adminCenter);
app.use('/vendor/chart', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));
app.use('/vendor/chart-plugin', express.static(path.join(__dirname, 'node_modules/chartjs-plugin-streaming/dist')));
app.use('/vendor/luxon', express.static(path.join(__dirname, 'node_modules/luxon/build')));
app.use('/vendor/chart-adapter', express.static(path.join(__dirname, 'node_modules/chartjs-adapter-luxon/dist')));

// Use auth routes
app.use(authRoutes);

// Stats API
app.get('/api/stats', requireAuth(3), statsHandler(appStartTime));

// Public pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/html/index.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public/html/about.html')));
app.get('/local', (req, res) => res.sendFile(path.join(__dirname, 'public/html/local.html')));
app.use('/gallery', gallery);
//app.get('/gallery', (req, res) => res.sendFile(path.join(__dirname, 'public/html/gallery.html')));
app.get('/local/gallery', (req, res) => res.sendFile(path.join(__dirname, 'public/html/gallery.html')));
app.get('/local/about', (req, res) => res.sendFile(path.join(__dirname, 'public/html/local_about.html')));

// Protected pages
//app.get('/local/gallery', requireAuth(5), (req, res) => res.sendFile(path.join(__dirname, 'public/html/gallery')));
app.use('/local/satdump', requireAuth(3), satdump);
app.get('/local/stats', requireAuth(3), (req, res) => res.sendFile(path.join(__dirname, 'public/html/stats.html')));
app.get('/local/admin', requireAuth(1), (req, res) => res.sendFile(path.join(__dirname, 'public/html/admin-center.html')));
schedule.scheduleJob('0 3 * * *', runBackup); //run every day at 0300
runBackup(); //run once on startup

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});