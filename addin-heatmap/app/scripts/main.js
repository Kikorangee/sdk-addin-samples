/**
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.heatmap = () => {
  'use strict';

  let api;

  let map;
  let heatMapLayer;

  let elExceptionTypes;
  let elVehicles;
  let elDateFromInput;
  let elDateToInput;
  let elShowHeatMap;
  let elError;
  let elMessage;
  let elLoading;
  let selectedVehicleCount;
  let myGeotabGetResultsLimit = 50000;
  let startTime;

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
        map.fitBounds(bounds);
        heatMapLayer.setLatLngs(coordinates);
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
    let deviceId = elVehicles.value;
    let ruleId = elExceptionTypes.options[elExceptionTypes.selectedIndex].value;
    let ruleName = elExceptionTypes.options[elExceptionTypes.selectedIndex].text;

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

    if ((deviceIds === null) || (ruleId === null) || (fromValue === '') || (toValue === '')) {
      return;
    }
    
    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();
    
    // Build array of calls to get ExceptionEvents for the seletced rule during
    // the specified date/time range for each selected device.
    let calls = [];
		for (let i = 0, len = deviceIds.length; i < len; i++) {
      calls.push([
        'Get', {
          typeName: 'ExceptionEvent',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: deviceIds[i]
            },
            ruleSearch: {
              id: ruleId
            },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }    
      ]);
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
      for (let i = 0, len = results.length; i < len; i++) {
        let exceptionEvents = results[i];
        for (let j = 0; j < exceptionEvents.length; j++) {
          exceptionEventCount++;
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

      // Execute multicall to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      api.multiCall(calls, function (results) {
        if (resultsEmpty(results)) {
          errorHandler('No data to display');
          toggleLoading(false);
          return;
        } 

        let coordinates = [];
        let bounds = [];
        let logRecordCount = 0;
        let exceededResultsLimitCountForLogRecords = 0;      
        // Build coordinates and bounds.
        for (let i = 0, len = results.length; i < len; i++) {
          let logRecords = results[i];
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
        }

        // Update map.
        if (coordinates.length > 0) {
          map.fitBounds(bounds);
          heatMapLayer.setLatLngs(coordinates);

          messageHandler(`Displaying ${formatNumber(logRecordCount)} combined log records associated with the
          ${formatNumber(exceptionEventCount)} '${ruleName}' rule exceptions found for the 
          ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`);
          
          // Build the error message if result limit(s) exceeded.
          if (exceededResultsLimitCountForExceptionEvents > 0 || exceededResultsLimitCountForLogRecords > 0) {
            let errorMessage = 'Note: Not all results are displayed because'; 
            
            if (exceededResultsLimitCountForExceptionEvents) {
              errorMessage += ` the result limit of 
              ${formatNumber(myGeotabGetResultsLimit)} was exceeded for '${ruleName}' rule exceptions`;
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
    heatMapLayer.setLatLngs(data.points);
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
    elDateFromInput = document.getElementById('from');
    elDateToInput = document.getElementById('to');
    elShowHeatMap = document.getElementById('showHeatMap');
    elError = document.getElementById('error');
    elMessage = document.getElementById('message');
    elLoading = document.getElementById('loading');

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
    });

    document.getElementById('visualizeByExceptionHistory').addEventListener('click', event => {
      elExceptionTypes.disabled = false;
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

      // Session details only namespace the optional browser cache. Resolve
      // them after MyGeotab has been released from the loading state.
      try {
        api.getSession(session => {
          cacheSessionNamespace = [session.database || 'unknown-database',
            session.userName || 'unknown-user'].join('|');
          cacheNamespace = cacheSessionNamespace;
        }, () => undefined);
      } catch (error) {
        console.warn('Session details unavailable; using fallback cache namespace.', error);
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
