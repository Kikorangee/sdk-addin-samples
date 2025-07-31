"use strict";
geotab.addin.heatmap = function () {
    // ULTRA-AGGRESSIVE OPTIMIZATION: Much smaller limits
    var v, h, m, p, y, E, w, i, l, r, c, D, t;
    var I = 200; // Reduced from 1000 to 200 records per vehicle
    var MAX_VEHICLES = 5; // Hard limit on vehicle selection
    var MAX_TOTAL_RECORDS = 1000; // Global limit on total records processed
    var CHUNK_SIZE = 2; // Smaller chunks (2 vehicles at a time)
    var API_DELAY = 200; // Longer delay between API calls
    
    var rawDataTableDiv, showRawDataBtn, downloadRawDataBtn;
    var lastHeatmapPoints = [];
    var dataCache = {}; // Simple caching system
    var isProcessing = false;
    var debounceTimer;

    var b = function (e) { l.innerHTML = e; };
    var B = function (e) { r.innerHTML = e; };

    function x(e) {
        if (!e || 0 === e.length) return !0;
        for (var t = 0; t < e.length; t++) {
            if (0 < e[t].length) return !1;
        }
        return !0;
    }

    function S(e) { return e.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,"); }
    function N() { return Math.round((new Date - t) / 1e3); }

    // Generate cache key for caching results
    function getCacheKey(vehicles, fromDate, toDate, ruleId) {
        return `${vehicles.sort().join(',')}_${fromDate}_${toDate}_${ruleId || 'location'}`;
    }

    var T = function (e) {
        if (e) {
            i.disabled = !0;
            c.style.display = "block";
            isProcessing = true;
        } else {
            setTimeout(function () { c.style.display = "none"; }, 300);
            i.disabled = !1;
            isProcessing = false;
        }
    };

    // Ultra-aggressive vehicle limit enforcement
    var enforceVehicleLimit = function() {
        var selected = 0;
        for (var j = 0; j < y.options.length; j++) {
            if (y.options[j].selected) selected++;
        }
        
        if (selected > MAX_VEHICLES) {
            // Auto-deselect excess vehicles
            var count = 0;
            for (var k = 0; k < y.options.length; k++) {
                if (y.options[k].selected) {
                    count++;
                    if (count > MAX_VEHICLES) {
                        y.options[k].selected = false;
                    }
                }
            }
            b(`⚠️ Auto-limited to ${MAX_VEHICLES} vehicles for optimal performance. Deselected ${selected - MAX_VEHICLES} vehicles.`);
        }
    };

    // Clear all data and memory
    var clearPreviousData = function() {
        if (m) {
            m.setLatLngs([]);
        }
        lastHeatmapPoints = [];
        
        // Clear old cache entries (keep only last 5)
        var cacheKeys = Object.keys(dataCache);
        if (cacheKeys.length > 5) {
            for (var i = 0; i < cacheKeys.length - 5; i++) {
                delete dataCache[cacheKeys[i]];
            }
        }
    };

    // Ultra-fast progress updates
    var showProgress = function(message, percentage) {
        if (percentage !== undefined) {
            B(`${message} ${percentage}%`);
        } else {
            B(message);
        }
    };

    // Minimal data sampling for ultra-fast rendering
    var renderUltraFast = function(points, bounds) {
        var maxRenderPoints = 500; // Even smaller limit for rendering
        var displayPoints = points;
        
        if (points.length > maxRenderPoints) {
            var step = Math.ceil(points.length / maxRenderPoints);
            displayPoints = [];
            for (var i = 0; i < points.length; i += step) {
                displayPoints.push(points[i]);
            }
        }
        
        if (bounds.length > 0) {
            h.fitBounds(bounds);
        }
        m.setLatLngs(displayPoints);
        
        return displayPoints.length;
    };

    // Ultra-aggressive chunked processing
    var processUltraFast = function(vehicles, searchConfig, callback) {
        var cacheKey = getCacheKey(vehicles, searchConfig.search.fromDate, searchConfig.search.toDate, searchConfig.search.ruleSearch?.id);
        
        // Check cache first
        if (dataCache[cacheKey]) {
            showProgress("Loading from cache...", 100);
            setTimeout(function() {
                callback(dataCache[cacheKey]);
            }, 100);
            return;
        }
        
        var allResults = [];
        var currentIndex = 0;
        var totalRecordsProcessed = 0;
        
        function processNext() {
            if (currentIndex >= vehicles.length || totalRecordsProcessed >= MAX_TOTAL_RECORDS) {
                // Cache the results
                dataCache[cacheKey] = allResults;
                callback(allResults);
                return;
            }
            
            var endIndex = Math.min(currentIndex + CHUNK_SIZE, vehicles.length);
            var chunkVehicles = vehicles.slice(currentIndex, endIndex);
            
            var progress = Math.round((currentIndex / vehicles.length) * 100);
            showProgress("Processing vehicles...", progress);
            
            var calls = [];
            for (var i = 0; i < chunkVehicles.length; i++) {
                var callConfig = JSON.parse(JSON.stringify(searchConfig)); // Deep clone
                callConfig.search.deviceSearch = { id: chunkVehicles[i] };
                calls.push(["Get", callConfig]);
            }
            
            v.multiCall(calls, function(results) {
                // Check if we're hitting limits
                for (var j = 0; j < results.length; j++) {
                    totalRecordsProcessed += results[j].length;
                    if (totalRecordsProcessed >= MAX_TOTAL_RECORDS) {
                        results[j] = results[j].slice(0, MAX_TOTAL_RECORDS - (totalRecordsProcessed - results[j].length));
                        break;
                    }
                }
                
                allResults = allResults.concat(results);
                currentIndex = endIndex;
                
                setTimeout(processNext, API_DELAY);
            }, function(error) {
                b("⚠️ API Error: " + error + ". Try reducing the date range or number of vehicles.");
                T(false);
            });
        }
        
        processNext();
    };

    // Ultra-fast search with aggressive optimization
    var d = function () {
        if (isProcessing) {
            b("⏳ Please wait for current operation to complete.");
            return;
        }
        
        clearPreviousData();
        
        // Enforce vehicle limits
        enforceVehicleLimit();
        
        void 0 !== m && h.removeLayer(m);
        m = L.heatLayer({
            radius: { value: 20, absolute: !1 }, // Smaller radius for faster rendering
            opacity: .8,
            gradient: { .4: "blue", .6: "cyan", .7: "lime", .8: "yellow", 1: "red" }
        }).addTo(h);
        
        // Count selected vehicles
        D = 0;
        for (var e = 0; e < y.options.length; e++) {
            if (y.options[e].selected) D++;
        }
        
        if (D === 0) {
            b("❌ Please select at least one vehicle.");
            return;
        }
        
        if (D > MAX_VEHICLES) {
            b(`❌ Maximum ${MAX_VEHICLES} vehicles allowed for optimal performance.`);
            return;
        }
        
        // Check date range
        var fromDate = new Date(E.value);
        var toDate = new Date(w.value);
        var hoursDiff = (toDate - fromDate) / (1000 * 60 * 60);
        
        if (hoursDiff > 24) {
            if (!confirm(`⚠️ Date range is ${Math.round(hoursDiff)} hours. This may be slow. Continue?\n\nTip: Try a range under 8 hours for best performance.`)) {
                return;
            }
        }
        
        t = new Date;
        showProgress("Starting ultra-fast search...", 0);
        T(!0);
        
        // Determine search type
        if (p.disabled) {
            ultraFastLocationSearch();
        } else {
            ultraFastExceptionSearch();
        }
    };

    // Ultra-optimized location search
    var ultraFastLocationSearch = function() {
        var selectedVehicles = [];
        for (var i = 0; i < y.options.length; i++) {
            if (y.options[i].selected) {
                selectedVehicles.push(y.options[i].value || y.options[i].text);
            }
        }
        
        var searchConfig = {
            typeName: "LogRecord",
            resultsLimit: I,
            search: {
                fromDate: new Date(E.value).toISOString(),
                toDate: new Date(w.value).toISOString()
            }
        };
        
        processUltraFast(selectedVehicles, searchConfig, function(allResults) {
            if (x(allResults)) {
                b("📍 No location data found. Try a different date range.");
                T(!1);
                return;
            }
            
            showProgress("Processing location data...", 90);
            
            var allPoints = [], bounds = [], totalRecords = 0;
            
            for (var i = 0; i < allResults.length; i++) {
                var records = allResults[i];
                for (var j = 0; j < records.length && totalRecords < MAX_TOTAL_RECORDS; j++) {
                    var record = records[j];
                    if (record.latitude !== 0 && record.longitude !== 0) {
                        allPoints.push({
                            lat: record.latitude,
                            lon: record.longitude,
                            timestamp: record.dateTime,
                            value: 1
                        });
                        bounds.push(new L.LatLng(record.latitude, record.longitude));
                        totalRecords++;
                    }
                }
            }
            
            lastHeatmapPoints = allPoints;
            
            if (allPoints.length > 0) {
                var displayedPoints = renderUltraFast(allPoints, bounds);
                var message = `✅ Displaying ${S(displayedPoints)} points from ${S(totalRecords)} records (${D} vehicles) [${N()}s]`;
                if (displayedPoints < totalRecords) {
                    message += ` - Sampled for performance`;
                }
                B(message);
                
                if (totalRecords >= MAX_TOTAL_RECORDS) {
                    b(`ℹ️ Hit ${S(MAX_TOTAL_RECORDS)} record limit. Reduce date range for complete data.`);
                }
            } else {
                b("📍 No valid coordinates found.");
            }
            
            T(!1);
        });
    };

    // Ultra-optimized exception search
    var ultraFastExceptionSearch = function() {
        var selectedVehicles = [];
        for (var i = 0; i < y.options.length; i++) {
            if (y.options[i].selected) {
                selectedVehicles.push(y.options[i].value || y.options[i].text);
            }
        }
        
        var ruleId = p.options[p.selectedIndex].value;
        var ruleName = p.options[p.selectedIndex].text;
        
        var searchConfig = {
            typeName: "ExceptionEvent",
            resultsLimit: Math.min(I, 100), // Even smaller limit for exceptions
            search: {
                ruleSearch: { id: ruleId },
                fromDate: new Date(E.value).toISOString(),
                toDate: new Date(w.value).toISOString()
            }
        };
        
        processUltraFast(selectedVehicles, searchConfig, function(exceptionResults) {
            if (x(exceptionResults)) {
                b("⚠️ No exceptions found for this rule and date range.");
                T(!1);
                return;
            }
            
            showProgress("Processing exceptions...", 50);
            
            // Simplified exception processing - take only first few exceptions
            var logCalls = [];
            var totalExceptions = 0;
            var maxExceptions = 50; // Limit total exceptions processed
            
            for (var i = 0; i < exceptionResults.length && totalExceptions < maxExceptions; i++) {
                var exceptions = exceptionResults[i];
                for (var j = 0; j < exceptions.length && totalExceptions < maxExceptions; j++) {
                    totalExceptions++;
                    logCalls.push(["Get", {
                        typeName: "LogRecord",
                        resultsLimit: 10, // Very small limit for exception logs
                        search: {
                            deviceSearch: { id: exceptions[j].device.id },
                            fromDate: exceptions[j].activeFrom,
                            toDate: exceptions[j].activeTo
                        }
                    }]);
                }
            }
            
            showProgress("Getting exception locations...", 75);
            
            // Process in small batches
            var batchSize = 5;
            var allLogResults = [];
            var currentBatch = 0;
            
            function processBatch() {
                var start = currentBatch * batchSize;
                var end = Math.min(start + batchSize, logCalls.length);
                var batchCalls = logCalls.slice(start, end);
                
                if (batchCalls.length === 0) {
                    processLogResults(allLogResults);
                    return;
                }
                
                v.multiCall(batchCalls, function(results) {
                    allLogResults = allLogResults.concat(results);
                    currentBatch++;
                    
                    var progress = Math.round(75 + (currentBatch / Math.ceil(logCalls.length / batchSize)) * 20);
                    showProgress("Processing exception locations...", progress);
                    
                    setTimeout(processBatch, API_DELAY);
                }, function(error) {
                    b("⚠️ Error getting exception locations: " + error);
                    T(false);
                });
            }
            
            function processLogResults(logResults) {
                if (x(logResults)) {
                    b("⚠️ No location data found for exceptions.");
                    T(!1);
                    return;
                }
                
                var allPoints = [], bounds = [], totalRecords = 0;
                
                for (var i = 0; i < logResults.length; i++) {
                    var records = logResults[i];
                    for (var j = 0; j < records.length; j++) {
                        var record = records[j];
                        if (record.latitude !== 0 && record.longitude !== 0) {
                            allPoints.push({
                                lat: record.latitude,
                                lon: record.longitude,
                                timestamp: record.dateTime,
                                value: 1
                            });
                            bounds.push(new L.LatLng(record.latitude, record.longitude));
                            totalRecords++;
                        }
                    }
                }
                
                lastHeatmapPoints = allPoints;
                
                if (allPoints.length > 0) {
                    var displayedPoints = renderUltraFast(allPoints, bounds);
                    B(`✅ Showing ${S(displayedPoints)} points from ${S(totalExceptions)} '${ruleName}' exceptions (${D} vehicles) [${N()}s]`);
                    
                    if (totalExceptions >= maxExceptions) {
                        b(`ℹ️ Limited to first ${maxExceptions} exceptions for performance. Reduce date range for more.`);
                    }
                } else {
                    b("⚠️ No valid coordinates found for exceptions.");
                }
                
                T(!1);
            }
            
            processBatch();
        });
    };

    // Ultra-aggressive debounced search
    var debouncedSearch = function() {
        if (isProcessing) {
            b("⏳ Please wait for current operation to complete.");
            return;
        }
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            d();
        }, 150); // Shorter debounce
    };

    // Initialization with ultra-conservative defaults
    var a = function (e) {
        h = new L.Map("heatmap-map", {
            center: new L.LatLng(e.latitude, e.longitude), 
            zoom: 13,
            preferCanvas: true // Better performance for large datasets
        });
        
        L.tileLayer("http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            subdomains: ["a", "b", "c"]
        }).addTo(h);
        
        p = document.getElementById("exceptionTypes");
        y = document.getElementById("vehicles");
        E = document.getElementById("from");
        w = document.getElementById("to");
        i = document.getElementById("showHeatMap");
        l = document.getElementById("error");
        r = document.getElementById("message");
        c = document.getElementById("loading");
        
        // Ultra-conservative default: last 2 hours only
        var now = new Date();
        var twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        
        var year = now.getFullYear();
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var day = String(now.getDate()).padStart(2, '0');
        var currentHour = String(now.getHours()).padStart(2, '0');
        var startHour = String(twoHoursAgo.getHours()).padStart(2, '0');
        
        E.value = `${year}-${month}-${day}T${startHour}:00`;
        w.value = `${year}-${month}-${day}T${currentHour}:59`;
        
        // Event listeners
        document.getElementById("visualizeByLocationHistory").addEventListener("click", function (e) { 
            p.disabled = !0;
        });
        
        document.getElementById("visualizeByExceptionHistory").addEventListener("click", function (e) { 
            p.disabled = !1;
        });
        
        // Add vehicle selection limit enforcement
        y.addEventListener("change", function(e) {
            enforceVehicleLimit();
        });
        
        document.getElementById("showHeatMap").addEventListener("click", function (e) { 
            e.preventDefault();
            debouncedSearch();
        });

        // Raw data functionality (simplified)
        rawDataTableDiv = document.getElementById("rawDataTable");
        showRawDataBtn = document.getElementById("showRawDataBtn");
        downloadRawDataBtn = document.getElementById("downloadRawDataBtn");

        if (showRawDataBtn) {
            showRawDataBtn.addEventListener('click', function () {
                if (!lastHeatmapPoints.length) {
                    b("📊 No data available. Generate a heatmap first.");
                    return;
                }
                
                if (rawDataTableDiv.style.display === 'none' || rawDataTableDiv.style.display === '') {
                    renderSimpleTable(lastHeatmapPoints);
                    rawDataTableDiv.style.display = 'block';
                    this.textContent = 'Hide Raw Data';
                } else {
                    rawDataTableDiv.style.display = 'none';
                    this.textContent = 'Show Raw Data';
                }
            });
        }

        if (downloadRawDataBtn) {
            downloadRawDataBtn.addEventListener('click', function () {
                if (!lastHeatmapPoints.length) {
                    b("💾 No data available. Generate a heatmap first.");
                    return;
                }
                
                try {
                    const csvHeader = 'Latitude,Longitude,Timestamp';
                    const csvRows = lastHeatmapPoints.slice(0, 1000).map(r => 
                        `${r.lat || ''},${r.lon || ''},${r.timestamp || ''}`
                    );
                    const csv = csvHeader + '\n' + csvRows.join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `heatmap_data_${new Date().toISOString().slice(0,10)}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    B("✅ CSV downloaded successfully!");
                } catch (error) {
                    b("❌ Error creating download: " + error.message);
                }
            });
        }
    };

    // Simplified table rendering
    function renderSimpleTable(data) {
        if (!data.length) {
            rawDataTableDiv.innerHTML = '<p>No data available.</p>';
            return;
        }
        
        var maxRows = 200; // Very limited for performance
        var displayData = data.slice(0, maxRows);
        
        var html = `<p><strong>Showing ${displayData.length} of ${data.length} records</strong></p>`;
        html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
        html += '<thead><tr style="background:#f0f0f0;"><th style="border:1px solid #ddd; padding:4px;">Lat</th><th style="border:1px solid #ddd; padding:4px;">Lng</th><th style="border:1px solid #ddd; padding:4px;">Time</th></tr></thead><tbody>';
        
        displayData.forEach(function(pt) {
            html += `<tr><td style="border:1px solid #ddd; padding:2px;">${(pt.lat || '').toString().substring(0,8)}</td><td style="border:1px solid #ddd; padding:2px;">${(pt.lon || '').toString().substring(0,8)}</td><td style="border:1px solid #ddd; padding:2px;">${(pt.timestamp || '').substring(11,19)}</td></tr>`;
        });
        
        html += '</tbody></table>';
        rawDataTableDiv.innerHTML = html;
    }

    var u = function (e, t) {
        return (e = e.name.toLowerCase()) === (t = t.name.toLowerCase()) ? 0 : t < e ? 1 : -1;
    };

    return {
        initialize: function (e, t, n) {
            v = e;
            "geolocation" in navigator
                ? navigator.geolocation.getCurrentPosition(function (e) { a(e.coords); n(); })
                : (a({ longitude: -79.709441, latitude: 43.434497 }), n());
        },
        focus: function (e, t) {
            v = e;
            
            // Load vehicles with smaller limit
            v.call("Get", {
                typeName: "Device",
                resultsLimit: 1000, // Reduced from 50k
                search: { fromDate: (new Date).toISOString(), groups: t.getGroupFilter() }
            }, function (e) {
                if (e && e.length > 0) {
                    e.sort(u);
                    e.forEach(function (e) {
                        var t = new Option;
                        t.text = e.name;
                        t.value = e.id;
                        y.add(t);
                    });
                    
                    // Show vehicle limit warning
                    if (e.length > MAX_VEHICLES) {
                        b(`ℹ️ ${e.length} vehicles loaded. Select max ${MAX_VEHICLES} for optimal performance.`);
                    }
                }
            }, function(error) {
                b("❌ Error loading vehicles: " + error);
            });
            
            // Load rules with smaller limit
            v.call("Get", {
                typeName: "Rule",
                resultsLimit: 1000 // Reduced from 50k
            }, function (e) {
                if (e && e.length > 0) {
                    e.sort(u);
                    e.forEach(function (e) {
                        var t = new Option;
                        t.text = e.name;
                        t.value = e.id;
                        p.add(t);
                    });
                }
            }, function(error) {
                b("❌ Error loading rules: " + error);
            });
            
            setTimeout(function () { h.invalidateSize(); }, 200);
        }
    };
};
