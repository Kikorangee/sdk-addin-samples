/**
 * Enhanced Geotab Heatmap Add-In
 * Features: Interactive controls, EV battery events, charging events, low battery markers,
 * Fault (DTC) overlays with severity, full summary panel, export options, responsive UI,
 * live SDK queries, and extensible code comments.
 * 
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.heatmap = () => {
  'use strict';

  let api;

  let map;
  let heatMapLayer;

  // UI elements
  let elExceptionTypes;
  let elVehicles;
  let elDateFromInput;
  let elDateToInput;
  let elShowHeatMap;
  let elError;
  let elMessage;
  let elLoading;
  let elSummary;
  let elExportBtn;
  let elEventType;
  let elLowBatteryToggle;
  let elShowFaultOverlay;
  let elDataRaw;
  let elDataStats;

  let selectedVehicleCount;
  let myGeotabGetResultsLimit = 50000;
  let startTime;

  // Data containers
  let batteryEvents = [];
  let chargingEvents = [];
  let faults = [];
  let summaryStats = {};

  /**
   * Display error message
   */
  let errorHandler = message => { elError.innerHTML = message; };

  /**
   * Display info message
   */
  let messageHandler = message => { elMessage.innerHTML = message; };

  /**
   * Utility: Check if results array is empty
   */
  function resultsEmpty(results) {
    if ((!results) || (results.length === 0)) return true;
    for (let i = 0; i < results.length; i++) {
      if (results[i].length > 0) return false;
    }
    return true;
  }

  /**
   * Format number with commas
   */
  function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
  }  

  /**
   * Get elapsed seconds since startTime
   */
  function getElapsedTimeSeconds() {
    return Math.round((new Date() - startTime) / 1000);
  }

  /**
   * Toggle loading spinner
   */
  let toggleLoading = show => {
    if (show) {
      elShowHeatMap.disabled = true;
      elLoading.style.display = 'block';
    } else {
      setTimeout(() => { elLoading.style.display = 'none'; }, 600);
      elShowHeatMap.disabled = false;
    }
  };

  /**
   * Remove heatmap layer and re-add it
   */
  let resetHeatMapLayer = () => {
    if (heatMapLayer !== undefined) map.removeLayer(heatMapLayer);

    heatMapLayer = L.heatLayer({
      radius: { value: 24, absolute: false },
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
   * Visualize heatmap based on selected data type
   */
  let displayHeatMap = () => {
    resetHeatMapLayer();

    // Ensure at least one vehicle is selected.
    selectedVehicleCount = Array.from(elVehicles.options).filter(opt => opt.selected).length;
    if (selectedVehicleCount === 0) {
      errorHandler('Please select at least one vehicle from the list and try again.');
      return;
    }

    startTime = new Date();

    // Determine selected visualization type
    let dataType = elEventType.value;
    switch (dataType) {
      case "location":
        displayHeatMapForLocationHistory();
        break;
      case "battery":
        displayEVBatteryEvents();
        break;
      case "charging":
        displayChargingEvents();
        break;
      case "faults":
        displayFaultEvents();
        break;
      default:
        displayHeatMapForLocationHistory();
    }
  }

  /**
   * Location history heatmap (original logic)
   */
  let displayHeatMapForLocationHistory = () => {
    let deviceIds = getSelectedDeviceIds();
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Build array of calls.
    let calls = deviceIds.map(id => [
      'Get', {
        typeName: 'LogRecord',
        resultsLimit: myGeotabGetResultsLimit,
        search: { deviceSearch: { id }, fromDate: dateFrom, toDate: dateTo }
      }
    ]);

    // Execute multicall.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        showDataOutput([]);
        return;
      }

      let coordinates = [];
      let bounds = [];
      let logRecordCount = 0;
      let exceededResultsLimitCount = 0;

      for (let records of results) {
        for (let rec of records) {
          if (rec.latitude !== 0 || rec.longitude !== 0) {
            coordinates.push({ lat: rec.latitude, lon: rec.longitude, value: 1 });
            bounds.push(new L.LatLng(rec.latitude, rec.longitude));
            logRecordCount++;
          }
        }
        if (records.length >= myGeotabGetResultsLimit) exceededResultsLimitCount++;
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
        showDataOutput(coordinates);
        updateSummaryPanel({ totalPoints: logRecordCount });
      } else {
        errorHandler('No data to display');
        showDataOutput([]);
        updateSummaryPanel({ totalPoints: 0 });
      }
      toggleLoading(false);
    }, function (errorString) {
      alert(errorString);
      toggleLoading(false);
    });
  };

  /**
   * EV Battery Events (custom)
   */
  let displayEVBatteryEvents = () => {
    let deviceIds = getSelectedDeviceIds();
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Get all battery status events for selected devices
    let calls = deviceIds.map(id => [
      'Get', {
        typeName: 'StatusData',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: { id },
          diagnosticSearch: { code: "BatteryLevel" },
          fromDate: dateFrom,
          toDate: dateTo
        }
      }
    ]);
    api.multiCall(calls, function (results) {
      let points = [];
      let lowBatteryCount = 0;
      let bounds = [];
      for (let devIdx = 0; devIdx < results.length; devIdx++) {
        for (let event of results[devIdx]) {
          if (event.latitude && event.longitude) {
            let level = parseFloat(event.data);
            let isLow = level < 20;
            points.push({
              lat: event.latitude,
              lon: event.longitude,
              value: 1,
              battery: level,
              low: isLow
            });
            bounds.push(new L.LatLng(event.latitude, event.longitude));
            if (isLow) lowBatteryCount++;
          }
        }
      }
      if (points.length > 0) {
        map.fitBounds(bounds);
        // Use circles for battery events
        points.forEach(pt => {
          L.circleMarker([pt.lat, pt.lon], {
            color: pt.low ? "#ff3333" : "#00bfff",
            radius: pt.low ? 10 : 7,
            fillOpacity: pt.low ? 0.9 : 0.7
          }).addTo(map).bindPopup(
            `Battery: ${pt.battery}%<br>${pt.low ? '<b>Low Battery!</b>' : ''}`
          );
        });
        messageHandler(`Displaying ${formatNumber(points.length)} battery status events. Low battery: ${lowBatteryCount}`);
        updateSummaryPanel({ batteryPoints: points.length, lowBattery: lowBatteryCount });
      } else {
        errorHandler('No battery events found.');
        updateSummaryPanel({ batteryPoints: 0, lowBattery: 0 });
      }
      toggleLoading(false);
    }, function (errorString) {
      alert(errorString);
      toggleLoading(false);
    });
  };

  /**
   * Charging Events (custom)
   */
  let displayChargingEvents = () => {
    let deviceIds = getSelectedDeviceIds();
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Get all charging events for selected devices
    let calls = deviceIds.map(id => [
      'Get', {
        typeName: 'StatusData',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: { id },
          diagnosticSearch: { code: "ChargingEvent" },
          fromDate: dateFrom,
          toDate: dateTo
        }
      }
    ]);
    api.multiCall(calls, function (results) {
      let points = [];
      let bounds = [];
      for (let devIdx = 0; devIdx < results.length; devIdx++) {
        for (let event of results[devIdx]) {
          if (event.latitude && event.longitude) {
            points.push({ lat: event.latitude, lon: event.longitude, value: 1 });
            bounds.push(new L.LatLng(event.latitude, event.longitude));
          }
        }
      }
      if (points.length > 0) {
        map.fitBounds(bounds);
        // Use lightning icon for charging events
        points.forEach(pt => {
          L.marker([pt.lat, pt.lon], {
            icon: L.divIcon({ className: '', html: '<span style="color:#33ff33;font-size:1.5em;">⚡</span>' })
          }).addTo(map).bindPopup('Charging Event');
        });
        messageHandler(`Displaying ${formatNumber(points.length)} charging events.`);
        updateSummaryPanel({ chargingPoints: points.length });
      } else {
        errorHandler('No charging events found.');
        updateSummaryPanel({ chargingPoints: 0 });
      }
      toggleLoading(false);
    }, function (errorString) {
      alert(errorString);
      toggleLoading(false);
    });
  };

  /**
   * Fault (DTC) Events with severity overlays
   */
  let displayFaultEvents = () => {
    let deviceIds = getSelectedDeviceIds();
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Get all faults for selected devices
    let calls = deviceIds.map(id => [
      'Get', {
        typeName: 'FaultData',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: { id },
          fromDate: dateFrom,
          toDate: dateTo
        }
      }
    ]);
    api.multiCall(calls, function (results) {
      let points = [];
      let bounds = [];
      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      for (let devIdx = 0; devIdx < results.length; devIdx++) {
        for (let fault of results[devIdx]) {
          if (fault.latitude && fault.longitude) {
            let severity = fault.severity || "info";
            if (severity === "critical") criticalCount++;
            else if (severity === "warning") warningCount++;
            else infoCount++;
            points.push({
              lat: fault.latitude,
              lon: fault.longitude,
              value: 1,
              code: fault.diagnostic.code,
              desc: fault.diagnostic.description,
              severity
            });
            bounds.push(new L.LatLng(fault.latitude, fault.longitude));
          }
        }
      }
      if (points.length > 0) {
        map.fitBounds(bounds);
        // Show severity overlays
        points.forEach(pt => {
          let color = pt.severity === "critical" ? "#dc3545"
            : pt.severity === "warning" ? "#ffc107"
            : "#0dcaf0";
          L.circleMarker([pt.lat, pt.lon], { color, radius: 10, fillOpacity: 0.7 })
            .addTo(map)
            .bindPopup(
              `<b>Fault: ${pt.code}</b><br>${pt.desc}<br>Severity: <span style="color:${color}">${pt.severity.toUpperCase()}</span>`
            );
        });
        messageHandler(`Displaying ${formatNumber(points.length)} faults. Critical: ${criticalCount}, Warning: ${warningCount}, Info: ${infoCount}`);
        updateSummaryPanel({
          faultPoints: points.length,
          faultCritical: criticalCount,
          faultWarning: warningCount,
          faultInfo: infoCount
        });
      } else {
        errorHandler('No faults found.');
        updateSummaryPanel({ faultPoints: 0, faultCritical: 0, faultWarning: 0, faultInfo: 0 });
      }
      toggleLoading(false);
    }, function (errorString) {
      alert(errorString);
      toggleLoading(false);
    });
  };

  /**
   * Get all selected vehicle IDs
   */
  function getSelectedDeviceIds() {
    return Array.from(elVehicles.options).filter(opt => opt.selected).map(opt => opt.value);
  }

  /**
   * Update summary panel with latest stats
   * Extend this function for more analytics
   */
  function updateSummaryPanel(stats = {}) {
    if (!elSummary) return;
    elSummary.innerHTML = `
      <ul>
        <li>Total Log Points: ${stats.totalPoints ?? '-'}</li>
        <li>Battery Events: ${stats.batteryPoints ?? '-'}</li>
        <li>Low Battery: ${stats.lowBattery ?? '-'}</li>
        <li>Charging Events: ${stats.chargingPoints ?? '-'}</li>
        <li>Faults: ${stats.faultPoints ?? '-'}</li>
        <li>Critical Faults: ${stats.faultCritical ?? '-'}</li>
        <li>Warning Faults: ${stats.faultWarning ?? '-'}</li>
        <li>Info Faults: ${stats.faultInfo ?? '-'}</li>
      </ul>
    `;
  }

  /**
   * Export data as CSV. Extend for more options.
   */
  function exportDataAsCSV() {
    let rows = [["Type", "Lat", "Lon", "Value", "Details"]];
    // Location history (add as needed)
    // Battery events
    batteryEvents.forEach(e => {
      rows.push(["Battery", e.lat, e.lon, e.value, `Level: ${e.battery}`]);
    });
    chargingEvents.forEach(e => {
      rows.push(["Charging", e.lat, e.lon, e.value, "Charging Event"]);
    });
    faults.forEach(e => {
      rows.push(["Fault", e.lat, e.lon, e.value, `Code: ${e.code}, Severity: ${e.severity}`]);
    });
    let csv = rows.map(r => r.join(",")).join("\n");
    let a = document.createElement("a");
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'heatmap_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Enhanced UI initialization
   */
  let initializeInterface = coords => {
    // Setup the map
    map = new L.Map('heatmap-map', {
      center: new L.LatLng(coords.latitude, coords.longitude),
      zoom: 13
    });

    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a','b','c']
    }).addTo(map);

    // Find reused elements (add new controls for enhancements)
    elExceptionTypes = document.getElementById('exceptionTypes');
    elVehicles = document.getElementById('vehicles');
    elDateFromInput = document.getElementById('from');
    elDateToInput = document.getElementById('to');
    elShowHeatMap = document.getElementById('showHeatMap');
    elError = document.getElementById('error');
    elMessage = document.getElementById('message');
    elLoading = document.getElementById('loading');
    elSummary = document.getElementById('summaryPanel');      // Add <div id="summaryPanel"></div> in HTML
    elExportBtn = document.getElementById('exportBtn');       // Add <button id="exportBtn"></button>
    elEventType = document.getElementById('eventType');       // Add <select id="eventType"></select>
    elLowBatteryToggle = document.getElementById('showLowBattery'); // Add <input id="showLowBattery" type="checkbox">
    elShowFaultOverlay = document.getElementById('showFaultSeverity'); // Add <input id="showFaultSeverity" type="checkbox">
    elDataRaw = document.getElementById('dataRaw');
    elDataStats = document.getElementById('dataStats');

    // Set up event listeners for new controls
    if (elExportBtn) {
      elExportBtn.addEventListener('click', () => exportDataAsCSV());
    }
    if (elEventType) {
      elEventType.addEventListener('change', () => displayHeatMap());
    }
    if (elLowBatteryToggle) {
      elLowBatteryToggle.addEventListener('change', () => displayEVBatteryEvents());
    }
    if (elShowFaultOverlay) {
      elShowFaultOverlay.addEventListener('change', () => displayFaultEvents());
    }

    // Original listeners
    document.getElementById('visualizeByLocationHistory').addEventListener('click', event => {
      elExceptionTypes.disabled = true;
    });

    document.getElementById('visualizeByExceptionHistory').addEventListener('click', event => {
      elExceptionTypes.disabled = false;
    });

    elExceptionTypes.addEventListener('change', event => { event.preventDefault(); });
    elVehicles.addEventListener('change', event => { event.preventDefault(); });
    elDateFromInput.addEventListener('change', event => { event.preventDefault(); });
    elDateToInput.addEventListener('change', event => { event.preventDefault(); });
    elShowHeatMap.addEventListener('click', event => {
      event.preventDefault();
      displayHeatMap();
    });    

    // Set up dates
    let now = new Date();
    let dd = now.getDate();
    let mm = now.getMonth() + 1;
    let yy = now.getFullYear();
    if (dd < 10) dd = '0' + dd;
    if (mm < 10) mm = '0' + mm;
    elDateFromInput.value = yy + '-' + mm + '-' + dd + 'T00:00';
    elDateToInput.value = yy + '-' + mm + '-' + dd + 'T23:59';
  };

  /**
   * Sorter for named entities
   */
  let sortByName = (a, b) => {
    a = a.name.toLowerCase();
    b = b.name.toLowerCase();
    return a === b ? 0 : a > b ? 1 : -1;
  };

  // ---- Data Output and Statistics Function ----
  function showDataOutput(coordinates) {
    if (!elDataRaw || !elDataStats) return;
    let arr = coordinates.map(d => ([d.lat, d.lon]));
    elDataRaw.textContent = JSON.stringify(arr, null, 2);
    if (!arr.length) {
      elDataStats.textContent = 'No data.';
      return;
    }
    let count = arr.length;
    let latitudes = arr.map(d => d[0]);
    let longitudes = arr.map(d => d[1]);
    let avgLat = latitudes.reduce((a, b) => a + b, 0) / count;
    let avgLng = longitudes.reduce((a, b) => a + b, 0) / count;
    elDataStats.innerHTML =
      '<ul>' +
      '<li>Total points: ' + count + '</li>' +
      '<li>Average Latitude: ' + avgLat.toFixed(5) + '</li>' +
      '<li>Average Longitude: ' + avgLng.toFixed(5) + '</li>' +
      '</ul>';
  }

  /**
   * SDK lifecycle: initialize, focus
   */
  return {
    initialize(freshApi, state, callback) {
      api = freshApi;
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(position => {
          initializeInterface(position.coords);
          callback();
        });
      } else {
        initializeInterface({ longitude: -79.709441, latitude: 43.434497 });
        callback();
      }
    },
    focus(freshApi, freshState) {
      api = freshApi;
      // Populate vehicles list.
      api.call('Get', {
        typeName: 'Device',
        resultsLimit: 50000,
        search: { fromDate: new Date().toISOString(), groups: freshState.getGroupFilter() }
      }, vehicles => {
        if (!vehicles || vehicles.length < 0) return;
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
        if (!rules || rules.length < 0) return;
        rules.sort(sortByName);
        rules.forEach(rule => {
          let option = new Option();
          option.text = rule.name;
          option.value = rule.id;
          elExceptionTypes.add(option);
        });
      }, errorHandler);

      setTimeout(() => { map.invalidateSize(); }, 200);
    }
  };
};
