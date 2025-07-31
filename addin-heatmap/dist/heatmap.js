"use strict";
geotab.addin.heatmap = function () {
    // Core variables
    var v, h, m, p, y, E, w, i, l, r, c, D, t;
    
    // Performance optimization settings
    var I = 5000; // Records per vehicle (reduced from 50,000)
    var MAX_VEHICLES_WARNING = 10; // Warning threshold
    var MAX_DISPLAY_POINTS = 3000; // Auto-sampling threshold
    var CHUNK_SIZE = 3; // Vehicles per API chunk
    var API_DELAY = 150; // Delay between API calls (ms)
    var MAX_TOTAL_RECORDS = 15000; // Global record limit
    
    // Feature variables
    var rawDataTableDiv, showRawDataBtn, downloadRawDataBtn;
    var lastHeatmapPoints = [];
    var dataCache = {}; // Simple caching system
    var processingStats = { totalVehicles: 0, processedVehicles: 0, totalRecords: 0 };
    var isProcessing = false;
    var debounceTimer;
    
    // Utility functions
    var b = function (e) { 
        if (l) l.innerHTML = e; 
        console.log("❌ ERROR: " + e);
    };
    
    var B = function (e) { 
        if (r) r.innerHTML = e; 
        console.log("✅ STATUS: " + e);
    };

    function x(e) {
        if (!e || 0 === e.length) return !0;
        for (var t = 0; t < e.length; t++) {
            if (0 < e[t].length) return !1;
        }
        return !0;
    }

    function S(e) { 
        return e.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,"); 
    }
    
    function N() { 
        return Math.round((new Date - t) / 1e3); 
    }

    // Generate cache key for result caching
    function getCacheKey(vehicles, fromDate, toDate, ruleId) {
        var vehicleKey = vehicles.sort().join(',');
        var dateKey = fromDate + '|' + toDate;
        var ruleKey = ruleId || 'location';
        return vehicleKey + '_' + dateKey + '_' + ruleKey;
    }

    // Loading indicator management
    var T = function (e) {
        if (e) {
            if (i) i.disabled = !0;
            if (c) c.style.display = "block";
            isProcessing = true;
        } else {
            setTimeout(function () { 
                if (c) c.style.display = "none"; 
            }, 600);
            if (i) i.disabled = !1;
            isProcessing = false;
        }
    };

    // Progress tracking
    var updateProgress = function(message, percentage) {
        var progressMsg = message;
        if (percentage !== undefined) {
            progressMsg += " (" + Math.round(percentage) + "%)";
        }
        B(progressMsg);
    };

    // Memory optimization - clear previous data
    var clearPreviousData = function() {
        if (m && h) {
            try {
                m.setLatLngs([]);
            } catch (e) {
                console.log("Error clearing heatmap:", e);
            }
        }
        lastHeatmapPoints = [];
        processingStats = { totalVehicles: 0, processedVehicles: 0, totalRecords: 0 };
        
        // Limit cache size
        var cacheKeys = Object.keys(dataCache);
        if (cacheKeys.length > 5) {
            for (var i = 0; i < cacheKeys.length - 5; i++) {
                delete dataCache[cacheKeys[i]];
            }
        }
    };

    // Smart data sampling for performance
    var optimizeDataForDisplay = function(points, bounds) {
        var displayPoints = points;
        
        if (points.length > MAX_DISPLAY_POINTS) {
            var sampleRate = Math.ceil(points.length / MAX_DISPLAY_POINTS);
            displayPoints = [];
            
            for (var i = 0; i < points.length; i += sampleRate) {
                displayPoints.push(points[i]);
            }
            
            console.log("📊 Auto-sampled:", displayPoints.length, "from", points.length, "points");
        }
        
        return displayPoints;
    };

    // Enhanced map rendering with optimization
    var renderOptimizedHeatmap = function(points, bounds) {
        if (!h || !m) {
            console.error("Map or heatmap layer not ready");
            return 0;
        }
        
        try {
            var displayPoints = optimizeDataForDisplay(points, bounds);
            
            if (bounds && bounds.length > 0) {
                h.fitBounds(bounds);
            }
            
            m.setLatLngs(displayPoints);
            
            var samplingNote = displayPoints.length < points.length 
                ? " (auto-sampled for performance)" 
                : "";
            
            updateProgress("Rendered " + S(displayPoints.length) + " points" + samplingNote + " [" + N() + "s]");
            
            return displayPoints.length;
            
        } catch (error) {
            console.error("Error rendering heatmap:", error);
            b("Error rendering heatmap: " + error.message);
            return 0;
        }
    };

    // Chunked API processing for better performance
    var processVehiclesInChunks = function(vehicles, searchConfig, progressCallback, callback) {
        var cacheKey = getCacheKey(vehicles, searchConfig.search.fromDate, searchConfig.search.toDate, searchConfig.search.ruleSearch?.id);
        
        // Check cache first
        if (dataCache[cacheKey]) {
            console.log("📦 Using cached data");
            updateProgress("Loading from cache...", 100);
            setTimeout(function() {
                callback(dataCache[cacheKey]);
            }, 100);
            return;
        }
        
        var allResults = [];
        var currentIndex = 0;
        var totalChunks = Math.ceil(vehicles.length / CHUNK_SIZE);
        
        function processNextChunk() {
            if (currentIndex >= vehicles.length) {
                // Cache the results
                dataCache[cacheKey] = allResults;
                callback(allResults);
                return;
            }
            
            var endIndex = Math.min(currentIndex + CHUNK_SIZE, vehicles.length);
            var chunkVehicles = vehicles.slice(currentIndex, endIndex);
            var chunkNumber = Math.floor(currentIndex / CHUNK_SIZE) + 1;
            
            var progress = (chunkNumber / totalChunks) * 100;
            var progressMsg = "Processing vehicle chunk " + chunkNumber + "/" + totalChunks;
            if (progressCallback) progressCallback(progressMsg, progress);
            
            var calls = [];
            for (var i = 0; i < chunkVehicles.length; i++) {
                var callConfig = JSON.parse(JSON.stringify(searchConfig)); // Deep clone
                callConfig.search.deviceSearch = { id: chunkVehicles[i] };
                calls.push(["Get", callConfig]);
            }
            
            if (!v || !v.multiCall) {
                b("Geotab API not available");
                T(!1);
                return;
            }
            
            v.multiCall(calls, function(chunkResults) {
                console.log("✅ Chunk", chunkNumber, "completed:", chunkResults.length, "results");
                
                allResults = allResults.concat(chunkResults || []);
                currentIndex = endIndex;
                
                // Add delay to prevent API overwhelming
                setTimeout(processNextChunk, API_DELAY);
                
            }, function(error) {
                console.error("❌ Chunk", chunkNumber, "failed:", error);
                b("API Error in chunk " + chunkNumber + ": " + error);
                T(!1);
            });
        }
        
        processNextChunk();
    };

    // Vehicle selection validation and limits
    var validateVehicleSelection = function() {
        var selectedCount = 0;
        if (y && y.options) {
            for (var i = 0; i < y.options.length; i++) {
                if (y.options[i].selected) selectedCount++;
            }
        }
        
        if (selectedCount === 0) {
            b("❌ Please select at least one vehicle");
            return false;
        }
        
        if (selectedCount > MAX_VEHICLES_WARNING) {
            var confirmMsg = "⚠️ You've selected " + selectedCount + " vehicles. This may take a while and impact performance.\n\n";
            confirmMsg += "Recommendations:\n";
            confirmMsg += "• Select " + MAX_VEHICLES_WARNING + " or fewer vehicles for optimal speed\n";
            confirmMsg += "• Use a shorter time range (4 hours or less)\n";
            confirmMsg += "• Data will be auto-sampled if needed\n\n";
            confirmMsg += "Continue anyway?";
            
            if (!confirm(confirmMsg)) {
                return false;
            }
        }
        
        return selectedCount;
    };

    // Date range validation
    var validateDateRange = function() {
        if (!E || !w || !E.value || !w.value) {
            b("❌ Please select both start and end dates");
            return false;
        }
        
        var fromDate = new Date(E.value);
        var toDate = new Date(w.value);
        var diffHours = (toDate - fromDate) / (1000 * 60 * 60);
        
        if (diffHours <= 0) {
            b("❌ End date must be after start date");
            return false;
        }
        
        if (diffHours > 168) { // 1 week
            var confirmMsg = "⚠️ Date range is " + Math.round(diffHours) + " hours (" + Math.round(diffHours/24) + " days).\n\n";
            confirmMsg += "Large date ranges may:\n";
            confirmMsg += "• Take several minutes to load\n";
            confirmMsg += "• Hit data limits and show incomplete results\n";
            confirmMsg += "• Be automatically sampled for display\n\n";
            confirmMsg += "Recommendation: Use ranges under 24 hours for best performance.\n\n";
            confirmMsg += "Continue with " + Math.round(diffHours) + " hour range?";
            
            if (!confirm(confirmMsg)) {
                return false;
            }
        }
        
        return true;
    };

    // Debounced search function
    var debouncedSearch = function() {
        if (isProcessing) {
            b("⏳ Please wait for current operation to complete");
            return;
        }
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            d();
        }, 300);
    };

    // Main heatmap generation function
    var d = function () {
        console.log("🚀 Starting heatmap generation...");
        
        // Clear previous data
        clearPreviousData();
        
        // Validate selections
        var selectedVehicleCount = validateVehicleSelection();
        if (!selectedVehicleCount) return;
        
        if (!validateDateRange()) return;
        
        // Setup heatmap layer
        if (h) {
            if (m) h.removeLayer(m);
            
            try {
                m = L.heatLayer({
                    radius: { value: 24, absolute: !1 },
                    opacity: .7,
                    gradient: { 
                        .45: "rgb(0,0,255)", 
                        .55: "rgb(0,255,255)", 
                        .65: "rgb(0,255,0)", 
                        .95: "yellow", 
                        1: "rgb(255,0,0)" 
                    }
                }).addTo(h);
            } catch (error) {
                b("Error creating heatmap layer: " + error.message);
                return;
            }
        }
        
        D = selectedVehicleCount;
        t = new Date;
        
        updateProgress("Initializing optimized search for " + D + " vehicles...", 0);
        T(!0);
        
        // Determine search type
        if (!p || p.disabled) {
            console.log("📍 Starting location history search");
            optimizedLocationSearch();
        } else {
            console.log("⚠️ Starting exception history search");
            optimizedExceptionSearch();
        }
    };

    // Optimized location history search
    var optimizedLocationSearch = function() {
        var selectedVehicles = [];
        if (y && y.options) {
            for (var i = 0; i < y.options.length; i++) {
                if (y.options[i].selected) {
                    selectedVehicles.push(y.options[i].value || y.options[i].text);
                }
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
        
        processingStats.totalVehicles = selectedVehicles.length;
        
        processVehiclesInChunks(selectedVehicles, searchConfig, updateProgress, function(allResults) {
            console.log("📊 Processing location results:", allResults.length, "vehicle results");
            
            if (x(allResults)) {
                b("📍 No location data found for the selected criteria");
                T(!1);
                return;
            }
            
            updateProgress("Processing location records...", 90);
            
            var allPoints = [], bounds = [], totalRecords = 0, exceededLimit = 0;
            
            for (var i = 0; i < allResults.length; i++) {
                var records = allResults[i] || [];
                for (var j = 0; j < records.length && totalRecords < MAX_TOTAL_RECORDS; j++) {
                    var record = records[j];
                    if (record && record.latitude !== 0 && record.longitude !== 0) {
                        allPoints.push({
                            lat: record.latitude,
                            lon: record.longitude,
                            timestamp: record.dateTime,
                            value: 1
                        });
                        if (typeof L !== 'undefined') {
                            bounds.push(new L.LatLng(record.latitude, record.longitude));
                        }
                        totalRecords++;
                    }
                }
                if (records.length >= I) exceededLimit++;
            }
            
            lastHeatmapPoints = allPoints;
            processingStats.totalRecords = totalRecords;
            
            console.log("📊 Final stats:", {
                vehicles: D,
                totalPoints: allPoints.length,
                totalRecords: totalRecords,
                exceededLimit: exceededLimit
            });
            
            if (allPoints.length > 0) {
                var displayedPoints = renderOptimizedHeatmap(allPoints, bounds);
                
                var message = "✅ " + S(totalRecords) + " records from " + D + " vehicles";
                if (displayedPoints < totalRecords) {
                    message += " (showing " + S(displayedPoints) + " optimized points)";
                }
                message += " [" + N() + "s]";
                B(message);
                
                if (exceededLimit > 0) {
                    b("ℹ️ Data limit reached for " + exceededLimit + " vehicles. Consider reducing date range for complete data.");
                }
                
                if (totalRecords >= MAX_TOTAL_RECORDS) {
                    b("ℹ️ Reached maximum record limit (" + S(MAX_TOTAL_RECORDS) + "). Results may be incomplete.");
                }
            } else {
                b("📍 No valid GPS coordinates found in the data");
            }
            
            T(!1);
        });
    };

    // Optimized exception history search
    var optimizedExceptionSearch = function() {
        var selectedVehicles = [];
        if (y && y.options) {
            for (var i = 0; i < y.options.length; i++) {
                if (y.options[i].selected) {
                    selectedVehicles.push(y.options[i].value || y.options[i].text);
                }
            }
        }
        
        if (!p || !p.options || p.selectedIndex < 0) {
            b("⚠️ Please select an exception type");
            T(!1);
            return;
        }
        
        var ruleId = p.options[p.selectedIndex].value;
        var ruleName = p.options[p.selectedIndex].text;
        
        var exceptionSearchConfig = {
            typeName: "ExceptionEvent",
            resultsLimit: Math.min(I, 2000), // Smaller limit for exceptions
            search: {
                ruleSearch: { id: ruleId },
                fromDate: new Date(E.value).toISOString(),
                toDate: new Date(w.value).toISOString()
            }
        };
        
        updateProgress("Searching for '" + ruleName + "' exceptions...", 10);
        
        processVehiclesInChunks(selectedVehicles, exceptionSearchConfig, updateProgress, function(exceptionResults) {
            console.log("⚠️ Exception results:", exceptionResults.length, "vehicle results");
            
            if (x(exceptionResults)) {
                b("⚠️ No '" + ruleName + "' exceptions found for selected vehicles and date range");
                T(!1);
                return;
            }
            
            updateProgress("Processing exception locations...", 50);
            
            // Collect log record calls from exceptions
            var logRecordCalls = [];
            var totalExceptions = 0;
            var exceededExceptionLimit = 0;
            
            for (var i = 0; i < exceptionResults.length; i++) {
                var exceptions = exceptionResults[i] || [];
                for (var j = 0; j < exceptions.length && totalExceptions < 1000; j++) {
                    var exc = exceptions[j];
                    if (exc && exc.device && exc.device.id) {
                        totalExceptions++;
                        logRecordCalls.push(["Get", {
                            typeName: "LogRecord",
                            resultsLimit: 50, // Small limit per exception
                            search: {
                                deviceSearch: { id: exc.device.id },
                                fromDate: exc.activeFrom,
                                toDate: exc.activeTo
                            }
                        }]);
                    }
                }
                if (exceptions.length >= exceptionSearchConfig.resultsLimit) {
                    exceededExceptionLimit++;
                }
            }
            
            if (logRecordCalls.length === 0) {
                b("⚠️ No valid exceptions found to process");
                T(!1);
                return;
            }
            
            updateProgress("Fetching location data for " + totalExceptions + " exceptions...", 70);
            
            // Process log records in smaller batches
            var batchSize = 10;
            var allLogResults = [];
            var currentBatch = 0;
            var totalBatches = Math.ceil(logRecordCalls.length / batchSize);
            
            function processLogBatch() {
                var start = currentBatch * batchSize;
                var end = Math.min(start + batchSize, logRecordCalls.length);
                var batchCalls = logRecordCalls.slice(start, end);
                
                if (batchCalls.length === 0) {
                    processLogResults(allLogResults);
                    return;
                }
                
                var progress = 70 + (currentBatch / totalBatches) * 20;
                updateProgress("Processing exception batch " + (currentBatch + 1) + "/" + totalBatches + "...", progress);
                
                v.multiCall(batchCalls, function(batchResults) {
                    allLogResults = allLogResults.concat(batchResults || []);
                    currentBatch++;
                    setTimeout(processLogBatch, API_DELAY);
                }, function(error) {
                    console.error("❌ Log batch error:", error);
                    b("Error processing exception locations: " + error);
                    T(!1);
                });
            }
            
            function processLogResults(logResults) {
                console.log("📊 Processing log results:", logResults.length, "exception logs");
                
                if (x(logResults)) {
                    b("⚠️ No location data found for exceptions");
                    T(!1);
                    return;
                }
                
                var allPoints = [], bounds = [], totalRecords = 0, exceededLogLimit = 0;
                
                for (var i = 0; i < logResults.length; i++) {
                    var records = logResults[i] || [];
                    for (var j = 0; j < records.length; j++) {
                        var record = records[j];
                        if (record && record.latitude !== 0 && record.longitude !== 0) {
                            allPoints.push({
                                lat: record.latitude,
                                lon: record.longitude,
                                timestamp: record.dateTime,
                                value: 1
                            });
                            if (typeof L !== 'undefined') {
                                bounds.push(new L.LatLng(record.latitude, record.longitude));
                            }
                            totalRecords++;
                        }
                    }
                    if (records.length >= 50) exceededLogLimit++;
                }
                
                lastHeatmapPoints = allPoints;
                
                if (allPoints.length > 0) {
                    var displayedPoints = renderOptimizedHeatmap(allPoints, bounds);
                    
                    var message = "✅ " + S(totalRecords) + " records from " + S(totalExceptions) + " '" + ruleName + "' exceptions";
                    if (displayedPoints < totalRecords) {
                        message += " (showing " + S(displayedPoints) + " optimized points)";
                    }
                    message += " [" + N() + "s]";
                    B(message);
                    
                    if (exceededExceptionLimit > 0 || exceededLogLimit > 0) {
                        var warnings = [];
                        if (exceededExceptionLimit > 0) {
                            warnings.push(exceededExceptionLimit + " vehicles hit exception limit");
                        }
                        if (exceededLogLimit > 0) {
                            warnings.push(exceededLogLimit + " exceptions hit log limit");
                        }
                        b("ℹ️ Limits exceeded: " + warnings.join(", ") + ". Consider reducing date range.");
                    }
                } else {
                    b("⚠️ No valid GPS coordinates found in exception data");
                }
                
                T(!1);
            }
            
            processLogBatch();
        });
    };

    // Enhanced initialization with better error handling
    var a = function (coords) {
        console.log("🗺️ Initializing enhanced heatmap with coordinates:", coords);
        
        try {
            // Verify required elements exist
            var mapElement = document.getElementById("heatmap-map");
            if (!mapElement) {
                throw new Error("Map container element not found");
            }
            
            // Verify Leaflet is loaded
            if (typeof L === 'undefined') {
                throw new Error("Leaflet library not loaded");
            }
            
            if (typeof L.heatLayer === 'undefined') {
                throw new Error("Leaflet heatmap plugin not loaded");
            }
            
            // Create map
            h = new L.Map("heatmap-map", {
                center: new L.LatLng(coords.latitude, coords.longitude),
                zoom: 13,
                preferCanvas: true, // Better performance for large datasets
                zoomControl: true,
                attributionControl: true
            });
            
            // Add tile layer
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                subdomains: ["a", "b", "c"],
                maxZoom: 18
            }).addTo(h);
            
            console.log("✅ Map created successfully");
            
        } catch (error) {
            console.error("❌ Map initialization failed:", error);
            b("Map initialization failed: " + error.message);
            return;
        }
        
        // Get DOM elements with error checking
        try {
            p = document.getElementById("exceptionTypes");
            y = document.getElementById("vehicles");
            E = document.getElementById("from");
            w = document.getElementById("to");
            i = document.getElementById("showHeatMap");
            l = document.getElementById("error");
            r = document.getElementById("message");
            c = document.getElementById("loading");
            
            // Verify critical elements
            if (!y) throw new Error("Vehicles select element not found");
            if (!i) throw new Error("Generate button not found");
            if (!E || !w) throw new Error("Date input elements not found");
            
        } catch (error) {
            console.error("❌ DOM element initialization failed:", error);
            b("Interface initialization failed: " + error.message);
            return;
        }
        
        // Set optimized default date range (last 4 hours)
        try {
            var now = new Date();
            var fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
            
            if (E) E.value = fourHoursAgo.toISOString().slice(0, 16);
            if (w) w.value = now.toISOString().slice(0, 16);
            
            console.log("✅ Default date range set:", fourHoursAgo.toISOString(), "to", now.toISOString());
            
        } catch (error) {
            console.error("❌ Date initialization failed:", error);
        }
        
        // Setup event listeners with error handling
        try {
            var locRadio = document.getElementById("visualizeByLocationHistory");
            var excRadio = document.getElementById("visualizeByExceptionHistory");
            
            if (locRadio) {
                locRadio.addEventListener("click", function () { 
                    if (p) p.disabled = !0; 
                    console.log("Location history mode selected");
                });
            }
            
            if (excRadio) {
                excRadio.addEventListener("click", function () { 
                    if (p) p.disabled = !1; 
                    console.log("Exception history mode selected");
                });
            }
            
            if (i) {
                i.addEventListener("click", function (e) { 
                    e.preventDefault(); 
                    debouncedSearch(); 
                });
            }
            
            console.log("✅ Event listeners attached");
            
        } catch (error) {
            console.error("❌ Event listener setup failed:", error);
        }

        // Raw data functionality setup
        try {
            rawDataTableDiv = document.getElementById("rawDataTable");
            showRawDataBtn = document.getElementById("showRawDataBtn");
            downloadRawDataBtn = document.getElementById("downloadRawDataBtn");

            if (showRawDataBtn) {
                showRawDataBtn.addEventListener('click', function () {
                    if (!lastHeatmapPoints.length) {
                        b("📊 No data available. Generate a heatmap first.");
                        return;
                    }
                    
                    if (rawDataTableDiv && (rawDataTableDiv.style.display === 'none' || rawDataTableDiv.style.display === '')) {
                        renderEnhancedDataTable(lastHeatmapPoints);
                        rawDataTableDiv.style.display = 'block';
                        this.textContent = 'Hide Raw Data Table';
                    } else if (rawDataTableDiv) {
                        rawDataTableDiv.style.display = 'none';
                        this.textContent = 'Show Raw Data Table';
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
                        var timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                        var filename = 'heatmap_data_' + timestamp + '.csv';
                        
                        var csvHeader = 'Latitude,Longitude,Timestamp,Vehicle_Info\n';
                        var csvRows = lastHeatmapPoints.map(function(r, index) {
                            return (r.lat || '') + ',' + 
                                   (r.lon || '') + ',' + 
                                   (r.timestamp || '') + ',' + 
                                   'Point_' + (index + 1);
                        }).join('\n');
                        
                        var csv = csvHeader + csvRows;
                        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        
                        B("✅ CSV exported successfully: " + filename);
                        
                    } catch (error) {
                        console.error("Export error:", error);
                        b("❌ Error creating CSV export: " + error.message);
                    }
                });
            }
            
            console.log("✅ Raw data functionality initialized");
            
        } catch (error) {
            console.error("❌ Raw data setup failed:", error);
        }
        
        B("🎉 Advanced heatmap initialized successfully!");
        console.log("🎉 Initialization complete");
    };

    // Enhanced table rendering with statistics
    function renderEnhancedDataTable(data) {
        if (!data.length || !rawDataTableDiv) {
            if (rawDataTableDiv) {
                rawDataTableDiv.innerHTML = '<div class="table-container"><p>No data available.</p></div>';
            }
            return;
        }
        
        var maxRows = 1000; // Performance limit
        var displayData = data.length > maxRows ? data.slice(0, maxRows) : data;
        
        // Calculate statistics
        var stats = {
            total: data.length,
            displayed: displayData.length,
            timeSpan: getTimeSpan(data),
            coordinates: getCoordinateStats(data)
        };
        
        var html = '<div style="margin-bottom: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">';
        html += '<h4 style="margin: 0 0 10px 0;">📊 Data Summary</h4>';
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">';
        html += '<div><strong>Total Records:</strong> ' + S(stats.total) + '</div>';
        html += '<div><strong>Displayed:</strong> ' + S(stats.displayed) + '</div>';
        html += '<div><strong>Time Span:</strong> ' + stats.timeSpan + '</div>';
        html += '<div><strong>Coordinate Range:</strong> ' + stats.coordinates + '</div>';
        html += '</div></div>';
        
        html += '<div class="table-container">';
        html += '<table>';
        html += '<thead><tr>';
        html += '<th style="width: 120px;">Latitude</th>';
        html += '<th style="width: 120px;">Longitude</th>';
        html += '<th style="width: 180px;">Timestamp</th>';
        html += '<th>Local Time</th>';
        html += '</tr></thead>';
        html += '<tbody>';
        
        for (var i = 0; i < displayData.length; i++) {
            var pt = displayData[i];
            var timestamp = pt.timestamp || '';
            var localTime = '';
            
            try {
                if (timestamp) {
                    var date = new Date(timestamp);
                    localTime = date.toLocaleString();
                }
            } catch (e) {
                localTime = 'Invalid date';
            }
            
            html += '<tr>';
            html += '<td>' + (pt.lat ? pt.lat.toFixed(6) : '') + '</td>';
            html += '<td>' + (pt.lon ? pt.lon.toFixed(6) : '') + '</td>';
            html += '<td style="font-family: monospace; font-size: 11px;">' + timestamp.substring(0, 19) + '</td>';
            html += '<td>' + localTime + '</td>';
            html += '</tr>';
        }
        
        html += '</tbody></table></div>';
        
        if (data.length > maxRows) {
            html += '<div style="margin-top: 10px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">';
            html += '<strong>Note:</strong> Showing first ' + S(maxRows) + ' of ' + S(data.length) + ' records for performance. ';
            html += 'Download CSV for complete dataset.';
            html += '</div>';
        }
        
        rawDataTableDiv.innerHTML = html;
    }

    // Helper functions for statistics
    function getTimeSpan(data) {
        if (!data.length) return 'N/A';
        
        var timestamps = data.map(function(d) { return d.timestamp; }).filter(Boolean);
        if (!timestamps.length) return 'N/A';
        
        var dates = timestamps.map(function(t) { return new Date(t); });
        var minDate = new Date(Math.min.apply(null, dates));
        var maxDate = new Date(Math.max.apply(null, dates));
        var diffHours = (maxDate - minDate) / (1000 * 60 * 60);
        
        if (diffHours < 1) {
            return Math.round(diffHours * 60) + ' minutes';
        } else if (diffHours < 24) {
            return Math.round(diffHours * 10) / 10 + ' hours';
        } else {
            return Math.round(diffHours / 24 * 10) / 10 + ' days';
        }
    }

    function getCoordinateStats(data) {
        if (!data.length) return 'N/A';
        
        var lats = data.map(function(d) { return d.lat; }).filter(function(l) { return l && l !== 0; });
        var lons = data.map(function(d) { return d.lon; }).filter(function(l) { return l && l !== 0; });
        
        if (!lats.length || !lons.length) return 'N/A';
        
        var latRange = (Math.max.apply(null, lats) - Math.min.apply(null, lats)).toFixed(4);
        var lonRange = (Math.max.apply(null, lons) - Math.min.apply(null, lons)).toFixed(4);
        
        return latRange + '° × ' + lonRange + '°';
    }

    // Sorting function for vehicles and rules
    var u = function (e, t) {
        return (e = e.name.toLowerCase()) === (t = t.name.toLowerCase()) ? 0 : t < e ? 1 : -1;
    };

    // Return the main object
    return {
        initialize: function (e, t, n) {
            console.log("🎯 Add-in initialize called");
            v = e;
            
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(function (pos) { 
                    console.log("📍 Geolocation obtained:", pos.coords);
                    a(pos.coords); 
                    n(); 
                }, function(error) {
                    console.log("🌍 Geolocation failed, using default location:", error);
                    a({ longitude: -79.709441, latitude: 43.434497 }); 
                    n();
                });
            } else {
                console.log("🌍 Geolocation not available, using default location");
                a({ longitude: -79.709441, latitude: 43.434497 }); 
                n();
            }
        },
        
        focus: function (e, t) {
            console.log("🎯 Add-in focus called");
            v = e;
            
            // Load vehicles with enhanced error handling
            if (v && v.call) {
                B("🚗 Loading vehicles...");
                
                v.call("Get", {
                    typeName: "Device",
                    resultsLimit: 2000, // Reasonable limit
                    search: { 
                        fromDate: (new Date).toISOString(), 
                        groups: t.getGroupFilter() 
                    }
                }, function (devices) {
                    console.log("✅ Vehicles loaded:", devices ? devices.length : 0);
                    
                    if (devices && devices.length > 0 && y) {
                        devices.sort(u);
                        
                        // Clear existing options
                        y.innerHTML = '';
                        
                        devices.forEach(function (device) {
                            var option = new Option();
                            option.text = device.name;
                            option.value = device.id;
                            y.add(option);
                        });
                        
                        B("✅ Loaded " + devices.length + " vehicles");
                        
                        if (devices.length > 50) {
                            b("ℹ️ Large fleet detected (" + devices.length + " vehicles). Select 10 or fewer for optimal performance.");
                        }
                    } else {
                        b("❌ No vehicles found or vehicles list not available");
                    }
                }, function(error) {
                    console.error("❌ Vehicle loading error:", error);
                    b("❌ Error loading vehicles: " + error);
                });
                
                // Load rules with enhanced error handling
                B("⚠️ Loading exception rules...");
                
                v.call("Get", {
                    typeName: "Rule",
                    resultsLimit: 2000 // Reasonable limit
                }, function (rules) {
                    console.log("✅ Rules loaded:", rules ? rules.length : 0);
                    
                    if (rules && rules.length > 0 && p) {
                        rules.sort(u);
                        
                        // Clear existing options
                        p.innerHTML = '';
                        
                        rules.forEach(function (rule) {
                            var option = new Option();
                            option.text = rule.name;
                            option.value = rule.id;
                            p.add(option);
                        });
                        
                        console.log("✅ Exception rules populated");
                    } else {
                        console.log("ℹ️ No rules found");
                    }
                }, function(error) {
                    console.error("❌ Rules loading error:", error);
                    b("❌ Error loading exception rules: " + error);
                });
            } else {
                b("❌ Geotab API not available");
            }
            
            // Ensure map is properly sized
            setTimeout(function () { 
                if (h && h.invalidateSize) {
                    h.invalidateSize(); 
                    console.log("🗺️ Map size invalidated");
                }
            }, 300);
        }
    };
};
