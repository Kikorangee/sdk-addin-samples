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
  // One multicall per this many requests: a month of fleet exceptions needs one
  // LogRecord request per event, which a single multicall cannot carry.
  var multiCallChunkSize = 250;
  // Locating more events than this takes longer than anyone waits, so the range
  // is reported as too wide instead of stalling the browser.
  var maxLocatedEvents = 6000;
  var maxVehicleRuleCombinations = 600;
  // MyGeotab admits 1000 API calls per minute per user and answers an
  // OverLimitException after that, so requests are paced under the quota.
  var apiCallsPerMinuteBudget = 850;
  var apiCallTimestamps = [];
  // Events closer together than this share one GPS request.
  var GPS_WINDOW_MERGE_MS = 30 * 60 * 1000;
  var GPS_WINDOWS_PER_VEHICLE = 24;
  var startTime;
  var printPreviousMetricDetails = null;
  var printingReport = false;
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
  var PRINT_TABLE_ROW_LIMIT = 750;
  // Landscape A4 less the 8mm print margins, at 96dpi.
  var PRINT_PAGE_WIDTH_PX = 1062;
  var IDLE_DEFAULT_FUEL_BURN = 3;
  var IDLE_DEFAULT_FUEL_PRICE = 1.9;
  var elIdleMinMinutes;
  var elIdleFuelBurn;
  var elIdleFuelPrice;
  var elTopIdlingOnly;
  var elIdleCostStatus;

  // Weight history reads the cargo weight diagnostic and compares it with the
  // axle scale register shipped in weight-register.js: over the GML payload is
  // an overload, over the GVM payload leaves the vehicle without cover.
  var WEIGHT_DIAGNOSTIC_SEARCH = '%cargo weight%';
  var WEIGHT_WINDOW_HOURS = 6;
  var WEIGHT_MAX_WINDOWS = 60;
  var WEIGHT_RESULTS_LIMIT = 50000;
  var WEIGHT_MATCH_TOLERANCE_MS = 5 * 60 * 1000;
  var WEIGHT_RUN_GAP_MS = 15 * 60 * 1000;
  var TOP_WEIGHT_PER_VEHICLE = 5;
  var WEIGHT_DEFAULT_FALLBACK_TONNES = 10;
  var WEIGHT_DEFAULT_WARN_PCT = 80;
  var WEIGHT_STATUS_COLORS = {
    critical: '#8e0000',
    over: '#d32f2f',
    warn: '#f0a000',
    under: '#2e9e44',
    unknown: '#6f7c8a'
  };
  var WEIGHT_STATUS_LABELS = {
    critical: 'Over GVM payload',
    over: 'Over payload limit',
    warn: 'Approaching payload limit',
    under: 'Under payload limit',
    unknown: 'No payload limit set'
  };
  var weightDiagnosticId = null;
  var elWeightFallbackTonnes;
  var elDataSourceCache;
  var elCacheBaseUrl;
  var elCacheStatus;
  var cacheIndex = null;
  var cacheMonths = {};
  var cacheScripts = {};
  var CACHE_URL_STORAGE_KEY = 'heatmap.cacheBaseUrl';
  var CACHE_SCRIPT_TIMEOUT_MS = 30000;
  var elWeightWarnPct;
  var elWeightOverOnly;
  var elTopWeightOnly;
  var elWeightStatus;

  // Live monitoring polls MyGeotab: the API offers no push channel to an
  // add-in, so freshness is bounded by the chosen interval. Polling is
  // suspended while the tab is hidden or the add-in loses focus.
  var LIVE_EXCEPTION_ALERT_MS = 15 * 60 * 1000;
  var LIVE_WEIGHT_LOOKBACK_MS = 60 * 60 * 1000;
  var LIVE_MAX_ALERTS = 25;
  var liveLayer;
  var liveTimer = null;
  var liveLoading = false;
  var liveFeedVersion = null;
  var liveVehicles = [];
  var liveAlertLog = [];
  var liveExceptionsByDevice = {};
  // Which vehicle/alert pairs have already been zoomed to, so a vehicle held
  // over its limit is only chased once rather than on every poll.
  var liveFocusedAlerts = {};
  var liveMarkersById = {};
  var LIVE_FOCUS_ZOOM = 14;
  var lastMapScreenSize = null;
  // Past OpenStreetMap's last rendered zoom (19) so stacked events can be
  // separated; automatic fits stop earlier, at FIT_MAX_ZOOM.
  var MAX_MAP_ZOOM = 21;
  var FIT_MAX_ZOOM = 18;
  var elLiveMonitor;
  var elLiveInterval;
  var elLiveSpeedThreshold;
  var elLiveWeightAlerts;
  var elLiveExceptionAlerts;
  var elLiveAlertsOnly;
  var elLiveAutoZoom;
  var elLiveAlerts;
  var elLiveStatus;

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
  function modeIsChecked(id) {
    var element = document.getElementById(id);
    return !!(element && element.checked);
  }
  function exceptionModeActive() {
    return modeIsChecked('visualizeByExceptionHistory');
  }
  function weightModeActive() {
    return modeIsChecked('visualizeByWeightHistory');
  }

  /**
   * Both exception and weight history plot discrete events, so they share the
   * event counters, legend, marker and print pipeline. Location history plots
   * raw GPS points instead.
   */
  function eventModeActive() {
    return exceptionModeActive() || weightModeActive();
  }
  function updateMapEventTotal() {
    if (!elMapEventTotal) return;
    var bounds = map && map.getBounds ? map.getBounds() : null;
    var exceptionMode = eventModeActive() && !cacheModeActive();
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
    var cachedEvents = cacheModeActive() && eventModeActive();
    var noun = weightModeActive() ? 'weight events' : exceptionMode ? 'exceptions' : cachedEvents ? 'cached exception events' : 'GPS points';
    elMapEventTotal.innerHTML = '<strong>' + formatNumber(visibleCount) + '</strong>' + '<span>' + noun + ' in view</span>' + '<small>' + formatNumber(totalCount) + ' ' + (exceptionMode ? 'mapped ' + noun + ' loaded' : cachedEvents ? 'cached exception events loaded' : 'GPS points loaded') + '</small>';
  }
  /**
   * The events the printed table lists: everything currently drawn on the map,
   * ordered by vehicle then by when it happened.
   */
  function printableMetrics() {
    return metricMapData.filter(metricPassesFilters).slice().sort(function (a, b) {
      var vehicle = String(a.vehicleName || '').localeCompare(String(b.vehicleName || ''));
      if (vehicle !== 0) return vehicle;
      return new Date(a.startTime || 0) - new Date(b.startTime || 0);
    });
  }
  function printMetricRow(metric, index) {
    var limit = metric.schoolZoneLimit != null ? metric.schoolZoneLimit : metric.speedLimit;
    var zone = metric.schoolZone ? describeSchoolZone(metric.schoolZone) : '';
    var rank = metric.topSpeedingRank ? '#' + metric.topSpeedingRank + ' fastest' : metric.topIdlingRank ? '#' + metric.topIdlingRank + ' costliest' : metric.topWeightRank ? '#' + metric.topWeightRank + ' heaviest' : '';
    // Speed columns are meaningless for an idling event, so they stay blank
    // rather than reporting the speed the vehicle happened to reach nearby.
    var idle = metric.kind === 'idle';
    var weight = metric.kind === 'weight';
    var cells = [index + 1, metric.vehicleName || '', weight && metric.weightRego ? metric.ruleName + ' (' + metric.weightRego + ')' : metric.ruleName || '', metric.startTime ? new Date(metric.startTime).toLocaleString() : '', formatDuration(metric.durationMs || 0), metric.label || '', !idle && !weight && Number.isFinite(metric.vehicleSpeed) ? metric.vehicleSpeed + ' km/h' : '', !idle && !weight && limit != null ? limit + ' km/h' : '', idle || weight ? '' : describeSpeedBand(metric) || '', idle ? '$' + (metric.idleCost || 0).toFixed(2) : '', weight ? formatTonnes(metric.weightKg) + ' t' : '', weight && metric.weightPct != null ? Math.round(metric.weightPct) + '%' : '', zone, rank];
    return '<tr>' + cells.map(function (cell) {
      return '<td>' + escapeHtml(String(cell)) + '</td>';
    }).join('') + '</tr>';
  }
  function buildPrintReportTable(exceptionMode) {
    var container = document.getElementById('printReportTable');
    if (!container) {
      container = document.createElement('section');
      container.id = 'printReportTable';
      document.getElementById('heatmap').appendChild(container);
    }
    if (!exceptionMode) {
      container.innerHTML = '<p class="print-table-note">' + (cacheModeActive() ? 'The local cache stores day and grid cell totals rather than individual events, so there is no per-event table to print. Switch the data source to the MyGeotab API for a table of results.' : 'Location history plots GPS points only, so there is no per-event table to print. Switch to exception history for a table of results.') + '</p>';
      return;
    }
    var metrics = printableMetrics();
    if (!metrics.length) {
      container.innerHTML = '<p class="print-table-note">No ' + (weightModeActive() ? 'weight' : 'exception') + ' events match the current filters.</p>';
      return;
    }
    var byVehicle = {};
    metrics.forEach(function (metric) {
      var key = metric.vehicleName || 'Unknown vehicle';
      if (!byVehicle[key]) byVehicle[key] = {
        events: 0,
        idleCost: 0,
        idleMinutes: 0,
        topSpeed: null,
        peakCargoKg: null,
        peakCargoPct: null
      };
      var summary = byVehicle[key];
      summary.events++;
      summary.idleCost += metric.idleCost || 0;
      summary.idleMinutes += metric.idleMinutes || 0;
      if (metric.kind !== 'idle' && Number.isFinite(metric.vehicleSpeed) && (summary.topSpeed == null || metric.vehicleSpeed > summary.topSpeed)) {
        summary.topSpeed = metric.vehicleSpeed;
      }
      if (Number.isFinite(metric.weightKg) && (summary.peakCargoKg == null || metric.weightKg > summary.peakCargoKg)) {
        summary.peakCargoKg = metric.weightKg;
      }
      if (Number.isFinite(metric.weightPct) && (summary.peakCargoPct == null || metric.weightPct > summary.peakCargoPct)) {
        summary.peakCargoPct = metric.weightPct;
      }
    });
    var summaryRows = Object.keys(byVehicle).sort().map(function (name) {
      var summary = byVehicle[name];
      return '<tr><td>' + escapeHtml(name) + '</td>' + '<td>' + formatNumber(summary.events) + '</td>' + '<td>' + (summary.topSpeed == null ? '' : summary.topSpeed + ' km/h') + '</td>' + '<td>' + (summary.idleMinutes ? Math.round(summary.idleMinutes) + ' min' : '') + '</td>' + '<td>' + (summary.idleCost ? '$' + summary.idleCost.toFixed(2) : '') + '</td>' + '<td>' + (summary.peakCargoKg == null ? '' : formatTonnes(summary.peakCargoKg) + ' t') + '</td>' + '<td>' + (summary.peakCargoPct == null ? '' : Math.round(summary.peakCargoPct) + '%') + '</td></tr>';
    }).join('');
    var truncated = metrics.length > PRINT_TABLE_ROW_LIMIT;
    var rows = metrics.slice(0, PRINT_TABLE_ROW_LIMIT).map(printMetricRow).join('');
    container.innerHTML = '<h2>Results by vehicle</h2>' + '<table class="print-table print-summary-table"><thead><tr>' + '<th>Vehicle</th><th>Events</th><th>Peak speed</th><th>Idling</th><th>Idling cost</th><th>Peak cargo</th><th>Worst % of limit</th>' + '</tr></thead><tbody>' + summaryRows + '</tbody></table>' + '<h2>Events</h2>' + '<table class="print-table"><thead><tr>' + '<th>#</th><th>Vehicle</th><th>Rule</th><th>Start</th><th>Duration</th><th>Measure</th>' + '<th>Vehicle speed</th><th>Limit</th><th>Speed band</th><th>Idling cost</th><th>Cargo</th><th>% of limit</th><th>Zone</th><th>Ring-fence</th>' + '</tr></thead><tbody>' + rows + '</tbody></table>' + (truncated ? '<p class="print-table-note">Showing the first ' + formatNumber(PRINT_TABLE_ROW_LIMIT) + ' of ' + formatNumber(metrics.length) + ' events. Narrow the filters or the date range to print the rest.</p>' : '');
  }
  // leaflet.heat reads its canvas back with getImageData, which throws while the
  // map pane still has no measurable size (as happens mid print layout).
  function redrawHeatMapLayer() {
    if (!heatMapLayer || !heatMapLayer.redraw) return;
    var size = map.getSize();
    if (!size || !size.x || !size.y) return;
    try {
      heatMapLayer.redraw();
    } catch (error) {
      console.warn('Heat map layer redraw skipped:', error);
    }
  }
  function preparePrintReport() {
    if (!document.getElementById('printReportHeader')) {
      var header = document.createElement('section');
      header.id = 'printReportHeader';
      header.innerHTML = '<div><h1>Heatmap Fleet Analytics</h1><p id="printReportFilters"></p></div>' + '<strong id="printReportSummary"></strong>';
      document.getElementById('heatmap').insertBefore(header, document.getElementById('heatmap').firstChild);
    }
    var exceptionMode = eventModeActive() && !cacheModeActive();
    var selectedVehicles = Array.from(elVehicles.selectedOptions || []).map(function (option) {
      return option.text;
    });
    var selectedRules = selectedExceptionRules().map(function (rule) {
      return rule.name;
    });
    var pointTotal = exceptionMode ? printableMetrics().length : heatMapPoints.reduce(function (sum, point) {
      return sum + (Number(point.value) || 1);
    }, 0);
    var fromText = elDateFromInput.value ? new Date(elDateFromInput.value).toLocaleString() : 'Not set';
    var toText = elDateToInput.value ? new Date(elDateToInput.value).toLocaleString() : 'Not set';
    var subject = weightModeActive() ? 'Weight history' : exceptionMode ? selectedRules.length ? selectedRules.join(', ') : 'Exception history' : 'Location history';
    document.getElementById('printReportFilters').textContent = subject + ' | ' + selectedVehicles.length + ' vehicle' + (selectedVehicles.length === 1 ? '' : 's') + ' | ' + fromText + ' to ' + toText + ' | Generated ' + new Date().toLocaleString();
    document.getElementById('printReportSummary').textContent = formatNumber(pointTotal) + (weightModeActive() ? ' mapped weight events' : exceptionMode ? ' mapped exceptions' : ' GPS points');
    buildPrintReportTable(exceptionMode);
    printingReport = true;
    printPreviousMetricDetails = metricDetailsVisible;
    if (exceptionMode && metricMapData.length) metricDetailsVisible = true;
    pinPrintMapToScreenSize();
    map.invalidateSize({
      animate: false,
      pan: false
    });
    redrawHeatMapLayer();
    renderMetricMarkers();
    updateMapEventTotal();
  }
  /**
   * Prints the map at exactly its on-screen pixel size, scaled down to fit the
   * page. Resizing it for print instead would leave the tiles for the new size
   * unrequested, so the map prints as an empty background.
   */
  function pinPrintMapToScreenSize() {
    var element = document.getElementById('heatmap-map');
    if (!element) return;
    var width = element.offsetWidth;
    var height = element.offsetHeight;

    // The print stylesheet can already have collapsed the map by the time this
    // runs, so fall back to the last size it had on screen.
    if (height < 200 && lastMapScreenSize) {
      width = lastMapScreenSize.width;
      height = lastMapScreenSize.height;
    }
    if (!width || !height) return;
    // Landscape A4 less the 8mm page margins, at 96dpi.
    var scale = Math.min(1, PRINT_PAGE_WIDTH_PX / width);
    var style = document.documentElement.style;
    style.setProperty('--print-map-width', width + 'px');
    style.setProperty('--print-map-height', height + 'px');
    style.setProperty('--print-map-scale', String(scale));
    style.setProperty('--print-map-box-height', Math.round(height * scale) + 'px');
  }
  /**
   * Keeps the map's on-screen size, so printing can reuse it after the print
   * stylesheet has changed the layout.
   */
  function rememberMapScreenSize() {
    if (printingReport) return;
    var element = document.getElementById('heatmap-map');
    if (!element || element.offsetHeight < 200) return;
    lastMapScreenSize = {
      width: element.offsetWidth,
      height: element.offsetHeight
    };
  }
  function restoreAfterPrint() {
    printingReport = false;
    if (printPreviousMetricDetails !== null) {
      metricDetailsVisible = printPreviousMetricDetails;
      printPreviousMetricDetails = null;
    }
    map.invalidateSize({
      animate: false,
      pan: false
    });
    redrawHeatMapLayer();
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
    var exceptionMode = exceptionModeActive();
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
      startTime: event.activeFrom,
      distanceKm: Number.isFinite(distance) ? distance : null,
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
    var weightOnly = topWeightFilterActive();
    if (!speedingOnly && !idlingOnly && !weightOnly) return true;
    if (speedingOnly && metric.topSpeedingRank) return true;
    if (idlingOnly && metric.topIdlingRank) return true;
    if (weightOnly && metric.topWeightRank) return true;
    return false;
  }
  var CATEGORY_COLORS = {
    speeding: '#ff7043',
    idling: '#4fc3f7',
    weight: '#b388ff',
    other: '#90a4ae'
  };

  /**
   * Which control section an event belongs to, so its legend row carries the
   * same colour as the section that produced it.
   * @param {object} metric - A mapped event.
   */
  function metricCategory(metric) {
    if (weightModeActive() || (metric && metric.weight)) return 'weight';
    var rule = { name: (metric && metric.ruleName) || '' };
    if (ruleIsIdling(rule)) return 'idling';
    if (ruleIsSpeeding(rule)) return 'speeding';
    return 'other';
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
  /**
   * The axle scale register is keyed on the asset name with punctuation and
   * spacing removed, so "COM-001" in the register matches "COM 001" in
   * MyGeotab.
   * @param {string} value - A vehicle or asset name.
   */
  function normalizeAssetName(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function weightRegisterFor(name) {
    if (typeof WEIGHT_REGISTER === 'undefined' || !WEIGHT_REGISTER) return null;
    return WEIGHT_REGISTER[normalizeAssetName(name)] || null;
  }
  function weightFallbackKg() {
    return positiveNumber(elWeightFallbackTonnes && elWeightFallbackTonnes.value, WEIGHT_DEFAULT_FALLBACK_TONNES) * 1000;
  }
  function weightWarnPct() {
    return positiveNumber(elWeightWarnPct && elWeightWarnPct.value, WEIGHT_DEFAULT_WARN_PCT);
  }

  /**
   * Payload limits for a vehicle: the register gives an alert limit at the GML
   * payload and a critical limit at the GVM payload; anything not in the
   * register falls back to the entered tonnage.
   * @param {string} vehicleName - The MyGeotab device name.
   */
  function weightLimitsFor(vehicleName) {
    var register = weightRegisterFor(vehicleName);
    if (register && register.payload) {
      return {
        register: register,
        alertKg: register.payload,
        criticalKg: register.gvm && register.tare ? register.gvm - register.tare : null,
        source: 'register'
      };
    }
    var fallback = weightFallbackKg();
    return {
      register: register,
      alertKg: fallback > 0 ? fallback : null,
      criticalKg: null,
      source: 'fallback'
    };
  }
  function classifyWeight(kg, limits) {
    if (!Number.isFinite(kg)) return 'unknown';
    // A reported weight with nothing to compare it against is unknown, not safe.
    if (!limits || limits.alertKg == null) return 'unknown';
    if (limits.criticalKg && kg >= limits.criticalKg) return 'critical';
    if (kg >= limits.alertKg) return 'over';
    if (kg >= limits.alertKg * (weightWarnPct() / 100)) return 'warn';
    return 'under';
  }
  function weightStatusIsOver(status) {
    return status === 'over' || status === 'critical';
  }
  function formatTonnes(kg, digits) {
    if (!Number.isFinite(kg)) return '\u2013';
    return (kg / 1000).toFixed(digits == null ? 2 : digits);
  }
  function cacheModeSelected() {
    return !!(elDataSourceCache && elDataSourceCache.checked);
  }

  /**
   * Weight history and the live monitor are not in the offline cache, so they
   * always read MyGeotab even when the cache is selected.
   */
  function cacheModeActive() {
    return cacheModeSelected() && !weightModeActive();
  }
  function setCacheStatus(text, isError) {
    if (!elCacheStatus) return;
    elCacheStatus.textContent = text || '';
    elCacheStatus.classList.toggle('is-error', !!isError);
  }
  function cacheBaseUrl() {
    var value = String((elCacheBaseUrl && elCacheBaseUrl.value) || '').trim();
    return value.replace(/\/+$/, '');
  }
  function loadCacheScript(url) {
    if (cacheScripts[url]) return cacheScripts[url];
    cacheScripts[url] = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timer = setTimeout(function () {
        script.remove();
        reject(new Error('timed out loading ' + url));
      }, CACHE_SCRIPT_TIMEOUT_MS);
      script.src = url;
      script.onload = function () {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = function () {
        clearTimeout(timer);
        script.remove();
        reject(new Error('could not load ' + url));
      };
      document.head.appendChild(script);
    });
    cacheScripts[url].catch(function () {
      delete cacheScripts[url];
    });
    return cacheScripts[url];
  }
  window.registerHeatmapMonth = function (monthId, payload) {
    cacheMonths[monthId] = payload || {};
  };
  function loadCacheIndex() {
    if (cacheIndex) return Promise.resolve(cacheIndex);
    var base = cacheBaseUrl();
    if (!base) return Promise.reject(new Error('no cache address is set'));
    return loadCacheScript(base + '/cache-index.js').then(function () {
      cacheIndex = window.HEATMAP_INDEX || null;
      if (!cacheIndex) throw new Error('the cache index did not load any data');
      return cacheIndex;
    });
  }
  function cacheMonthIds(from, to) {
    var ids = [];
    var cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    var last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
    while (cursor.getTime() <= last && ids.length < 24) {
      ids.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return ids;
  }

  /**
   * Only the months the cache index knows about are requested, so a range wider
   * than the cache does not produce a run of failed script loads.
   */
  function loadCacheMonths(ids) {
    var base = cacheBaseUrl();
    var known = (cacheIndex && cacheIndex.months || []).map(function (month) {
      return String(month.id || month);
    });
    var wanted = ids.filter(function (id) {
      return !known.length || known.indexOf(id) !== -1;
    });
    return Promise.all(wanted.map(function (id) {
      if (cacheMonths[id]) return Promise.resolve();
      return loadCacheScript(base + '/months/' + id + '.js');
    })).then(function () {
      return wanted;
    });
  }
  function cacheCoverageText() {
    var meta = (cacheIndex && cacheIndex.meta) || {};
    var built = meta.generatedAt ? new Date(meta.generatedAt) : null;
    return 'Cache covers ' + String(meta.from || '?').slice(0, 10) + ' to ' + String(meta.to || '?').slice(0, 10) + (built && !Number.isNaN(built.getTime()) ? ', built ' + built.toLocaleString() : '');
  }

  /**
   * Draws the heat layer from the offline cache. The cache stores day and grid
   * cell totals rather than individual events, so this is heat only: event
   * markers, measures and the per-event print table stay on the API path.
   */
  var displayCachedHeatMap = function displayCachedHeatMap() {
    var deviceIds = selectedDeviceIds();
    var ruleIds = exceptionModeActive() ? selectedExceptionRules().map(function (rule) {
      return rule.id;
    }) : [];
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
    if (!deviceIds.length || fromValue === '' || toValue === '') return;
    errorHandler('');
    messageHandler('');
    metricMapData = [];
    renderMetricMarkers();
    toggleLoading(true);
    showProgress('Loading cached history\u2026');
    var from = new Date(fromValue);
    var to = new Date(toValue);
    var fromDay = from.toISOString().slice(0, 10);
    var toDay = to.toISOString().slice(0, 10);
    loadCacheIndex().then(function () {
      return loadCacheMonths(cacheMonthIds(from, to));
    }).then(function (months) {
      var wantedDevices = {};
      deviceIds.forEach(function (id) {
        wantedDevices[id] = true;
      });
      var wantedRules = {};
      ruleIds.forEach(function (id) {
        wantedRules[id] = true;
      });
      var cells = {};
      var records = 0;
      var days = 0;
      months.forEach(function (monthId) {
        var month = cacheMonths[monthId] || {};
        var rows = (exceptionModeActive() ? month.exceptions : month.location) || [];
        rows.forEach(function (row) {
          if (row.date < fromDay || row.date > toDay) return;
          if (!wantedDevices[row.deviceId]) return;
          if (ruleIds.length && !wantedRules[row.ruleId]) return;
          records += Number(row.rawCount || row.eventCount) || 0;
          days++;
          (row.cells || []).forEach(function (cell) {
            var lat = Number(cell[0]);
            var lon = Number(cell[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            var key = lat.toFixed(5) + ',' + lon.toFixed(5);
            if (cells[key]) cells[key].value += Math.max(1, Number(cell[2]) || 1);
            else cells[key] = { lat: lat, lon: lon, value: Math.max(1, Number(cell[2]) || 1) };
          });
        });
      });
      var coordinates = Object.keys(cells).map(function (key) {
        return cells[key];
      });
      if (!coordinates.length) {
        errorHandler('The cache holds no ' + (exceptionModeActive() ? 'exceptions' : 'locations') + ' for the selected vehicles and dates. ' + cacheCoverageText() + '.');
        setCacheStatus(cacheCoverageText() + '.');
        toggleLoading(false);
        return;
      }
      coordinates = filterPointsBySelectedZones(coordinates);
      if (!coordinates.length) {
        errorHandler('No cached data falls inside the selected zone(s).');
        toggleLoading(false);
        return;
      }
      setHeatMapPoints(coordinates);
      heatMapLayer.setLatLngs(coordinates);
      map.fitBounds(coordinates.map(function (point) {
        return new L.LatLng(point.lat, point.lon);
      }), { maxZoom: FIT_MAX_ZOOM });
      updateMapEventTotal();
      messageHandler('Displaying ' + formatNumber(coordinates.length) + ' cached heat cells from ' + formatNumber(records) + ' ' + (exceptionModeActive() ? 'exception events' : 'log records') + ' across ' + formatNumber(days) + ' vehicle days. [' + getElapsedTimeSeconds() + ' sec]');
      errorHandler('Note: the cache stores day and grid cell totals, so event details, measures, speed bands, ring-fencing and the per-event print table need the MyGeotab API data source.');
      setCacheStatus(cacheCoverageText() + '.');
      toggleLoading(false);
    })['catch'](function (error) {
      setCacheStatus('Cache unavailable: ' + (error && error.message ? error.message : 'unknown error') + '. Check the cache address and that the local viewer is running.', true);
      errorHandler('Could not read the local cache, so nothing was displayed. Switch to the MyGeotab API data source, or start the local cache viewer.');
      toggleLoading(false);
    });
  };

  /**
   * The selected vehicle ids, shared by the API and cache paths.
   */
  function selectedDeviceIds() {
    var ids = [];
    if (!elVehicles) return ids;
    for (var i = 0; i < elVehicles.options.length; i++) {
      if (elVehicles.options[i].selected) ids.push(elVehicles.options[i].value || elVehicles.options[i].text);
    }
    return ids;
  }
  function setWeightStatus(text) {
    if (elWeightStatus) elWeightStatus.textContent = text || '';
  }
  function topWeightFilterActive() {
    return !!(elTopWeightOnly && elTopWeightOnly.checked);
  }
  function weightOverOnlyActive() {
    return !!(elWeightOverOnly && elWeightOverOnly.checked);
  }
  function metricPassesWeightFilter(metric) {
    if (metric.kind !== 'weight') return true;
    if (weightOverOnlyActive() && !weightStatusIsOver(metric.weightStatus)) return false;
    return true;
  }

  /**
   * Ranks each vehicle's worst weight events by how far over its payload limit
   * they went, so the five worst can be ring-fenced like speeding and idling.
   */
  function annotateMetricsWithWeight() {
    var byVehicle = {};
    var over = 0;
    var peakPct = null;
    var events = 0;
    metricMapData.forEach(function (metric) {
      metric.topWeightRank = null;
      if (metric.kind !== 'weight') return;
      events++;
      if (weightStatusIsOver(metric.weightStatus)) over++;
      if (Number.isFinite(metric.weightPct) && (peakPct == null || metric.weightPct > peakPct)) peakPct = metric.weightPct;
      if (!metricPassesWeightFilter(metric)) return;
      var key = metric.vehicleName || '';
      if (!byVehicle[key]) byVehicle[key] = [];
      byVehicle[key].push(metric);
    });
    Object.keys(byVehicle).forEach(function (key) {
      byVehicle[key].sort(function (a, b) {
        return (b.weightPct || 0) - (a.weightPct || 0) || (b.weightKg || 0) - (a.weightKg || 0);
      }).slice(0, TOP_WEIGHT_PER_VEHICLE).forEach(function (metric, position) {
        metric.topWeightRank = position + 1;
      });
    });
    if (events) {
      setWeightStatus(formatNumber(events) + ' weight event' + (events === 1 ? '' : 's') + ' \u2022 ' + formatNumber(over) + ' over the payload limit' + (peakPct == null ? '' : ' \u2022 worst ' + Math.round(peakPct) + '% of limit') + '.');
    }
  }

  /**
   * Weight legend rows: how much of the mapped load was over the limit, and how
   * many ringed worst-overload markers are drawn.
   */
  function weightLegendRows() {
    var weights = metricMapData.filter(function (metric) {
      return metric.kind === 'weight' && metricPassesZoneFilter(metric) && metricPassesWeightFilter(metric);
    });
    if (!weights.length) return '';
    var counts = {};
    weights.forEach(function (metric) {
      counts[metric.weightStatus] = (counts[metric.weightStatus] || 0) + 1;
    });
    var rows = Object.keys(WEIGHT_STATUS_LABELS).filter(function (status) {
      return counts[status];
    }).map(function (status) {
      return '<span class="speed-band-row"><i style="--zone-color:' + WEIGHT_STATUS_COLORS[status] + '"></i>' + escapeHtml(WEIGHT_STATUS_LABELS[status]) + ' <b>' + formatNumber(counts[status]) + '</b></span>';
    }).join('');
    var ranked = weights.filter(function (metric) {
      return metric.topWeightRank;
    });
    return '<strong class="speed-band-heading">Weight</strong>' + rows + '<span class="top-weight-row' + (topWeightFilterActive() ? ' is-only' : '') + '">Top ' + TOP_WEIGHT_PER_VEHICLE + ' overloads per vehicle <b>' + formatNumber(ranked.length) + '</b></span>';
  }

  /**
   * Redraws weight presentation after a limit or filter change, without
   * refetching anything from MyGeotab.
   */
  function refreshWeightPresentation() {
    annotateMetricsWithWeight();
    displayMetricLegend(metricMapData);
    renderMetricMarkers();
    updateMapEventTotal();
    renderLiveVehicles();
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
    if (metric.kind === 'weight') return true;
    if (!speedBandFilterActive()) return true;
    if (metric.speedBand == null) return false;
    return selectedSpeedBands.indexOf(metric.speedBand) !== -1;
  }

  /**
   * Every filter an event has to pass to be drawn and counted.
   * @param {object} metric - A mapped exception event.
   */
  function metricPassesFilters(metric) {
    return metricPassesZoneFilter(metric) && metricPassesBandFilter(metric) && metricPassesIdleDurationFilter(metric) && metricPassesWeightFilter(metric) && metricPassesRankFilters(metric);
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
          category: metricCategory(metric),
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
      element.innerHTML = '<strong>' + (weightModeActive() ? 'Weight legend' : 'Exception legend') + '</strong>' + rules.map(function (rule) {
        return '<span class="metric-legend-rule is-' + rule.category + '" style="--category-color:' + CATEGORY_COLORS[rule.category] + '"><i></i>' + escapeHtml(rule.name) + ' <b>' + formatNumber(rule.count) + '</b></span>';
      }).join('') + speedBandLegendRows() + topSpeedingLegendRow() + idlingLegendRows() + weightLegendRows() + '<label class="metric-detail-toggle"><input type="checkbox"> Show event details</label>' + '<small>' + (weightModeActive() ? 'Marker fill is the vehicle colour and the ring shows how the load compares with the axle scale register; heat intensity follows the percentage of the payload limit.' : 'Event marker colours match the vehicle legend, their ring shows the Risk Management speed band, and speeding events also show the posted limit as a road sign. Heat colouring can be toggled separately in the Exceptions controls.') + '</small>';
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
    if (weightModeActive()) return '';
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
      var calloutText = metric.ruleName + " \u2192 " + metric.label + (metric.topWeightRank ? ' \u2022 #' + metric.topWeightRank + ' worst load for this vehicle' : '') + (metric.schoolZoneSpeeding ? ' (' + zoneWord + ')' : '') + (bandText && metric.speedBand > 0 ? ' \u2022 band ' + metric.speedBand : '') + (metric.topSpeedingRank ? ' \u2022 #' + metric.topSpeedingRank + ' fastest for this vehicle' : '') + (metric.topIdlingRank ? ' \u2022 #' + metric.topIdlingRank + ' costliest idling for this vehicle' : '');
      var rank = metric.topSpeedingRank || metric.topIdlingRank || metric.topWeightRank;
      var popupHtml = metric.popup + (metric.topSpeedingRank ? '<br><span class="top-speeding-flag">#' + metric.topSpeedingRank + ' fastest speeding event for ' + escapeHtml(metric.vehicleName || 'this vehicle') + '</span>' : '') + (metric.kind === 'idle' ? '<br><span class="idling-flag">' + (metric.topIdlingRank ? '#' + metric.topIdlingRank + ' costliest idling event for ' + escapeHtml(metric.vehicleName || 'this vehicle') + ' \u2014 ' : '') + Math.round(metric.idleMinutes || 0) + ' min idling \u2022 ' + (metric.idleLitres || 0).toFixed(1) + ' L \u2022 $' + (metric.idleCost || 0).toFixed(2) + ' at ' + idleFuelBurn() + ' L/h and $' + idleFuelPrice().toFixed(2) + '/L</span>' : '') + (bandText ? '<br><span class="speed-band-flag">' + escapeHtml(bandText) + (Number.isFinite(metric.vehicleSpeed) ? ' \u2014 vehicle ' + metric.vehicleSpeed + ' km/h' : '') + '</span>' : '') + (metric.schoolZone ? '<br><span class="school-zone-flag">' + (metric.schoolZoneSpeeding ? 'Over the ' + zoneWord + ' limit' : 'Inside a ' + zoneWord) + ': ' + escapeHtml(describeSchoolZone(metric.schoolZone)) + (Number.isFinite(metric.vehicleSpeed) ? ' \u2014 vehicle ' + metric.vehicleSpeed + ' km/h' : '') + '</span>' : '');
      var bandRing = metric.speedBand > 0 && metric.kind !== 'weight' ? speedBandByIndex(metric.speedBand) : null;
      var weightRing = metric.kind === 'weight' ? WEIGHT_STATUS_COLORS[metric.weightStatus] || null : null;
      var dot = L.circleMarker([metric.lat, metric.lon], {
        radius: rank ? 7 : bandRing || weightRing ? 5 : 4,
        color: weightRing ? weightRing : bandRing ? bandRing.color : metric.topSpeedingRank ? '#ffd166' : metric.topIdlingRank ? '#4fc3f7' : '#ffffff',
        weight: rank ? 3 : bandRing || weightRing ? 2 : 1,
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
          className: 'event-metric-marker event-metric-' + metric.kind + (metric.topSpeedingRank ? ' is-top-speeding' : '') + (metric.topIdlingRank ? ' is-top-idling' : '') + (metric.topWeightRank ? ' is-top-weight' : ''),
          html: '<span style="--rule-color:' + metric.color + "\">\u2192 " + escapeHtml(metric.label) + (metric.schoolZoneSpeeding ? ' \uD83C\uDFEB' : '') + (rank ? '<b class="' + (metric.topSpeedingRank ? 'top-speeding-rank' : metric.topIdlingRank ? 'top-idling-rank' : 'top-weight-rank') + '">#' + rank + '</b>' : '') + '</span>',
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
    annotateMetricsWithWeight();
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
      var send = function send() {
        var wait = apiQuotaDelayMs(calls.length);
        if (wait > 0) {
          setTimeout(send, wait);
          return;
        }
        recordApiCalls(calls.length);
        api.multiCall(calls, function (results) {
          return resolve(results || []);
        }, reject);
      };
      send();
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
   * The windows to fetch GPS for one vehicle in. Nearby events share a window,
   * and the widest gaps are merged away until the vehicle needs no more than
   * GPS_WINDOWS_PER_VEHICLE requests, which keeps a wide date range inside
   * MyGeotab's calls-per-minute quota.
   * @param {Array} events - One vehicle's ExceptionEvents.
   */
  function gpsFetchWindows(events) {
    var windows = (events || []).map(function (event) {
      var from = new Date(event.activeFrom).getTime();
      var to = new Date(event.activeTo || event.activeFrom).getTime();
      return {
        from: from,
        to: Math.max(from, Number.isFinite(to) ? to : from)
      };
    }).filter(function (window) {
      return Number.isFinite(window.from);
    }).sort(function (a, b) {
      return a.from - b.from;
    });
    var merged = [];
    windows.forEach(function (window) {
      var previous = merged[merged.length - 1];
      if (previous && window.from <= previous.to + GPS_WINDOW_MERGE_MS) {
        previous.to = Math.max(previous.to, window.to);
      } else {
        merged.push({
          from: window.from,
          to: window.to
        });
      }
    });
    while (merged.length > GPS_WINDOWS_PER_VEHICLE) {
      var narrowest = 0;
      for (var index = 1; index < merged.length - 1; index++) {
        if (merged[index + 1].from - merged[index].to < merged[narrowest + 1].from - merged[narrowest].to) {
          narrowest = index;
        }
      }
      merged[narrowest].to = merged[narrowest + 1].to;
      merged.splice(narrowest + 1, 1);
    }
    return merged;
  }

  /**
   * The records that fall inside one event's own window, from its vehicle's
   * pooled and time-sorted records.
   * @param {Array} records - The vehicle's LogRecords, sorted by dateTime.
   * @param {object} event - The ExceptionEvent being located.
   */
  function recordsInEventWindow(records, event) {
    var from = new Date(event.activeFrom).getTime();
    var to = new Date(event.activeTo || event.activeFrom).getTime();
    if (!Number.isFinite(to) || to < from) to = from;
    var inside = [];
    for (var index = 0; index < records.length; index++) {
      var time = new Date(records[index].dateTime).getTime();
      if (time > to) break;
      if (time >= from) inside.push(records[index]);
    }
    return inside;
  }

  /**
   * At most limit items, taken a slice at a time from each group so every group
   * is represented rather than the first groups filling the whole allowance.
   * @param {Array} groups - Arrays of items to draw from.
   * @param {number} limit - Most items to return.
   */
  function takeAcrossGroups(groups, limit) {
    var taken = [];
    var slice = Math.max(1, Math.floor(limit / Math.max(1, groups.length)));
    var offsets = groups.map(function () {
      return 0;
    });
    var exhausted = false;
    while (taken.length < limit && !exhausted) {
      exhausted = true;
      for (var index = 0; index < groups.length && taken.length < limit; index++) {
        var group = groups[index];
        var end = Math.min(group.length, offsets[index] + slice, offsets[index] + limit - taken.length);
        if (end > offsets[index]) {
          taken = taken.concat(group.slice(offsets[index], end));
          offsets[index] = end;
          exhausted = false;
        }
      }
    }
    return taken;
  }

  /**
   * A MyGeotab API error as something a driver manager can act on.
   * @param {*} error - The error the API reported.
   */
  function readableApiError(error) {
    var text = String(error && error.message || error || 'Unknown error');
    if (text.indexOf('OverLimit') > -1 || text.indexOf('quota') > -1) {
      return 'MyGeotab is rate limiting this database (' + text + '). Wait a minute, then search a shorter date range or fewer vehicles.';
    }
    return text;
  }
  function recordApiCalls(count) {
    var now = Date.now();
    for (var index = 0; index < count; index++) {
      apiCallTimestamps.push(now);
    }
  }

  /**
   * How long to wait before issuing the next batch without exceeding the
   * calls-per-minute quota. Returns 0 when the batch can go out now.
   * @param {number} count - Calls in the next batch.
   */
  function apiQuotaDelayMs(count) {
    var cutoff = Date.now() - 60000;
    while (apiCallTimestamps.length && apiCallTimestamps[0] < cutoff) {
      apiCallTimestamps.shift();
    }
    if (apiCallTimestamps.length + count <= apiCallsPerMinuteBudget) return 0;
    var overBy = apiCallTimestamps.length + count - apiCallsPerMinuteBudget;
    var oldest = apiCallTimestamps[Math.min(overBy - 1, apiCallTimestamps.length - 1)];
    return Math.max(250, oldest + 60000 - Date.now());
  }
  /**
   * Runs a large request list as paced multicalls, reporting progress on the
   * centre bar, and hands back every result in the original order.
   * @param {Array} calls - The full list of API calls.
   * @param {string} label - Caption shown above the progress bar.
   * @param {Function} onDone - Called with the combined results.
   * @param {Function} onError - Called with the first error.
   */
  function multiCallChunked(calls, label, onDone, onError) {
    var results = [];
    var index = 0;
    if (!calls.length) {
      onDone(results);
      return;
    }
    var runNext = function runNext() {
      if (index >= calls.length) {
        onDone(results);
        return;
      }
      var batch = calls.slice(index, index + multiCallChunkSize);
      var wait = apiQuotaDelayMs(batch.length);
      if (wait > 0) {
        showProgress(label + ' ' + formatNumber(index) + ' of ' + formatNumber(calls.length) + ' \u2014 waiting for the API quota\u2026');
        setTimeout(runNext, wait);
        return;
      }
      showProgress(label + ' ' + formatNumber(index) + ' of ' + formatNumber(calls.length) + '\u2026');
      recordApiCalls(batch.length);
      api.multiCall(batch, function (batchResults) {
        results = results.concat(batchResults);
        index += batch.length;
        // Yields to the browser so the bar repaints between batches.
        setTimeout(runNext, 0);
      }, onError);
    };
    runNext();
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
    if (cacheModeActive()) {
      displayCachedHeatMap();
    } else if (weightModeActive()) {
      displayWeightHistoryMap();
    } else if (exceptionModeActive()) {
      displayHeatMapForExceptionHistory();
    } else {
      displayHeatMapForLocationHistory();
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
    multiCallChunked(calls, 'Loading GPS history', function (results) {
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
        map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM });
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
      errorHandler(readableApiError(errorString));
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
    if (deviceIds.length * selectedRules.length > maxVehicleRuleCombinations) {
      errorHandler('Select fewer vehicles or rules. A maximum of ' + formatNumber(maxVehicleRuleCombinations) + ' vehicle/rule combinations is supported.');
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
    multiCallChunked(calls, 'Loading exceptions', function (results) {
      var eventTotals = selectedRules.map(function () {
        return 0;
      });
      var exceededResultsLimitCountForExceptionEvents = 0;
      var eventGroups = [];
      for (var _i5 = 0, len = results.length; _i5 < len; _i5++) {
        var exceptionEvents = results[_i5] || [];
        var ruleIndex = _i5 % selectedRules.length;
        var deviceIndex = Math.floor(_i5 / selectedRules.length);
        var vehicleName = deviceIds[deviceIndex];
        for (var optionIndex = 0; optionIndex < elVehicles.options.length; optionIndex++) {
          if (elVehicles.options[optionIndex].value === deviceIds[deviceIndex]) {
            vehicleName = elVehicles.options[optionIndex].text;
            break;
          }
        }
        eventTotals[ruleIndex] += exceptionEvents.length;
        var group = [];
        for (var _j = 0; _j < exceptionEvents.length; _j++) {
          group.push({
            event: exceptionEvents[_j],
            rule: selectedRules[ruleIndex],
            color: colorForVehicleId(deviceIds[deviceIndex]),
            vehicleName: vehicleName
          });
        }
        if (group.length) eventGroups.push(group);
        if (exceptionEvents.length >= myGeotabGetResultsLimit) {
          exceededResultsLimitCountForExceptionEvents++;
        }
      }

      // Name the rules that returned nothing, so an empty result is never just
      // "No data to display" when another rule did have events.
      var emptyRuleNames = selectedRules.filter(function (rule, index) {
        return !eventTotals[index];
      }).map(function (rule) {
        return rule.name;
      });
      var foundEvents = eventGroups.reduce(function (sum, group) {
        return sum + group.length;
      }, 0);
      if (!foundEvents) {
        errorHandler('No exceptions in this date range for ' + (emptyRuleNames.length === selectedRules.length ? 'the selected rule(s): ' + emptyRuleNames.join(', ') : emptyRuleNames.join(', ')) + '.');
        toggleLoading(false);
        return;
      }
      // Taken round-robin across the vehicle/rule pairs, so a range too wide to
      // map in full still shows every vehicle rather than only the first few.
      var eventInfos = takeAcrossGroups(eventGroups, maxLocatedEvents);
      var truncatedEvents = foundEvents - eventInfos.length;

      // GPS is fetched in merged per-vehicle windows rather than one request per
      // event: a month of fleet idling is thousands of events, which exceeds
      // MyGeotab's calls-per-minute quota and returns nothing at all.
      var eventsByDevice = {};
      eventInfos.forEach(function (info) {
        var deviceId = info.event.device.id;
        if (!eventsByDevice[deviceId]) eventsByDevice[deviceId] = [];
        eventsByDevice[deviceId].push(info.event);
      });
      var calls = [];
      var windowDevices = [];
      Object.keys(eventsByDevice).forEach(function (deviceId) {
        gpsFetchWindows(eventsByDevice[deviceId]).forEach(function (window) {
          windowDevices.push(deviceId);
          calls.push(['Get', {
            typeName: 'LogRecord',
            resultsLimit: myGeotabGetResultsLimit,
            search: {
              deviceSearch: {
                id: deviceId
              },
              fromDate: new Date(window.from).toISOString(),
              toDate: new Date(window.to).toISOString()
            }
          }]);
        });
      });
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
      var windowCallCount = windowDevices.length;
      multiCallChunked(calls, 'Locating exceptions', function (results) {
        var logResults = results.slice(0, windowCallCount);
        var roadResults = results.slice(windowCallCount);
        if (resultsEmpty(logResults)) {
          errorHandler('Found ' + formatNumber(eventInfos.length) + ' exception(s), but no GPS records to place them on the map.');
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

        // Pool each vehicle's records once, then hand every event the records
        // inside its own window.
        var logsByDevice = {};
        logResults.forEach(function (rows, index) {
          var deviceId = windowDevices[index];
          if (!logsByDevice[deviceId]) logsByDevice[deviceId] = [];
          logsByDevice[deviceId] = logsByDevice[deviceId].concat(rows || []);
          if ((rows || []).length >= myGeotabGetResultsLimit) {
            exceededResultsLimitCountForLogRecords++;
          }
        });
        Object.keys(logsByDevice).forEach(function (deviceId) {
          logsByDevice[deviceId].sort(function (a, b) {
            return new Date(a.dateTime) - new Date(b.dateTime);
          });
          logsByDevice[deviceId].forEach(function (record) {
            if (record.latitude !== 0 || record.longitude !== 0) logRecordCount++;
          });
        });
        var metrics = [];
        // Build one metric and one heat point per mapped ExceptionEvent.
        // LogRecords are used only to locate the event and calculate its metric;
        // they must not independently increase exception heat intensity.
        for (var _i6 = 0, _len2 = eventInfos.length; _i6 < _len2; _i6++) {
          var eventInfo = eventInfos[_i6];
          var logRecords = recordsInEventWindow(logsByDevice[eventInfo.event.device.id] || [], eventInfo.event);
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
          map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM });
          heatMapLayer.setLatLngs(coordinates);
          displayMetricMarkers(metrics);
          updateMapEventTotal();
          messageHandler("Displaying event-based heat from ".concat(formatNumber(metrics.length), " mapped exceptions\n          (").concat(formatNumber(logRecordCount), " supporting GPS records) across ").concat(formatNumber(selectedRules.length), " selected rules for the\n          ").concat(formatNumber(selectedVehicleCount), " selected vehicles. [").concat(getElapsedTimeSeconds(), " sec]"));

          if (truncatedEvents > 0) {
            errorHandler('Note: this range holds ' + formatNumber(eventInfos.length + truncatedEvents) + ' exceptions; ' + formatNumber(eventInfos.length) + ' of them were mapped, spread evenly across the selected vehicles and rules. Narrow the date range, the vehicles or the rules to map them all.');
          } else if (emptyRuleNames.length) {
            errorHandler('Note: no events in this range for ' + emptyRuleNames.join(', ') + '.');
          }

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
        errorHandler(readableApiError(errorString));
        toggleLoading(false);
      });
    }, function (errorString) {
      errorHandler(readableApiError(errorString));
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
    map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM });
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
  var requiredElementIds = ['heatmap', 'heatmap-map', 'exceptionTypes', 'speedingRules', 'idlingRules', 'idleMinMinutes', 'idleFuelBurn', 'idleFuelPrice', 'topIdlingOnly', 'showExceptionHeatMap', 'showSchoolZones', 'speedZoneCategories', 'schoolZonesOnly', 'eventsInZonesOnly', 'groupTypes', 'vehicleGroups', 'vehicles', 'zoneTypes', 'zones', 'from', 'to', 'showHeatMap', 'refreshAddIn', 'error', 'message', 'loading', 'map-event-total', 'visualizeByLocationHistory', 'visualizeByExceptionHistory', 'visualizeByWeightHistory', 'weightFallbackTonnes', 'weightWarnPct', 'weightOverOnly', 'topWeightOnly', 'liveMonitor', 'liveInterval', 'liveSpeedThreshold', 'liveAutoZoom', 'liveAlerts'];
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

  /**
   * The cargo weight diagnostic is resolved by name so each database uses its
   * own diagnostic id, and the result is kept for the session.
   * @returns {Promise} Resolves with the diagnostic id, or null when the
   * database has no cargo weight diagnostic.
   */
  function resolveWeightDiagnostic() {
    if (weightDiagnosticId) return Promise.resolve(weightDiagnosticId);
    return new Promise(function (resolve) {
      api.call('Get', {
        typeName: 'Diagnostic',
        search: { name: WEIGHT_DIAGNOSTIC_SEARCH },
        resultsLimit: 10
      }, function (diagnostics) {
        var match = (diagnostics || [])[0];
        weightDiagnosticId = match && match.id ? match.id : null;
        resolve(weightDiagnosticId);
      }, function () {
        resolve(null);
      });
    });
  }

  /**
   * StatusData is read in windows: Get gives no ordering guarantee, so a single
   * window large enough to hit the results limit could silently discard the
   * newest readings.
   * @param {Date} from - Start of the range.
   * @param {Date} to - End of the range.
   */
  function weightWindows(from, to) {
    var windows = [];
    var cursor = from.getTime();
    var end = to.getTime();
    var span = WEIGHT_WINDOW_HOURS * 3600000;
    while (cursor < end && windows.length < WEIGHT_MAX_WINDOWS) {
      var next = Math.min(cursor + span, end);
      windows.push([new Date(cursor), new Date(next)]);
      cursor = next;
    }
    return windows;
  }

  /**
   * Locates a weight reading by the closest GPS record in time. Readings with
   * no position within the tolerance cannot be mapped.
   * @param {Array} logs - The device's GPS records, ascending by time.
   * @param {number} stamp - The reading's timestamp in milliseconds.
   */
  function nearestLogRecord(logs, stamp) {
    var best = null;
    var bestGap = Infinity;
    for (var i = 0; i < logs.length; i++) {
      var gap = Math.abs(new Date(logs[i].dateTime).getTime() - stamp);
      if (gap < bestGap) {
        bestGap = gap;
        best = logs[i];
      } else if (gap > bestGap && bestGap < WEIGHT_MATCH_TOLERANCE_MS) {
        break;
      }
    }
    return bestGap <= WEIGHT_MATCH_TOLERANCE_MS ? best : null;
  }

  /**
   * Consecutive readings at or above the warning level become one event, so a
   * vehicle sitting loaded for an hour is one overload rather than hundreds of
   * markers. The event carries the run's peak weight and its duration.
   * @param {object} vehicle - {id, name, color}.
   * @param {Array} readings - {stamp, kg} sorted ascending.
   * @param {Array} logs - The device's GPS records.
   */
  function buildWeightMetrics(vehicle, readings, logs) {
    var limits = weightLimitsFor(vehicle.name);
    var warnKg = limits.alertKg == null ? null : limits.alertKg * (weightWarnPct() / 100);
    var metrics = [];
    var run = null;
    var flush = function flush() {
      if (!run) return;
      var log = nearestLogRecord(logs, run.peakStamp);
      if (log && Number.isFinite(run.kg)) {
        var status = classifyWeight(run.kg, limits);
        var pct = limits.alertKg ? run.kg / limits.alertKg * 100 : null;
        var register = limits.register;
        var durationMs = Math.max(0, run.lastStamp - run.firstStamp);
        metrics.push({
          lat: Number(log.latitude),
          lon: Number(log.longitude),
          kind: 'weight',
          label: formatTonnes(run.kg) + ' t' + (pct == null ? '' : ' \u2022 ' + Math.round(pct) + '%'),
          ruleName: WEIGHT_STATUS_LABELS[status] || 'Cargo weight',
          vehicleName: vehicle.name,
          color: vehicle.color,
          startTime: new Date(run.firstStamp).toISOString(),
          durationMs: durationMs,
          weightKg: run.kg,
          weightPct: pct,
          weightStatus: status,
          weightLimitKg: limits.alertKg,
          weightCriticalKg: limits.criticalKg,
          weightSource: limits.source,
          weightRego: register ? register.rego : null,
          weightAxles: register ? register.axles : null,
          weightReadings: run.count,
          speedLimit: null,
          vehicleSpeed: null,
          popup: '<strong>' + escapeHtml(vehicle.name) + (register ? ' \u2014 ' + escapeHtml(register.rego) + ' \u2022 ' + escapeHtml(register.axles) : '') + '</strong><br>' + 'Cargo: <span class="weight-' + status + '">' + formatTonnes(run.kg) + ' t</span>' + (pct == null ? '' : ' \u2014 ' + Math.round(pct) + '% of limit') + '<br>' + escapeHtml(WEIGHT_STATUS_LABELS[status] || '') + '<br>' + (register ? 'Tare ' + formatTonnes(register.tare) + ' t \u2022 GML ' + formatTonnes(register.gml, 1) + ' t \u2022 GVM ' + formatTonnes(register.gvm, 1) + ' t<br>Payload limit ' + formatTonnes(register.payload) + ' t (GML)' + (limits.criticalKg ? ' \u2022 ' + formatTonnes(limits.criticalKg) + ' t (GVM)' : '') : 'Not in the axle scale register \u2014 using the fallback limit of ' + formatTonnes(limits.alertKg) + ' t') + '<br>' + formatNumber(run.count) + ' reading' + (run.count === 1 ? '' : 's') + ' over ' + formatDuration(durationMs) + '<br>' + escapeHtml(new Date(run.firstStamp).toLocaleString())
        });
      }
      run = null;
    };
    readings.forEach(function (reading) {
      var interesting = warnKg == null ? true : reading.kg >= warnKg;
      if (!interesting) {
        flush();
        return;
      }
      if (run && reading.stamp - run.lastStamp > WEIGHT_RUN_GAP_MS) flush();
      if (!run) {
        run = {
          kg: reading.kg,
          peakStamp: reading.stamp,
          firstStamp: reading.stamp,
          lastStamp: reading.stamp,
          count: 0
        };
      }
      if (reading.kg > run.kg) {
        run.kg = reading.kg;
        run.peakStamp = reading.stamp;
      }
      run.lastStamp = reading.stamp;
      run.count++;
    });
    flush();
    return metrics;
  }

  /**
   * Maps the cargo weight recorded over the selected range against the axle
   * scale register.
   */
  var displayWeightHistoryMap = function displayWeightHistoryMap() {
    var vehicles = [];
    for (var i = 0; i < elVehicles.options.length; i++) {
      var option = elVehicles.options[i];
      if (option.selected) {
        vehicles.push({
          id: option.value || option.text,
          name: option.text,
          color: colorForVehicleId(option.value || option.text)
        });
      }
    }
    var fromValue = elDateFromInput.value;
    var toValue = elDateToInput.value;
    errorHandler('');
    messageHandler('');
    if (!vehicles.length || fromValue === '' || toValue === '') {
      errorHandler('Select at least one vehicle and a date range.');
      return;
    }
    var from = new Date(fromValue);
    var to = new Date(toValue);
    var windows = weightWindows(from, to);
    if (!windows.length) {
      errorHandler('Select a date range that ends after it starts.');
      return;
    }
    if (vehicles.length * windows.length > 400) {
      errorHandler('Select fewer vehicles or a shorter date range: ' + formatNumber(vehicles.length * windows.length) + ' weight requests would be needed.');
      return;
    }
    toggleLoading(true);
    resolveWeightDiagnostic().then(function (diagnosticId) {
      if (!diagnosticId) {
        errorHandler('This database has no cargo weight diagnostic, so weight history is unavailable.');
        toggleLoading(false);
        return;
      }
      var calls = [];
      vehicles.forEach(function (vehicle) {
        windows.forEach(function (window_) {
          calls.push(['Get', {
            typeName: 'StatusData',
            resultsLimit: WEIGHT_RESULTS_LIMIT,
            search: {
              deviceSearch: { id: vehicle.id },
              diagnosticSearch: { id: diagnosticId },
              fromDate: window_[0].toISOString(),
              toDate: window_[1].toISOString()
            }
          }]);
        });
      });
      vehicles.forEach(function (vehicle) {
        calls.push(['Get', {
          typeName: 'LogRecord',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: { id: vehicle.id },
            fromDate: from.toISOString(),
            toDate: to.toISOString()
          }
        }]);
      });
      multiCallChunked(calls, 'Loading cargo weight', function (results) {
        var statusCount = vehicles.length * windows.length;
        var metrics = [];
        var readingTotal = 0;
        vehicles.forEach(function (vehicle, vehicleIndex) {
          var readings = [];
          for (var w = 0; w < windows.length; w++) {
            (results[vehicleIndex * windows.length + w] || []).forEach(function (row) {
              if (row.data === null || row.data === undefined) return;
              var stamp = new Date(row.dateTime).getTime();
              if (!Number.isFinite(stamp)) return;
              // Cargo weight is reported in grams, as the weight dashboard reads it.
              readings.push({ stamp: stamp, kg: Number(row.data) / 1000 });
            });
          }
          readings.sort(function (a, b) {
            return a.stamp - b.stamp;
          });
          readingTotal += readings.length;
          var logs = validLogRecords(results[statusCount + vehicleIndex] || []).slice().sort(function (a, b) {
            return new Date(a.dateTime) - new Date(b.dateTime);
          });
          metrics = metrics.concat(buildWeightMetrics(vehicle, readings, logs));
        });
        if (!metrics.length) {
          resetHeatMapLayer();
          displayMetricMarkers([]);
          displayMetricLegend([]);
          setWeightStatus(readingTotal ? formatNumber(readingTotal) + ' weight readings found, but none could be placed on the map or reached the warning level.' : 'No cargo weight readings were recorded for the selected vehicles and range.');
          errorHandler(readingTotal ? 'No mappable weight events in this range.' : 'No cargo weight data to display.');
          toggleLoading(false);
          return;
        }
        var coordinates = metrics.map(function (metric) {
          // Heat intensity follows how heavily loaded the vehicle was.
          return {
            lat: metric.lat,
            lon: metric.lon,
            value: metric.weightPct ? Math.max(1, metric.weightPct / 100) : 1
          };
        });
        coordinates = filterPointsBySelectedZones(coordinates);
        metrics = filterPointsBySelectedZones(metrics);
        if (!coordinates.length) {
          errorHandler('No weight events fall inside the selected zone(s).');
          toggleLoading(false);
          return;
        }
        setHeatMapPoints(coordinates);
        map.fitBounds(coordinates.map(function (point) {
          return new L.LatLng(point.lat, point.lon);
        }), { maxZoom: FIT_MAX_ZOOM });
        heatMapLayer.setLatLngs(coordinates);
        displayMetricMarkers(metrics);
        updateMapEventTotal();
        var over = metrics.filter(function (metric) {
          return weightStatusIsOver(metric.weightStatus);
        }).length;
        var unregistered = vehicles.filter(function (vehicle) {
          return !weightRegisterFor(vehicle.name);
        }).length;
        messageHandler('Displaying ' + formatNumber(metrics.length) + ' weight events (' + formatNumber(over) + ' over the payload limit) from ' + formatNumber(readingTotal) + ' cargo weight readings for the ' + formatNumber(vehicles.length) + ' selected vehicles. [' + getElapsedTimeSeconds() + ' sec]');
        if (unregistered) {
          errorHandler('Note: ' + formatNumber(unregistered) + ' selected vehicle' + (unregistered === 1 ? ' is' : 's are') + ' not in the axle scale register, so the fallback payload limit was used.');
        }
        toggleLoading(false);
      }, function (error) {
        errorHandler(error);
        toggleLoading(false);
      });
    });
  };

  /**
   * Live monitoring: current positions with speed, payload and new-exception
   * alerts. MyGeotab exposes no push channel to an add-in, so this polls.
   */
  function liveMonitorEnabled() {
    return !!(elLiveMonitor && elLiveMonitor.checked);
  }
  function liveSpeedThreshold() {
    return positiveNumber(elLiveSpeedThreshold && elLiveSpeedThreshold.value, 0);
  }
  function setLiveStatus(text, isError) {
    if (!elLiveStatus) return;
    elLiveStatus.textContent = text || '';
    elLiveStatus.classList.toggle('is-error', !!isError);
  }
  function liveIntervalMs() {
    return positiveNumber(elLiveInterval && elLiveInterval.value, 60) * 1000;
  }

  /**
   * Restarts the poll timer. Polling is suspended while the tab is hidden so a
   * backgrounded add-in does not keep querying the fleet.
   */
  function applyLiveMonitor() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    if (!liveMonitorEnabled()) {
      clearLiveLayer();
      setLiveStatus('');
      return;
    }
    if (document.hidden) {
      setLiveStatus('Live monitor paused while this tab is hidden.');
      return;
    }
    pollLiveData();
    liveTimer = setInterval(pollLiveData, liveIntervalMs());
  }
  function clearLiveLayer() {
    if (liveLayer) {
      map.removeLayer(liveLayer);
      liveLayer = null;
    }
    liveVehicles = [];
    renderLiveAlertList();
  }

  /**
   * One poll: current positions, recent cargo weight, and any new exceptions
   * for the selected rules from the exception feed.
   */
  function pollLiveData() {
    if (!api || liveLoading || !liveMonitorEnabled() || document.hidden) return;
    liveLoading = true;
    setLiveStatus('Refreshing live positions\u2026');
    var wantWeight = !!(elLiveWeightAlerts && elLiveWeightAlerts.checked);
    var wantExceptions = !!(elLiveExceptionAlerts && elLiveExceptionAlerts.checked) && selectedExceptionRules().length > 0;
    resolveWeightDiagnostic().then(function (diagnosticId) {
      var calls = [['Get', { typeName: 'DeviceStatusInfo' }]];
      var weightIndex = -1;
      var feedIndex = -1;
      if (wantWeight && diagnosticId) {
        weightIndex = calls.length;
        calls.push(['Get', {
          typeName: 'StatusData',
          resultsLimit: WEIGHT_RESULTS_LIMIT,
          search: {
            diagnosticSearch: { id: diagnosticId },
            fromDate: new Date(Date.now() - LIVE_WEIGHT_LOOKBACK_MS).toISOString(),
            toDate: new Date().toISOString()
          }
        }]);
      }
      if (wantExceptions) {
        feedIndex = calls.length;
        // The feed's version cursor guarantees no event is missed or repeated;
        // a from date only seeds the very first poll.
        var feedRequest = { typeName: 'ExceptionEvent', resultsLimit: 1000 };
        if (liveFeedVersion) {
          feedRequest.fromVersion = liveFeedVersion;
        } else {
          feedRequest.search = { fromDate: new Date(Date.now() - LIVE_EXCEPTION_ALERT_MS).toISOString() };
        }
        calls.push(['GetFeed', feedRequest]);
      }
      api.multiCall(calls, function (results) {
        applyLiveResults(results[0] || [], weightIndex === -1 ? [] : results[weightIndex] || [], feedIndex === -1 ? null : results[feedIndex]);
        liveLoading = false;
      }, function (error) {
        liveLoading = false;
        setLiveStatus('Live monitor failed: ' + (error && error.message ? error.message : error), true);
      });
    });
  }

  /**
   * Turns a poll's results into live vehicles and alerts.
   * @param {Array} statusInfos - DeviceStatusInfo rows.
   * @param {Array} weightRows - Recent cargo weight StatusData rows.
   * @param {object} feed - The ExceptionEvent feed result, when requested.
   */
  function applyLiveResults(statusInfos, weightRows, feed) {
    var nameById = {};
    allVehicles.forEach(function (vehicle) {
      nameById[vehicle.id] = vehicle.name || vehicle.id;
    });
    var selectedIds = selectedValues(elVehicles);
    var latestWeight = {};
    (weightRows || []).forEach(function (row) {
      if (row.data === null || row.data === undefined || !row.device || !row.device.id) return;
      var stamp = new Date(row.dateTime).getTime();
      if (!Number.isFinite(stamp)) return;
      var current = latestWeight[row.device.id];
      if (!current || stamp > current.stamp) latestWeight[row.device.id] = { stamp: stamp, kg: Number(row.data) / 1000 };
    });
    if (feed) {
      if (feed.toVersion) liveFeedVersion = feed.toVersion;
      var ruleIds = {};
      selectedExceptionRules().forEach(function (rule) {
        ruleIds[rule.id] = rule.name;
      });
      (feed.data || []).forEach(function (event) {
        var ruleId = event.rule && event.rule.id;
        var deviceId = event.device && event.device.id;
        if (!ruleId || !deviceId || !ruleIds[ruleId]) return;
        if (!nameById[deviceId]) return;
        var stamp = new Date(event.activeTo || event.activeFrom).getTime();
        if (!Number.isFinite(stamp) || Date.now() - stamp > LIVE_EXCEPTION_ALERT_MS) return;
        liveExceptionsByDevice[deviceId] = { stamp: stamp, rule: ruleIds[ruleId] };
        pushLiveAlert({
          stamp: stamp,
          vehicle: nameById[deviceId] || deviceId,
          deviceId: deviceId,
          kind: 'exception',
          text: ruleIds[ruleId]
        });
      });
    }
    var threshold = liveSpeedThreshold();
    liveVehicles = (statusInfos || []).filter(function (info) {
      var deviceId = info && info.device && info.device.id;
      if (!deviceId || !nameById[deviceId]) return false;
      if (selectedIds.length && selectedIds.indexOf(deviceId) === -1) return false;
      return Number.isFinite(Number(info.latitude)) && Number.isFinite(Number(info.longitude)) && !(Number(info.latitude) === 0 && Number(info.longitude) === 0);
    }).map(function (info) {
      var deviceId = info.device.id;
      var name = nameById[deviceId];
      var limits = weightLimitsFor(name);
      var weight = latestWeight[deviceId];
      var weightStatus = weight ? classifyWeight(weight.kg, limits) : null;
      var speed = Math.round(Number(info.speed) || 0);
      var recentException = liveExceptionsByDevice[deviceId];
      if (recentException && Date.now() - recentException.stamp > LIVE_EXCEPTION_ALERT_MS) recentException = null;
      var alerts = [];
      if (threshold && speed >= threshold) alerts.push({ kind: 'speed', text: speed + ' km/h (over ' + threshold + ')' });
      if (weightStatus && weightStatusIsOver(weightStatus)) alerts.push({ kind: 'weight', text: formatTonnes(weight.kg) + ' t \u2014 ' + WEIGHT_STATUS_LABELS[weightStatus] });
      if (recentException) alerts.push({ kind: 'exception', text: recentException.rule });
      return {
        id: deviceId,
        name: name,
        lat: Number(info.latitude),
        lon: Number(info.longitude),
        speed: speed,
        driving: !!info.isDriving,
        weightKg: weight ? weight.kg : null,
        weightStamp: weight ? weight.stamp : null,
        weightStatus: weightStatus,
        limits: limits,
        alerts: alerts,
        color: colorForVehicleId(deviceId)
      };
    });
    liveVehicles.forEach(function (vehicle) {
      vehicle.alerts.forEach(function (alert) {
        if (alert.kind === 'exception') return;
        pushLiveAlert({ stamp: Date.now(), vehicle: vehicle.name, deviceId: vehicle.id, kind: alert.kind, text: alert.text });
      });
    });
    renderLiveVehicles();
    focusNewLiveAlerts();
    var alerting = liveVehicles.filter(function (vehicle) {
      return vehicle.alerts.length;
    }).length;
    setLiveStatus(formatNumber(liveVehicles.length) + ' vehicles live \u2022 ' + formatNumber(alerting) + ' alerting \u2022 updated ' + new Date().toLocaleTimeString() + ' \u2022 next in ' + Math.round(liveIntervalMs() / 1000) + ' s', alerting > 0);
  }

  /**
   * Zooms the map to a vehicle that has just started alerting and opens its
   * popup, so the reading that triggered the alert is readable without hunting
   * for the marker. A vehicle is only chased once per alert episode.
   */
  function focusNewLiveAlerts() {
    if (!map || !(elLiveAutoZoom && elLiveAutoZoom.checked)) return;
    var live = {};
    var target = null;
    liveVehicles.forEach(function (vehicle) {
      vehicle.alerts.forEach(function (alert) {
        var key = vehicle.id + '|' + alert.kind;
        live[key] = true;
        if (liveFocusedAlerts[key] || target) return;
        // An overweight vehicle outranks a speed or exception alert, since the
        // load is the thing that cannot be fixed by slowing down.
        if (!target || alert.kind === 'weight') target = { vehicle: vehicle, key: key };
      });
    });
    Object.keys(liveFocusedAlerts).forEach(function (key) {
      if (!live[key]) delete liveFocusedAlerts[key];
    });
    if (!target) return;
    liveFocusedAlerts[target.key] = true;
    focusLiveVehicle(target.vehicle.id);
  }

  /**
   * Centres the map on a live vehicle and opens its details.
   * @param {string} deviceId - The vehicle to show.
   */
  function focusLiveVehicle(deviceId) {
    var vehicle = liveVehicles.filter(function (candidate) {
      return candidate.id === deviceId;
    })[0];
    if (!map || !vehicle) return;
    map.setView([vehicle.lat, vehicle.lon], Math.max(map.getZoom() || 0, LIVE_FOCUS_ZOOM));
    var marker = liveMarkersById[deviceId];
    if (marker && marker.openPopup) marker.openPopup();
  }

  /**
   * Keeps one entry per vehicle and alert kind so a vehicle held over its limit
   * does not flood the list on every poll.
   * @param {object} alert - {stamp, vehicle, kind, text}.
   */
  function pushLiveAlert(alert) {
    var existing = liveAlertLog.filter(function (entry) {
      return entry.vehicle === alert.vehicle && entry.kind === alert.kind;
    })[0];
    if (existing) {
      existing.stamp = alert.stamp;
      existing.text = alert.text;
      existing.deviceId = alert.deviceId || existing.deviceId;
      existing.count = (existing.count || 1) + 1;
    } else {
      alert.count = 1;
      liveAlertLog.push(alert);
    }
    liveAlertLog.sort(function (a, b) {
      return b.stamp - a.stamp;
    });
    liveAlertLog = liveAlertLog.slice(0, LIVE_MAX_ALERTS);
    renderLiveAlertList();
  }
  function renderLiveAlertList() {
    if (!elLiveAlerts) return;
    if (!liveMonitorEnabled() || !liveAlertLog.length) {
      elLiveAlerts.innerHTML = liveMonitorEnabled() ? '<li class="live-alert-empty">No alerts yet.</li>' : '';
      return;
    }
    elLiveAlerts.innerHTML = liveAlertLog.map(function (alert) {
      return '<li class="live-alert live-alert-' + alert.kind + '" data-device="' + escapeHtml(String(alert.deviceId || '')) + '" title="Show this vehicle on the map"><b>' + escapeHtml(alert.vehicle) + '</b> ' + escapeHtml(alert.text) + '<small>' + new Date(alert.stamp).toLocaleTimeString() + (alert.count > 1 ? ' \u00b7 ' + alert.count + '\u00d7' : '') + '</small></li>';
    }).join('');
  }

  /**
   * Live vehicles sit in their own layer so historical results stay on the map
   * underneath them.
   */
  function renderLiveVehicles() {
    if (!map) return;
    if (liveLayer) map.removeLayer(liveLayer);
    if (!liveMonitorEnabled() || !liveVehicles.length) {
      liveLayer = null;
      return;
    }
    liveLayer = L.layerGroup().addTo(map);
    liveMarkersById = {};
    var alertsOnly = !!(elLiveAlertsOnly && elLiveAlertsOnly.checked);
    liveVehicles.forEach(function (vehicle) {
      var alerting = vehicle.alerts.length > 0;
      if (alertsOnly && !alerting) return;
      var ring = alerting ? vehicle.alerts[0].kind === 'weight' ? WEIGHT_STATUS_COLORS[vehicle.weightStatus] || '#d32f2f' : '#d32f2f' : '#ffffff';
      var marker = L.circleMarker([vehicle.lat, vehicle.lon], {
        radius: alerting ? 10 : 7,
        color: ring,
        weight: alerting ? 3 : 2,
        fillColor: vehicle.color,
        fillOpacity: 0.95,
        className: alerting ? 'live-vehicle is-alerting' : 'live-vehicle'
      });
      marker.bindTooltip(vehicle.name + ' \u2022 ' + (vehicle.driving ? vehicle.speed + ' km/h' : 'stopped') + (alerting ? ' \u2022 ' + vehicle.alerts[0].text : ''), {
        direction: 'top',
        offset: [0, -6]
      });
      marker.bindPopup('<strong>' + escapeHtml(vehicle.name) + '</strong><br>' + (vehicle.driving ? 'Driving \u2022 ' + vehicle.speed + ' km/h' : 'Stopped') + '<br>' + (vehicle.weightKg == null ? 'No cargo weight in the last hour' : 'Cargo ' + formatTonnes(vehicle.weightKg) + ' t' + (vehicle.limits.alertKg ? ' \u2014 ' + Math.round(vehicle.weightKg / vehicle.limits.alertKg * 100) + '% of limit' : '') + '<br>' + escapeHtml(WEIGHT_STATUS_LABELS[vehicle.weightStatus] || '')) + (vehicle.alerts.length ? '<br><span class="live-alert-flag">' + vehicle.alerts.map(function (alert) {
        return escapeHtml(alert.text);
      }).join('<br>') + '</span>' : ''));
      marker.addTo(liveLayer);
      liveMarkersById[vehicle.id] = marker;
      addLiveWeightSign(vehicle);
      // The label carries the numbers, so an alert can be read off the map
      // without opening anything.
      var labelText = vehicle.name + (vehicle.weightKg != null ? ' \u2022 ' + formatTonnes(vehicle.weightKg) + ' t' + (vehicle.limits.alertKg ? ' (' + Math.round(vehicle.weightKg / vehicle.limits.alertKg * 100) + '%)' : '') : '') + (vehicle.driving ? ' \u2022 ' + vehicle.speed + ' km/h' : '');
      if (alerting || vehicle.weightKg != null) {
        L.marker([vehicle.lat, vehicle.lon], {
          icon: L.divIcon({
            className: 'live-vehicle-label' + (alerting ? ' is-alerting' : ''),
            html: '<span>' + escapeHtml(labelText) + '</span>',
            iconSize: [200, 20],
            iconAnchor: [-8, 10]
          }),
          interactive: false
        }).addTo(liveLayer);
      }
    });
  }

  /**
   * A roundel beside a live vehicle showing its current load and the limit it
   * is measured against, mirroring the posted-limit signs on speeding events.
   * @param {object} vehicle - A live vehicle from applyLiveResults.
   */
  function addLiveWeightSign(vehicle) {
    if (vehicle.weightKg == null) return;
    var limitKg = vehicle.limits && vehicle.limits.alertKg;
    var color = WEIGHT_STATUS_COLORS[vehicle.weightStatus] || '#6f7c8a';
    var pct = limitKg ? Math.round(vehicle.weightKg / limitKg * 100) : null;
    var sign = L.marker([vehicle.lat, vehicle.lon], {
      icon: L.divIcon({
        className: 'live-weight-sign' + (weightStatusIsOver(vehicle.weightStatus) ? ' is-over' : ''),
        html: '<span style="border-color:' + color + '"><b>' + escapeHtml(formatTonnes(vehicle.weightKg)) + '</b><i>' + escapeHtml(limitKg ? '/' + formatTonnes(limitKg) : 't') + '</i></span>',
        iconSize: [40, 40],
        // Above the label, which sits at the same point.
        iconAnchor: [-8, 46]
      }),
      interactive: true,
      zIndexOffset: 400
    });
    sign.bindTooltip(escapeHtml(vehicle.name + ' \u2014 cargo ' + formatTonnes(vehicle.weightKg) + ' t' + (limitKg ? ' of ' + formatTonnes(limitKg) + ' t limit' + (pct != null ? ' (' + pct + '%)' : '') : ' (no register limit, fallback threshold)') + ' \u2014 ' + (WEIGHT_STATUS_LABELS[vehicle.weightStatus] || 'unknown')), {
      direction: 'top',
      offset: [0, -6]
    });
    sign.addTo(liveLayer);
  }

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
      zoom: 13,
      maxZoom: MAX_MAP_ZOOM
    });

    // OpenStreetMap only renders tiles to zoom 19; past that its last tiles are
    // scaled up so events stacked on one yard or street can still be separated.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: ['a', 'b', 'c'],
      maxZoom: MAX_MAP_ZOOM,
      maxNativeZoom: 19
    }).addTo(map);
    rememberMapScreenSize();
    map.on('resize', rememberMapScreenSize);

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
    elDataSourceCache = document.getElementById('dataSourceCache');
    elCacheBaseUrl = document.getElementById('cacheBaseUrl');
    elCacheStatus = document.getElementById('cacheStatus');
    elWeightFallbackTonnes = document.getElementById('weightFallbackTonnes');
    elWeightWarnPct = document.getElementById('weightWarnPct');
    elWeightOverOnly = document.getElementById('weightOverOnly');
    elTopWeightOnly = document.getElementById('topWeightOnly');
    elWeightStatus = document.getElementById('weightStatus');
    elLiveMonitor = document.getElementById('liveMonitor');
    elLiveInterval = document.getElementById('liveInterval');
    elLiveSpeedThreshold = document.getElementById('liveSpeedThreshold');
    elLiveWeightAlerts = document.getElementById('liveWeightAlerts');
    elLiveExceptionAlerts = document.getElementById('liveExceptionAlerts');
    elLiveAlertsOnly = document.getElementById('liveAlertsOnly');
    elLiveAutoZoom = document.getElementById('liveAutoZoom');
    elLiveAlerts = document.getElementById('liveAlerts');
    elLiveStatus = document.getElementById('liveStatus');
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
      ['otherSection', 'speedingSection', 'idlingSection'].forEach(function (id) {
        var section = document.getElementById(id);
        if (section) section.classList.toggle('is-inactive', !enabled);
      });
      ruleDropdown.rebuild();
      speedingRuleDropdown.rebuild();
      idlingRuleDropdown.rebuild();
      syncHeatMapVisibility();
      updateMapEventTotal();
    };
    var setWeightControlsEnabled = function setWeightControlsEnabled(enabled) {
      [elWeightFallbackTonnes, elWeightWarnPct, elWeightOverOnly, elTopWeightOnly].forEach(function (element) {
        if (element) element.disabled = !enabled;
      });
      var section = document.getElementById('weightSection');
      if (section) section.classList.toggle('is-inactive', !enabled);
    };
    document.getElementById('visualizeByLocationHistory').addEventListener('click', function (event) {
      setExceptionControlsEnabled(false);
      setWeightControlsEnabled(false);
    });
    document.getElementById('visualizeByExceptionHistory').addEventListener('click', function (event) {
      setExceptionControlsEnabled(true);
      setWeightControlsEnabled(false);
    });
    var elWeightMode = document.getElementById('visualizeByWeightHistory');
    if (elWeightMode) elWeightMode.addEventListener('click', function (event) {
      setExceptionControlsEnabled(false);
      setWeightControlsEnabled(true);
    });
    setWeightControlsEnabled(false);
    [elWeightFallbackTonnes, elWeightWarnPct, elWeightOverOnly, elTopWeightOnly].forEach(function (element) {
      if (element) element.addEventListener('change', refreshWeightPresentation);
    });
    setWeightStatus('Cargo weight is compared with the axle scale register: over the GML payload is an overload, over the GVM payload is critical. Vehicles missing from the register use the fallback limit.');
    if (elCacheBaseUrl) {
      var storedCacheUrl = null;
      try {
        storedCacheUrl = window.localStorage.getItem(CACHE_URL_STORAGE_KEY);
      } catch (error) {
        storedCacheUrl = null;
      }
      if (storedCacheUrl) elCacheBaseUrl.value = storedCacheUrl;
      elCacheBaseUrl.addEventListener('change', function () {
        cacheIndex = null;
        cacheMonths = {};
        cacheScripts = {};
        try {
          window.localStorage.setItem(CACHE_URL_STORAGE_KEY, cacheBaseUrl());
        } catch (error) {
          // Private browsing can refuse storage; the address still applies now.
        }
        if (cacheModeSelected()) describeCache();
      });
    }
    var describeCache = function describeCache() {
      var section = document.getElementById('dataSourceSection');
      if (section) section.classList.toggle('is-cache-active', cacheModeSelected());
      if (!cacheModeSelected()) {
        setCacheStatus('Reading MyGeotab directly. Switch to the local cache for faster historical searches.');
        return;
      }
      setCacheStatus('Checking the local cache\u2026');
      loadCacheIndex().then(function () {
        setCacheStatus(cacheCoverageText() + '. History reads the cache; weight history and the live monitor still read MyGeotab.');
      })['catch'](function (error) {
        setCacheStatus('Cache unavailable: ' + (error && error.message ? error.message : 'unknown error') + '. Check the address and that the local viewer is running.', true);
      });
    };
    ['dataSourceApi', 'dataSourceCache'].forEach(function (id) {
      var radio = document.getElementById(id);
      if (radio) radio.addEventListener('change', describeCache);
    });
    describeCache();
    if (elLiveMonitor) elLiveMonitor.addEventListener('change', applyLiveMonitor);
    if (elLiveInterval) elLiveInterval.addEventListener('change', applyLiveMonitor);
    [elLiveSpeedThreshold, elLiveWeightAlerts, elLiveExceptionAlerts].forEach(function (element) {
      if (element) element.addEventListener('change', function () {
        if (liveMonitorEnabled()) pollLiveData();
      });
    });
    if (elLiveAlertsOnly) elLiveAlertsOnly.addEventListener('change', renderLiveVehicles);
    if (elLiveAlerts) elLiveAlerts.addEventListener('click', function (event) {
      var row = event.target && event.target.closest ? event.target.closest('.live-alert') : null;
      var deviceId = row && row.getAttribute('data-device');
      if (deviceId) focusLiveVehicle(deviceId);
    });
    document.addEventListener('visibilitychange', applyLiveMonitor);
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
        applyLiveMonitor();
      }, 200);
    },
    blur: function blur() {
      // Live polling must not continue while another MyGeotab page is open.
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
    }
  };
};
