document.addEventListener('DOMContentLoaded', () => {
  const systemStatsEl = document.getElementById('system-stats');
  const searchBox = document.getElementById('hm-search-box');
  const hmStatsContainer = document.getElementById('hm-stats-container');
  const pinnedList = document.getElementById('pinned-list');
  const filterTemperatures = document.getElementById('filterTemperatures');
  const filterVoltages = document.getElementById('filterVoltages');
  const filterFans = document.getElementById('filterFans');

  // Placeholder for storing hm stats
  let hmStats = [];

  document.getElementById('refresh-pins').addEventListener('click', refreshPinnedValues);

  // Fetch system stats and determine the host IP dynamically
  fetch('../local/api/info')
    .then(res => res.json())
    .then(data => {
      const { system_uptime_sec, app_uptime_sec, app_cpu_percent, app_mem } = data;

      // Set iframe source dynamically
      //hmFrame.src = `http://${hostIp}:8085`;

      const entries = [
        { label: 'System Uptime', value: convertSeconds(system_uptime_sec) },
        { label: 'Server Uptime', value: convertSeconds(app_uptime_sec) },
        { label: 'Server CPU', value: app_cpu_percent },
        { label: 'Server Memory %', value: app_mem.memory_percent },
        { label: 'Memory - RSS', value: formatBytes(app_mem.rss_bytes) },
        { label: 'Memory - Heap Alloc', value: formatBytes(app_mem.go_heap_alloc_bytes) },
        { label: 'Memory - Heap Sys', value: formatBytes(app_mem.go_heap_sys_bytes) },
        { label: 'Memory - Stack', value: formatBytes(app_mem.go_stack_inuse_bytes) },
        { label: 'Memory - Routines (Threads)', value: app_mem.go_goroutines },
        { label: 'Memory - Last Garbage collection:', value: app_mem.go_last_gc_unix_sec }
      ];

      entries.forEach(({ label, value }) => {
        const statEl = document.createElement('div');
        statEl.className = 'stat-entry';

        const text = document.createElement('span');
        text.textContent = `${label}: ${value}`;

        statEl.appendChild(text);
        systemStatsEl.appendChild(statEl);
      });
    })
    .catch(err => {
      systemStatsEl.textContent = `Failed to load stats: ${err}`;
    });

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do {
      bytes = bytes / 1024;
      i++;
    } while (bytes >= 1024 && i < units.length - 1);
    return `${bytes.toFixed(1)} ${units[i]}`;
  }

  function convertSeconds(totalSeconds) {
  const days = Math.floor(totalSeconds / (24 * 3600)); // Calculate days
  totalSeconds %= (24 * 3600); // Remaining seconds after extracting days

  const hours = Math.floor(totalSeconds / 3600); // Calculate hours
  totalSeconds %= 3600; // Remaining seconds after extracting hours

  const minutes = Math.floor(totalSeconds / 60); // Calculate minutes
  const seconds = totalSeconds % 60; // Remaining seconds
  const string = `${days}d ${hours}h ${minutes}m ${seconds}s`

  return string;
}

  function refreshPinnedValues() {
    fetch('../local/api/hardware')
    .then(res => res.json())
    .then(data => {
      hmStats = data; // Update global stats list

      // Refresh pinned sensors
      const pinned = getPinnedFromStorage();
      pinnedList.innerHTML = '';
      pinned.forEach(name => {
        const sensor = hmStats.find(s => s.SensorName === name);
        if (sensor) renderPinnedSensor(sensor);
      });

      // Refresh search results if there's an active query
      const query = searchBox.value.trim().toLowerCase();
      if (query) {
        const filtered = hmStats.filter(sensor =>
          sensor.SensorName.toLowerCase().includes(query) ||
          sensor.SensorClass.toLowerCase().includes(query)
        );
        renderhmStats(filtered); // Show filtered results
      } else {
        renderhmStats(hmStats); // Show everything if nothing is in the search bar
      }
    })
    .catch(err => {
      console.error('Error refreshing stats:', err);
    });
}

  // Fetch and process hm stats
  fetch('../local/api/hardware')
  .then(res => res.json())
  .then(hmData => {
    console.log("hm Data:", hmData);
    if (Array.isArray(hmData)) {
      hmStats = hmData;
      renderhmStats(hmStats); // Show all stats on page load
    } else {
      console.error('Expected flat array of stats, got:', hmData);
    }
  })
  .catch(err => {
    console.error('Error fetching hm stats:', err);
  });

  // Render the hm stats based on the filtered stats
  function renderhmStats(stats = []) {
    if (!hmStatsContainer) return;
    hmStatsContainer.innerHTML = '';
  
    stats.forEach(sensor => {  // Add the item, label, value, and a pin button to each entry
      const hmItem = document.createElement('div');
      hmItem.className = 'hm-item';
  
      const label = document.createElement('span');
      label.className = 'hm-label';
      label.textContent = `${sensor.SensorClass}: ${sensor.SensorName}`;
  
      const value = document.createElement('span');
      value.className = 'hm-value';
      value.textContent = `${sensor.SensorValue} ${sensor.SensorUnit}`;
  
      const pinButton = document.createElement('button');
      pinButton.className = 'pin-button';
      pinButton.textContent = '📌';
      pinButton.addEventListener('click', () => {
        pinSensor(sensor);
      });

      value.classList.add('glow');
      setTimeout(() => value.classList.remove('glow'), 1000);
  
      hmItem.appendChild(label);
      hmItem.appendChild(value);
      hmItem.appendChild(pinButton);
      hmStatsContainer.appendChild(hmItem);
    });
  }

  // Pin the sensor to the pinned list
  function pinSensor(sensor) {
    const pinned = getPinnedFromStorage();
    if (!pinned.includes(sensor.SensorName)) {
      pinned.push(sensor.SensorName);
      savePinnedToStorage(pinned);
    }
    renderPinnedSensor(sensor);
  }

  // Render the pinned sensors with item, label, value and unpin button to each entry
  function renderPinnedSensor(sensor) {
    const pinnedItem = document.createElement('li');
    pinnedItem.classList.add('pinned-item');
  
    const label = document.createElement('span');
    label.textContent = `${sensor.SensorClass} - ${sensor.SensorName}:`;

    const value = document.createElement('span');
    value.className = 'pinned-value';
    value.textContent = `${sensor.SensorValue} ${sensor.SensorUnit}`;
  
    const unpinButton = document.createElement('button');
    unpinButton.textContent = '❌';
    unpinButton.classList.add('unpin-button');
    unpinButton.addEventListener('click', () => {
      unpinSensor(sensor.SensorName, pinnedItem);
    });

    // Simple visual effect to show that the values have been updated
    value.classList.add('glow');
    setTimeout(() => value.classList.remove('glow'), 1000); // gurl she was glowing
  
    pinnedItem.appendChild(label);
    pinnedItem.appendChild(value);
    pinnedItem.appendChild(unpinButton);
    pinnedList.appendChild(pinnedItem);
  }

  // Unpin the sensor from the pinned list
  function unpinSensor(sensorText, pinnedItem) {
    pinnedList.removeChild(pinnedItem);
    const pinned = getPinnedFromStorage().filter(name => name !== sensorText);
    savePinnedToStorage(pinned);
  }

  function renderInitialPinnedValues() {
    const pinned = getPinnedFromStorage();
    if (pinned.length === 0) return;
  
    fetch('../local/api/hardware')
      .then(res => res.json())
      .then(data => {
        pinnedList.innerHTML = '';
        pinned.forEach(name => {
          const sensor = data.find(s => s.SensorName === name);
          if (sensor) renderPinnedSensor(sensor);
        });
      });
  }

  function getPinnedFromStorage() {
    return JSON.parse(localStorage.getItem('pinnedSensors') || '[]');
  }
  
  function savePinnedToStorage(pinnedArray) {
    localStorage.setItem('pinnedSensors', JSON.stringify(pinnedArray));
  }

  // Hook up search input listener
  searchBox.addEventListener('input', function (event) {
    const query = event.target.value.toLowerCase();
  
    fetch('../local/api/hardware')
      .then(res => res.json())
      .then(data => {
        const filtered = data.filter(sensor =>
          sensor.SensorName.toLowerCase().includes(query) ||
          sensor.SensorClass.toLowerCase().includes(query)
        );
        renderhmStats(filtered);
      });
  });

  // Hook up filter checkbox listeners
  [filterTemperatures, filterVoltages, filterFans].forEach(cb => {
    if (cb) cb.addEventListener('change', renderhmStats);
  });
  renderInitialPinnedValues();
  setInterval(refreshPinnedValues, 10000); // auto refresh every 10 seconds
});