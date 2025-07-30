/**
 * Enhanced Geotab Heatmap Add-In
 * Features: Interactive controls, EV battery events, charging events, low battery markers,
 * Fault (DTC) overlays with severity, full summary panel, export options, responsive UI,
 * live SDK queries, enhanced data visualization, and extensible code structure.
 */

geotab.addin.heatmap = () => {
  'use strict';

  let api;
  let map;
  let heatMapLayer;
  let markers = [];
  let infoWindows = [];

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

  // Configuration
  const myGeotabGetResultsLimit = 50000;
  let selectedVehicleCount;
  let startTime;

  // Data containers
  let batteryEvents = [];
  let chargingEvents = [];
  let faults = [];
  let summaryStats = {};

  /**
   * Error and message handlers
   */
  const errorHandler = message => { 
    if (elError) elError.innerHTML = message; 
  };

  const messageHandler = message => { 
    if (elMessage) elMessage.innerHTML = message; 
  };

  /**
   * Utility functions
   */
  function resultsEmpty(results) {
    if (!results || results.length === 0) return true;
    for (let i = 0; i < results.length; i++) {
      if (results[i].length > 0) return false;
    }
    return true;
  }

  function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  }

  function getElapsedTimeSeconds() {
    return Math.round((new Date() - startTime) / 1000);
  }

  function toggleLoading(show) {
    if (!elLoading) return;
    if (show) {
      if (elShowHeatMap) elShowHeatMap.disabled = true;
      elLoading.style.display = 'block';
    } else {
      setTimeout(() => { elLoading.style.display = 'none'; }, 600);
      if (elShowHeatMap) elShowHeatMap.disabled = false;
    }
  }

  /**
   * Map and visualization functions
   */
  function initializeMap(coords) {
    map = L.map('heatmap-map').setView([coords.latitude, coords.longitude], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a','b','c']
    }).addTo(map);

    resetHeatMapLayer();
    addHeatmapLegend();
  }

  function resetHeatMapLayer() {
    if (heatMapLayer) map.removeLayer(heatMapLayer);

    heatMapLayer = L.heatLayer([], {
      radius: 24,
      blur: 15,
      maxZoom: 17,
      minOpacity: 0.5,
      gradient: {
        0.4: 'blue',
        0.6: 'cyan',
        0.7: 'lime',
        0.8: 'yellow',
        1.0: 'red'
      }
    }).addTo(map);
  }

  function addHeatmapLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'heatmap-legend');
      div.innerHTML = `
        <h4>Heatmap Intensity</h4>
        <div class="legend-gradient"></div>
        <div class="legend-labels">
          <span>Low</span>
          <span>High</span>
        </div>
      `;
      return div;
    };
    legend.addTo(map);
  }

  function clearMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
  }

  /**
   * Data visualization functions
   */
  function displayHeatMap() {
    if (!map) return;
    clearMarkers();
    resetHeatMapLayer();

    selectedVehicleCount = Array.from(elVehicles.options).filter(opt => opt.selected).length;
    if (selectedVehicleCount === 0) {
      errorHandler('Please select at least one vehicle from the list and try again.');
      return;
    }

    startTime = new Date();

    switch (elEventType.value) {
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

  function displayHeatMapForLocationHistory() {
    const deviceIds = getSelectedDeviceIds();
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    const dateFrom = new Date(fromValue).toISOString();
    const dateTo = new Date(toValue).toISOString();

    const calls = deviceIds.map(id => [
      'Get', {
        typeName: 'LogRecord',
        resultsLimit: myGeotabGetResultsLimit,
        search: { deviceSearch: { id }, fromDate: dateFrom, toDate: dateTo }
      }
    ]);

    api.multiCall(calls, results => {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        showEnhancedDataOutput([]);
        updateSummaryPanel({ totalPoints: 0 });
        return;
      }

      const coordinates = [];
      const bounds = [];
      let logRecordCount = 0;
      let exceededResultsLimitCount = 0;

      results.forEach(records => {
        records.forEach(rec => {
          if (rec.latitude !== 0 || rec.longitude !== 0) {
            coordinates.push({ lat: rec.latitude, lng: rec.longitude, value: 1 });
            bounds.push([rec.latitude, rec.longitude]);
            logRecordCount++;
          }
        });
        if (records.length >= myGeotabGetResultsLimit) exceededResultsLimitCount++;
      });

      if (coordinates.length > 0) {
        heatMapLayer.setLatLngs(coordinates.map(c => [c.lat, c.lng, c.value]));
        map.fitBounds(bounds);
        messageHandler(`Displaying ${formatNumber(logRecordCount)} log records for ${formatNumber(selectedVehicleCount)} vehicles. [${getElapsedTimeSeconds()} sec]`);
        if (exceededResultsLimitCount > 0) {
          errorHandler(`Note: Results limited to ${formatNumber(myGeotabGetResultsLimit)} records per vehicle (${exceededResultsLimitCount} vehicles affected)`);
        }
        showEnhancedDataOutput(coordinates);
        updateSummaryPanel({ totalPoints: logRecordCount });
      } else {
        errorHandler('No valid coordinates found');
        showEnhancedDataOutput([]);
        updateSummaryPanel({ totalPoints: 0 });
      }
      toggleLoading(false);
    }, errorString => {
      alert(errorString);
      toggleLoading(false);
    });
  }

  function displayEVBatteryEvents() {
    const deviceIds = getSelectedDeviceIds();
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    const dateFrom = new Date(fromValue).toISOString();
    const dateTo = new Date(toValue).toISOString();

    const calls = deviceIds.map(id => [
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

    api.multiCall(calls, results => {
      const points = [];
      const bounds = [];
      let lowBatteryCount = 0;

      results.forEach((deviceResults, devIdx) => {
        deviceResults.forEach(event => {
          if (event.latitude && event.longitude) {
            const level = parseFloat(event.data);
            const isLow = level < 20;
            points.push({
              lat: event.latitude,
              lng: event.longitude,
              value: 1,
              battery: level,
              low: isLow,
              device: event.device.name || event.device.id,
              time: event.dateTime
            });
            bounds.push([event.latitude, event.longitude]);
            if (isLow) lowBatteryCount++;
          }
        });
      });

      if (points.length > 0) {
        points.forEach(pt => {
          const marker = L.circleMarker([pt.lat, pt.lng], {
            color: pt.low ? "#ff3333" : "#00bfff",
            radius: pt.low ? 10 : 7,
            fillOpacity: pt.low ? 0.9 : 0.7
          }).addTo(map);
          marker.bindPopup(createEnhancedTooltip({
            type: 'battery',
            ...pt
          }));
          markers.push(marker);
        });
        map.fitBounds(bounds);
        messageHandler(`Displaying ${formatNumber(points.length)} battery events (${lowBatteryCount} low)`);
        showEnhancedDataOutput(points);
        updateSummaryPanel({ 
          batteryPoints: points.length, 
          lowBattery: lowBatteryCount 
        });
      } else {
        errorHandler('No battery events found');
        showEnhancedDataOutput([]);
        updateSummaryPanel({ batteryPoints: 0, lowBattery: 0 });
      }
      toggleLoading(false);
    }, errorString => {
      alert(errorString);
      toggleLoading(false);
    });
  }

  function displayChargingEvents() {
    const deviceIds = getSelectedDeviceIds();
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    const dateFrom = new Date(fromValue).toISOString();
    const dateTo = new Date(toValue).toISOString();

    const calls = deviceIds.map(id => [
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

    api.multiCall(calls, results => {
      const points = [];
      const bounds = [];

      results.forEach(deviceResults => {
        deviceResults.forEach(event => {
          if (event.latitude && event.longitude) {
            points.push({ 
              lat: event.latitude, 
              lng: event.longitude,
              device: event.device.name || event.device.id,
              station: event.locationName || "Unknown",
              time: event.dateTime
            });
            bounds.push([event.latitude, event.longitude]);
          }
        });
      });

      if (points.length > 0) {
        points.forEach(pt => {
          const marker = L.marker([pt.lat, pt.lng], {
            icon: L.divIcon({ 
              className: 'charging-marker', 
              html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="yellow" d="M7 2v11h3v9l7-12h-4l4-8z"/>
</svg>' 
            })
          }).addTo(map);
          marker.bindPopup(createEnhancedTooltip({
            type: 'charging',
            ...pt
          }));
          markers.push(marker);
        });
        map.fitBounds(bounds);
        messageHandler(`Displaying ${formatNumber(points.length)} charging events`);
        showEnhancedDataOutput(points);
        updateSummaryPanel({ chargingPoints: points.length });
      } else {
        errorHandler('No charging events found');
        showEnhancedDataOutput([]);
        updateSummaryPanel({ chargingPoints: 0 });
      }
      toggleLoading(false);
    }, errorString => {
      alert(errorString);
      toggleLoading(false);
    });
  }

  function displayFaultEvents() {
    const deviceIds = getSelectedDeviceIds();
    const fromValue = elDateFromInput.value;
    const toValue = elDateToInput.value;

    if (!deviceIds.length || !fromValue || !toValue) return;

    toggleLoading(true);

    const dateFrom = new Date(fromValue).toISOString();
    const dateTo = new Date(toValue).toISOString();

    const calls = deviceIds.map(id => [
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

    api.multiCall(calls, results => {
      const points = [];
      const bounds = [];
      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;

      results.forEach(deviceResults => {
        deviceResults.forEach(fault => {
          if (fault.latitude && fault.longitude) {
            const severity = fault.severity || "info";
            if (severity === "critical") criticalCount++;
            else if (severity === "warning") warningCount++;
            else infoCount++;
            
            points.push({
              lat: fault.latitude,
              lng: fault.longitude,
              device: fault.device.name || fault.device.id,
              code: fault.diagnostic.code,
              description: fault.diagnostic.description,
              severity,
              time: fault.dateTime
            });
            bounds.push([fault.latitude, fault.longitude]);
          }
        });
      });

      if (points.length > 0) {
        points.forEach(pt => {
          const color = pt.severity === "critical" ? "#dc3545" :
                       pt.severity === "warning" ? "#ffc107" : "#0dcaf0";
          const marker = L.circleMarker([pt.lat, pt.lng], { 
            color,
            radius: 10,
            fillOpacity: 0.7
          }).addTo(map);
          marker.bindPopup(createEnhancedTooltip({
            type: 'fault',
            ...pt
          }));
          markers.push(marker);
        });
        map.fitBounds(bounds);
        messageHandler(`Displaying ${formatNumber(points.length)} faults (Critical: ${criticalCount}, Warning: ${warningCount}, Info: ${infoCount})`);
        showEnhancedDataOutput(points);
        updateSummaryPanel({
          faultPoints: points.length,
          faultCritical: criticalCount,
          faultWarning: warningCount,
          faultInfo: infoCount
        });
      } else {
        errorHandler('No faults found');
        showEnhancedDataOutput([]);
        updateSummaryPanel({ 
          faultPoints: 0, 
          faultCritical: 0, 
          faultWarning: 0, 
          faultInfo: 0 
        });
      }
      toggleLoading(false);
    }, errorString => {
      alert(errorString);
      toggleLoading(false);
    });
  }

  /**
   * Enhanced visualization functions
   */
  function showEnhancedDataOutput(data) {
    if (!elDataRaw || !elDataStats) return;
    
    // Show first 100 points in raw data view
    elDataRaw.textContent = JSON.stringify(data.slice(0, 100), null, 2);
    
    // Calculate statistics
    const stats = {
      totalPoints: data.length,
      avgLat: data.reduce((sum, pt) => sum + pt.lat, 0) / data.length,
      avgLng: data.reduce((sum, pt) => sum + pt.lng, 0) / data.length,
      minLat: Math.min(...data.map(pt => pt.lat)),
      maxLat: Math.max(...data.map(pt => pt.lat)),
      minLng: Math.min(...data.map(pt => pt.lng)),
      maxLng: Math.max(...data.map(pt => pt.lng))
    };
    
    // Update stats display
    elDataStats.innerHTML = `
      <div class="data-stats">
        <h5>Data Statistics</h5>
        <ul>
          <li>Total Points: ${formatNumber(stats.totalPoints)}</li>
          <li>Avg Latitude: ${stats.avgLat.toFixed(6)}</li>
          <li>Avg Longitude: ${stats.avgLng.toFixed(6)}</li>
          <li>Latitude Range: ${stats.minLat.toFixed(6)} to ${stats.maxLat.toFixed(6)}</li>
          <li>Longitude Range: ${stats.minLng.toFixed(6)} to ${stats.maxLng.toFixed(6)}</li>
        </ul>
      </div>
    `;
  }

  function createEnhancedTooltip(data) {
    let content = `<div class="heatmap-tooltip">`;
    
    switch(data.type) {
      case 'battery':
        content += `
          <h4>${data.device}</h4>
          <p><strong>Battery Level:</strong> ${data.battery}%</p>
          <p><strong>Time:</strong> ${new Date(data.time).toLocaleString()}</p>
          ${data.low ? '<p class="text-danger"><strong>⚠ Low Battery Warning</strong></p>' : ''}
        `;
        break;
        
      case 'charging':
        content += `
          <h4>Charging Event</h4>
          <p><strong>Device:</strong> ${data.device}</p>
          <p><strong>Location:</strong> ${data.station}</p>
          <p><strong>Time:</strong> ${new Date(data.time).toLocaleString()}</p>
        `;
        break;
        
      case 'fault':
        content += `
          <h4>Fault Report</h4>
          <p><strong>Device:</strong> ${data.device}</p>
          <p><strong>Code:</strong> ${data.code}</p>
          <p><strong>Description:</strong> ${data.description}</p>
          <p><strong>Severity:</strong> <span class="text-${data.severity}">${data.severity.toUpperCase()}</span></p>
          <p><strong>Time:</strong> ${new Date(data.time).toLocaleString()}</p>
        `;
        break;
        
      default:
        content += `
          <h4>Location Data</h4>
          <p><strong>Coordinates:</strong> ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}</p>
        `;
    }
    
    content += `</div>`;
    return content;
  }

  function updateSummaryPanel(stats = {}) {
    if (!elSummary) return;
    elSummary.innerHTML = `
      <div class="summary-panel">
        <h4>Summary Statistics</h4>
        <ul>
          <li>Total Points: ${stats.totalPoints ?? '-'}</li>
          <li>Battery Events: ${stats.batteryPoints ?? '-'}</li>
          <li>Low Battery Events: ${stats.lowBattery ?? '-'}</li>
          <li>Charging Events: ${stats.chargingPoints ?? '-'}</li>
          <li>Total Faults: ${stats.faultPoints ?? '-'}</li>
          <li>Critical Faults: ${stats.faultCritical ?? '-'}</li>
          <li>Warning Faults: ${stats.faultWarning ?? '-'}</li>
          <li>Info Faults: ${stats.faultInfo ?? '-'}</li>
        </ul>
      </div>
    `;
  }

  function getSelectedDeviceIds() {
    return Array.from(elVehicles.options)
      .filter(opt => opt.selected)
      .map(opt => opt.value);
  }

  function exportDataAsCSV() {
    let rows = [["Type", "Latitude", "Longitude", "Value", "Details", "Time"]];
    
    // Add location data if available
    if (heatMapLayer && heatMapLayer.getLatLngs().length > 0) {
      heatMapLayer.getLatLngs().forEach(pt => {
        rows.push(["Location", pt.lat, pt.lng, pt.value || 1, "", ""]);
      });
    }
    
    // Add battery events
    batteryEvents.forEach(e => {
      rows.push(["Battery", e.lat, e.lng, e.value, `Level: ${e.battery}%`, e.time]);
    });
    
    // Add charging events
    chargingEvents.forEach(e => {
      rows.push(["Charging", e.lat, e.lng, e.value, `Station: ${e.station}`, e.time]);
    });
    
    // Add faults
    faults.forEach(f => {
      rows.push(["Fault", f.lat, f.lng, 1, `Code: ${f.code}, Severity: ${f.severity}`, f.time]);
    });
    
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'heatmap_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * UI initialization
   */
  function initializeInterface(coords) {
    initializeMap(coords);
    
    // Get DOM elements
    elExceptionTypes = document.getElementById('exceptionTypes');
    elVehicles = document.getElementById('vehicles');
    elDateFromInput = document.getElementById('from');
    elDateToInput = document.getElementById('to');
    elShowHeatMap = document.getElementById('showHeatMap');
    elError = document.getElementById('error');
    elMessage = document.getElementById('message');
    elLoading = document.getElementById('loading');
    elSummary = document.getElementById('summaryPanel');
    elExportBtn = document.getElementById('exportBtn');
    elEventType = document.getElementById('eventType');
    elLowBatteryToggle = document.getElementById('showLowBattery');
    elShowFaultOverlay = document.getElementById('showFaultSeverity');
    elDataRaw = document.getElementById('dataRaw');
    elDataStats = document.getElementById('dataStats');

    // Set up event listeners
    if (elExportBtn) elExportBtn.addEventListener('click', exportDataAsCSV);
    if (elEventType) elEventType.addEventListener('change', displayHeatMap);
    if (elLowBatteryToggle) elLowBatteryToggle.addEventListener('change', displayHeatMap);
    if (elShowFaultOverlay) elShowFaultOverlay.addEventListener('change', displayHeatMap);
    if (elShowHeatMap) elShowHeatMap.addEventListener('click', e => {
      e.preventDefault();
      displayHeatMap();
    });

    // Set default dates
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    elDateFromInput.value = `${today}T00:00`;
    elDateToInput.value = `${today}T23:59`;
  }

  function sortByName(a, b) {
    a = a.name.toLowerCase();
    b = b.name.toLowerCase();
    return a === b ? 0 : a > b ? 1 : -1;
  }

  /**
   * SDK lifecycle methods
   */
  return {
    initialize(freshApi, state, callback) {
      api = freshApi;
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(position => {
          initializeInterface(position.coords);
          callback();
        }, () => {
          initializeInterface({ latitude: 0, longitude: 0 });
          callback();
        });
      } else {
        initializeInterface({ latitude: 0, longitude: 0 });
        callback();
      }
    },

    focus(freshApi, freshState) {
      api = freshApi;
      
      // Populate vehicles list
      api.call('Get', {
        typeName: 'Device',
        resultsLimit: 50000,
        search: { fromDate: new Date().toISOString(), groups: freshState.getGroupFilter() }
      }, vehicles => {
        if (!vehicles || vehicles.length === 0) return;
        vehicles.sort(sortByName);
        vehicles.forEach(vehicle => {
          const option = new Option(vehicle.name, vehicle.id);
          elVehicles.add(option);
        });
      }, errorHandler);

      // Populate exceptions list
      api.call('Get', {
        typeName: 'Rule',
        resultsLimit: 50000
      }, rules => {
        if (!rules || rules.length === 0) return;
        rules.sort(sortByName);
        rules.forEach(rule => {
          const option = new Option(rule.name, rule.id);
          elExceptionTypes.add(option);
        });
      }, errorHandler);

      setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    },

    blur() {
      // Cleanup if needed
    }
  };
};
