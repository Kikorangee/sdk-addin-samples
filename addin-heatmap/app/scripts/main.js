/**
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.heatmap = () => {
  'use strict';

  let api;

  let map;
  let heatMapLayer;
  let metricMarkerLayer;
  let metricLegendControl;
  let metricMapData = [];
  let metricDetailsVisible = false;
  let heatMapPoints = [];

  let elExceptionTypes;
  let elVehicles;
  let ruleDropdown;
  let vehicleDropdown;
  let elDateFromInput;
  let elDateToInput;
  let elShowHeatMap;
  let elError;
  let elMessage;
  let elLoading;
  let elMapEventTotal;
  let selectedVehicleCount;
  let myGeotabGetResultsLimit = 50000;
  let startTime;
  let printPreviousMetricDetails = null;

  // Browser cache: one compact record per database/user, mode, vehicle, rule
  // and UTC day. Historical days are immutable; today's record expires after
  // five minutes. Points are aggregated into ~50 m / one-minute cells.
  const CACHE_DB_NAME = 'geotab-heatmap-cache';
  const CACHE_STORE_NAME = 'dailyHeatCells';
  const CACHE_DB_VERSION = 1;
  const CACHE_SCHEMA_VERSION = 1;
  const CACHE_TODAY_TTL_MS = 5 * 60 * 1000;
  const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const API_BATCH_SIZE = 25;
  const GRID_MULTIPLIER = 2000; // 0.0005 degrees, roughly 50 m latitude
  let cacheSessionNamespace = 'unknown-database|unknown-user';
  let cacheNamespace = 'unknown-database|unknown-user';
  let cacheDbPromise;

  /**
   * Display error message
   * @param {string} message - The error message.
   */
  let errorHandler = message => {
    elError.innerHTML = message;
  };  

  /**
   * Display error message
   * @param {string} message - The error message.
   */
  let messageHandler = message => {
    elMessage.innerHTML = message;
  }; 
  
  /**
   * Returns a boolean indicating whether all elements in the
   * supplied results array are empty.
   * @param {object} results - The results array to be evaluated.
   */
  function resultsEmpty(results) {
    if ((!results) || (results.length === 0)) {
      return true;
    }
    for (let i = 0; i < results.length; i++) {
      let result = results[i];
      if (result.length > 0) {
        return false;
      }
    }
    return true;    
  }

  /**
   * Formats a number using the comma separator.
   * @param {number} num The number to be formatted.
   */
  function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
  }  

  /**
   * Calculates the elapsed time (in seconds) between the value of the 
   * startTime variable and the current time.
   */
  function getElapsedTimeSeconds() {
    return Math.round((new Date() - startTime) / 1000);
  }

  function updateMapEventTotal() {
    if (!elMapEventTotal) return;
    const bounds = map && map.getBounds ? map.getBounds() : null;
    const exceptionMode = document.getElementById('visualizeByExceptionHistory') &&
      document.getElementById('visualizeByExceptionHistory').checked;
    let visibleCount = 0;
    let totalCount = 0;

    const countablePoints = exceptionMode ? metricMapData : heatMapPoints;
    countablePoints.forEach(point => {
      const weight = exceptionMode ? 1 : (Number(point.value) || 1);
      totalCount += weight;
      if (!bounds || bounds.contains(new L.LatLng(point.lat, point.lon))) {
        visibleCount += weight;
      }
    });

    elMapEventTotal.innerHTML = '<strong>' + formatNumber(visibleCount) + '</strong>' +
      '<span>' + (exceptionMode ? 'exceptions' : 'GPS points') + ' in view</span>' +
      '<small>' + formatNumber(totalCount) +
      (exceptionMode ? ' mapped exceptions loaded' : ' GPS points loaded') + '</small>';
  }

  function preparePrintReport() {
    if (!document.getElementById('printReportHeader')) {
      const header = document.createElement('section');
      header.id = 'printReportHeader';
      header.innerHTML = '<div><h1>Heatmap Fleet Analytics</h1><p id="printReportFilters"></p></div>' +
        '<strong id="printReportSummary"></strong>';
      document.getElementById('heatmap').insertBefore(header, document.getElementById('heatmap').firstChild);
    }
    const exceptionMode = document.getElementById('visualizeByExceptionHistory').checked;
    const selectedVehicles = Array.from(elVehicles.selectedOptions || []).map(option => option.text);
    const selectedRules = Array.from(elExceptionTypes.selectedOptions || []).map(option => option.text);
    const pointTotal = (exceptionMode ? metricMapData : heatMapPoints).reduce((sum, point) =>
      sum + (exceptionMode ? 1 : (Number(point.value) || 1)), 0);
    const fromText = elDateFromInput.value ? new Date(elDateFromInput.value).toLocaleString() : 'Not set';
    const toText = elDateToInput.value ? new Date(elDateToInput.value).toLocaleString() : 'Not set';
    const subject = exceptionMode
      ? (selectedRules.length ? selectedRules.join(', ') : 'Exception history')
      : 'Location history';
    document.getElementById('printReportFilters').textContent =
      subject + ' | ' + selectedVehicles.length + ' vehicle' +
      (selectedVehicles.length === 1 ? '' : 's') + ' | ' + fromText + ' to ' + toText +
      ' | Generated ' + new Date().toLocaleString();
    document.getElementById('printReportSummary').textContent =
      formatNumber(pointTotal) + (exceptionMode ? ' mapped exceptions' : ' GPS points');

    printPreviousMetricDetails = metricDetailsVisible;
    if (exceptionMode && metricMapData.length) metricDetailsVisible = true;
    map.invalidateSize({ animate: false, pan: false });
    if (heatMapLayer && heatMapLayer.redraw) heatMapLayer.redraw();
    renderMetricMarkers();
    updateMapEventTotal();
  }

  function restoreAfterPrint() {
    if (printPreviousMetricDetails !== null) {
      metricDetailsVisible = printPreviousMetricDetails;
      printPreviousMetricDetails = null;
    }
    map.invalidateSize({ animate: false, pan: false });
    if (heatMapLayer && heatMapLayer.redraw) heatMapLayer.redraw();
    renderMetricMarkers();
    updateMapEventTotal();
  }

  function setHeatMapPoints(points) {
    heatMapPoints = points || [];
    updateMapEventTotal();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + remainder + 's';
    return remainder + 's';
  }

  function validLogRecords(records) {
    return (records || []).filter(record =>
      Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude)) &&
      (Number(record.latitude) !== 0 || Number(record.longitude) !== 0)
    ).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
  }

  function roadLimitAt(roadSpeeds, dateTime) {
    const target = new Date(dateTime).getTime();
    let limit = null;
    for (let i = 0; i < roadSpeeds.length; i++) {
      if (new Date(roadSpeeds[i].date).getTime() > target) break;
      limit = Number(roadSpeeds[i].maxSpeed);
    }
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  }

  function bearingRadians(a, b) {
    const lat1 = Number(a.latitude) * Math.PI / 180;
    const lat2 = Number(b.latitude) * Math.PI / 180;
    const dLon = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
    return Math.atan2(Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
  }

  function normalizedAngle(value) {
    while (value > Math.PI) value -= 2 * Math.PI;
    while (value < -Math.PI) value += 2 * Math.PI;
    return value;
  }

  function colorForRuleIndex(ruleIndex) {
    // Golden-angle spacing guarantees adjacent selected rules use different hues.
    const hue = Math.round((Number(ruleIndex) * 137.508) % 360);
    return 'hsl(' + hue + ', 72%, 42%)';
  }

  function buildEventMetric(eventInfo, records, roadSpeeds) {
    const logs = validLogRecords(records);
    if (!logs.length) return null;
    const name = eventInfo.rule.name || 'Exception';
    const lowerName = name.toLowerCase();
    const event = eventInfo.event;
    const durationMs = Math.max(0, new Date(event.activeTo || event.activeFrom) - new Date(event.activeFrom));
    let chosen = logs[Math.floor(logs.length / 2)];
    let label = formatDuration(durationMs);
    let detail = 'Duration: ' + label;
    let kind = 'duration';

    if (lowerName.indexOf('speed') > -1) {
      let bestExcess = -Infinity;
      let maxSpeed = -Infinity;
      let bestLimit = null;
      logs.forEach(log => {
        const speed = Number(log.speed);
        if (!Number.isFinite(speed)) return;
        if (speed > maxSpeed) {
          maxSpeed = speed;
          chosen = log;
        }
        const limit = roadLimitAt(roadSpeeds || [], log.dateTime);
        if (limit != null && speed - limit > bestExcess) {
          bestExcess = speed - limit;
          bestLimit = limit;
          chosen = log;
        }
      });
      if (bestLimit != null && bestExcess > -Infinity) {
        label = (bestExcess >= 0 ? '+' : '') + Math.round(bestExcess) + ' km/h';
        detail = 'Peak exceedance: ' + label + ' (vehicle ' + Math.round(Number(chosen.speed)) +
          ' km/h; posted limit ' + Math.round(bestLimit) + ' km/h)';
      } else {
        label = Math.round(maxSpeed) + ' km/h';
        detail = 'Peak vehicle speed: ' + label + ' (posted limit unavailable)';
      }
      kind = 'speed';
    } else if (lowerName.indexOf('harsh') > -1 || lowerName.indexOf('hard acceleration') > -1) {
      let bestG = 0;
      let hasForceSample = false;
      for (let i = 1; i < logs.length; i++) {
        const elapsed = (new Date(logs[i].dateTime) - new Date(logs[i - 1].dateTime)) / 1000;
        if (!(elapsed > 0 && elapsed <= 60)) continue;
        let g;
        if (lowerName.indexOf('corner') > -1 && i < logs.length - 1) {
          const nextElapsed = (new Date(logs[i + 1].dateTime) - new Date(logs[i].dateTime)) / 1000;
          if (!(nextElapsed > 0 && nextElapsed <= 60)) continue;
          const turn = Math.abs(normalizedAngle(bearingRadians(logs[i], logs[i + 1]) -
            bearingRadians(logs[i - 1], logs[i])));
          g = (Number(logs[i].speed) / 3.6) * turn / ((elapsed + nextElapsed) / 2) / 9.80665;
        } else {
          const acceleration = ((Number(logs[i].speed) - Number(logs[i - 1].speed)) / 3.6) / elapsed / 9.80665;
          g = lowerName.indexOf('brak') > -1 ? -acceleration : acceleration;
        }
        if (Number.isFinite(g) && g > bestG) {
          bestG = g;
          hasForceSample = true;
          chosen = logs[i];
        }
      }
      if (hasForceSample) {
        label = bestG.toFixed(2) + ' g';
        detail = 'Peak calculated ' + (lowerName.indexOf('corner') > -1 ? 'lateral' : 'longitudinal') +
          ' force: ' + label;
        kind = 'force';
      } else {
        label = 'N/A';
        detail = 'G-force unavailable from the GPS samples';
        kind = 'unavailable';
      }
    }

    const distance = Number(event.distance);
    const secondary = 'Duration: ' + formatDuration(durationMs) +
      (Number.isFinite(distance) ? '; distance: ' + distance.toFixed(2) + ' km' : '');
    return {
      lat: Number(chosen.latitude), lon: Number(chosen.longitude), label: label, kind: kind,
      ruleName: name, color: eventInfo.color,
      popup: '<strong>' + escapeHtml(name) + '</strong><br>' + escapeHtml(eventInfo.vehicleName) +
        '<br>' + escapeHtml(detail) + '<br>' + escapeHtml(secondary) +
        '<br>' + escapeHtml(new Date(event.activeFrom).toLocaleString())
    };
  }

  function displayMetricLegend(metrics) {
    if (metricLegendControl) map.removeControl(metricLegendControl);
    const rules = [];
    const seen = {};
    (metrics || []).forEach(metric => {
      if (!seen[metric.ruleName]) {
        seen[metric.ruleName] = { name: metric.ruleName, color: metric.color, count: 0 };
        rules.push(seen[metric.ruleName]);
      }
      seen[metric.ruleName].count++;
    });
    if (!rules.length) return;
    metricLegendControl = L.control({ position: 'topright' });
    metricLegendControl.onAdd = () => {
      const element = L.DomUtil.create('div', 'metric-legend');
      element.innerHTML = '<strong>Exception legend</strong>' + rules.map(rule =>
        '<span><i style="background:' + rule.color + '"></i>' + escapeHtml(rule.name) +
        ' <b>' + formatNumber(rule.count) + '</b></span>'
      ).join('') +
        '<label class="metric-detail-toggle"><input type="checkbox"> Show event details</label>' +
        '<small>Each selected exception rule has a different colour. Heat map is shown without markers by default.</small>';
      L.DomEvent.disableClickPropagation(element);
      const toggle = element.querySelector('input');
      toggle.checked = metricDetailsVisible;
      L.DomEvent.on(toggle, 'change', () => {
        metricDetailsVisible = toggle.checked;
        renderMetricMarkers();
      });
      return element;
    };
    metricLegendControl.addTo(map);
  }

  function renderMetricMarkers() {
    if (metricMarkerLayer) map.removeLayer(metricMarkerLayer);
    metricMarkerLayer = L.layerGroup().addTo(map);
    if (!metricMapData.length || !metricDetailsVisible) return;
    const acceptedLabelPoints = [];
    const mapSize = map.getSize();
    metricMapData.forEach(metric => {
      if (!map.getBounds().contains(new L.LatLng(metric.lat, metric.lon))) return;
      const calloutText = metric.ruleName + ' \u2192 ' + metric.label;
      const dot = L.circleMarker([metric.lat, metric.lon], {
        radius: 4,
        color: '#ffffff',
        weight: 1,
        fillColor: metric.color,
        fillOpacity: 0.95
      });
      dot.bindTooltip(calloutText, { direction: 'top', offset: [0, -5] });
      dot.bindPopup(metric.popup);
      dot.addTo(metricMarkerLayer);

      const point = map.latLngToContainerPoint([metric.lat, metric.lon]);
      let labelPoint = point;
      for (let attempt = 0; attempt < 240; attempt++) {
        const radius = attempt === 0 ? 0 : 28 + Math.sqrt(attempt) * 18;
        const angle = attempt * Math.PI * (3 - Math.sqrt(5));
        const candidate = L.point(
          Math.max(70, Math.min(mapSize.x - 90, point.x + Math.cos(angle) * radius)),
          Math.max(32, Math.min(mapSize.y - 38, point.y + Math.sin(angle) * radius))
        );
        const blockedByLegend = candidate.x > mapSize.x - 220 && candidate.y < 150;
        const overlaps = acceptedLabelPoints.some(other =>
          Math.abs(other.x - candidate.x) < 88 && Math.abs(other.y - candidate.y) < 28
        );
        labelPoint = candidate;
        if (!overlaps && !blockedByLegend) break;
      }
      acceptedLabelPoints.push(labelPoint);
      const labelLatLng = map.containerPointToLatLng(labelPoint);
      if (labelPoint.distanceTo(point) > 8) {
        L.polyline([[metric.lat, metric.lon], labelLatLng], {
          color: metric.color, weight: 1, opacity: 0.75, interactive: false
        }).addTo(metricMarkerLayer);
      }
      const marker = L.marker(labelLatLng, {
        icon: L.divIcon({
          className: 'event-metric-marker event-metric-' + metric.kind,
          html: '<span style="--rule-color:' + metric.color + '">\u2192 ' + escapeHtml(metric.label) + '</span>',
          iconSize: [70, 30],
          iconAnchor: [8, 15]
        })
      });
      marker.bindTooltip(calloutText, { direction: 'top', offset: [0, -6] });
      marker.bindPopup(metric.popup);
      marker.addTo(metricMarkerLayer);
    });
  }

  function displayMetricMarkers(metrics) {
    metricMapData = metrics || [];
    metricDetailsVisible = false;
    displayMetricLegend(metrics);
    renderMetricMarkers();
    updateMapEventTotal();
  }

  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open heatmap cache'));
    });
    return cacheDbPromise;
  }

  function cacheGet(key) {
    return openCacheDb().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(CACHE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    })).catch(() => null);
  }

  function cachePut(record) {
    record.schemaVersion = CACHE_SCHEMA_VERSION;
    record.fetchedAt = Date.now();
    record.lastAccessed = Date.now();
    return openCacheDb().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    })).catch(() => undefined);
  }

  function pruneCache() {
    const cutoff = Date.now() - CACHE_RETENTION_MS;
    return openCacheDb().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        const value = cursor.value;
        if (!value || value.schemaVersion !== CACHE_SCHEMA_VERSION || value.lastAccessed < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    })).catch(() => undefined);
  }

  function utcDayChunks(fromMs, toMs) {
    const chunks = [];
    let cursor = new Date(fromMs);
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= toMs) {
      const dayStart = cursor.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
      chunks.push({
        day: new Date(dayStart).toISOString().slice(0, 10),
        start: dayStart,
        end: dayEnd
      });
      cursor = new Date(dayStart + 24 * 60 * 60 * 1000);
    }
    return chunks;
  }

  function cacheKey(mode, deviceId, ruleId, day) {
    return [cacheNamespace, mode, deviceId, ruleId || '-', day].join('|');
  }

  function cacheRecordIsFresh(record, chunk) {
    if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) return false;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (chunk.end < todayStart.getTime()) return true;
    return Date.now() - record.fetchedAt < CACHE_TODAY_TTL_MS;
  }

  function compactLogRecords(logRecords, dayStart, dayEnd) {
    const cells = new Map();
    (logRecords || []).forEach(record => {
      const latitude = Number(record.latitude);
      const longitude = Number(record.longitude);
      const time = new Date(record.dateTime).getTime();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          (latitude === 0 && longitude === 0) || !Number.isFinite(time) ||
          time < dayStart || time > dayEnd) {
        return;
      }
      const minute = Math.floor(time / 60000) * 60000;
      const lat = Math.round(latitude * GRID_MULTIPLIER) / GRID_MULTIPLIER;
      const lon = Math.round(longitude * GRID_MULTIPLIER) / GRID_MULTIPLIER;
      const key = minute + '|' + lat + '|' + lon;
      const existing = cells.get(key);
      if (existing) existing.value += 1;
      else cells.set(key, { t: minute, lat: lat, lon: lon, value: 1 });
    });
    return Array.from(cells.values());
  }

  function pointsInRange(points, fromMs, toMs) {
    return (points || []).filter(point => point.t >= fromMs && point.t <= toMs);
  }

  function apiMultiCallPromise(calls) {
    if (!calls.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      api.multiCall(calls, results => resolve(results || []), reject);
    });
  }

  function runApiCallsInBatches(calls) {
    const output = new Array(calls.length);
    let chain = Promise.resolve();
    for (let start = 0; start < calls.length; start += API_BATCH_SIZE) {
      const batchStart = start;
      const batch = calls.slice(start, start + API_BATCH_SIZE);
      chain = chain.then(() => apiMultiCallPromise(batch)).then(results => {
        for (let offset = 0; offset < batch.length; offset++) {
          output[batchStart + offset] = results[offset] || [];
        }
      });
    }
    return chain.then(() => output);
  }

  function buildDailyTasks(mode, deviceIds, ruleId, fromMs, toMs) {
    const days = utcDayChunks(fromMs, toMs);
    const tasks = [];
    deviceIds.forEach(deviceId => {
      days.forEach(chunk => {
        tasks.push({
          mode: mode,
          deviceId: deviceId,
          ruleId: ruleId || null,
          chunk: chunk,
          key: cacheKey(mode, deviceId, ruleId, chunk.day),
          record: null
        });
      });
    });
    return tasks;
  }

  function loadCachedTasks(tasks) {
    return Promise.all(tasks.map(task => cacheGet(task.key).then(record => {
      if (cacheRecordIsFresh(record, task.chunk)) task.record = record;
      return task;
    })));
  }

  function locationHeatData(deviceIds, fromMs, toMs) {
    const tasks = buildDailyTasks('location', deviceIds, null, fromMs, toMs);
    return loadCachedTasks(tasks).then(() => {
      const missing = tasks.filter(task => !task.record);
      const calls = missing.map(task => ['Get', {
        typeName: 'LogRecord',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: { id: task.deviceId },
          fromDate: new Date(task.chunk.start).toISOString(),
          toDate: new Date(task.chunk.end).toISOString()
        }
      }]);
      return runApiCallsInBatches(calls).then(results => Promise.all(missing.map((task, index) => {
        const rows = results[index] || [];
        task.record = {
          key: task.key,
          namespace: cacheNamespace,
          mode: 'location',
          deviceId: task.deviceId,
          ruleId: null,
          day: task.chunk.day,
          points: compactLogRecords(rows, task.chunk.start, task.chunk.end),
          rawCount: rows.length,
          truncated: rows.length >= myGeotabGetResultsLimit
        };
        return cachePut(task.record);
      })).then(() => {
        let points = [];
        let rawCount = 0;
        let truncatedChunks = 0;
        tasks.forEach(task => {
          const selected = pointsInRange(task.record.points, fromMs, toMs);
          points = points.concat(selected);
          rawCount += selected.reduce((sum, point) => sum + point.value, 0);
          if (task.record.truncated) truncatedChunks++;
        });
        return {
          points: points,
          rawCount: rawCount,
          cacheHits: tasks.length - missing.length,
          fetchedChunks: missing.length,
          truncatedChunks: truncatedChunks
        };
      }));
    });
  }

  function mergedExceptionWindows(events, dayStart, dayEnd) {
    const windows = (events || []).map(event => {
      const from = Math.max(dayStart, new Date(event.activeFrom).getTime());
      const to = Math.min(dayEnd, new Date(event.activeTo || event.activeFrom).getTime());
      return { from: from, to: Math.max(from, to) };
    }).filter(window => Number.isFinite(window.from) && Number.isFinite(window.to))
      .sort((a, b) => a.from - b.from);

    const merged = [];
    windows.forEach(window => {
      const previous = merged[merged.length - 1];
      // Merge overlaps and windows within one minute of each other.
      if (previous && window.from <= previous.to + 60000) {
        previous.to = Math.max(previous.to, window.to);
      } else {
        merged.push({ from: window.from, to: window.to });
      }
    });
    return merged;
  }

  function exceptionHeatData(deviceIds, ruleId, fromMs, toMs) {
    const tasks = buildDailyTasks('exception', deviceIds, ruleId, fromMs, toMs);
    return loadCachedTasks(tasks).then(() => {
      const missing = tasks.filter(task => !task.record);
      const exceptionCalls = missing.map(task => ['Get', {
        typeName: 'ExceptionEvent',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: { id: task.deviceId },
          ruleSearch: { id: ruleId },
          fromDate: new Date(task.chunk.start).toISOString(),
          toDate: new Date(task.chunk.end).toISOString()
        }
      }]);

      return runApiCallsInBatches(exceptionCalls).then(exceptionResults => {
        const logCalls = [];
        const logOwners = [];
        missing.forEach((task, taskIndex) => {
          const events = exceptionResults[taskIndex] || [];
          task.events = events;
          const windows = mergedExceptionWindows(events, task.chunk.start, task.chunk.end);
          windows.forEach(window => {
            logOwners.push(taskIndex);
            logCalls.push(['Get', {
              typeName: 'LogRecord',
              resultsLimit: myGeotabGetResultsLimit,
              search: {
                deviceSearch: { id: task.deviceId },
                fromDate: new Date(window.from).toISOString(),
                toDate: new Date(window.to).toISOString()
              }
            }]);
          });
        });

        return runApiCallsInBatches(logCalls).then(logResults => {
          const logsByTask = missing.map(() => []);
          const truncatedLogsByTask = missing.map(() => 0);
          logResults.forEach((rows, index) => {
            const owner = logOwners[index];
            logsByTask[owner] = logsByTask[owner].concat(rows || []);
            if ((rows || []).length >= myGeotabGetResultsLimit) truncatedLogsByTask[owner]++;
          });

          return Promise.all(missing.map((task, index) => {
            const events = task.events || [];
            task.record = {
              key: task.key,
              namespace: cacheNamespace,
              mode: 'exception',
              deviceId: task.deviceId,
              ruleId: ruleId,
              day: task.chunk.day,
              points: compactLogRecords(logsByTask[index], task.chunk.start, task.chunk.end),
              events: events.map(event => ({
                id: event.id,
                from: new Date(event.activeFrom).getTime(),
                to: new Date(event.activeTo || event.activeFrom).getTime()
              })),
              truncated: events.length >= myGeotabGetResultsLimit || truncatedLogsByTask[index] > 0
            };
            return cachePut(task.record);
          }));
        });
      }).then(() => {
        let points = [];
        let eventCount = 0;
        let rawCount = 0;
        let truncatedChunks = 0;
        tasks.forEach(task => {
          const selected = pointsInRange(task.record.points, fromMs, toMs);
          points = points.concat(selected);
          rawCount += selected.reduce((sum, point) => sum + point.value, 0);
          eventCount += (task.record.events || []).filter(event =>
            event.from <= toMs && event.to >= fromMs).length;
          if (task.record.truncated) truncatedChunks++;
        });
        return {
          points: points,
          rawCount: rawCount,
          eventCount: eventCount,
          cacheHits: tasks.length - missing.length,
          fetchedChunks: missing.length,
          truncatedChunks: truncatedChunks
        };
      });
    });
  }

  /**
   * Toggle loading spinner
   * @param {boolean} show - [true] to display the spinner, otherwise [false].
   */
  let toggleLoading = show => {
    if (show) {
      elShowHeatMap.disabled = true;
      elLoading.style.display = 'block';
    } else {
      setTimeout(() => {
        elLoading.style.display = 'none';
      }, 600);
      elShowHeatMap.disabled = false;
    }
  };

  /**
   * Remove the HeatMap layer and add a new empty one.
   */
  let resetHeatMapLayer = () => {
    if (heatMapLayer !== undefined) {
      map.removeLayer(heatMapLayer);
    }
    
    heatMapLayer = L.heatLayer({
      radius: {
        value: 24,
        absolute: false
      },
      opacity: 0.7,
      gradient: {
        0.45: 'rgb(0,0,255)',
        0.55: 'rgb(0,255,255)',
        0.65: 'rgb(0,255,0)',
        0.95: 'yellow',
        1.0: 'rgb(255,0,0)'
      }
    }).addTo(map);
    setHeatMapPoints([]);
  }

  /**
   * Call the appropriate heat map generation function based on the
   * selected visualization option.
   */
  let displayHeatMap = () => {
    resetHeatMapLayer();

    // Ensure at least one vehicle is selected.
    selectedVehicleCount = 0;
    for (var i = 0; i < elVehicles.options.length; i++) {
        if (elVehicles.options[i].selected) {
          selectedVehicleCount++;
        }
    }
    if (selectedVehicleCount === 0) {
      errorHandler('Please select at least one vehicle from the list and try again.');
      return;
    }

    startTime = new Date();

    if (elExceptionTypes.disabled === true) {
      displayHeatMapForLocationHistory();
    }
    else {
      displayHeatMapForExceptionHistory();
    }
  }

  /**
   * Displays the heatmap of vehicle(s) location history
   */
  let displayHeatMapForLocationHistory = () => {
    let deviceId = elVehicles.value;

    // Get selected device IDs.
    let deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i=0, iLen=options.length; i<iLen; i++) {
      opt = options[i];
  
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if ((deviceIds === null) || (fromValue === '') || (toValue === '')) {
      return;
    }
    
    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Build array of calls.
		let calls = [];
		for (let i = 0, len = deviceIds.length; i < len; i++) {
      calls.push([
        'Get', {
          typeName: 'LogRecord',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: deviceIds[i]
            },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }    
      ]);
		}

    // Execute multicall.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        return;
      }      
 
      let coordinates = [];
      let bounds = [];
      let logRecordCount = 0; 
      let exceededResultsLimitCount = 0;
      let logRecords = [];    
      // Build coordinates and bounds.
      for (let i = 0, len = results.length; i < len; i++) {
        logRecords = results[i];
        for (let j = 0; j < logRecords.length; j++) {
          if (logRecords[j].latitude !== 0 || logRecords[j].longitude !== 0) {
            coordinates.push({
              lat: logRecords[j].latitude,
              lon: logRecords[j].longitude,
              value: 1
            });
            bounds.push(new L.LatLng(logRecords[j].latitude, logRecords[j].longitude));
            logRecordCount++;
          }
        }
        if (logRecords.length >= myGeotabGetResultsLimit){
          exceededResultsLimitCount++;
        }                
      }

      // Update map.
      if (coordinates.length > 0) {
        setHeatMapPoints(coordinates);
        map.fitBounds(bounds);
        heatMapLayer.setLatLngs(coordinates);
        updateMapEventTotal();
        messageHandler(`Displaying ${formatNumber(logRecordCount)} combined log records for the
        ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`);
        if (exceededResultsLimitCount > 0) {
          errorHandler(`Note: Not all results are displayed because the result limit of 
          ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
          ${formatNumber(exceededResultsLimitCount)} of the selected vehicles.`);  
        }
      } else {
        errorHandler('No data to display');
      }      
      toggleLoading(false);
    }, function (errorString) {
      // eslint-disable-next-line no-alert
      alert(errorString);
      toggleLoading(false);
    });
  };

  let displayHeatMapForExceptionHistory = () => {
    let selectedRules = [];
    for (let i = 0; i < elExceptionTypes.options.length; i++) {
      let ruleOption = elExceptionTypes.options[i];
      if (ruleOption.selected && !ruleOption.disabled && ruleOption.value) {
        selectedRules.push({ id: ruleOption.value, name: ruleOption.text });
      }
    }

    // Get selected device IDs.
    let deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i=0, iLen=options.length; i<iLen; i++) {
      opt = options[i];
  
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if (deviceIds.length === 0 || selectedRules.length === 0 || fromValue === '' || toValue === '') {
      errorHandler('Select at least one vehicle and one exception rule.');
      return;
    }

    if (deviceIds.length * selectedRules.length > 100) {
      errorHandler('Select fewer vehicles or rules. A maximum of 100 vehicle/rule combinations is supported.');
      return;
    }
    
    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();
    
    // Build one ExceptionEvent request for every selected vehicle/rule pair.
    let calls = [];
		for (let i = 0; i < deviceIds.length; i++) {
      for (let j = 0; j < selectedRules.length; j++) {
        calls.push([
          'Get', {
            typeName: 'ExceptionEvent',
            resultsLimit: myGeotabGetResultsLimit,
            search: {
              deviceSearch: {
                id: deviceIds[i]
              },
              ruleSearch: {
                id: selectedRules[j].id
              },
              fromDate: dateFrom,
              toDate: dateTo
            }
          }
        ]);
		}
		}

    // Execute multicall to get ExceptionEvents for the seletced rule during
    // the specified date/time range for each selected device.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        return;
      }
      
      // Build array of calls to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      let exceptionEventCount = 0;
      let exceededResultsLimitCountForExceptionEvents = 0;  
      let calls = [];
      let eventInfos = [];
      for (let i = 0, len = results.length; i < len; i++) {
        let exceptionEvents = results[i];
        let ruleIndex = i % selectedRules.length;
        let deviceIndex = Math.floor(i / selectedRules.length);
        let vehicleName = deviceIds[deviceIndex];
        for (let optionIndex = 0; optionIndex < elVehicles.options.length; optionIndex++) {
          if (elVehicles.options[optionIndex].value === deviceIds[deviceIndex]) {
            vehicleName = elVehicles.options[optionIndex].text;
            break;
          }
        }
        for (let j = 0; j < exceptionEvents.length; j++) {
          exceptionEventCount++;
          eventInfos.push({
            event: exceptionEvents[j],
            rule: selectedRules[ruleIndex],
            color: colorForRuleIndex(ruleIndex),
            vehicleName: vehicleName
          });
          calls.push([
            'Get', {
              typeName: 'LogRecord',
              resultsLimit: myGeotabGetResultsLimit,
              search: {
                deviceSearch: {
                  id: exceptionEvents[j].device.id
                },
                fromDate: exceptionEvents[j].activeFrom,
                toDate: exceptionEvents[j].activeTo
              }
            }    
          ]);        
        } 
        if (exceptionEvents.length >= myGeotabGetResultsLimit){
          exceededResultsLimitCountForExceptionEvents++;
        }                
      }

      let roadDevices = [];
      deviceIds.forEach(deviceId => {
        roadDevices.push(deviceId);
        calls.push(['GetPostedRoadSpeedsForDevice', {
          deviceSearch: { id: deviceId },
          fromDate: dateFrom,
          toDate: dateTo,
          postedRoadSpeedOptions: 'None'
        }]);
      });

      // Execute multicall to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      api.multiCall(calls, function (results) {
        let logResults = results.slice(0, eventInfos.length);
        let roadResults = results.slice(eventInfos.length);
        if (resultsEmpty(logResults)) {
          errorHandler('No data to display');
          toggleLoading(false);
          return;
        } 

        let coordinates = [];
        let bounds = [];
        let logRecordCount = 0;
        let exceededResultsLimitCountForLogRecords = 0;
        let roadByDevice = {};
        roadDevices.forEach((deviceId, index) => {
          roadByDevice[deviceId] = (roadResults[index] || []).slice().sort((a, b) =>
            new Date(a.date) - new Date(b.date));
        });
        let metrics = [];
        // Build coordinates and bounds.
        for (let i = 0, len = logResults.length; i < len; i++) {
          let logRecords = logResults[i];
          for (let j = 0; j < logRecords.length; j++) {
            if (logRecords[j].latitude !== 0 || logRecords[j].longitude !== 0) {
              coordinates.push({
                lat: logRecords[j].latitude,
                lon: logRecords[j].longitude,
                value: 1
              });
              bounds.push(new L.LatLng(logRecords[j].latitude, logRecords[j].longitude));
              logRecordCount++;
            }
          }
          if (logRecords.length >= myGeotabGetResultsLimit){
            exceededResultsLimitCountForLogRecords++;
          }
          let eventInfo = eventInfos[i];
          let metric = buildEventMetric(eventInfo, logRecords,
            roadByDevice[eventInfo.event.device.id] || []);
          if (metric) metrics.push(metric);
        }

        // Update map.
        if (coordinates.length > 0) {
          setHeatMapPoints(coordinates);
          map.fitBounds(bounds);
          heatMapLayer.setLatLngs(coordinates);
          displayMetricMarkers(metrics);
          updateMapEventTotal();

          messageHandler(`Displaying ${formatNumber(logRecordCount)} combined log records associated with the
          ${formatNumber(exceptionEventCount)} exceptions across ${formatNumber(selectedRules.length)} selected rules for the
          ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`);
          
          // Build the error message if result limit(s) exceeded.
          if (exceededResultsLimitCountForExceptionEvents > 0 || exceededResultsLimitCountForLogRecords > 0) {
            let errorMessage = 'Note: Not all results are displayed because'; 
            
            if (exceededResultsLimitCountForExceptionEvents) {
              errorMessage += ` the result limit of 
              ${formatNumber(myGeotabGetResultsLimit)} was exceeded for one or more selected rules`;
            }

            if (exceededResultsLimitCountForExceptionEvents > 0 && exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += ' and';
            }

            if (exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += ` the result limit of 
              ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
              ${formatNumber(exceededResultsLimitCountForLogRecords)} exception window(s).`;
            }

            errorMessage += '.';
            errorHandler(errorMessage);
          }
          toggleLoading(false);
        } else {
          errorHandler('No data to display');
        }      
      }, function (errorString) {
        // eslint-disable-next-line no-alert
        alert(errorString);
        toggleLoading(false);
      });
    }, function (errorString) {
      // eslint-disable-next-line no-alert
      alert(errorString);
      toggleLoading(false);
    });
  };

  function selectedDeviceIds() {
    const ids = [];
    for (let i = 0; i < elVehicles.options.length; i++) {
      const option = elVehicles.options[i];
      if (option.selected) ids.push(option.value || option.text);
    }
    return ids;
  }

  function displayCachedPoints(data, successMessage) {
    if (!data.points || data.points.length === 0) {
      errorHandler('No data to display');
      toggleLoading(false);
      return;
    }
    const bounds = data.points.map(point => new L.LatLng(point.lat, point.lon));
    map.fitBounds(bounds);
    setHeatMapPoints(data.points);
    heatMapLayer.setLatLngs(data.points);
    updateMapEventTotal();
    messageHandler(successMessage + ` Cache: ${formatNumber(data.cacheHits)} hit(s), ` +
      `${formatNumber(data.fetchedChunks)} fetched daily chunk(s). [${getElapsedTimeSeconds()} sec]`);
    if (data.truncatedChunks > 0) {
      errorHandler(`Note: ${formatNumber(data.truncatedChunks)} daily cache chunk(s) reached the ` +
        `${formatNumber(myGeotabGetResultsLimit)}-record API limit and may be incomplete.`);
    }
    toggleLoading(false);
  }

  let displayCachedHeatMapForLocationHistory = () => {
    const deviceIds = selectedDeviceIds();
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (!deviceIds.length || !fromValue || !toValue) return;

    const fromMs = new Date(fromValue).getTime();
    const toMs = new Date(toValue).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      errorHandler('Please select a valid date range.');
      return;
    }

    toggleLoading(true);
    locationHeatData(deviceIds, fromMs, toMs).then(data => {
      displayCachedPoints(data,
        `Displaying ${formatNumber(data.rawCount)} combined log records for ` +
        `${formatNumber(deviceIds.length)} selected vehicles.`);
    }).catch(error => {
      errorHandler(error && error.message ? error.message : String(error));
      toggleLoading(false);
    });
  };

  let displayCachedHeatMapForExceptionHistory = () => {
    const deviceIds = selectedDeviceIds();
    const selectedRule = elExceptionTypes.options[elExceptionTypes.selectedIndex];
    const ruleId = selectedRule ? selectedRule.value : null;
    const ruleName = selectedRule ? selectedRule.text : '';
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (!deviceIds.length || !ruleId || !fromValue || !toValue) return;

    const fromMs = new Date(fromValue).getTime();
    const toMs = new Date(toValue).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      errorHandler('Please select a valid date range.');
      return;
    }

    toggleLoading(true);
    exceptionHeatData(deviceIds, ruleId, fromMs, toMs).then(data => {
      displayCachedPoints(data,
        `Displaying ${formatNumber(data.rawCount)} combined log records associated with ` +
        `${formatNumber(data.eventCount)} '${ruleName}' exceptions for ` +
        `${formatNumber(deviceIds.length)} selected vehicles.`);
    }).catch(error => {
      errorHandler(error && error.message ? error.message : String(error));
      toggleLoading(false);
    });
  };

  /**
   * Intialize the user interface
   * @param {object} coords - An object with the latitude and longitude to render on the map.
   */
  function enhanceMultiSelect(select, placeholder) {
    const wrapper = document.createElement('div');
    const toggle = document.createElement('button');
    const panel = document.createElement('div');
    const actions = document.createElement('div');
    const optionList = document.createElement('div');

    wrapper.className = 'multi-select-dropdown';
    toggle.type = 'button';
    toggle.className = 'multi-select-toggle';
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    panel.className = 'multi-select-panel';
    actions.className = 'multi-select-actions';
    optionList.className = 'multi-select-option-list';
    optionList.setAttribute('role', 'listbox');
    optionList.setAttribute('aria-multiselectable', 'true');

    const makeAction = (text, selected) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => {
        Array.from(select.options).forEach(option => {
          if (!option.disabled) option.selected = selected;
        });
        select.dispatchEvent(new Event('change', { bubbles: true }));
        rebuild();
      });
      return button;
    };

    actions.appendChild(makeAction('Select all', true));
    actions.appendChild(makeAction('Clear', false));
    panel.appendChild(actions);
    panel.appendChild(optionList);
    wrapper.appendChild(toggle);
    wrapper.appendChild(panel);
    select.insertAdjacentElement('afterend', wrapper);

    function close() {
      wrapper.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    function rebuild() {
      optionList.innerHTML = '';
      const options = Array.from(select.options).filter(option => !option.disabled);
      const selected = options.filter(option => option.selected);
      toggle.disabled = select.disabled;
      toggle.textContent = selected.length === 0 ? placeholder :
        (selected.length === 1 ? selected[0].text : `${selected.length} selected`);
      if (select.disabled) close();

      if (!options.length) {
        const empty = document.createElement('div');
        empty.className = 'multi-select-empty';
        empty.textContent = 'No options available';
        optionList.appendChild(empty);
        return;
      }

      options.forEach(option => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        const text = document.createElement('span');
        label.className = 'multi-select-option';
        checkbox.type = 'checkbox';
        checkbox.checked = option.selected;
        text.textContent = option.text;
        checkbox.addEventListener('change', () => {
          option.selected = checkbox.checked;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          rebuild();
        });
        label.appendChild(checkbox);
        label.appendChild(text);
        optionList.appendChild(label);
      });
    }

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const opening = !wrapper.classList.contains('is-open');
      document.querySelectorAll('.multi-select-dropdown.is-open').forEach(dropdown => {
        dropdown.classList.remove('is-open');
        dropdown.querySelector('.multi-select-toggle').setAttribute('aria-expanded', 'false');
      });
      if (opening && !select.disabled) {
        wrapper.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
    panel.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', rebuild);
    document.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
    });
    new MutationObserver(rebuild).observe(select, {
      childList: true, subtree: true, attributes: true
    });
    rebuild();
    return { rebuild };
  }

  let initializeInterface = coords => {
    // setup the map
    map = new L.Map('heatmap-map', {
        center: new L.LatLng(coords.latitude, coords.longitude),
        zoom: 13
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a','b','c']
    }).addTo(map);

    // find reused elements
    elExceptionTypes = document.getElementById('exceptionTypes');
    elVehicles = document.getElementById('vehicles');
    ruleDropdown = enhanceMultiSelect(elExceptionTypes, 'Select rules');
    vehicleDropdown = enhanceMultiSelect(elVehicles, 'Select vehicles');
    elDateFromInput = document.getElementById('from');
    elDateToInput = document.getElementById('to');
    elShowHeatMap = document.getElementById('showHeatMap');
    elError = document.getElementById('error');
    elMessage = document.getElementById('message');
    elLoading = document.getElementById('loading');
    elMapEventTotal = document.getElementById('map-event-total');
    window.addEventListener('beforeprint', preparePrintReport);
    window.addEventListener('afterprint', restoreAfterPrint);

    map.on('moveend zoomend', () => {
      updateMapEventTotal();
      renderMetricMarkers();
    });
    updateMapEventTotal();

    const formatLocalDateTime = date => {
      const pad = value => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    };

    const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0);
    const endOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59);

    const setDatePreset = range => {
      const now = new Date();
      let from;
      let to;

      if (range === 'yesterday') {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        from = startOfDay(yesterday);
        to = endOfDay(yesterday);
      } else if (range === 'thisWeek') {
        const daysSinceMonday = (now.getDay() + 6) % 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0);
        to = now;
      } else if (range === 'lastWeek') {
        const daysSinceMonday = (now.getDay() + 6) % 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday - 7, 0, 0);
        to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59);
      } else if (range === 'thisMonth') {
        from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0);
        to = now;
      } else if (range === 'lastMonth') {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0);
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59);
      } else {
        from = startOfDay(now);
        to = now;
        range = 'today';
      }

      elDateFromInput.value = formatLocalDateTime(from);
      elDateToInput.value = formatLocalDateTime(to);
      document.querySelectorAll('.date-preset').forEach(button => {
        button.classList.toggle('is-active', button.dataset.range === range);
      });
    };

    document.querySelectorAll('.date-preset').forEach(button => {
      button.addEventListener('click', () => setDatePreset(button.dataset.range));
    });
    setDatePreset('today');

    document.getElementById('visualizeByLocationHistory').addEventListener('click', event => {
      elExceptionTypes.disabled = true;
      ruleDropdown.rebuild();
      updateMapEventTotal();
    });

    document.getElementById('visualizeByExceptionHistory').addEventListener('click', event => {
      elExceptionTypes.disabled = false;
      ruleDropdown.rebuild();
      updateMapEventTotal();
    });

    document.getElementById('exceptionTypes').addEventListener('change', event => {
      event.preventDefault();
    });

    document.getElementById('vehicles').addEventListener('change', event => {
      event.preventDefault();
    });

    document.getElementById('from').addEventListener('change', event => {
      event.preventDefault();
    });

    document.getElementById('to').addEventListener('change', event => {
      event.preventDefault();
    });

    document.getElementById('showHeatMap').addEventListener('click', event => {
      event.preventDefault();
      displayHeatMap();
    });    
  };

  /**
   * Sort named entities
   * @param {object} a - The left comparison named entity
   * @param {object} b - The right comparison named entity
   */
  let sortByName = (a, b) => {
    a = a.name.toLowerCase();
    b = b.name.toLowerCase();

    if (a === b) {
      return 0;
    }

    if (a > b) {
      return 1;
    }

    return -1;
  };

  return {
    initialize(freshApi, state, callback) {
      api = freshApi;

      // Startup must never wait on geolocation or an API response. The map
      // fits to returned fleet data when a heat map is generated, so a fixed
      // initial centre is sufficient and avoids iframe permission deadlocks.
      const fallback = { longitude: 174.7633, latitude: -36.8485 };
      try {
        initializeInterface(fallback);
        pruneCache();
      } catch (error) {
        console.error('Heat Map initialization failed:', error);
      } finally {
        callback();
      }

    },
    focus(freshApi, freshState) {
      api = freshApi;

      const groupFilter = freshState.getGroupFilter() || [];
      const groupSignature = groupFilter.map(group => group.id || String(group)).sort().join(',') || 'all';
      cacheNamespace = cacheSessionNamespace + '|groups:' + groupSignature;

      // Focus can run again after the MyGeotab group filter changes. Rebuild the
      // options rather than retaining vehicles/rules from the previous scope.
      while (elVehicles.options.length) elVehicles.remove(0);
      while (elExceptionTypes.options.length > 1) elExceptionTypes.remove(1);
      
      // Populate vehicles list.
      api.call('Get', {
        typeName: 'Device',
        resultsLimit: 50000,
        search: {
          fromDate: new Date().toISOString(),
          groups: groupFilter
        }
      }, vehicles => {
        if (!vehicles || vehicles.length < 0) {
          return;
        }

        vehicles.sort(sortByName);

        vehicles.forEach(vehicle => {
          let option = new Option();
          option.text = vehicle.name;
          option.value = vehicle.id;
          elVehicles.add(option);
        });
      }, errorHandler);

      // Populate exceptions list.
      api.call('Get', {
        typeName: 'Rule',
        resultsLimit: 50000
      }, rules => {
        if (!rules || rules.length < 0) {
          return;
        }

        rules.sort(sortByName);

        rules.forEach(rule => {
          let option = new Option();
          option.text = rule.name;
          option.value = rule.id;
          elExceptionTypes.add(option);
        });
      }, errorHandler);

      setTimeout(() => {
        map.invalidateSize();
      }, 200);      
    },
    blur() {
      // No active timers or subscriptions need cleanup.
    }
  };

};
