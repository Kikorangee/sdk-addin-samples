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
  var elShowExceptionHeatMap;
  var elGroupTypes;
  var elVehicleGroups;
  var elVehicles;
  var elZoneTypes;
  var elZones;
  var ruleDropdown;
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

  // School speed zones come from the NZTA National Speed Limit Register
  // (SpeedLimitZoneFull view), filtered to the zones that exist because of a
  // school. Only the zones intersecting the current map view are requested so a
  // pan never pulls all ~6,800 national zones at once.
  var SCHOOL_ZONE_SERVICE_URL = 'https://services.arcgis.com/CXBb7LAjgIIdcsPt/arcgis/rest/services/SpeedLimitZoneFull__View/FeatureServer/0/query';
  var SCHOOL_ZONE_WHERE = "speedLimitZoneReasonName='The presence of a school'";
  var SCHOOL_ZONE_MIN_ZOOM = 11;
  var SCHOOL_ZONE_PAGE_SIZE = 2000;
  var SCHOOL_ZONE_MAX_CACHED = 6000;
  var elShowSchoolZones;
  var elSchoolZoneStatus;
  var schoolZoneLayer;
  var schoolZoneLegendControl;
  var schoolZones = [];
  var schoolZoneById = {};
  var schoolZoneRequestId = 0;
  var schoolZoneReloadTimer = null;

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
    var selectedRules = Array.from(elExceptionTypes.selectedOptions || []).map(function (option) {
      return option.text;
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
      speedLimit: speedLimit,
      vehicleSpeed: Number.isFinite(Number(chosen.speed)) ? Math.round(Number(chosen.speed)) : peakSpeed,
      ruleName: name,
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
      name: properties.speedLimitZoneName || properties.rcaZoneReferenceName || 'School speed zone',
      category: properties.speedCategoryName || '',
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
  function pointInSchoolZone(lat, lon, zone) {
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
      if (pointInSchoolZone(lat, lon, schoolZones[i])) return schoolZones[i];
    }
    return null;
  }
  function describeSchoolZone(zone) {
    var limit = schoolZoneLimit(zone);
    var parts = [zone.name];
    if (limit != null) parts.push(limit + ' km/h school zone');
    if (zone.category) parts.push(zone.category.toLowerCase() + ' limit');
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
  function schoolZoneSpeedingCount() {
    return metricMapData.filter(function (metric) {
      return metric.schoolZoneSpeeding;
    }).length;
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
      style: function style() {
        return {
          color: '#f2a900',
          weight: 2,
          opacity: 0.9,
          fillColor: '#f2a900',
          fillOpacity: 0.18
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
    schoolZoneLegendControl = L.control({
      position: 'bottomright'
    });
    schoolZoneLegendControl.onAdd = function () {
      var element = L.DomUtil.create('div', 'school-zone-legend');
      element.innerHTML = '<strong><i></i>School speed zones</strong>' + '<span>' + formatNumber(schoolZones.length) + ' zones loaded for this view</span>' + '<span><b>' + formatNumber(speedingCount) + '</b> mapped events over the school-zone limit</span>' + '<small>Zones and limits from the NZTA National Speed Limit Register. Variable zones only apply during the posted school periods, so check the zone tooltip before acting on an event.</small>';
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
      setSchoolZoneStatus('Zoom in to load school zones.');
      return Promise.resolve();
    }
    var bounds = map.getBounds();
    var requestId = ++schoolZoneRequestId;
    setSchoolZoneStatus('Loading school zones\u2026');
    var parameters = ['where=' + encodeURIComponent(SCHOOL_ZONE_WHERE), 'geometry=' + encodeURIComponent([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',')), 'geometryType=esriGeometryEnvelope', 'spatialRel=esriSpatialRelIntersects', 'inSR=4326', 'outSR=4326', 'outFields=' + encodeURIComponent('OBJECTID,speedLimitZoneName,rcaZoneReferenceName,speedCategoryName,speedLimitZoneValue,speedLimitZoneMinValue,speedLimitZoneMaxValue,speedLimitZoneVarPrdDesc'), 'resultRecordCount=' + SCHOOL_ZONE_PAGE_SIZE, 'returnGeometry=true', 'f=geojson'].join('&');
    return fetch(SCHOOL_ZONE_SERVICE_URL + '?' + parameters, {
      credentials: 'omit'
    }).then(function (response) {
      if (!response.ok) throw new Error('NZTA speed limit service returned ' + response.status);
      return response.json();
    }).then(function (collection) {
      if (requestId !== schoolZoneRequestId) return;
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
      var speedingCount = schoolZoneSpeedingCount();
      setSchoolZoneStatus(formatNumber(schoolZones.length) + ' school zones loaded' + (added ? '' : ' (no new zones in this view)') + '; ' + formatNumber(speedingCount) + ' mapped events over the school-zone limit.');
    })['catch'](function (error) {
      if (requestId !== schoolZoneRequestId) return;
      setSchoolZoneStatus('School zones unavailable: ' + (error && error.message ? error.message : 'request failed') + '.');
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
      setSchoolZoneStatus('');
      renderSchoolZoneLayer();
      displaySchoolZoneLegend();
      annotateMetricsWithSchoolZones();
      renderMetricMarkers();
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
      }).join('') + '<label class="metric-detail-toggle"><input type="checkbox"> Show event details</label>' + '<small>Event marker colours match the vehicle legend, and speeding events also show the posted limit as a road sign. Heat colouring can be toggled separately in the Exceptions controls.</small>';
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
  // A roundel of the posted limit sits above each mapped speeding event. Events
  // cluster on the same stretch of road, so a sign is skipped when an identical
  // limit is already drawn within 46px of it.
  function addSpeedLimitSign(metric, acceptedSignPoints) {
    // Inside a school zone the school limit is the one that matters, so it wins
    // over the posted road limit on the sign.
    var limit = metric.schoolZoneLimit != null ? metric.schoolZoneLimit : metric.speedLimit;
    if (limit == null) return;
    var inSchoolZone = metric.schoolZoneLimit != null;
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
    var tooltip = inSchoolZone ? 'School zone limit: ' + limit + ' km/h \u2014 ' + describeSchoolZone(metric.schoolZone) + (metric.speedLimit != null ? ' (posted road limit ' + metric.speedLimit + ' km/h)' : '') : 'Posted speed limit: ' + limit + ' km/h';
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
      addSpeedLimitSign(metric, acceptedSignPoints);
      var calloutText = metric.ruleName + " \u2192 " + metric.label + (metric.schoolZoneSpeeding ? ' (school zone)' : '');
      var popupHtml = metric.popup + (metric.schoolZone ? '<br><span class="school-zone-flag">' + (metric.schoolZoneSpeeding ? 'Over the school-zone limit' : 'Inside a school zone') + ': ' + escapeHtml(describeSchoolZone(metric.schoolZone)) + (Number.isFinite(metric.vehicleSpeed) ? ' \u2014 vehicle ' + metric.vehicleSpeed + ' km/h' : '') + '</span>' : '');
      var dot = L.circleMarker([metric.lat, metric.lon], {
        radius: 4,
        color: '#ffffff',
        weight: 1,
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
          className: 'event-metric-marker event-metric-' + metric.kind,
          html: '<span style="--rule-color:' + metric.color + "\">\u2192 " + escapeHtml(metric.label) + (metric.schoolZoneSpeeding ? ' \uD83C\uDFEB' : '') + '</span>',
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
    if (show) {
      elShowHeatMap.disabled = true;
      elLoading.classList.add('is-loading');
      elLoading.setAttribute('aria-busy', 'true');
      elLoading.setAttribute('aria-valuetext', 'Loading map data');
    } else {
      setTimeout(function () {
        elLoading.classList.remove('is-loading');
        elLoading.setAttribute('aria-busy', 'false');
        elLoading.setAttribute('aria-valuetext', 'Ready');
      }, 600);
      elShowHeatMap.disabled = false;
    }
  };

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
    var selectedRules = [];
    for (var _i3 = 0; _i3 < elExceptionTypes.options.length; _i3++) {
      var ruleOption = elExceptionTypes.options[_i3];
      if (ruleOption.selected && !ruleOption.disabled && ruleOption.value) {
        selectedRules.push({
          id: ruleOption.value,
          name: ruleOption.text
        });
      }
    }

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
  var requiredElementIds = ['heatmap', 'heatmap-map', 'exceptionTypes', 'showExceptionHeatMap', 'showSchoolZones', 'groupTypes', 'vehicleGroups', 'vehicles', 'zoneTypes', 'zones', 'from', 'to', 'showHeatMap', 'refreshAddIn', 'error', 'message', 'loading', 'map-event-total', 'visualizeByLocationHistory', 'visualizeByExceptionHistory'];
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
    elGroupTypes = document.getElementById('groupTypes');
    elVehicleGroups = document.getElementById('vehicleGroups');
    elVehicles = document.getElementById('vehicles');
    elZoneTypes = document.getElementById('zoneTypes');
    elZones = document.getElementById('zones');
    ruleDropdown = enhanceMultiSelect(elExceptionTypes, 'Select rules');
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
    document.getElementById('visualizeByLocationHistory').addEventListener('click', function (event) {
      elExceptionTypes.disabled = true;
      elShowExceptionHeatMap.disabled = true;
      ruleDropdown.rebuild();
      syncHeatMapVisibility();
      updateMapEventTotal();
    });
    document.getElementById('visualizeByExceptionHistory').addEventListener('click', function (event) {
      elExceptionTypes.disabled = false;
      elShowExceptionHeatMap.disabled = false;
      ruleDropdown.rebuild();
      syncHeatMapVisibility();
      updateMapEventTotal();
    });
    elShowExceptionHeatMap.addEventListener('change', syncHeatMapVisibility);
    if (elShowSchoolZones) elShowSchoolZones.addEventListener('change', syncSchoolZoneVisibility);
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
      }]], function (results) {
        var vehicles = results[0];
        var groups = results[1];
        var zoneTypes = results[2];
        var zones = results[3];
        var rules = results[4];
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
          rules.forEach(function (rule) {
            var option = new Option();
            option.text = rule.name;
            option.value = rule.id;
            elExceptionTypes.add(option);
          });
          ruleDropdown.rebuild();
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
