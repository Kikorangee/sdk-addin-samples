"use strict";
geotab.addin.heatmap = function () {
    // Core variables (keeping original structure)
    var v, h, m, p, y, E, w, i, l, r, c, D, t;
    var I = 5000; // ONLY CHANGE: Reduced from 50,000 to 5,000 for better performance
    
    // NEW: Raw data functionality
    var rawDataTableDiv, showRawDataBtn, downloadRawDataBtn;
    var lastHeatmapPoints = [];

    // Helper functions (exactly as original)
    var b = function (e) { l.innerHTML = e; };
    var B = function (e) { r.innerHTML = e; };

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

    var T = function (e) {
        e ? (i.disabled = !0, c.style.display = "block")
          : (setTimeout(function () { c.style.display = "none" }, 600), i.disabled = !1)
    };

    var d = function () {
        void 0 !== m && h.removeLayer(m),
            m = L.heatLayer({
                radius: { value: 24, absolute: !1 },
                opacity: .7,
                gradient: { .45: "rgb(0,0,255)", .55: "rgb(0,255,255)", .65: "rgb(0,255,0)", .95: "yellow", 1: "rgb(255,0,0)" }
            }).addTo(h);
        for (var e = D = 0; e < y.options.length; e++)
            y.options[e].selected && D++;
        0 !== D ? (t = new Date, !0 === p.disabled ? n() : o()) : b("Please select at least one vehicle from the list and try again.");
    };

    // Location history search (keeping original logic exactly)
    var n = function () {
        y.value;
        for (var e, t = [], n = y.options, o = 0, a = n.length; o < a; o++)
            (e = n[o]).selected && t.push(e.value || e.text);
        var i = E.value, l = w.value;
        b(""), B("");
        if (null !== t && "" !== i && "" !== l) {
            T(!0);
            for (var r = new Date(i).toISOString(),
                c = new Date(l).toISOString(),
                d = [], u = 0, s = t.length; u < s; u++)
                d.push(["Get", {
                    typeName: "LogRecord",
                    resultsLimit: I,
                    search: {
                        deviceSearch: { id: t[u] },
                        fromDate: r,
                        toDate: c
                    }
                }]);
            v.multiCall(d, function (e) {
                if (x(e)) return b("No data to display"), void T(!1);
                for (var t = [], n = [], o = 0, a = 0, i = [], l = 0, r = e.length; l < r; l++) {
                    i = e[l];
                    for (var c = 0; c < i.length; c++)
                        0 === i[c].latitude && 0 === i[c].longitude ||
                        (t.push({ lat: i[c].latitude, lon: i[c].longitude, timestamp: i[c].dateTime, value: 1 }),
                            n.push(new L.LatLng(i[c].latitude, i[c].longitude)), o++);
                    i.length >= I && a++;
                }
                
                // NEW: Store data for raw table
                lastHeatmapPoints = t;
                
                0 < t.length ?
                    (h.fitBounds(n),
                        m.setLatLngs(t),
                        B("Displaying ".concat(S(o), " combined log records for the\n        ").concat(S(D), " selected vehicles. [").concat(N(), " sec]")),
                        0 < a && b("Note: Not all results are displayed because the result limit of \n          ".concat(S(I), " was exceeded for \n          ").concat(S(a), " of the selected vehicles.")))
                    : b("No data to display"), T(!1)
            }, function (e) { alert(e), T(!1) })
        }
    };

    // Exception history search (keeping original logic exactly)
    var o = function () {
        y.value;
        for (var e, t = p.options[p.selectedIndex].value, g = p.options[p.selectedIndex].text, n = [], o = y.options, a = 0, i = o.length; a < i; a++)
            (e = o[a]).selected && n.push(e.value || e.text);
        var l = E.value, r = w.value;
        b(""), B("");
        if (null !== n && null !== t && "" !== l && "" !== r) {
            T(!0);
            for (var c = new Date(l).toISOString(),
                d = new Date(r).toISOString(),
                u = [], s = 0, f = n.length; s < f; s++)
                u.push(["Get", {
                    typeName: "ExceptionEvent",
                    resultsLimit: I,
                    search: {
                        deviceSearch: { id: n[s] },
                        ruleSearch: { id: t },
                        fromDate: c,
                        toDate: d
                    }
                }]);
            v.multiCall(u, function (e) {
                if (x(e)) return b("No data to display"), void T(!1);
                for (var u = 0, s = 0, t = [], n = 0, o = e.length; n < o; n++) {
                    for (var a = e[n], i = 0; i < a.length; i++)
                        u++, t.push(["Get", {
                            typeName: "LogRecord",
                            resultsLimit: I,
                            search: {
                                deviceSearch: { id: a[i].device.id },
                                fromDate: a[i].activeFrom,
                                toDate: a[i].activeTo
                            }
                        }]);
                    a.length >= I && s++;
                }
                v.multiCall(t, function (e) {
                    if (x(e)) return b("No data to display"), void T(!1);
                    for (var t = [], n = [], o = 0, a = 0, i = 0, l = e.length; i < l; i++) {
                        for (var r = e[i], c = 0; c < r.length; c++)
                            0 === r[c].latitude && 0 === r[c].longitude ||
                            (t.push({ lat: r[c].latitude, lon: r[c].longitude, timestamp: r[c].dateTime, value: 1 }),
                                n.push(new L.LatLng(r[c].latitude, r[c].longitude)), o++);
                        r.length >= I && a++;
                    }
                    
                    // NEW: Store data for raw table
                    lastHeatmapPoints = t;
                    
                    if (0 < t.length) {
                        h.fitBounds(n),
                            m.setLatLngs(t),
                            B("Displaying ".concat(S(o), " combined log records associated with the\n          ").concat(S(u), " '").concat(g, "' rule exceptions found for the \n          ").concat(S(D), " selected vehicles. [").concat(N(), " sec]")),
                            0 < s || 0 < a && (function () {
                                var d = "Note: Not all results are displayed because";
                                s && (d += " the result limit of \n              ".concat(S(I), " was exceeded for '").concat(g, "' rule exceptions"));
                                0 < s && 0 < a && (d += " and");
                                a && (d += " the result limit of \n              ".concat(S(I), " was exceeded for \n              ").concat(S(a), " of the selected vehicles."));
                                b(d += ".");
                            })(), T(!1)
                    } else b("No data to display")
                }, function (e) { alert(e), T(!1) })
            }, function (e) { alert(e), T(!1) })
        }
    };

    // Initialization (keeping original logic, only changing default date range)
    var a = function (e) {
        h = new L.Map("heatmap-map", {
            center: new L.LatLng(e.latitude, e.longitude), zoom: 13
        }),
            L.tileLayer("http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                subdomains: ["a", "b", "c"]
            }).addTo(h),
            p = document.getElementById("exceptionTypes"),
            y = document.getElementById("vehicles"),
            E = document.getElementById("from"),
            w = document.getElementById("to"),
            i = document.getElementById("showHeatMap"),
            l = document.getElementById("error"),
            r = document.getElementById("message"),
            c = document.getElementById("loading");
        
        // OPTIMIZED: Better default date range (4 hours instead of full day)
        var t = new Date;
        var fourHoursAgo = new Date(t.getTime() - 4 * 60 * 60 * 1000);
        var n = t.getDate(), o = t.getMonth() + 1, a = t.getFullYear();
        var startHour = fourHoursAgo.getHours(), currentHour = t.getHours();
        
        n < 10 && (n = "0" + n), o < 10 && (o = "0" + o);
        if (startHour < 10) startHour = "0" + startHour;
        if (currentHour < 10) currentHour = "0" + currentHour;
        
        E.value = a + "-" + o + "-" + n + "T" + startHour + ":00",
        w.value = a + "-" + o + "-" + n + "T" + currentHour + ":00",
        
        // Event listeners (exactly as original)
        document.getElementById("visualizeByLocationHistory").addEventListener("click", function (e) { p.disabled = !0 }),
        document.getElementById("visualizeByExceptionHistory").addEventListener("click", function (e) { p.disabled = !1 }),
        document.getElementById("exceptionTypes").addEventListener("change", function (e) { e.preventDefault() }),
        document.getElementById("vehicles").addEventListener("change", function (e) { e.preventDefault() }),
        document.getElementById("from").addEventListener("change", function (e) { e.preventDefault() }),
        document.getElementById("to").addEventListener("change", function (e) { e.preventDefault() }),
        document.getElementById("showHeatMap").addEventListener("click", function (e) { e.preventDefault(), d() });

        // NEW: Raw data table functionality
        rawDataTableDiv = document.getElementById("rawDataTable");
        showRawDataBtn = document.getElementById("showRawDataBtn");
        downloadRawDataBtn = document.getElementById("downloadRawDataBtn");

        if (showRawDataBtn) {
            showRawDataBtn.addEventListener('click', function () {
                if (rawDataTableDiv.style.display === 'none' || rawDataTableDiv.style.display === '') {
                    if (lastHeatmapPoints.length === 0) {
                        b("No data available. Please generate a heatmap first.");
                        return;
                    }
                    renderRawDataTable(lastHeatmapPoints);
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
                    b("No data available. Please generate a heatmap first.");
                    return;
                }
                const csvHeader = ['Latitude', 'Longitude', 'Timestamp'];
                const csvRows = lastHeatmapPoints.map(r => [
                    r.lat || r.latitude || '',
                    r.lon || r.lng || r.longitude || '',
                    r.timestamp || r.dateTime || ''
                ]);
                const csv = [csvHeader, ...csvRows].map(e => e.join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'heatmap_data_' + new Date().toISOString().slice(0,10) + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }
    };

    // NEW: Simple table renderer
    function renderRawDataTable(data) {
        if (!data.length) {
            rawDataTableDiv.innerHTML = '<p>No data available.</p>';
            return;
        }
        
        var maxRows = 1000; // Limit for performance
        var displayData = data.length > maxRows ? data.slice(0, maxRows) : data;
        
        var html = '<div style="margin-bottom: 10px;">';
        if (data.length > maxRows) {
            html += '<p><strong>Showing first ' + maxRows + ' of ' + S(data.length) + ' total records</strong></p>';
        } else {
            html += '<p><strong>Total records: ' + S(data.length) + '</strong></p>';
        }
        html += '</div>';
        
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
        html += '<thead><tr style="background-color: #f0f0f0;"><th style="border: 1px solid #ddd; padding: 8px;">Latitude</th><th style="border: 1px solid #ddd; padding: 8px;">Longitude</th><th style="border: 1px solid #ddd; padding: 8px;">Timestamp</th></tr></thead>';
        html += '<tbody>';
        
        for (var i = 0; i < displayData.length; i++) {
            var pt = displayData[i];
            html += '<tr>';
            html += '<td style="border: 1px solid #ddd; padding: 4px;">' + (pt.lat || pt.latitude || '') + '</td>';
            html += '<td style="border: 1px solid #ddd; padding: 4px;">' + (pt.lon || pt.lng || pt.longitude || '') + '</td>';
            html += '<td style="border: 1px solid #ddd; padding: 4px;">' + (pt.timestamp || pt.dateTime || '') + '</td>';
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        rawDataTableDiv.innerHTML = html;
    }

    // Sorting function (exactly as original)
    var u = function (e, t) {
        return (e = e.name.toLowerCase()) === (t = t.name.toLowerCase()) ? 0 : t < e ? 1 : -1;
    };

    // Return object (exactly as original)
    return {
        initialize: function (e, t, n) {
            v = e, "geolocation" in navigator
                ? navigator.geolocation.getCurrentPosition(function (e) { a(e.coords), n(); })
                : (a({ longitude: -79.709441, latitude: 43.434497 }), n());
        },
        focus: function (e, t) {
            (v = e).call("Get", {
                typeName: "Device",
                resultsLimit: 5e4,
                search: { fromDate: (new Date).toISOString(), groups: t.getGroupFilter() }
            }, function (e) {
                !e || e.length < 0 || (e.sort(u), e.forEach(function (e) {
                    var t = new Option;
                    t.text = e.name, t.value = e.id, y.add(t);
                }));
            }, b),
                v.call("Get", {
                    typeName: "Rule",
                    resultsLimit: 5e4
                }, function (e) {
                    !e || e.length < 0 || (e.sort(u), e.forEach(function (e) {
                        var t = new Option;
                        t.text = e.name, t.value = e.id, p.add(t);
                    }));
                }, b),
                setTimeout(function () { h.invalidateSize() }, 200);
        }
    };
};
