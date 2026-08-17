/**
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.heatmap = function () {
  'use strict';

  var api;
  var interfaceReady = false;
  var map;
  var heatMapLayer;
  var metricMarkerLayer;
  var metricLegendControl;
  var vehicleLegendControl;
  var metricMapData = [];
  var metricDetailsVisible = false;
  var heatMapPoints = [];
  var elExceptionTypes;
  var elSpeedingRules;
  var elIdlingRules;
  var elShowExceptionHeatMap;
  var elGroupTypes;
  var elVehicleGroups;
  var elVehicles;
  var elZoneTypes;
  var elZones;
  var ruleDropdown;
  var speedingRuleDropdown;
  var idlingRuleDropdown;
  var groupTypeDropdown;
  var vehicleGroupDropdown;
  var vehicleDropdown;
  var zoneTypeDropdown;
  var zoneDropdown;
  var elDateFromInput;
  var elDateToInput;
  var elShowHeatMap;
  var elError;
  var elMessage;
  var elLoading;
  var elMapEventTotal;
  var selectedVehicleCount;
  var myGeotabGetResultsLimit = 50000;
  var startTime;
  var printPreviousMetricDetails = null;
  var allVehicles = [];
  var availableGroups = [];
  var groupById = {};
  var parentByGroupId = {};
  var availableZoneTypes = [];
  var availableZones = [];
  var legendVehicleIds = {};

  // Speed limit zones come from the NZTA National Speed Limit Register
  // (SpeedLimitZoneFull view). Zones are grouped by their posted limit, which is
  // the category the picker exposes, and school zones are the subset whose
  // reason is a school. Only the zones intersecting the current map view are
  // requested so a pan never pulls the whole national register at once.
  var SCHOOL_ZONE_SERVICE_URL = 'https://services.arcgis.com/CXBb7LAjgIIdcsPt/arcgis/rest/services/SpeedLimitZoneFull__View/FeatureServer/0/query';
  var SCHOOL_ZONE_REASON = 'The presence of a school';
  var SPEED_ZONE_CATEGORIES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  // The limits common enough that the overlay shows something in most views.
  var SPEED_ZONE_DEFAULT_CATEGORIES = [30, 40, 50, 100];
  // Distinct colour per category so overlapping limits stay readable.
  var SPEED_ZONE_COLORS = {
    10: '#7b1fa2',
    20: '#5e35b1',
    30: '#1e88e5',
    40: '#f2a900',
    50: '#00897b',
    60: '#43a047',
    70: '#c0ca33',
    80: '#fb8c00',
    90: '#e64a19',
    100: '#d81b60',
    110: '#b71c1c'
  };
  var SCHOOL_ZONE_MIN_ZOOM = 11;
  var SCHOOL_ZONE_PAGE_SIZE = 2000;
  var SCHOOL_ZONE_MAX_CACHED = 6000;
  var elShowSchoolZones;
  var elSchoolZoneStatus;
  var elSpeedZoneCategories;
  var elSchoolZonesOnly;
  var elEventsInZonesOnly;
  var selectedZoneCategories = SPEED_ZONE_DEFAULT_CATEGORIES.slice();
  var schoolZoneLayer;
  var schoolZoneLegendControl;
  var schoolZones = [];
  var schoolZoneById = {};
  var schoolZoneRequestId = 0;
  var schoolZoneReloadTimer = null;
  var elLoadingLabel;
  var mainLoadActive = false;
  var zoneLoadActive = false;

  // MyGeotab's Risk Management speed bands. SystemSettings.speedingTrigger holds
  // the three absolute speeds the database is configured with and
  // speedingGraceDuration the grace period, so events are banded exactly as the
  // Risk Management report bands them instead of against invented thresholds.
  var SPEED_BAND_COLORS = ['#43a047', '#f2a900', '#fb8c00', '#d81b60'];
  var speedBandTriggers = [];
  var speedBandGraceSeconds = null;
  var selectedSpeedBands = [];
  var elSpeedBands;
  var elSpeedBandStatus;
  var elTopSpeedingOnly;
  var TOP_SPEEDING_PER_VEHICLE = 5;

  // Idling has its own section because its events are ranked by what they cost
  // rather than by speed: cost = idle hours x litres/hour x price per litre,
  // the same model as the standalone idling dashboard.
  var TOP_IDLING_PER_VEHICLE = 5;
  var IDLE_DEFAULT_FUEL_BURN = 3;
  var IDLE_DEFAULT_FUEL_PRICE = 1.9;
  var elIdleMinMinutes;
  var elIdleFuelBurn;
  var elIdleFuelPrice;
  var elTopIdlingOnly;
  var elIdleCostStatus;

  // Browser cache: one compact record per database/user, mode, vehicle, rule
  // and UTC day. Historical days are immutable; today's record expires after
  // five minutes. Points are aggregated into ~50 m / one-minute cells.
  var CACHE_DB_NAME = 'geotab-heatmap-cache';
  var CACHE_STORE_NAME = 'dailyHeatCells';
  var CACHE_DB_VERSION = 1;
  var CACHE_SCHEMA_VERSION = 1;
  var CACHE_TODAY_TTL_MS = 5 * 60 * 1000;
  var CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  var API_BATCH_SIZE = 25;
  // Selector data only needs enough rows to fill the dropdowns. Asking for
  // 50,000 zones or rules is slow enough on large databases that MyGeotab
  // reports a connection failure instead of a result.
  var SELECTOR_RESULTS_LIMIT = 5000;
  var GRID_MULTIPLIER = 2000; // 0.0005 degrees, roughly 50 m latitude
  var cacheSessionNamespace = 'unknown-database|unknown-user';
  var cacheNamespace = 'unknown-database|unknown-user';
  var cacheDbPromise;

  /**
   * Display error message
   * @param {string} message - The error message.
   */
  var errorHandler = function errorHandler(message) {
    // MyGeotab passes an error object to api.call error callbacks; rendering it
    // directly would print "[object Object]" instead of the reason.
    if (message && typeof message === 'object') {
      message = message.message || message.name || 'Unknown MyGeotab error';
    }
    elError.innerHTML = message;
  };

  /**
   * Display error message
   * @param {string} message - The error message.
   */
  var messageHandler = function messageHandler(message) {
    elMessage.innerHTML = message;
  };

  /**
   * Returns a boolean indicating whether all elements in the
   * supplied results array are empty.
   * @param {object} results - The results array to be evaluated.
   */
  function resultsEmpty(results) {
    if (!results || results.length === 0) {
      return true;
    }
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
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
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
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
    var bounds = map && map.getBounds ? map.getBounds() : null;
    var exceptionMode = document.getElementById('visualizeByExceptionHistory') && document.getElementById('visualizeByExceptionHistory').checked;
    var visibleCount = 0;
    var totalCount = 0;
    var countablePoints = exceptionMode ? metricMapData : heatMapPoints;
    countablePoints.forEach(function (point) {
      if (exceptionMode && !metricPassesFilters(point)) return;
      var weight = exceptionMode ? 1 : Number(point.value) || 1;
      totalCount += weight;
      if (!bounds || bounds.contains(new L.LatLng(point.lat, point.lon))) {
        visibleCount += weight;
      }
    });
    elMapEventTotal.innerHTML = '<strong>' + formatNumber(visibleCount) + '</strong>' + '<span>' + (exceptionMode ? 'exceptions' : 'GPS points') + ' in view</span>' + '<small>' + formatNumber(totalCount) + (exceptionMode ? ' mapped exceptions loaded' : ' GPS points loaded') + '</small>';
  }
  function preparePrintReport() {
    if (!document.getElementById('printReportHeader')) {
      var header = document.createElement('section');
      header.id = 'printReportHeader';
      header.innerHTML = '<div><h1>Heatmap Fleet Analytics</h1><p id="printReportFilters"></p></div>' + '<strong id="printReportSummary"></strong>';
      document.getElementById('heatmap').insertBefore(header, document.getElementById('heatmap').firstChild);
    }
    var exceptionMode = document.getElementById('visualizeByExceptionHistory').checked;
    var selectedVehicles = Array.from(elVehicles.selectedOptions || []).map(function (option) {
      return option.text;
    });
    var selectedRules = selectedExceptionRules().map(function (rule) {
      return rule.name;
    });
    var pointTotal = (exceptionMode ? metricMapData : heatMapPoints).reduce(function (sum, point) {
      return sum + (exceptionMode ? 1 : Number(point.value) || 1);
    }, 0);
    var fromText = elDateFromInput.value ? new Date(elDateFromInput.value).toLocaleString() : 'Not set';
    var toText = elDateToInput.value ? new Date(elDateToInput.value).toLocaleString() : 'Not set';
    var subject = exceptionMode ? selectedRules.length ? selectedRules.join(', ') : 'Exception history' : 'Location history';
    document.getElementById('printReportFilters').textContent = subject + ' | ' + selectedVehicles.length + ' vehicle' + (selectedVehicles.length === 1 ? '' : 's') + ' | ' + fromText + ' to ' + toText + ' | Generated ' + new Date().toLocaleString();
    document.getElementById('printReportSummary').textContent = formatNumber(pointTotal) + (exceptionMode ? ' mapped exceptions' : ' GPS points');
    printPreviousMetricDetails = metricDetailsVisible;
    if (exceptionMode && metricMapData.length) metricDetailsVisible = true;
    map.invalidateSize({
      animate: false,
      pan: false
    });
    if (heatMapLayer && heatMapLayer.redraw) heatMapLayer.redraw();
    renderMetricMarkers();
    updateMapEventTotal();
  }
  function restoreAfterPrint() {
    if (printPreviousMetricDetails !== null) {
      metricDetailsVisible = printPreviousMetricDetails;
      printPreviousMetricDetails = null;
    }
    map.invalidateSize({
      animate: false,
      pan: false
    });
    if (heatMapLayer && heatMapLayer.redraw) heatMapLayer.redraw();
    renderMetricMarkers();
    updateMapEventTotal();
  }
  function setHeatMapPoints(points) {
    heatMapPoints = points || [];
    updateMapEventTotal();
  }
  function selectedValues(select) {
    return Array.from(select && select.selectedOptions || []).map(function (option) {
      return option.value;
    });
  }
  function zoneCoordinates(zone) {
    return (zone && zone.points || []).map(function (point) {
      return {
        lat: Number(point.y != null ? point.y : point.latitude),
        lon: Number(point.x != null ? point.x : point.longitude)
      };
    }).filter(function (point) {
      return Number.isFinite(point.lat) && Number.isFinite(point.lon);
    });
  }
  function pointInPolygon(point, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i].lon;
      var yi = polygon[i].lat;
      var xj = polygon[j].lon;
      var yj = polygon[j].lat;
      var intersects = yi > point.lat !== yj > point.lat && point.lon < (xj - xi) * (point.lat - yi) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  function filterPointsBySelectedZones(points) {
    var zoneIds = selectedValues(elZones);
    if (!zoneIds.length) return points || [];
    var polygons = availableZones.filter(function (zone) {
      return zoneIds.indexOf(zone.id) !== -1;
    }).map(zoneCoordinates).filter(function (polygon) {
      return polygon.length >= 3;
    });
    if (!polygons.length) return [];
    return (points || []).filter(function (point) {
      return polygons.some(function (polygon) {
        return pointInPolygon(point, polygon);
      });
    });
  }
  function populateZoneOptions() {
    var selectedTypeIds = selectedValues(elZoneTypes);
    var previouslySelected = selectedValues(elZones);
    while (elZones.options.length) elZones.remove(0);
    availableZones.filter(function (zone) {
      if (!selectedTypeIds.length) return true;
      var zoneTypeIds = (zone.zoneTypes || []).map(function (zoneType) {
        return zoneType.id || zoneType;
      });
      return selectedTypeIds.some(function (id) { return zoneTypeIds.indexOf(id) !== -1; });
    }).forEach(function (zone) {
      var option = new Option(zone.name, zone.id);
      option.selected = previouslySelected.indexOf(zone.id) !== -1;
      elZones.add(option);
    });
    zoneDropdown.rebuild();
  }
  function syncHeatMapVisibility() {
    if (!map || !heatMapLayer) return;
    var exceptionMode = document.getElementById('visualizeByExceptionHistory').checked;
    var shouldShow = !exceptionMode || elShowExceptionHeatMap.checked;
    // Keep the layer, its canvas, and all loaded points attached to the map.
    // The exception control changes presentation only, so event data and
    // detail markers remain available when heat colouring is switched off.
    if (!map.hasLayer(heatMapLayer)) heatMapLayer.addTo(map);
    if (heatMapLayer._canvas) {
      heatMapLayer._canvas.style.visibility = shouldShow ? 'visible' : 'hidden';
      heatMapLayer._canvas.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDuration(milliseconds) {
    var seconds = Math.max(0, Math.round(milliseconds / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds % 3600 / 60);
    var remainder = seconds % 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + remainder + 's';
    return remainder + 's';
  }
  function validLogRecords(records) {
    return (records || []).filter(function (record) {
      return Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude)) && (Number(record.latitude) !== 0 || Number(record.longitude) !== 0);
    }).sort(function (a, b) {
      return new Date(a.dateTime) - new Date(b.dateTime);
    });
  }
  function roadLimitAt(roadSpeeds, dateTime) {
    var target = new Date(dateTime).getTime();
    var limit = null;
    for (var i = 0; i < roadSpeeds.length; i++) {
      if (new Date(roadSpeeds[i].date).getTime() > target) break;
      limit = Number(roadSpeeds[i].maxSpeed);
    }
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  }
  function bearingRadians(a, b) {
    var lat1 = Number(a.latitude) * Math.PI / 180;
    var lat2 = Number(b.latitude) * Math.PI / 180;
    var dLon = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
    return Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
  }
  function normalizedAngle(value) {
    while (value > Math.PI) value -= 2 * Math.PI;
    while (value < -Math.PI) value += 2 * Math.PI;
    return value;
  }
  function colorForVehicleId(vehicleId) {
    var index = allVehicles.findIndex(function (vehicle) {
      return vehicle.id === vehicleId;
    });
    if (index < 0) index = 0;
    var hue = Math.round(index * 137.508 % 360);
    return 'hsl(' + hue + ', 70%, 40%)';
  }
  function rememberSelectedVehiclesInLegend() {
    selectedValues(elVehicles).forEach(function (id) {
      legendVehicleIds[id] = true;
    });
  }
  function displayVehicleLegend() {
    if (vehicleLegendControl) map.removeControl(vehicleLegendControl);
    var selectedLookup = {};
    selectedValues(elVehicles).forEach(function (id) { selectedLookup[id] = true; });
    var legendVehicles = allVehicles.filter(function (vehicle) {
      return legendVehicleIds[vehicle.id] === true;
    }).map(function (vehicle) {
      return { id: vehicle.id, name: vehicle.name, color: colorForVehicleId(vehicle.id), selected: selectedLookup[vehicle.id] === true };
    });
    if (!legendVehicles.length) return;
    vehicleLegendControl = L.control({ position: 'bottomleft' });
    vehicleLegendControl.onAdd = function () {
      var element = L.DomUtil.create('div', 'vehicle-legend');
      element.innerHTML = '<strong>Vehicles</strong>' + legendVehicles.map(function (vehicle) {
        return '<label><input type="checkbox" value="' + escapeHtml(vehicle.id) + '"' + (vehicle.selected ? ' checked' : '') + '><i style="background:' + vehicle.color + '"></i><span>' + escapeHtml(vehicle.name) + '</span></label>';
      }).join('') + '<small>Tick or untick vehicles to update these results.</small>';
      L.DomEvent.disableClickPropagation(element);
      L.DomEvent.disableScrollPropagation(element);
      Array.from(element.querySelectorAll('input')).forEach(function (checkbox) {
        L.DomEvent.on(checkbox, 'change', function () {
          for (var i = 0; i < elVehicles.options.length; i++) {
            if (elVehicles.options[i].value === checkbox.value) {
              elVehicles.options[i].selected = checkbox.checked;
              break;
            }
          }
          vehicleDropdown.rebuild();
          if (selectedValues(elVehicles).length) {
            displayHeatMap();
          } else {
            resetHeatMapLayer();
            displayMetricMarkers([]);
            displayMetricLegend([]);
            displayVehicleLegend();
            errorHandler('Select at least one vehicle to display results.');
            messageHandler('');
          }
        });
      });
      return element;
    };
    vehicleLegendControl.addTo(map);
  }
  function buildEventMetric(eventInfo, records, roadSpeeds) {
    var logs = validLogRecords(records);
    if (!logs.length) return null;
    var name = eventInfo.rule.name || 'Exception';
    var lowerName = name.toLowerCase();
    var event = eventInfo.event;
    var durationMs = Math.max(0, new Date(event.activeTo || event.activeFrom) - new Date(event.activeFrom));
    var chosen = logs[Math.floor(logs.length / 2)];
    var peakSpeed = null;
    var label = formatDuration(durationMs);
    var detail = 'Duration: ' + label;
    var kind = 'duration';
    var speedLimit = null;
    if (lowerName.indexOf('speed') > -1) {
      var bestExcess = -Infinity;
      var maxSpeed = -Infinity;
      var bestLimit = null;
      logs.forEach(function (log) {
        var speed = Number(log.speed);
        if (!Number.isFinite(speed)) return;
        if (speed > maxSpeed) {
          maxSpeed = speed;
          chosen = log;
        }
        var limit = roadLimitAt(roadSpeeds || [], log.dateTime);
        if (limit != null && speed - limit > bestExcess) {
          bestExcess = speed - limit;
          bestLimit = limit;
          chosen = log;
        }
      });
      if (Number.isFinite(maxSpeed)) peakSpeed = Math.round(maxSpeed);
      if (bestLimit != null && bestExcess > -Infinity) {
        speedLimit = Math.round(bestLimit);
        label = (bestExcess >= 0 ? '+' : '') + Math.round(bestExcess) + ' km/h';
        detail = 'Peak exceedance: ' + label + ' (vehicle ' + Math.round(Number(chosen.speed)) + ' km/h; posted limit ' + Math.round(bestLimit) + ' km/h)';
      } else {
        label = Math.round(maxSpeed) + ' km/h';
        detail = 'Peak vehicle speed: ' + label + ' (posted limit unavailable)';
      }
      kind = 'speed';
    } else if (lowerName.indexOf('idl') > -1) {
      // Idling is measured by how long the engine ran stationary; the cost is
      // applied later so the editable fuel burn and price stay live.
      kind = 'idle';
      detail = 'Idle duration: ' + label;
    } else if (lowerName.indexOf('harsh') > -1 || lowerName.indexOf('hard acceleration') > -1) {
      var bestG = 0;
      var hasForceSample = false;
      for (var i = 1; i < logs.length; i++) {
        var elapsed = (new Date(logs[i].dateTime) - new Date(logs[i - 1].dateTime)) / 1000;
        if (!(elapsed > 0 && elapsed <= 60)) continue;
        var g = void 0;
        if (lowerName.indexOf('corner') > -1 && i < logs.length - 1) {
          var nextElapsed = (new Date(logs[i + 1].dateTime) - new Date(logs[i].dateTime)) / 1000;
          if (!(nextElapsed > 0 && nextElapsed <= 60)) continue;
          var turn = Math.abs(normalizedAngle(bearingRadians(logs[i], logs[i + 1]) - bearingRadians(logs[i - 1], logs[i])));
          g = Number(logs[i].speed) / 3.6 * turn / ((elapsed + nextElapsed) / 2) / 9.80665;
        } else {
          var acceleration = (Number(logs[i].speed) - Number(logs[i - 1].speed)) / 3.6 / elapsed / 9.80665;
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
        detail = 'Peak calculated ' + (lowerName.indexOf('corner') > -1 ? 'lateral' : 'longitudinal') + ' force: ' + label;
        kind = 'force';
      } else {
        label = 'N/A';
        detail = 'G-force unavailable from the GPS samples';
        kind = 'unavailable';
      }
    }
    var distance = Number(event.distance);
    var secondary = 'Duration: ' + formatDuration(durationMs) + (Number.isFinite(distance) ? '; distance: ' + distance.toFixed(2) + ' km' : '');
    return {
      lat: Number(chosen.latitude),
      lon: Number(chosen.longitude),
      label: label,
      kind: kind,
      durationMs: durationMs,
      speedLimit: speedLimit,
      vehicleSpeed: Number.isFinite(Number(chosen.speed)) ? Math.round(Number(chosen.speed)) : peakSpeed,
      ruleName: name,
      vehicleName: eventInfo.vehicleName,
      color: eventInfo.color,
      popup: '<strong>' + escapeHtml(name) + '</strong><br>' + escapeHtml(eventInfo.vehicleName) + '<br>' + escapeHtml(detail) + '<br>' + escapeHtml(secondary) + '<br>' + escapeHtml(new Date(event.activeFrom).toLocaleString())
    };
  }
  function schoolZoneRings(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  /**
   * Converts an NZTA speed limit zone feature into the compact shape the
   * overlay and the point-in-zone test need, including a bounding box so most
   * zones can be rejected without walking their rings.
   * @param {object} feature - A GeoJSON feature from the speed limit register.
   */
  function normalizeSchoolZone(feature) {
    var rings = schoolZoneRings(feature && feature.geometry);
    if (!rings.length) return null;
    var properties = feature.properties || {};
    var minLat = Infinity;
    var maxLat = -Infinity;
    var minLon = Infinity;
    var maxLon = -Infinity;
    rings.forEach(function (polygon) {
      (polygon[0] || []).forEach(function (position) {
        var lon = Number(position[0]);
        var lat = Number(position[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      });
    });
    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
    var numeric = function numeric(value) {
      var parsed = Number(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    return {
      id: String(properties.OBJECTID != null ? properties.OBJECTID : properties.GlobalID || Math.random()),
      name: properties.speedLimitZoneName || properties.rcaZoneReferenceName || 'Speed limit zone',
      category: properties.speedCategoryName || '',
      reason: properties.speedLimitZoneReasonName || '',
      isSchool: properties.speedLimitZoneReasonName === SCHOOL_ZONE_REASON,
      limit: numeric(properties.speedLimitZoneValue),
      minLimit: numeric(properties.speedLimitZoneMinValue),
      maxLimit: numeric(properties.speedLimitZoneMaxValue),
      period: properties.speedLimitZoneVarPrdDesc || '',
      rings: rings,
      bbox: [minLat, minLon, maxLat, maxLon],
      feature: {
        type: 'Feature',
        geometry: feature.geometry,
        properties: properties
      }
    };
  }

  /**
   * The limit a school zone enforces while it is active. Variable zones publish
   * the school-hours limit as their minimum value (for example 40 km/h inside a
   * 50 km/h street), so that is the limit school-zone speeding is measured
   * against.
   * @param {object} zone - A normalized school zone.
   */
  function schoolZoneLimit(zone) {
    if (!zone) return null;
    if (zone.minLimit != null) return zone.minLimit;
    return zone.limit;
  }
  function pointInRing(lat, lon, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var lonI = Number(ring[i][0]);
      var latI = Number(ring[i][1]);
      var lonJ = Number(ring[j][0]);
      var latJ = Number(ring[j][1]);
      if (latI > lat !== latJ > lat && lon < (lonJ - lonI) * (lat - latI) / (latJ - latI) + lonI) {
        inside = !inside;
      }
    }
    return inside;
  }
  function pointInSpeedZone(lat, lon, zone) {
    if (lat < zone.bbox[0] || lat > zone.bbox[2] || lon < zone.bbox[1] || lon > zone.bbox[3]) return false;
    return zone.rings.some(function (polygon) {
      if (!polygon.length || !pointInRing(lat, lon, polygon[0])) return false;
      for (var hole = 1; hole < polygon.length; hole++) {
        if (pointInRing(lat, lon, polygon[hole])) return false;
      }
      return true;
    });
  }
  function schoolZoneAt(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    for (var i = 0; i < schoolZones.length; i++) {
      if (pointInSpeedZone(lat, lon, schoolZones[i])) return schoolZones[i];
    }
    return null;
  }
  function speedZoneColor(zone) {
    var limit = schoolZoneLimit(zone);
    return SPEED_ZONE_COLORS[limit] || '#8492a6';
  }
  function describeSchoolZone(zone) {
    var limit = schoolZoneLimit(zone);
    var parts = [zone.name];
    if (limit != null) parts.push(limit + ' km/h ' + (zone.isSchool ? 'school zone' : 'zone'));
    if (zone.category) parts.push(zone.category.toLowerCase() + ' limit');
    if (zone.reason && !zone.isSchool) parts.push(zone.reason.toLowerCase());
    if (zone.period) parts.push(zone.period);
    return parts.join(' \u2022 ');
  }

  /**
   * Tags every mapped event with the school zone it falls inside, so the sign,
   * callout and popup can report the school-zone limit instead of only the
   * posted road limit.
   */
  function annotateMetricsWithSchoolZones() {
    metricMapData.forEach(function (metric) {
      var zone = schoolZones.length ? schoolZoneAt(metric.lat, metric.lon) : null;
      metric.schoolZone = zone;
      var limit = schoolZoneLimit(zone);
      metric.schoolZoneLimit = limit;
      // Only speeding events carry a meaningful peak speed, so other rule
      // types are reported as inside the zone without being called speeding.
      metric.schoolZoneSpeeding = !!(zone && limit != null && metric.kind === 'speed' && Number.isFinite(metric.vehicleSpeed) && metric.vehicleSpeed > limit);
    });
  }
  /**
   * Parses a MyGeotab duration ("00:00:16") into seconds.
   * @param {string} value - The duration to parse.
   */
  function durationSeconds(value) {
    var parts = String(value == null ? '' : value).split(':');
    if (parts.length !== 3) return null;
    var seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  /**
   * One entry per Risk Management band: the three configured triggers produce
   * four bands, the first being everything below the slowest trigger.
   */
  function speedBands() {
    if (!speedBandTriggers.length) return [];
    return speedBandTriggers.map(function (trigger, index) {
      var next = speedBandTriggers[index + 1];
      return {
        index: index + 1,
        chip: String(trigger),
        label: next ? trigger + '\u2013' + (next - 1) + ' km/h' : trigger + '+ km/h',
        color: SPEED_BAND_COLORS[Math.min(index + 1, SPEED_BAND_COLORS.length - 1)]
      };
    }).concat([{
      index: 0,
      chip: '<' + speedBandTriggers[0],
      label: 'Under ' + speedBandTriggers[0] + ' km/h',
      color: SPEED_BAND_COLORS[0]
    }]).sort(function (a, b) {
      return a.index - b.index;
    });
  }
  function speedBandByIndex(index) {
    return speedBands().filter(function (band) {
      return band.index === index;
    })[0] || null;
  }

  /**
   * The band a speed falls in: 0 below the first trigger, then one band per
   * trigger reached.
   * @param {number} speed - Vehicle speed in km/h.
   */
  function speedBandIndex(speed) {
    if (!speedBandTriggers.length || !Number.isFinite(speed)) return null;
    var index = 0;
    speedBandTriggers.forEach(function (trigger, position) {
      if (speed >= trigger) index = position + 1;
    });
    return index;
  }

  /**
   * Stores the database's Risk Management bands and shows them in the picker.
   * @param {object|Array} settings - The SystemSettings result.
   */
  function applySpeedBandSettings(settings) {
    var record = Array.isArray(settings) ? settings[0] : settings;
    speedBandTriggers = ((record && record.speedingTrigger) || []).map(Number).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    }).sort(function (a, b) {
      return a - b;
    });
    speedBandGraceSeconds = durationSeconds(record && record.speedingGraceDuration);
    selectedSpeedBands = speedBands().map(function (band) {
      return band.index;
    });
    buildSpeedBandPicker();
    annotateMetricsWithSpeedBands();
    renderMetricMarkers();
    updateMapEventTotal();
  }
  function setSpeedBandStatus(text) {
    if (elSpeedBandStatus) elSpeedBandStatus.textContent = text || '';
  }

  /**
   * Renders one chip per Risk Management band; unticking a band removes its
   * events from the map, the legend and the totals.
   */
  function buildSpeedBandPicker() {
    if (!elSpeedBands) return;
    elSpeedBands.innerHTML = '';
    var bands = speedBands();
    if (!bands.length) {
      setSpeedBandStatus('Speed bands unavailable \u2014 MyGeotab did not return the Risk Management settings for this database.');
      return;
    }
    bands.forEach(function (band) {
      var label = document.createElement('label');
      label.className = 'speed-zone-category';
      label.style.setProperty('--zone-color', band.color);
      label.title = band.label;
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(band.index);
      input.checked = selectedSpeedBands.indexOf(band.index) !== -1;
      input.addEventListener('change', function () {
        selectedSpeedBands = Array.prototype.slice.call(elSpeedBands.querySelectorAll('input:checked')).map(function (checked) {
          return Number(checked.value);
        });
        displayMetricLegend(metricMapData);
        renderMetricMarkers();
        updateMapEventTotal();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(band.chip));
      elSpeedBands.appendChild(label);
    });
    setSpeedBandStatus('Risk Management bands from your database: ' + speedBandTriggers.join(' / ') + ' km/h' + (speedBandGraceSeconds != null ? ', ' + speedBandGraceSeconds + 's grace' : '') + '. Untick a band to hide its events.');
  }

  /**
   * Tags every mapped event with the Risk Management band its speed falls in.
   */
  function annotateMetricsWithSpeedBands() {
    metricMapData.forEach(function (metric) {
      metric.speedBand = speedBandIndex(metric.vehicleSpeed);
    });
  }

  /**
   * Ranks each vehicle's fastest speeding events so the worst few can be
   * singled out: rank 1 is that vehicle's highest speed, and events outside its
   * top five carry no rank.
   */
  function annotateMetricsWithTopSpeeding() {
    var byVehicle = {};
    metricMapData.forEach(function (metric) {
      metric.topSpeedingRank = null;
      if (metric.kind !== 'speed' || !Number.isFinite(metric.vehicleSpeed)) return;
      var key = metric.vehicleName || '';
      if (!byVehicle[key]) byVehicle[key] = [];
      byVehicle[key].push(metric);
    });
    Object.keys(byVehicle).forEach(function (key) {
      byVehicle[key].sort(function (a, b) {
        return b.vehicleSpeed - a.vehicleSpeed;
      }).slice(0, TOP_SPEEDING_PER_VEHICLE).forEach(function (metric, position) {
        metric.topSpeedingRank = position + 1;
      });
    });
  }
  function topSpeedingFilterActive() {
    return !!(elTopSpeedingOnly && elTopSpeedingOnly.checked);
  }
  function topIdlingFilterActive() {
    return !!(elTopIdlingOnly && elTopIdlingOnly.checked);
  }

  /**
   * The two ring-fence toggles are additive: with both ticked the map keeps each
   * vehicle's worst speeding events and its costliest idling events.
   * @param {object} metric - A mapped exception event.
   */
  function metricPassesRankFilters(metric) {
    var speedingOnly = topSpeedingFilterActive();
    var idlingOnly = topIdlingFilterActive();
    if (!speedingOnly && !idlingOnly) return true;
    if (speedingOnly && metric.topSpeedingRank) return true;
    if (idlingOnly && metric.topIdlingRank) return true;
    return false;
  }
  function ruleIsSpeeding(rule) {
    var name = String((rule && rule.name) || '').toLowerCase();
    var id = String((rule && rule.id) || '');
    return name.indexOf('speed') > -1 || id.indexOf('Speeding') > -1;
  }

  /**
   * Idling covers both plain idling rules and the built-in preventable idling
   * rule, which is the one the idling dashboard defaults to.
   * @param {object} rule - A MyGeotab Rule.
   */
  function ruleIsIdling(rule) {
    var name = String((rule && rule.name) || '').toLowerCase();
    var id = String((rule && rule.id) || '');
    return name.indexOf('idl') > -1 || id.indexOf('Idling') > -1;
  }
  function positiveNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  function idleFuelBurn() {
    return positiveNumber(elIdleFuelBurn && elIdleFuelBurn.value, IDLE_DEFAULT_FUEL_BURN);
  }
  function idleFuelPrice() {
    return positiveNumber(elIdleFuelPrice && elIdleFuelPrice.value, IDLE_DEFAULT_FUEL_PRICE);
  }
  function idleMinMinutes() {
    return positiveNumber(elIdleMinMinutes && elIdleMinMinutes.value, 0);
  }
  function metricPassesIdleDurationFilter(metric) {
    if (metric.kind !== 'idle') return true;
    var minimum = idleMinMinutes();
    if (!minimum) return true;
    return (metric.idleMinutes || 0) >= minimum;
  }

  /**
   * Costs every idling event from the editable fuel burn and price, then ranks
   * each vehicle's costliest events. Only events long enough to pass the minimum
   * duration are ranked, so the ring-fence follows the selected duration.
   */
  function annotateMetricsWithIdling() {
    var burn = idleFuelBurn();
    var price = idleFuelPrice();
    var byVehicle = {};
    var totalHours = 0;
    var totalCost = 0;
    var idlingCount = 0;
    metricMapData.forEach(function (metric) {
      metric.topIdlingRank = null;
      if (metric.kind !== 'idle') return;
      var hours = Math.max(0, Number(metric.durationMs) || 0) / 3600000;
      metric.idleMinutes = hours * 60;
      metric.idleLitres = hours * burn;
      metric.idleCost = metric.idleLitres * price;
      metric.label = Math.round(metric.idleMinutes) + ' min \u2022 $' + metric.idleCost.toFixed(2);
      if (!metricPassesIdleDurationFilter(metric)) return;
      idlingCount++;
      totalHours += hours;
      totalCost += metric.idleCost;
      var key = metric.vehicleName || '';
      if (!byVehicle[key]) byVehicle[key] = [];
      byVehicle[key].push(metric);
    });
    Object.keys(byVehicle).forEach(function (key) {
      byVehicle[key].sort(function (a, b) {
        return b.idleCost - a.idleCost;
      }).slice(0, TOP_IDLING_PER_VEHICLE).forEach(function (metric, position) {
        metric.topIdlingRank = position + 1;
      });
    });
    setIdleCostStatus(idlingCount ? idlingCount + ' idling event' + (idlingCount === 1 ? '' : 's') + ' \u2022 ' + totalHours.toFixed(1) + ' idle hours \u2022 $' + totalCost.toFixed(2) + ' at ' + burn + ' L/h and $' + price.toFixed(2) + '/L.' : 'Select idling rule(s) and show results to cost idling events at ' + burn + ' L/h and $' + price.toFixed(2) + '/L.');
  }
  function setIdleCostStatus(text) {
    if (elIdleCostStatus) elIdleCostStatus.textContent = text || '';
  }

  /**
   * Recosts and redraws idling after a rate or duration change, without
   * refetching anything from MyGeotab.
   */
  /**
   * The rules to query: the speeding and idling sections plus whatever is picked
   * in the generic rule dropdown.
   */
  function selectedExceptionRules() {
    var rules = [];
    [elSpeedingRules, elIdlingRules, elExceptionTypes].forEach(function (select) {
      if (!select) return;
      Array.prototype.slice.call(select.options).forEach(function (option) {
        if (option.selected && !option.disabled && option.value) {
          rules.push({
            id: option.value,
            name: option.text
          });
        }
      });
    });
    return rules;
  }
  function refreshIdlingPresentation() {
    annotateMetricsWithIdling();
    displayMetricLegend(metricMapData);
    renderMetricMarkers();
    updateMapEventTotal();
  }
  function describeSpeedBand(metric) {
    var band = metric.speedBand == null ? null : speedBandByIndex(metric.speedBand);
    if (!band) return '';
    return (band.index === 0 ? 'Below band 1' : 'Speed band ' + band.index) + ' (' + band.label + ')';
  }

  /**
   * Only filters once a band has actually been unticked, so a database without
   * Risk Management settings behaves as before.
   */
  function speedBandFilterActive() {
    var bands = speedBands();
    return !!(bands.length && selectedSpeedBands.length && selectedSpeedBands.length < bands.length);
  }
  function metricPassesBandFilter(metric) {
    if (!speedBandFilterActive()) return true;
    if (metric.speedBand == null) return false;
    return selectedSpeedBands.indexOf(metric.speedBand) !== -1;
  }

  /**
   * Every filter an event has to pass to be drawn and counted.
   * @param {object} metric - A mapped exception event.
   */
  function metricPassesFilters(metric) {
    return metricPassesZoneFilter(metric) && metricPassesBandFilter(metric) && metricPassesIdleDurationFilter(metric) && metricPassesRankFilters(metric);
  }
  function schoolZoneSpeedingCount() {
    return metricMapData.filter(function (metric) {
      return metric.schoolZoneSpeeding;
    }).length;
  }
  function zoneEventCount() {
    return metricMapData.filter(function (metric) {
      return !!metric.schoolZone;
    }).length;
  }

  /**
   * True when the event should be drawn: either no zone filter is active, or the
   * event falls inside one of the loaded zones for the selected categories.
   * @param {object} metric - A mapped exception event.
   */
  function metricPassesZoneFilter(metric) {
    if (!zoneFilterActive()) return true;
    return !!metric.schoolZone;
  }

  /**
   * The filter can only be honoured once zones are loadable: below the minimum
   * zoom no zone is known, so filtering would hide every event instead.
   */
  function zoneFilterActive() {
    if (!elEventsInZonesOnly || !elEventsInZonesOnly.checked) return false;
    if (!elShowSchoolZones || !elShowSchoolZones.checked) return false;
    return !(map && map.getZoom() < SCHOOL_ZONE_MIN_ZOOM);
  }

  /**
   * Renders the posted-limit category chips and keeps the selection in sync.
   */
  function buildSpeedZoneCategoryPicker() {
    if (!elSpeedZoneCategories) return;
    elSpeedZoneCategories.innerHTML = '';
    SPEED_ZONE_CATEGORIES.forEach(function (limit) {
      var label = document.createElement('label');
      label.className = 'speed-zone-category';
      label.style.setProperty('--zone-color', SPEED_ZONE_COLORS[limit]);
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(limit);
      input.checked = selectedZoneCategories.indexOf(limit) !== -1;
      input.addEventListener('change', function () {
        selectedZoneCategories = Array.prototype.slice.call(elSpeedZoneCategories.querySelectorAll('input:checked')).map(function (checked) {
          return Number(checked.value);
        });
        resetSpeedZoneCache();
        syncSchoolZoneVisibility();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(String(limit)));
      elSpeedZoneCategories.appendChild(label);
    });
  }

  /**
   * Zones already fetched belong to the previous category selection, so they are
   * dropped whenever the selection changes.
   */
  function resetSpeedZoneCache() {
    schoolZones = [];
    schoolZoneById = {};
    schoolZoneRequestId++;
    // Events keep a reference to the zone they were in, which no longer applies.
    annotateMetricsWithSchoolZones();
  }
  /**
   * A category is the limit a zone actually enforces. Variable zones publish
   * that as their minimum value ("40 km/h" inside a 50 km/h street), so those
   * are matched on the minimum and only zones without one fall back to the
   * headline value.
   */
  function speedZoneWhereClause() {
    var clauses = [];
    if (selectedZoneCategories.length) {
      var values = selectedZoneCategories.map(function (limit) {
        return "'" + limit + "'";
      }).join(',');
      var minimums = selectedZoneCategories.map(function (limit) {
        return "'" + limit + " km/h'";
      }).join(',');
      clauses.push('(speedLimitZoneMinValue IN (' + minimums + ') OR (speedLimitZoneMinValue IS NULL AND speedLimitZoneValue IN (' + values + ')))');
    } else {
      // An empty selection would otherwise pull every zone in the view.
      clauses.push('1=0');
    }
    if (elSchoolZonesOnly && elSchoolZonesOnly.checked) {
      clauses.push("speedLimitZoneReasonName='" + SCHOOL_ZONE_REASON + "'");
    }
    return clauses.join(' AND ');
  }
  function setSchoolZoneStatus(text) {
    if (elSchoolZoneStatus) elSchoolZoneStatus.textContent = text || '';
  }
  function renderSchoolZoneLayer() {
    if (schoolZoneLayer) {
      map.removeLayer(schoolZoneLayer);
      schoolZoneLayer = null;
    }
    if (!elShowSchoolZones || !elShowSchoolZones.checked || !schoolZones.length) return;
    schoolZoneLayer = L.geoJSON(schoolZones.map(function (zone) {
      return zone.feature;
    }), {
      pane: 'overlayPane',
      style: function style(feature) {
        var zone = schoolZoneById[String(feature.properties.OBJECTID)];
        var color = zone ? speedZoneColor(zone) : '#8492a6';
        return {
          color: color,
          weight: zone && zone.isSchool ? 3 : 2,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.18,
          dashArray: zone && zone.isSchool ? null : '4 3'
        };
      },
      onEachFeature: function onEachFeature(feature, layer) {
        var zone = schoolZoneById[String(feature.properties.OBJECTID)];
        if (!zone) return;
        layer.bindTooltip(escapeHtml(describeSchoolZone(zone)), {
          sticky: true
        });
        layer.bindPopup('<strong>' + escapeHtml(zone.name) + '</strong><br>' + escapeHtml((schoolZoneLimit(zone) != null ? schoolZoneLimit(zone) + ' km/h' : 'Limit unavailable') + (zone.category ? ' (' + zone.category + ')' : '')) + (zone.period ? '<br>' + escapeHtml(zone.period) : '') + '<br><small>NZTA National Speed Limit Register</small>');
      }
    }).addTo(map);
    if (schoolZoneLayer.bringToBack) schoolZoneLayer.bringToBack();
  }
  function displaySchoolZoneLegend() {
    if (schoolZoneLegendControl) {
      map.removeControl(schoolZoneLegendControl);
      schoolZoneLegendControl = null;
    }
    if (!elShowSchoolZones || !elShowSchoolZones.checked) return;
    var speedingCount = schoolZoneSpeedingCount();
    var countsByLimit = {};
    schoolZones.forEach(function (zone) {
      var limit = schoolZoneLimit(zone);
      if (limit == null) return;
      countsByLimit[limit] = (countsByLimit[limit] || 0) + 1;
    });
    schoolZoneLegendControl = L.control({
      position: 'bottomright'
    });
    schoolZoneLegendControl.onAdd = function () {
      var element = L.DomUtil.create('div', 'school-zone-legend');
      var rows = SPEED_ZONE_CATEGORIES.filter(function (limit) {
        return countsByLimit[limit];
      }).map(function (limit) {
        return '<span><i style="--zone-color:' + SPEED_ZONE_COLORS[limit] + '"></i>' + limit + ' km/h <b>' + formatNumber(countsByLimit[limit]) + '</b></span>';
      }).join('');
      element.innerHTML = '<strong><i></i>Speed limit zones</strong>' + (rows || '<span>No zones loaded for this view</span>') + '<span><b>' + formatNumber(zoneEventCount()) + '</b> mapped events inside these zones</span>' + '<span><b>' + formatNumber(speedingCount) + '</b> over the zone limit</span>' + '<small>Zones and limits from the NZTA National Speed Limit Register. Variable zones (school periods for example) only apply during their posted hours, so check the zone tooltip before acting on an event.</small>';
      L.DomEvent.disableClickPropagation(element);
      return element;
    };
    schoolZoneLegendControl.addTo(map);
  }

  /**
   * Loads the school zones intersecting the current map view from the NZTA
   * feature service, keeping zones already fetched for neighbouring views.
   */
  function loadSchoolZonesForView() {
    if (!map || !elShowSchoolZones || !elShowSchoolZones.checked) return Promise.resolve();
    if (map.getZoom() < SCHOOL_ZONE_MIN_ZOOM) {
      setSchoolZoneStatus('Zoom in to load speed zones (zoom 11 or closer).' + (elEventsInZonesOnly && elEventsInZonesOnly.checked ? ' The zone filter is suspended until then, so every event stays on the map.' : ''));
      renderMetricMarkers();
      updateMapEventTotal();
      return Promise.resolve();
    }
    if (!selectedZoneCategories.length) {
      setSchoolZoneStatus('Select at least one speed zone category.');
      renderMetricMarkers();
      updateMapEventTotal();
      return Promise.resolve();
    }
    var bounds = map.getBounds();
    var requestId = ++schoolZoneRequestId;
    setSchoolZoneStatus('Loading speed zones\u2026');
    toggleZoneLoading(true);
    var parameters = ['where=' + encodeURIComponent(speedZoneWhereClause()), 'geometry=' + encodeURIComponent([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',')), 'geometryType=esriGeometryEnvelope', 'spatialRel=esriSpatialRelIntersects', 'inSR=4326', 'outSR=4326', 'outFields=' + encodeURIComponent('OBJECTID,speedLimitZoneName,rcaZoneReferenceName,speedCategoryName,speedLimitZoneReasonName,speedLimitZoneValue,speedLimitZoneMinValue,speedLimitZoneMaxValue,speedLimitZoneVarPrdDesc'), 'resultRecordCount=' + SCHOOL_ZONE_PAGE_SIZE, 'returnGeometry=true', 'f=geojson'].join('&');
    return fetch(SCHOOL_ZONE_SERVICE_URL + '?' + parameters, {
      credentials: 'omit'
    }).then(function (response) {
      if (!response.ok) throw new Error('NZTA speed limit service returned ' + response.status);
      return response.json();
    }).then(function (collection) {
      if (requestId !== schoolZoneRequestId) return;
      toggleZoneLoading(false);
      var added = 0;
      (collection.features || []).forEach(function (feature) {
        var zone = normalizeSchoolZone(feature);
        if (!zone || schoolZoneById[zone.id]) return;
        schoolZoneById[zone.id] = zone;
        schoolZones.push(zone);
        added++;
      });
      if (schoolZones.length > SCHOOL_ZONE_MAX_CACHED) {
        schoolZones.splice(0, schoolZones.length - SCHOOL_ZONE_MAX_CACHED).forEach(function (zone) {
          delete schoolZoneById[zone.id];
        });
      }
      annotateMetricsWithSchoolZones();
      renderSchoolZoneLayer();
      displaySchoolZoneLegend();
      renderMetricMarkers();
      updateMapEventTotal();
      var speedingCount = schoolZoneSpeedingCount();
      if (!schoolZones.length) {
        var schoolOnly = elSchoolZonesOnly && elSchoolZonesOnly.checked;
        setSchoolZoneStatus('No ' + selectedZoneCategories.join('/') + ' km/h ' + (schoolOnly ? 'school ' : '') + 'zones in this view \u2014 ' + (schoolOnly ? 'untick School zones only or select more categories.' : 'select more speed zone categories.'));
        return;
      }
      setSchoolZoneStatus(formatNumber(schoolZones.length) + ' speed zones loaded' + (added ? '' : ' (no new zones in this view)') + '; ' + formatNumber(zoneEventCount()) + ' mapped events inside them, ' + formatNumber(speedingCount) + ' over the zone limit.');
    })['catch'](function (error) {
      if (requestId !== schoolZoneRequestId) return;
      toggleZoneLoading(false);
      setSchoolZoneStatus('Speed zones unavailable: ' + (error && error.message ? error.message : 'request failed') + '.');
    });
  }
  function scheduleSchoolZoneReload() {
    if (!elShowSchoolZones || !elShowSchoolZones.checked) return;
    if (schoolZoneReloadTimer) clearTimeout(schoolZoneReloadTimer);
    schoolZoneReloadTimer = setTimeout(function () {
      schoolZoneReloadTimer = null;
      loadSchoolZonesForView();
    }, 400);
  }
  function syncSchoolZoneVisibility() {
    if (!elShowSchoolZones) return;
    if (!elShowSchoolZones.checked) {
      schoolZoneRequestId++;
      toggleZoneLoading(false);
      setSchoolZoneStatus('');
      renderSchoolZoneLayer();
      displaySchoolZoneLegend();
      annotateMetricsWithSchoolZones();
      renderMetricMarkers();
      updateMapEventTotal();
      return;
    }
    renderSchoolZoneLayer();
    displaySchoolZoneLegend();
    loadSchoolZonesForView();
  }
  function displayMetricLegend(metrics) {
    if (metricLegendControl) map.removeControl(metricLegendControl);
    var rules = [];
    var seen = {};
    (metrics || []).forEach(function (metric) {
      if (!seen[metric.ruleName]) {
        seen[metric.ruleName] = {
          name: metric.ruleName,
          count: 0
        };
        rules.push(seen[metric.ruleName]);
      }
      seen[metric.ruleName].count++;
    });
    if (!rules.length) return;
    metricLegendControl = L.control({
      position: 'topright'
    });
    metricLegendControl.onAdd = function () {
      var element = L.DomUtil.create('div', 'metric-legend');
      element.innerHTML = '<strong>Exception legend</strong>' + rules.map(function (rule) {
        return '<span>' + escapeHtml(rule.name) + ' <b>' + formatNumber(rule.count) + '</b></span>';
      }).join('') + speedBandLegendRows() + topSpeedingLegendRow() + idlingLegendRows() + '<label class="metric-detail-toggle"><input type="checkbox"> Show event details</label>' + '<small>Event marker colours match the vehicle legend, their ring shows the Risk Management speed band, and speeding events also show the posted limit as a road sign. Heat colouring can be toggled separately in the Exceptions controls.</small>';
      L.DomEvent.disableClickPropagation(element);
      var toggle = element.querySelector('input');
      toggle.checked = metricDetailsVisible;
      L.DomEvent.on(toggle, 'change', function () {
        metricDetailsVisible = toggle.checked;
        renderMetricMarkers();
      });
      return element;
    };
    metricLegendControl.addTo(map);
  }
  /**
   * Band counts for the legend, using the same band filter as the map so the
   * numbers match what is drawn.
   */
  function speedBandLegendRows() {
    var bands = speedBands();
    if (!bands.length) return '';
    var rows = bands.map(function (band) {
      var count = metricMapData.filter(function (metric) {
        return metric.speedBand === band.index && metricPassesZoneFilter(metric);
      }).length;
      var muted = selectedSpeedBands.indexOf(band.index) === -1;
      return '<span class="speed-band-row' + (muted ? ' is-muted' : '') + '"><i style="--zone-color:' + band.color + '"></i>' + escapeHtml(band.label) + ' <b>' + formatNumber(count) + '</b></span>';
    }).join('');
    return '<strong class="speed-band-heading">Speed bands</strong>' + rows;
  }

  /**
   * How many of each vehicle's five worst speeding events are on the map, so
   * the ringed markers can be read against a count.
   */
  function topSpeedingLegendRow() {
    var ranked = metricMapData.filter(function (metric) {
      return metric.topSpeedingRank && metricPassesZoneFilter(metric) && metricPassesBandFilter(metric);
    });
    if (!ranked.length) return '';
    var vehicles = {};
    ranked.forEach(function (metric) {
      vehicles[metric.vehicleName || ''] = true;
    });
    return '<span class="top-speeding-row' + (topSpeedingFilterActive() ? ' is-only' : '') + '">Top ' + TOP_SPEEDING_PER_VEHICLE + ' speeding per vehicle <b>' + formatNumber(ranked.length) + '</b> across ' + formatNumber(Object.keys(vehicles).length) + ' vehicles</span>';
  }

  /**
   * Idle hours and their fuel cost for the events the map is showing, plus how
   * many of each vehicle's costliest events are ringed.
   */
  function idlingLegendRows() {
    var idling = metricMapData.filter(function (metric) {
      return metric.kind === 'idle' && metricPassesZoneFilter(metric) && metricPassesIdleDurationFilter(metric);
    });
    if (!idling.length) return '';
    var hours = idling.reduce(function (sum, metric) {
      return sum + (metric.idleMinutes || 0) / 60;
    }, 0);
    var cost = idling.reduce(function (sum, metric) {
      return sum + (metric.idleCost || 0);
    }, 0);
    var ranked = idling.filter(function (metric) {
      return metric.topIdlingRank;
    });
    var minimum = idleMinMinutes();
    return '<strong class="speed-band-heading">Idling</strong>' + '<span>' + formatNumber(idling.length) + ' events • ' + hours.toFixed(1) + ' h <b>$' + cost.toFixed(2) + '</b></span>' + (minimum ? '<span>Minimum ' + minimum + ' min per event</span>' : '') + '<span class="top-idling-row' + (topIdlingFilterActive() ? ' is-only' : '') + '">Top ' + TOP_IDLING_PER_VEHICLE + ' costliest per vehicle <b>' + formatNumber(ranked.length) + '</b></span>';
  }

  // A roundel of the posted limit sits above each mapped speeding event. Events
  // cluster on the same stretch of road, so a sign is skipped when an identical
  // limit is already drawn within 46px of it.
  function addSpeedLimitSign(metric, acceptedSignPoints) {
    // Inside an overlaid zone that zone's limit is the one that matters, so it
    // wins over the posted road limit on the sign.
    var limit = metric.schoolZoneLimit != null ? metric.schoolZoneLimit : metric.speedLimit;
    if (limit == null) return;
    var inSchoolZone = metric.schoolZoneLimit != null && metric.schoolZone && metric.schoolZone.isSchool;
    var point = map.latLngToContainerPoint([metric.lat, metric.lon]);
    var duplicate = acceptedSignPoints.some(function (other) {
      return other.limit === limit && other.school === inSchoolZone && Math.abs(other.x - point.x) < 46 && Math.abs(other.y - point.y) < 46;
    });
    if (duplicate) return;
    acceptedSignPoints.push({ x: point.x, y: point.y, limit: limit, school: inSchoolZone });
    var sign = L.marker([metric.lat, metric.lon], {
      icon: L.divIcon({
        className: 'speed-limit-sign' + (inSchoolZone ? ' is-school-zone' : ''),
        html: '<span>' + escapeHtml(String(limit)) + '</span>',
        iconSize: [34, 34],
        iconAnchor: [17, 40]
      }),
      interactive: true,
      zIndexOffset: -100
    });
    var tooltip = metric.schoolZoneLimit != null ? (inSchoolZone ? 'School zone limit: ' : 'Zone limit: ') + limit + ' km/h \u2014 ' + describeSchoolZone(metric.schoolZone) + (metric.speedLimit != null ? ' (posted road limit ' + metric.speedLimit + ' km/h)' : '') : 'Posted speed limit: ' + limit + ' km/h';
    sign.bindTooltip(escapeHtml(tooltip), {
      direction: 'top',
      offset: [0, -6]
    });
    sign.addTo(metricMarkerLayer);
  }
  function renderMetricMarkers() {
    if (metricMarkerLayer) map.removeLayer(metricMarkerLayer);
    metricMarkerLayer = L.layerGroup().addTo(map);
    if (!metricMapData.length || !metricDetailsVisible) return;
    var acceptedLabelPoints = [];
    var acceptedSignPoints = [];
    var mapSize = map.getSize();
    metricMapData.forEach(function (metric) {
      if (!map.getBounds().contains(new L.LatLng(metric.lat, metric.lon))) return;
      if (!metricPassesFilters(metric)) return;
      addSpeedLimitSign(metric, acceptedSignPoints);
      var zoneWord = metric.schoolZone && metric.schoolZone.isSchool ? 'school zone' : 'zone';
      var bandText = describeSpeedBand(metric);
      var calloutText = metric.ruleName + " \u2192 " + metric.label + (metric.schoolZoneSpeeding ? ' (' + zoneWord + ')' : '') + (bandText && metric.speedBand > 0 ? ' \u2022 band ' + metric.speedBand : '') + (metric.topSpeedingRank ? ' \u2022 #' + metric.topSpeedingRank + ' fastest for this vehicle' : '') + (metric.topIdlingRank ? ' \u2022 #' + metric.topIdlingRank + ' costliest idling for this vehicle' : '');
      var rank = metric.topSpeedingRank || metric.topIdlingRank;
      var popupHtml = metric.popup + (metric.topSpeedingRank ? '<br><span class="top-speeding-flag">#' + metric.topSpeedingRank + ' fastest speeding event for ' + escapeHtml(metric.vehicleName || 'this vehicle') + '</span>' : '') + (metric.kind === 'idle' ? '<br><span class="idling-flag">' + (metric.topIdlingRank ? '#' + metric.topIdlingRank + ' costliest idling event for ' + escapeHtml(metric.vehicleName || 'this vehicle') + ' \u2014 ' : '') + Math.round(metric.idleMinutes || 0) + ' min idling \u2022 ' + (metric.idleLitres || 0).toFixed(1) + ' L \u2022 $' + (metric.idleCost || 0).toFixed(2) + ' at ' + idleFuelBurn() + ' L/h and $' + idleFuelPrice().toFixed(2) + '/L</span>' : '') + (bandText ? '<br><span class="speed-band-flag">' + escapeHtml(bandText) + (Number.isFinite(metric.vehicleSpeed) ? ' \u2014 vehicle ' + metric.vehicleSpeed + ' km/h' : '') + '</span>' : '') + (metric.schoolZone ? '<br><span class="school-zone-flag">' + (metric.schoolZoneSpeeding ? 'Over the ' + zoneWord + ' limit' : 'Inside a ' + zoneWord) + ': ' + escapeHtml(describeSchoolZone(metric.schoolZone)) + (Number.isFinite(metric.vehicleSpeed) ? ' \u2014 vehicle ' + metric.vehicleSpeed + ' km/h' : '') + '</span>' : '');
      var bandRing = metric.speedBand > 0 ? speedBandByIndex(metric.speedBand) : null;
      var dot = L.circleMarker([metric.lat, metric.lon], {
        radius: rank ? 7 : bandRing ? 5 : 4,
        color: bandRing ? bandRing.color : metric.topSpeedingRank ? '#ffd166' : metric.topIdlingRank ? '#4fc3f7' : '#ffffff',
        weight: rank ? 3 : bandRing ? 2 : 1,
        fillColor: metric.color,
        fillOpacity: 0.95
      });
      dot.bindTooltip(calloutText, {
        direction: 'top',
        offset: [0, -5]
      });
      dot.bindPopup(popupHtml);
      dot.addTo(metricMarkerLayer);
      var point = map.latLngToContainerPoint([metric.lat, metric.lon]);
      var labelPoint = point;
      for (var attempt = 0; attempt < 240; attempt++) {
        var radius = attempt === 0 ? 0 : 28 + Math.sqrt(attempt) * 18;
        var angle = attempt * Math.PI * (3 - Math.sqrt(5));
        var candidate = L.point(Math.max(70, Math.min(mapSize.x - 90, point.x + Math.cos(angle) * radius)), Math.max(32, Math.min(mapSize.y - 38, point.y + Math.sin(angle) * radius)));
        var blockedByLegend = candidate.x > mapSize.x - 220 && candidate.y < 150;
        var overlaps = acceptedLabelPoints.some(function (other) {
          return Math.abs(other.x - candidate.x) < 88 && Math.abs(other.y - candidate.y) < 28;
        });
        labelPoint = candidate;
        if (!overlaps && !blockedByLegend) break;
      }
      acceptedLabelPoints.push(labelPoint);
      var labelLatLng = map.containerPointToLatLng(labelPoint);
      if (labelPoint.distanceTo(point) > 8) {
        L.polyline([[metric.lat, metric.lon], labelLatLng], {
          color: metric.color,
          weight: 1,
          opacity: 0.75,
          interactive: false
        }).addTo(metricMarkerLayer);
      }
      var marker = L.marker(labelLatLng, {
        icon: L.divIcon({
          className: 'event-metric-marker event-metric-' + metric.kind + (metric.topSpeedingRank ? ' is-top-speeding' : '') + (metric.topIdlingRank ? ' is-top-idling' : ''),
          html: '<span style="--rule-color:' + metric.color + "\">\u2192 " + escapeHtml(metric.label) + (metric.schoolZoneSpeeding ? ' \uD83C\uDFEB' : '') + (rank ? '<b class="' + (metric.topSpeedingRank ? 'top-speeding-rank' : 'top-idling-rank') + '">#' + rank + '</b>' : '') + '</span>',
          iconSize: [70, 30],
          iconAnchor: [8, 15]
        })
      });
      marker.bindTooltip(calloutText, {
        direction: 'top',
        offset: [0, -6]
      });
      marker.bindPopup(popupHtml);
      marker.addTo(metricMarkerLayer);
    });
  }
  function displayMetricMarkers(metrics) {
    metricMapData = metrics || [];
    metricDetailsVisible = false;
    annotateMetricsWithSchoolZones();
    annotateMetricsWithSpeedBands();
    annotateMetricsWithTopSpeeding();
    annotateMetricsWithIdling();
    displayMetricLegend(metrics);
    displaySchoolZoneLegend();
    renderMetricMarkers();
    updateMapEventTotal();
  }
  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      var request = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          var store = db.createObjectStore(CACHE_STORE_NAME, {
            keyPath: 'key'
          });
          store.createIndex('lastAccessed', 'lastAccessed', {
            unique: false
          });
        }
      };
      request.onsuccess = function () {
        return resolve(request.result);
      };
      request.onerror = function () {
        return reject(request.error || new Error('Unable to open heatmap cache'));
      };
    });
    return cacheDbPromise;
  }
  function cacheGet(key) {
    return openCacheDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
        var request = transaction.objectStore(CACHE_STORE_NAME).get(key);
        request.onsuccess = function () {
          return resolve(request.result || null);
        };
        request.onerror = function () {
          return reject(request.error);
        };
      });
    }).catch(function () {
      return null;
    });
  }
  function cachePut(record) {
    record.schemaVersion = CACHE_SCHEMA_VERSION;
    record.fetchedAt = Date.now();
    record.lastAccessed = Date.now();
    return openCacheDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
        transaction.objectStore(CACHE_STORE_NAME).put(record);
        transaction.oncomplete = function () {
          return resolve();
        };
        transaction.onerror = function () {
          return reject(transaction.error);
        };
      });
    }).catch(function () {
      return undefined;
    });
  }
  function pruneCache() {
    var cutoff = Date.now() - CACHE_RETENTION_MS;
    return openCacheDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
        var store = transaction.objectStore(CACHE_STORE_NAME);
        var request = store.openCursor();
        request.onsuccess = function (event) {
          var cursor = event.target.result;
          if (!cursor) return;
          var value = cursor.value;
          if (!value || value.schemaVersion !== CACHE_SCHEMA_VERSION || value.lastAccessed < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        };
        request.onerror = function () {
          return reject(request.error);
        };
        transaction.oncomplete = function () {
          return resolve();
        };
        transaction.onerror = function () {
          return reject(transaction.error);
        };
      });
    }).catch(function () {
      return undefined;
    });
  }
  function utcDayChunks(fromMs, toMs) {
    var chunks = [];
    var cursor = new Date(fromMs);
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= toMs) {
      var dayStart = cursor.getTime();
      var dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
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
    var todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (chunk.end < todayStart.getTime()) return true;
    return Date.now() - record.fetchedAt < CACHE_TODAY_TTL_MS;
  }
  function compactLogRecords(logRecords, dayStart, dayEnd) {
    var cells = new Map();
    (logRecords || []).forEach(function (record) {
      var latitude = Number(record.latitude);
      var longitude = Number(record.longitude);
      var time = new Date(record.dateTime).getTime();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 && longitude === 0 || !Number.isFinite(time) || time < dayStart || time > dayEnd) {
        return;
      }
      var minute = Math.floor(time / 60000) * 60000;
      var lat = Math.round(latitude * GRID_MULTIPLIER) / GRID_MULTIPLIER;
      var lon = Math.round(longitude * GRID_MULTIPLIER) / GRID_MULTIPLIER;
      var key = minute + '|' + lat + '|' + lon;
      var existing = cells.get(key);
      if (existing) existing.value += 1;else cells.set(key, {
        t: minute,
        lat: lat,
        lon: lon,
        value: 1
      });
    });
    return Array.from(cells.values());
  }
  function pointsInRange(points, fromMs, toMs) {
    return (points || []).filter(function (point) {
      return point.t >= fromMs && point.t <= toMs;
    });
  }
  function apiMultiCallPromise(calls) {
    if (!calls.length) return Promise.resolve([]);
    return new Promise(function (resolve, reject) {
      api.multiCall(calls, function (results) {
        return resolve(results || []);
      }, reject);
    });
  }
  function runApiCallsInBatches(calls) {
    var output = new Array(calls.length);
    var chain = Promise.resolve();
    var _loop = function _loop() {
      var batchStart = start;
      var batch = calls.slice(start, start + API_BATCH_SIZE);
      chain = chain.then(function () {
        return apiMultiCallPromise(batch);
      }).then(function (results) {
        for (var offset = 0; offset < batch.length; offset++) {
          output[batchStart + offset] = results[offset] || [];
        }
      });
    };
    for (var start = 0; start < calls.length; start += API_BATCH_SIZE) {
      _loop();
    }
    return chain.then(function () {
      return output;
    });
  }
  function buildDailyTasks(mode, deviceIds, ruleId, fromMs, toMs) {
    var days = utcDayChunks(fromMs, toMs);
    var tasks = [];
    deviceIds.forEach(function (deviceId) {
      days.forEach(function (chunk) {
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
    return Promise.all(tasks.map(function (task) {
      return cacheGet(task.key).then(function (record) {
        if (cacheRecordIsFresh(record, task.chunk)) task.record = record;
        return task;
      });
    }));
  }
  function locationHeatData(deviceIds, fromMs, toMs) {
    var tasks = buildDailyTasks('location', deviceIds, null, fromMs, toMs);
    return loadCachedTasks(tasks).then(function () {
      var missing = tasks.filter(function (task) {
        return !task.record;
      });
      var calls = missing.map(function (task) {
        return ['Get', {
          typeName: 'LogRecord',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: task.deviceId
            },
            fromDate: new Date(task.chunk.start).toISOString(),
            toDate: new Date(task.chunk.end).toISOString()
          }
        }];
      });
      return runApiCallsInBatches(calls).then(function (results) {
        return Promise.all(missing.map(function (task, index) {
          var rows = results[index] || [];
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
        })).then(function () {
          var points = [];
          var rawCount = 0;
          var truncatedChunks = 0;
          tasks.forEach(function (task) {
            var selected = pointsInRange(task.record.points, fromMs, toMs);
            points = points.concat(selected);
            rawCount += selected.reduce(function (sum, point) {
              return sum + point.value;
            }, 0);
            if (task.record.truncated) truncatedChunks++;
          });
          return {
            points: points,
            rawCount: rawCount,
            cacheHits: tasks.length - missing.length,
            fetchedChunks: missing.length,
            truncatedChunks: truncatedChunks
          };
        });
      });
    });
  }
  function mergedExceptionWindows(events, dayStart, dayEnd) {
    var windows = (events || []).map(function (event) {
      var from = Math.max(dayStart, new Date(event.activeFrom).getTime());
      var to = Math.min(dayEnd, new Date(event.activeTo || event.activeFrom).getTime());
      return {
        from: from,
        to: Math.max(from, to)
      };
    }).filter(function (window) {
      return Number.isFinite(window.from) && Number.isFinite(window.to);
    }).sort(function (a, b) {
      return a.from - b.from;
    });
    var merged = [];
    windows.forEach(function (window) {
      var previous = merged[merged.length - 1];
      // Merge overlaps and windows within one minute of each other.
      if (previous && window.from <= previous.to + 60000) {
        previous.to = Math.max(previous.to, window.to);
      } else {
        merged.push({
          from: window.from,
          to: window.to
        });
      }
    });
    return merged;
  }
  function exceptionHeatData(deviceIds, ruleId, fromMs, toMs) {
    var tasks = buildDailyTasks('exception', deviceIds, ruleId, fromMs, toMs);
    return loadCachedTasks(tasks).then(function () {
      var missing = tasks.filter(function (task) {
        return !task.record;
      });
      var exceptionCalls = missing.map(function (task) {
        return ['Get', {
          typeName: 'ExceptionEvent',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: task.deviceId
            },
            ruleSearch: {
              id: ruleId
            },
            fromDate: new Date(task.chunk.start).toISOString(),
            toDate: new Date(task.chunk.end).toISOString()
          }
        }];
      });
      return runApiCallsInBatches(exceptionCalls).then(function (exceptionResults) {
        var logCalls = [];
        var logOwners = [];
        missing.forEach(function (task, taskIndex) {
          var events = exceptionResults[taskIndex] || [];
          task.events = events;
          var windows = mergedExceptionWindows(events, task.chunk.start, task.chunk.end);
          windows.forEach(function (window) {
            logOwners.push(taskIndex);
            logCalls.push(['Get', {
              typeName: 'LogRecord',
              resultsLimit: myGeotabGetResultsLimit,
              search: {
                deviceSearch: {
                  id: task.deviceId
                },
                fromDate: new Date(window.from).toISOString(),
                toDate: new Date(window.to).toISOString()
              }
            }]);
          });
        });
        return runApiCallsInBatches(logCalls).then(function (logResults) {
          var logsByTask = missing.map(function () {
            return [];
          });
          var truncatedLogsByTask = missing.map(function () {
            return 0;
          });
          logResults.forEach(function (rows, index) {
            var owner = logOwners[index];
            logsByTask[owner] = logsByTask[owner].concat(rows || []);
            if ((rows || []).length >= myGeotabGetResultsLimit) truncatedLogsByTask[owner]++;
          });
          return Promise.all(missing.map(function (task, index) {
            var events = task.events || [];
            task.record = {
              key: task.key,
              namespace: cacheNamespace,
              mode: 'exception',
              deviceId: task.deviceId,
              ruleId: ruleId,
              day: task.chunk.day,
              points: compactLogRecords(logsByTask[index], task.chunk.start, task.chunk.end),
              events: events.map(function (event) {
                return {
                  id: event.id,
                  from: new Date(event.activeFrom).getTime(),
                  to: new Date(event.activeTo || event.activeFrom).getTime()
                };
              }),
              truncated: events.length >= myGeotabGetResultsLimit || truncatedLogsByTask[index] > 0
            };
            return cachePut(task.record);
          }));
        });
      }).then(function () {
        var points = [];
        var eventCount = 0;
        var rawCount = 0;
        var truncatedChunks = 0;
        tasks.forEach(function (task) {
          var selected = pointsInRange(task.record.points, fromMs, toMs);
          points = points.concat(selected);
          rawCount += selected.reduce(function (sum, point) {
            return sum + point.value;
          }, 0);
          eventCount += (task.record.events || []).filter(function (event) {
            return event.from <= toMs && event.to >= fromMs;
          }).length;
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
  var toggleLoading = function toggleLoading(show) {
    mainLoadActive = !!show;
    if (show) {
      elShowHeatMap.disabled = true;
      showProgress('Loading map data\u2026');
    } else {
      setTimeout(function () {
        // A zone fetch may still be in flight and owns the bar until it ends.
        if (mainLoadActive || zoneLoadActive) return;
        hideProgress();
      }, 600);
      elShowHeatMap.disabled = false;
    }
  };

  /**
   * Shows the centred progress bar with a caption naming the current work.
   * @param {string} label - Caption shown above the bar.
   */
  function showProgress(label) {
    if (!elLoading) return;
    elLoading.classList.add('is-loading');
    elLoading.setAttribute('aria-busy', 'true');
    elLoading.setAttribute('aria-valuetext', label);
    if (elLoadingLabel) elLoadingLabel.textContent = label;
  }
  function hideProgress() {
    if (!elLoading) return;
    elLoading.classList.remove('is-loading');
    elLoading.setAttribute('aria-busy', 'false');
    elLoading.setAttribute('aria-valuetext', 'Ready');
    if (elLoadingLabel) elLoadingLabel.textContent = '';
  }

  /**
   * The zone overlay reports its own fetches on the same bar, without taking it
   * away from a map data load that is still running.
   * @param {boolean} show - [true] while a zone request is in flight.
   */
  function toggleZoneLoading(show) {
    zoneLoadActive = !!show;
    if (show) {
      showProgress('Loading speed zones\u2026');
    } else if (mainLoadActive) {
      showProgress('Loading map data\u2026');
    } else {
      hideProgress();
    }
  }

  /**
   * Remove the HeatMap layer and add a new empty one.
   */
  var resetHeatMapLayer = function resetHeatMapLayer() {
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
    syncHeatMapVisibility();
  };

  /**
   * Call the appropriate heat map generation function based on the
   * selected visualization option.
   */
  var displayHeatMap = function displayHeatMap() {
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
    rememberSelectedVehiclesInLegend();
    displayVehicleLegend();
    startTime = new Date();
    if (elExceptionTypes.disabled === true) {
      displayHeatMapForLocationHistory();
    } else {
      displayHeatMapForExceptionHistory();
    }
  };

  /**
   * Displays the heatmap of vehicle(s) location history
   */
  var displayHeatMapForLocationHistory = function displayHeatMapForLocationHistory() {
    var deviceId = elVehicles.value;

    // Get selected device IDs.
    var deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i = 0, iLen = options.length; i < iLen; i++) {
      opt = options[i];
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (deviceIds === null || fromValue === '' || toValue === '') {
      return;
    }
    toggleLoading(true);
    var dateFrom = new Date(fromValue).toISOString();
    var dateTo = new Date(toValue).toISOString();

    // Build array of calls.
    var calls = [];
    for (var _i = 0, len = deviceIds.length; _i < len; _i++) {
      calls.push(['Get', {
        typeName: 'LogRecord',
        resultsLimit: myGeotabGetResultsLimit,
        search: {
          deviceSearch: {
            id: deviceIds[_i]
          },
          fromDate: dateFrom,
          toDate: dateTo
        }
      }]);
    }

    // Execute multicall.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        return;
      }
      var coordinates = [];
      var bounds = [];
      var logRecordCount = 0;
      var exceededResultsLimitCount = 0;
      var logRecords = [];
      // Build coordinates and bounds.
      for (var _i2 = 0, _len = results.length; _i2 < _len; _i2++) {
        logRecords = results[_i2];
        for (var j = 0; j < logRecords.length; j++) {
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
        if (logRecords.length >= myGeotabGetResultsLimit) {
          exceededResultsLimitCount++;
        }
      }

      // Update map.
      if (coordinates.length > 0) {
        coordinates = filterPointsBySelectedZones(coordinates);
        if (!coordinates.length) {
          errorHandler('No data falls inside the selected zone(s).');
          toggleLoading(false);
          return;
        }
        bounds = coordinates.map(function (point) { return new L.LatLng(point.lat, point.lon); });
        setHeatMapPoints(coordinates);
        map.fitBounds(bounds);
        heatMapLayer.setLatLngs(coordinates);
        updateMapEventTotal();
        messageHandler("Displaying ".concat(formatNumber(logRecordCount), " combined log records for the\n        ").concat(formatNumber(selectedVehicleCount), " selected vehicles. [").concat(getElapsedTimeSeconds(), " sec]"));
        if (exceededResultsLimitCount > 0) {
          errorHandler("Note: Not all results are displayed because the result limit of \n          ".concat(formatNumber(myGeotabGetResultsLimit), " was exceeded for \n          ").concat(formatNumber(exceededResultsLimitCount), " of the selected vehicles."));
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
  var displayHeatMapForExceptionHistory = function displayHeatMapForExceptionHistory() {
    var selectedRules = selectedExceptionRules();

    // Get selected device IDs.
    var deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i = 0, iLen = options.length; i < iLen; i++) {
      opt = options[i];
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
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
    var dateFrom = new Date(fromValue).toISOString();
    var dateTo = new Date(toValue).toISOString();

    // Build one ExceptionEvent request for every selected vehicle/rule pair.
    var calls = [];
    for (var _i4 = 0; _i4 < deviceIds.length; _i4++) {
      for (var j = 0; j < selectedRules.length; j++) {
        calls.push(['Get', {
          typeName: 'ExceptionEvent',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: deviceIds[_i4]
            },
            ruleSearch: {
              id: selectedRules[j].id
            },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }]);
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
      var exceededResultsLimitCountForExceptionEvents = 0;
      var calls = [];
      var eventInfos = [];
      for (var _i5 = 0, len = results.length; _i5 < len; _i5++) {
        var exceptionEvents = results[_i5];
        var ruleIndex = _i5 % selectedRules.length;
        var deviceIndex = Math.floor(_i5 / selectedRules.length);
        var vehicleName = deviceIds[deviceIndex];
        for (var optionIndex = 0; optionIndex < elVehicles.options.length; optionIndex++) {
          if (elVehicles.options[optionIndex].value === deviceIds[deviceIndex]) {
            vehicleName = elVehicles.options[optionIndex].text;
            break;
          }
        }
        for (var _j = 0; _j < exceptionEvents.length; _j++) {
          eventInfos.push({
            event: exceptionEvents[_j],
            rule: selectedRules[ruleIndex],
            color: colorForVehicleId(deviceIds[deviceIndex]),
            vehicleName: vehicleName
          });
          calls.push(['Get', {
            typeName: 'LogRecord',
            resultsLimit: myGeotabGetResultsLimit,
            search: {
              deviceSearch: {
                id: exceptionEvents[_j].device.id
              },
              fromDate: exceptionEvents[_j].activeFrom,
              toDate: exceptionEvents[_j].activeTo
            }
          }]);
        }
        if (exceptionEvents.length >= myGeotabGetResultsLimit) {
          exceededResultsLimitCountForExceptionEvents++;
        }
      }
      var roadDevices = [];
      deviceIds.forEach(function (deviceId) {
        roadDevices.push(deviceId);
        calls.push(['GetPostedRoadSpeedsForDevice', {
          deviceSearch: {
            id: deviceId
          },
          fromDate: dateFrom,
          toDate: dateTo,
          postedRoadSpeedOptions: 'None'
        }]);
      });

      // Execute multicall to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      api.multiCall(calls, function (results) {
        var logResults = results.slice(0, eventInfos.length);
        var roadResults = results.slice(eventInfos.length);
        if (resultsEmpty(logResults)) {
          errorHandler('No data to display');
          toggleLoading(false);
          return;
        }
        var coordinates = [];
        var bounds = [];
        var logRecordCount = 0;
        var exceededResultsLimitCountForLogRecords = 0;
        var roadByDevice = {};
        roadDevices.forEach(function (deviceId, index) {
          roadByDevice[deviceId] = (roadResults[index] || []).slice().sort(function (a, b) {
            return new Date(a.date) - new Date(b.date);
          });
        });
        var metrics = [];
        // Build one metric and one heat point per mapped ExceptionEvent.
        // LogRecords are used only to locate the event and calculate its metric;
        // they must not independently increase exception heat intensity.
        for (var _i6 = 0, _len2 = logResults.length; _i6 < _len2; _i6++) {
          var logRecords = logResults[_i6];
          for (var _j2 = 0; _j2 < logRecords.length; _j2++) {
            if (logRecords[_j2].latitude !== 0 || logRecords[_j2].longitude !== 0) {
              logRecordCount++;
            }
          }
          if (logRecords.length >= myGeotabGetResultsLimit) {
            exceededResultsLimitCountForLogRecords++;
          }
          var eventInfo = eventInfos[_i6];
          var metric = buildEventMetric(eventInfo, logRecords, roadByDevice[eventInfo.event.device.id] || []);
          if (metric) {
            metrics.push(metric);
            coordinates.push({
              lat: metric.lat,
              lon: metric.lon,
              value: 1
            });
            bounds.push(new L.LatLng(metric.lat, metric.lon));
          }
        }

        // Update map.
        if (coordinates.length > 0) {
          coordinates = filterPointsBySelectedZones(coordinates);
          metrics = filterPointsBySelectedZones(metrics);
          if (!coordinates.length) {
            errorHandler('No exceptions fall inside the selected zone(s).');
            toggleLoading(false);
            return;
          }
          bounds = coordinates.map(function (point) { return new L.LatLng(point.lat, point.lon); });
          setHeatMapPoints(coordinates);
          map.fitBounds(bounds);
          heatMapLayer.setLatLngs(coordinates);
          displayMetricMarkers(metrics);
          updateMapEventTotal();
          messageHandler("Displaying event-based heat from ".concat(formatNumber(metrics.length), " mapped exceptions\n          (").concat(formatNumber(logRecordCount), " supporting GPS records) across ").concat(formatNumber(selectedRules.length), " selected rules for the\n          ").concat(formatNumber(selectedVehicleCount), " selected vehicles. [").concat(getElapsedTimeSeconds(), " sec]"));

          // Build the error message if result limit(s) exceeded.
          if (exceededResultsLimitCountForExceptionEvents > 0 || exceededResultsLimitCountForLogRecords > 0) {
            var errorMessage = 'Note: Not all results are displayed because';
            if (exceededResultsLimitCountForExceptionEvents) {
              errorMessage += " the result limit of \n              ".concat(formatNumber(myGeotabGetResultsLimit), " was exceeded for one or more selected rules");
            }
            if (exceededResultsLimitCountForExceptionEvents > 0 && exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += ' and';
            }
            if (exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += " the result limit of \n              ".concat(formatNumber(myGeotabGetResultsLimit), " was exceeded for \n              ").concat(formatNumber(exceededResultsLimitCountForLogRecords), " exception window(s).");
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
    var ids = [];
    for (var i = 0; i < elVehicles.options.length; i++) {
      var option = elVehicles.options[i];
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
    var filteredPoints = filterPointsBySelectedZones(data.points);
    if (!filteredPoints.length) {
      errorHandler('No data falls inside the selected zone(s).');
      toggleLoading(false);
      return;
    }
    var bounds = filteredPoints.map(function (point) {
      return new L.LatLng(point.lat, point.lon);
    });
    map.fitBounds(bounds);
    setHeatMapPoints(filteredPoints);
    heatMapLayer.setLatLngs(filteredPoints);
    updateMapEventTotal();
    messageHandler(successMessage + " Cache: ".concat(formatNumber(data.cacheHits), " hit(s), ") + "".concat(formatNumber(data.fetchedChunks), " fetched daily chunk(s). [").concat(getElapsedTimeSeconds(), " sec]"));
    if (data.truncatedChunks > 0) {
      errorHandler("Note: ".concat(formatNumber(data.truncatedChunks), " daily cache chunk(s) reached the ") + "".concat(formatNumber(myGeotabGetResultsLimit), "-record API limit and may be incomplete."));
    }
    toggleLoading(false);
  }
  var displayCachedHeatMapForLocationHistory = function displayCachedHeatMapForLocationHistory() {
    var deviceIds = selectedDeviceIds();
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (!deviceIds.length || !fromValue || !toValue) return;
    var fromMs = new Date(fromValue).getTime();
    var toMs = new Date(toValue).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      errorHandler('Please select a valid date range.');
      return;
    }
    toggleLoading(true);
    locationHeatData(deviceIds, fromMs, toMs).then(function (data) {
      displayCachedPoints(data, "Displaying ".concat(formatNumber(data.rawCount), " combined log records for ") + "".concat(formatNumber(deviceIds.length), " selected vehicles."));
    }).catch(function (error) {
      errorHandler(error && error.message ? error.message : String(error));
      toggleLoading(false);
    });
  };
  var displayCachedHeatMapForExceptionHistory = function displayCachedHeatMapForExceptionHistory() {
    var deviceIds = selectedDeviceIds();
    var selectedRule = elExceptionTypes.options[elExceptionTypes.selectedIndex];
    var ruleId = selectedRule ? selectedRule.value : null;
    var ruleName = selectedRule ? selectedRule.text : '';
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (!deviceIds.length || !ruleId || !fromValue || !toValue) return;
    var fromMs = new Date(fromValue).getTime();
    var toMs = new Date(toValue).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      errorHandler('Please select a valid date range.');
      return;
    }
    toggleLoading(true);
    exceptionHeatData(deviceIds, ruleId, fromMs, toMs).then(function (data) {
      displayCachedPoints(data, "Displaying ".concat(formatNumber(data.rawCount), " combined log records associated with ") + "".concat(formatNumber(data.eventCount), " '").concat(ruleName, "' exceptions for ") + "".concat(formatNumber(deviceIds.length), " selected vehicles."));
    }).catch(function (error) {
      errorHandler(error && error.message ? error.message : String(error));
      toggleLoading(false);
    });
  };

  /**
   * Intialize the user interface
   * @param {object} coords - An object with the latitude and longitude to render on the map.
   */
  function enhanceMultiSelect(select, placeholder) {
    var wrapper = document.createElement('div');
    var toggle = document.createElement('button');
    var panel = document.createElement('div');
    var actions = document.createElement('div');
    var optionList = document.createElement('div');
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
    var makeAction = function makeAction(text, selected) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', function () {
        Array.from(select.options).forEach(function (option) {
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
      var options = Array.from(select.options).filter(function (option) { return !option.disabled; });
      var selected = options.filter(function (option) { return option.selected; });
      toggle.disabled = select.disabled;
      toggle.textContent = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0].text : selected.length + ' selected';
      if (select.disabled) close();
      if (!options.length) {
        var empty = document.createElement('div');
        empty.className = 'multi-select-empty';
        empty.textContent = 'No options available';
        optionList.appendChild(empty);
        return;
      }
      options.forEach(function (option) {
        var label = document.createElement('label');
        var checkbox = document.createElement('input');
        var text = document.createElement('span');
        label.className = 'multi-select-option';
        checkbox.type = 'checkbox';
        checkbox.checked = option.selected;
        text.textContent = option.text;
        checkbox.addEventListener('change', function () {
          option.selected = checkbox.checked;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          rebuild();
        });
        label.appendChild(checkbox);
        label.appendChild(text);
        optionList.appendChild(label);
      });
    }
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      var opening = !wrapper.classList.contains('is-open');
      document.querySelectorAll('.multi-select-dropdown.is-open').forEach(function (dropdown) {
        dropdown.classList.remove('is-open');
        dropdown.querySelector('.multi-select-toggle').setAttribute('aria-expanded', 'false');
      });
      if (opening && !select.disabled) {
        wrapper.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
    panel.addEventListener('click', function (event) { return event.stopPropagation(); });
    select.addEventListener('change', rebuild);
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    new MutationObserver(rebuild).observe(select, { childList: true, subtree: true, attributes: true });
    rebuild();
    return { rebuild: rebuild };
  }

  function populateVehicleOptions(vehicles, selectVehicles) {
    var previouslySelected = selectedValues(elVehicles);
    while (elVehicles.options.length) elVehicles.remove(0);
    (vehicles || []).sort(sortByName).forEach(function (vehicle) {
      var option = new Option(vehicle.name, vehicle.id);
      option.selected = selectVehicles || previouslySelected.indexOf(vehicle.id) !== -1;
      elVehicles.add(option);
    });
    vehicleDropdown.rebuild();
  }
  function descendantGroupIds(groupIds) {
    var seen = {};
    var pending = (groupIds || []).slice();
    while (pending.length) {
      var id = pending.pop();
      if (!id || seen[id]) continue;
      seen[id] = true;
      var group = groupById[id];
      (group && group.children || []).forEach(function (child) {
        pending.push(child.id || child);
      });
    }
    return Object.keys(seen);
  }
  function populateVehicleGroupOptions() {
    var selectedTypeIds = selectedValues(elGroupTypes);
    var previousGroupIds = selectedValues(elVehicleGroups);
    var allowedIds = selectedTypeIds.length ? descendantGroupIds(selectedTypeIds) : [];
    while (elVehicleGroups.options.length) elVehicleGroups.remove(0);
    availableGroups.filter(function (group) {
      if (!/\sPREFIX$/i.test(group.name || '')) return false;
      return !selectedTypeIds.length || allowedIds.indexOf(group.id) !== -1;
    }).sort(sortByName).forEach(function (group) {
      var option = new Option(group.name, group.id);
      option.selected = previousGroupIds.indexOf(group.id) !== -1;
      elVehicleGroups.add(option);
    });
    vehicleGroupDropdown.rebuild();
  }
  function loadVehiclesForSelectedGroups() {
    legendVehicleIds = {};
    var selectedGroupIds = selectedValues(elVehicleGroups);
    var selectedTypeIds = selectedValues(elGroupTypes);
    var branchIds = descendantGroupIds(selectedGroupIds.length ? selectedGroupIds : selectedTypeIds);
    if (!branchIds.length) {
      populateVehicleOptions(allVehicles, false);
      displayVehicleLegend();
      return;
    }
    var branchLookup = {};
    branchIds.forEach(function (id) { branchLookup[id] = true; });
    var matchingVehicles = allVehicles.filter(function (vehicle) {
      return (vehicle.groups || []).some(function (group) {
        return branchLookup[group.id || group] === true;
      });
    });
    populateVehicleOptions(matchingVehicles, true);
    rememberSelectedVehiclesInLegend();
    displayVehicleLegend();
  }

  // Every element this script binds to. MyGeotab keeps the Add-In URL from its
  // System Settings configuration, so an outdated page can be served alongside
  // the current script. Reporting the missing ids makes that visible instead of
  // leaving a loaded but inert Add-In.
  var requiredElementIds = ['heatmap', 'heatmap-map', 'exceptionTypes', 'speedingRules', 'idlingRules', 'idleMinMinutes', 'idleFuelBurn', 'idleFuelPrice', 'topIdlingOnly', 'showExceptionHeatMap', 'showSchoolZones', 'speedZoneCategories', 'schoolZonesOnly', 'eventsInZonesOnly', 'groupTypes', 'vehicleGroups', 'vehicles', 'zoneTypes', 'zones', 'from', 'to', 'showHeatMap', 'refreshAddIn', 'error', 'message', 'loading', 'map-event-total', 'visualizeByLocationHistory', 'visualizeByExceptionHistory'];
  var reportUnsupportedPage = function reportUnsupportedPage(missingIds) {
    var message = 'This Heat Map page is out of date and is missing: ' + missingIds.join(', ') + '. Update the MyGeotab Add-In configuration URL to the current Heat Map page, then reload.';
    var banner = document.createElement('div');
    banner.className = 'heatmap-unsupported-page';
    banner.setAttribute('role', 'alert');
    banner.textContent = message;
    document.body.insertBefore(banner, document.body.firstChild);
    return new Error(message);
  };
  // Fit the Add-In to whatever space MyGeotab leaves below its own header so the
  // controls, top bar and map are all visible without scrolling the page.
  var fitToViewport = function fitToViewport() {
    var root = document.getElementById('heatmap');
    if (!root) {
      return;
    }
    // MyGeotab renders the Add-In in a frame that can be taller than the space
    // left below its own header, so prefer the height actually visible there.
    var viewport = window.innerHeight;
    try {
      if (window.frameElement && window.parent && window.parent !== window) {
        var visible = window.parent.innerHeight - window.frameElement.getBoundingClientRect().top;
        if (visible > 0) {
          viewport = Math.min(viewport, visible);
        }
      }
    } catch (crossOrigin) {
      // A cross-origin parent leaves the frame's own height as the best guess.
    }
    var available = Math.max(viewport - root.getBoundingClientRect().top, 420);
    root.style.height = Math.round(available) + 'px';
    // Trim whatever still overflows (page margins, siblings) so nothing scrolls.
    var overflow = document.documentElement.scrollHeight - viewport;
    if (overflow > 0) {
      root.style.height = Math.round(Math.max(available - overflow, 420)) + 'px';
    }
    if (map) {
      map.invalidateSize({
        animate: false,
        pan: false
      });
    }
  };
  var initializeInterface = function initializeInterface(coords) {
    var missingIds = requiredElementIds.filter(function (id) {
      return !document.getElementById(id);
    });
    if (missingIds.length) {
      throw reportUnsupportedPage(missingIds);
    }

    // setup the map
    map = new L.Map('heatmap-map', {
      center: new L.LatLng(coords.latitude, coords.longitude),
      zoom: 13
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a', 'b', 'c']
    }).addTo(map);

    // find reused elements
    elExceptionTypes = document.getElementById('exceptionTypes');
    elShowExceptionHeatMap = document.getElementById('showExceptionHeatMap');
    elShowSchoolZones = document.getElementById('showSchoolZones');
    elSchoolZoneStatus = document.getElementById('schoolZoneStatus');
    elSpeedZoneCategories = document.getElementById('speedZoneCategories');
    elSchoolZonesOnly = document.getElementById('schoolZonesOnly');
    elEventsInZonesOnly = document.getElementById('eventsInZonesOnly');
    elSpeedBands = document.getElementById('speedBands');
    elSpeedBandStatus = document.getElementById('speedBandStatus');
    elTopSpeedingOnly = document.getElementById('topSpeedingOnly');
    buildSpeedZoneCategoryPicker();
    buildSpeedBandPicker();
    elGroupTypes = document.getElementById('groupTypes');
    elVehicleGroups = document.getElementById('vehicleGroups');
    elVehicles = document.getElementById('vehicles');
    elZoneTypes = document.getElementById('zoneTypes');
    elZones = document.getElementById('zones');
    elSpeedingRules = document.getElementById('speedingRules');
    elIdlingRules = document.getElementById('idlingRules');
    elIdleMinMinutes = document.getElementById('idleMinMinutes');
    elIdleFuelBurn = document.getElementById('idleFuelBurn');
    elIdleFuelPrice = document.getElementById('idleFuelPrice');
    elTopIdlingOnly = document.getElementById('topIdlingOnly');
    elIdleCostStatus = document.getElementById('idleCostStatus');
    ruleDropdown = enhanceMultiSelect(elExceptionTypes, 'Select rules');
    speedingRuleDropdown = enhanceMultiSelect(elSpeedingRules, 'Select speeding rules');
    idlingRuleDropdown = enhanceMultiSelect(elIdlingRules, 'Select idling rules');
    groupTypeDropdown = enhanceMultiSelect(elGroupTypes, 'All group types');
    vehicleGroupDropdown = enhanceMultiSelect(elVehicleGroups, 'All vehicle groups');
    vehicleDropdown = enhanceMultiSelect(elVehicles, 'Select vehicles');
    zoneTypeDropdown = enhanceMultiSelect(elZoneTypes, 'All zone types');
    zoneDropdown = enhanceMultiSelect(elZones, 'All zones');
    elDateFromInput = document.getElementById('from');
    elDateToInput = document.getElementById('to');
    elShowHeatMap = document.getElementById('showHeatMap');
    elError = document.getElementById('error');
    elMessage = document.getElementById('message');
    elLoading = document.getElementById('loading');
    elLoadingLabel = document.getElementById('loading-label');
    elMapEventTotal = document.getElementById('map-event-total');
    window.addEventListener('beforeprint', preparePrintReport);
    window.addEventListener('afterprint', restoreAfterPrint);
    window.addEventListener('resize', fitToViewport);
    fitToViewport();
    map.on('moveend zoomend', function () {
      updateMapEventTotal();
      renderMetricMarkers();
      scheduleSchoolZoneReload();
    });
    updateMapEventTotal();
    var formatLocalDateTime = function formatLocalDateTime(date) {
      var pad = function pad(value) {
        return String(value).padStart(2, '0');
      };
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    };
    var startOfDay = function startOfDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0);
    };
    var endOfDay = function endOfDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59);
    };
    var setDatePreset = function setDatePreset(range) {
      var now = new Date();
      var from;
      var to;
      if (range === 'yesterday') {
        var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        from = startOfDay(yesterday);
        to = endOfDay(yesterday);
      } else if (range === 'thisWeek') {
        var daysSinceMonday = (now.getDay() + 6) % 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0);
        to = now;
      } else if (range === 'lastWeek') {
        var _daysSinceMonday = (now.getDay() + 6) % 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - _daysSinceMonday - 7, 0, 0);
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
      document.querySelectorAll('.date-preset').forEach(function (button) {
        button.classList.toggle('is-active', button.dataset.range === range);
      });
    };
    document.querySelectorAll('.date-preset').forEach(function (button) {
      button.addEventListener('click', function () {
        return setDatePreset(button.dataset.range);
      });
    });
    setDatePreset('today');
    var setExceptionControlsEnabled = function setExceptionControlsEnabled(enabled) {
      elExceptionTypes.disabled = !enabled;
      elSpeedingRules.disabled = !enabled;
      elIdlingRules.disabled = !enabled;
      elShowExceptionHeatMap.disabled = !enabled;
      ruleDropdown.rebuild();
      speedingRuleDropdown.rebuild();
      idlingRuleDropdown.rebuild();
      syncHeatMapVisibility();
      updateMapEventTotal();
    };
    document.getElementById('visualizeByLocationHistory').addEventListener('click', function (event) {
      setExceptionControlsEnabled(false);
    });
    document.getElementById('visualizeByExceptionHistory').addEventListener('click', function (event) {
      setExceptionControlsEnabled(true);
    });
    elShowExceptionHeatMap.addEventListener('change', syncHeatMapVisibility);
    if (elShowSchoolZones) elShowSchoolZones.addEventListener('change', syncSchoolZoneVisibility);
    if (elSchoolZonesOnly) elSchoolZonesOnly.addEventListener('change', function () {
      resetSpeedZoneCache();
      syncSchoolZoneVisibility();
    });
    if (elEventsInZonesOnly) elEventsInZonesOnly.addEventListener('change', function () {
      renderMetricMarkers();
      updateMapEventTotal();
    });
    if (elTopSpeedingOnly) elTopSpeedingOnly.addEventListener('change', function () {
      displayMetricLegend(metricMapData);
      renderMetricMarkers();
      updateMapEventTotal();
    });
    if (elTopIdlingOnly) elTopIdlingOnly.addEventListener('change', refreshIdlingPresentation);
    if (elIdleMinMinutes) elIdleMinMinutes.addEventListener('change', refreshIdlingPresentation);
    if (elIdleFuelBurn) elIdleFuelBurn.addEventListener('change', refreshIdlingPresentation);
    if (elIdleFuelPrice) elIdleFuelPrice.addEventListener('change', refreshIdlingPresentation);
    setIdleCostStatus('Idling cost = idle hours \u00d7 ' + idleFuelBurn() + ' L/h \u00d7 $' + idleFuelPrice().toFixed(2) + '/L. Both rates are editable.');
    elGroupTypes.addEventListener('change', function () {
      populateVehicleGroupOptions();
      loadVehiclesForSelectedGroups();
    });
    elVehicleGroups.addEventListener('change', loadVehiclesForSelectedGroups);
    elZoneTypes.addEventListener('change', populateZoneOptions);
    document.getElementById('exceptionTypes').addEventListener('change', function (event) {
      event.preventDefault();
    });
    document.getElementById('vehicles').addEventListener('change', function (event) {
      event.preventDefault();
      rememberSelectedVehiclesInLegend();
      displayVehicleLegend();
    });
    document.getElementById('from').addEventListener('change', function (event) {
      event.preventDefault();
    });
    document.getElementById('to').addEventListener('change', function (event) {
      event.preventDefault();
    });
    document.getElementById('showHeatMap').addEventListener('click', function (event) {
      event.preventDefault();
      displayHeatMap();
    });
    document.getElementById('refreshAddIn').addEventListener('click', function (event) {
      event.preventDefault();
      window.location.reload();
    });
    interfaceReady = true;
  };

  /**
   * Sort named entities
   * @param {object} a - The left comparison named entity
   * @param {object} b - The right comparison named entity
   */
  var sortByName = function sortByName(a, b) {
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
    initialize: function initialize(freshApi, state, callback) {
      api = freshApi;

      // Startup must never wait on geolocation or an API response. The map
      // fits to returned fleet data when a heat map is generated, so a fixed
      // initial centre is sufficient and avoids iframe permission deadlocks.
      var fallback = {
        longitude: 174.7633,
        latitude: -36.8485
      };
      try {
        initializeInterface(fallback);
        pruneCache();
      } catch (error) {
        console.error('Heat Map initialization failed:', error);
      } finally {
        callback();
      }
    },
    focus: function focus(freshApi, freshState) {
      api = freshApi;
      if (!interfaceReady) {
        return;
      }
      var groupFilter = freshState.getGroupFilter() || [];
      var groupSignature = groupFilter.map(function (group) {
        return group.id || String(group);
      }).sort().join(',') || 'all';
      cacheNamespace = cacheSessionNamespace + '|groups:' + groupSignature;

      // Focus can run again after the MyGeotab group filter changes. Rebuild the
      // options rather than retaining vehicles/rules from the previous scope.
      while (elVehicles.options.length) elVehicles.remove(0);
      while (elGroupTypes.options.length) elGroupTypes.remove(0);
      while (elVehicleGroups.options.length) elVehicleGroups.remove(0);
      while (elZoneTypes.options.length) elZoneTypes.remove(0);
      while (elZones.options.length) elZones.remove(0);
      while (elExceptionTypes.options.length > 1) elExceptionTypes.remove(1);
      allVehicles = [];
      availableGroups = [];
      groupById = {};
      parentByGroupId = {};
      availableZoneTypes = [];
      availableZones = [];

      // One multiCall instead of five parallel requests: MyGeotab reports
      // "unable to connect to your database" when a burst of large Get calls
      // times out, and the selector data is only useful once it has all arrived.
      api.multiCall([['Get', {
        typeName: 'Device',
        resultsLimit: SELECTOR_RESULTS_LIMIT,
        search: {
          fromDate: new Date().toISOString(),
          groups: groupFilter
        }
      }], ['Get', {
        typeName: 'Group',
        resultsLimit: SELECTOR_RESULTS_LIMIT
      }], ['Get', {
        typeName: 'ZoneType',
        resultsLimit: SELECTOR_RESULTS_LIMIT
      }], ['Get', {
        typeName: 'Zone',
        resultsLimit: SELECTOR_RESULTS_LIMIT,
        search: {
          groups: groupFilter
        }
      }], ['Get', {
        typeName: 'Rule',
        resultsLimit: SELECTOR_RESULTS_LIMIT
      }], ['Get', {
        typeName: 'SystemSettings'
      }]], function (results) {
        var vehicles = results[0];
        var groups = results[1];
        var zoneTypes = results[2];
        var zones = results[3];
        var rules = results[4];
        applySpeedBandSettings(results[5]);
        if (!vehicles || !vehicles.length) {
          errorHandler('No vehicles are available for the current group filter.');
        } else {
          allVehicles = vehicles.sort(sortByName);
          populateVehicleOptions(allVehicles, false);
        }
        availableGroups = (groups || []).filter(function (group) {
          return group && group.id && group.name;
        });
        availableGroups.forEach(function (group) {
          groupById[group.id] = group;
        });
        availableGroups.forEach(function (parent) {
          (parent.children || []).forEach(function (child) {
            parentByGroupId[child.id || child] = parent.id;
          });
        });
        var typeIds = {};
        availableGroups.filter(function (group) {
          return /\sPREFIX$/i.test(group.name || '');
        }).forEach(function (group) {
          var parentId = parentByGroupId[group.id];
          if (parentId && groupById[parentId]) typeIds[parentId] = true;
        });
        Object.keys(typeIds).map(function (id) {
          return groupById[id];
        }).sort(sortByName).forEach(function (group) {
          elGroupTypes.add(new Option(group.name, group.id));
        });
        groupTypeDropdown.rebuild();
        populateVehicleGroupOptions();

        // Zone types narrow the zone selector.
        availableZoneTypes = (zoneTypes || []).filter(function (zoneType) {
          return zoneType && zoneType.id && zoneType.name;
        }).sort(sortByName);
        availableZoneTypes.forEach(function (zoneType) {
          elZoneTypes.add(new Option(zoneType.name, zoneType.id));
        });
        zoneTypeDropdown.rebuild();

        // Selected zones are applied client-side to both GPS heat points and
        // exception metrics, leaving the fetched exception data intact.
        availableZones = (zones || []).filter(function (zone) {
          return zone && zone.id && zone.name && zoneCoordinates(zone).length >= 3;
        }).sort(sortByName);
        populateZoneOptions();
        if (rules && rules.length) {
          rules.sort(sortByName);
          // Speeding and idling get their own selectors so their dedicated
          // controls apply to a known set of rules; everything else stays in the
          // generic rule dropdown.
          rules.forEach(function (rule) {
            var option = new Option();
            option.text = rule.name;
            option.value = rule.id;
            if (ruleIsSpeeding(rule)) {
              elSpeedingRules.add(option);
            } else if (ruleIsIdling(rule)) {
              elIdlingRules.add(option);
            } else {
              elExceptionTypes.add(option);
            }
          });
          ruleDropdown.rebuild();
          speedingRuleDropdown.rebuild();
          idlingRuleDropdown.rebuild();
        }
      }, errorHandler);
      setTimeout(function () {
        fitToViewport();
        map.invalidateSize();
      }, 200);
    },
    blur: function blur() {
      // No active timers or subscriptions need cleanup.
    }
  };
};
