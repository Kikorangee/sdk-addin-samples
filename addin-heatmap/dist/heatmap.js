"use strict";
geotab.addin.heatmap = function () {
    // OPTIMIZED: Reduced from 50,000 to 1,000 for better performance
    var v, h, m, p, y, E, w, i, l, r, c, D, t, I = 1000;
    var rawDataTableDiv, showRawDataBtn, downloadRawDataBtn;
    var lastHeatmapPoints = []; // stores the latest data used to render heatmap
    
    // OPTIMIZED: Add chunking and debouncing variables
    var CHUNK_SIZE = 5; // Process 5 vehicles at a time
    var MAX_VEHICLES_WARNING = 20; // Warn if more than 20 vehicles selected
    var MAX_DISPLAY_POINTS = 5000; // Sample data if more than this many points
    var debounceTimer;
    var isProcessing = false;

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

    var T = function (e) {
        if (e) {
            i.disabled = !0;
            c.style.display = "block";
            isProcessing = true;
        } else {
            setTimeout(function () { c.style.display = "none"; }, 600);
            i.disabled = !1;
            isProcessing = false;
        }
    };

    // OPTIMIZED: Memory cleanup function
    var clearPreviousData = function() {
        if (m) {
            m.setLatLngs([]); // Clear previous heatmap data
        }
        lastHeatmapPoints = []; // Clear stored points
    };

    // OPTIMIZED: Progress indicator
    var showProgress = function(current, total, message) {
        var percentage = Math.round((current / total) * 100);
        B(`${message} ${percentage}% complete (${current}/${total})`);
    };

    // OPTIMIZED: Smart data sampling for large datasets
    var renderHeatmapWithOptimization = function(points, bounds) {
        var displayPoints = points;
        
        if (points.length > MAX_DISPLAY_POINTS) {
            // Sample the data for better performance
            var sampledPoints = [];
            var sampleRate = Math.max(1, Math.floor(points.length / MAX_DISPLAY_POINTS));
            
            for (var i = 0; i < points.length; i += sampleRate) {
                sampledPoints.push(points[i]);
            }
            
            displayPoints = sampledPoints;
            B(`Displaying ${S(sampledPoints.length)} sampled points from ${S(points.length)} total records for better performance. [${N()} sec]`);
        }
        
        if (bounds.length > 0) {
            h.fitBounds(bounds);
        }
        m.setLatLngs(displayPoints);
    };

    // OPTIMIZED: Chunked data processing
    var processVehiclesInChunks = function(vehicles, searchConfig, callback) {
        var allResults = [];
        var currentChunk = 0;
        var totalChunks = Math.ceil(vehicles.length / CHUNK_SIZE);
        
        function processChunk() {
            var start = currentChunk * CHUNK_SIZE;
            var end = Math.min(start + CHUNK_SIZE, vehicles.length);
            var chunkVehicles = vehicles.slice(start, end);
            
            if (chunkVehicles.length === 0) {
                callback(allResults);
                return;
            }
            
            showProgress(currentChunk + 1, totalChunks, "Processing vehicle chunks...");
            
            var calls = [];
            for (var i = 0; i < chunkVehicles.length; i++) {
                var callConfig = Object.assign({}, searchConfig);
                callConfig.search.deviceSearch = { id: chunkVehicles[i] };
                calls.push(["Get", callConfig]);
            }
            
            v.multiCall(calls, function(results) {
                allResults = allResults.concat(results);
                currentChunk++;
                
                // Small delay to prevent overwhelming the API
                setTimeout(processChunk, 50);
            }, function(error) {
                alert("Error processing vehicle chunk: " + error);
                T(false);
            });
        }
        
        processChunk();
    };

    // OPTIMIZED: Debounced search function
    var debouncedSearch = function() {
        if (isProcessing) {
            b("Please wait for current operation to complete.");
            return;
        }
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            d();
        }, 300);
    };

    var d = function () {
        clearPreviousData();
        
        void 0 !== m && h.removeLayer(m),
            m = L.heatLayer({
                radius: { value: 24, absolute: !1 },
                opacity: .7,
                gradient: { .45: "rgb(0,0,255)", .55: "rgb(0,255,255)", .65: "rgb(0,255,0)", .95: "yellow", 1: "rgb(255,0,0)" }
            }).addTo(h);
        
        for (var e = D = 0; e < y.options.length; e++)
            y.options[e].selected && D++;
        
        if (0 === D) {
            b("Please select at least one vehicle from the list and try again.");
            return;
        }
        
        // OPTIMIZED: Warn about too many vehicles
        if (D > MAX_VEHICLES_WARNING) {
            if (!confirm(`You've selected ${D} vehicles. This may take a while and could impact performance. Continue?`)) {
                return;
            }
        }
        
        t = new Date;
        !0 === p.disabled ? optimizedLocationSearch() : optimizedExceptionSearch();
    };

    // OPTIMIZED: Location search with chunking
    var optimizedLocationSearch = function () {
        var selectedVehicles = [];
        for (var i = 0; i < y.options.length; i++) {
            if (y.options[i].selected) {
                selectedVehicles.push(y.options[i].value || y.options[i].text);
            }
        }
        
        var fromDate = E.value, toDate = w.value;
        b(""), B("Starting optimized location search...");
        
        if (null !== selectedVehicles && "" !== fromDate && "" !== toDate) {
            T(!0);
            
            var searchConfig = {
                typeName: "LogRecord",
                resultsLimit: I,
                search: {
                    fromDate: new Date(fromDate).toISOString(),
                    toDate: new Date(toDate).toISOString()
                }
            };
            
            processVehiclesInChunks(selectedVehicles, searchConfig, function(allResults) {
                if (x(allResults)) {
                    b("No data to display");
                    T(!1);
                    return;
                }
                
                B("Processing location data...");
                
                var allPoints = [], bounds = [], totalRecords = 0, exceededLimit = 0;
                
                for (var i = 0; i < allResults.length; i++) {
                    var records = allResults[i];
                    for (var j = 0; j < records.length; j++) {
                        var record = records[j];
                        if (0 !== record.latitude && 0 !== record.longitude) {
                            allPoints.push({
                                lat: record.latitude,
