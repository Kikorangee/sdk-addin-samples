document.addEventListener('DOMContentLoaded', function () {
    // ---- Existing logic: Data structure and variables ----
    // You likely have something like this:
    let rawData = []; // This will be filled when vehicles/dates are selected
    let filteredRawData = []; // Data filtered by date range

    // ---- Existing logic: Date picker setup ----
    const fp = flatpickr("#datePicker", {
        mode: "range",
        dateFormat: "Y-m-d",
        onClose: function(selectedDates, dateStr, instance) {
            filterAndRender(selectedDates);
        }
    });

    // ---- Existing logic: Data filtering and main rendering ----
    function filterAndRender(selectedDates) {
        // Filter rawData according to date range selection
        if (selectedDates && selectedDates.length === 2) {
            const [start, end] = selectedDates;
            filteredRawData = rawData.filter(item => {
                const ts = new Date(item.timestamp);
                return ts >= start && ts <= end;
            });
        } else {
            filteredRawData = rawData.slice();
        }
        renderHeatMap(filteredRawData);
        const tableDiv = document.getElementById('rawDataTable');
        if (tableDiv.style.display === 'block') {
            renderRawDataTable(filteredRawData);
        }
    }

    // ---- Existing logic: Heatmap rendering ----
    function renderHeatMap(data) {
        const div = document.getElementById('heatMapCanvas');
        div.innerHTML = ''; // Clear previous map
        // Insert your existing heatmap logic here, for example:
        // heatMapLibrary.render(div, data);
        // For demonstration, we'll show a count:
        div.innerHTML = `<p>${data.length} data points loaded for heat map.<br>(Integrate actual map rendering here.)</p>`;
    }

    // ---- NEW: Raw data table toggle ----
    document.getElementById('showRawDataBtn').addEventListener('click', function() {
        const tableDiv = document.getElementById('rawDataTable');
        if (tableDiv.style.display === 'none' || tableDiv.style.display === '') {
            renderRawDataTable(filteredRawData);
            tableDiv.style.display = 'block';
            this.textContent = 'Hide Raw Data';
        } else {
            tableDiv.style.display = 'none';
            this.textContent = 'Show Raw Data';
        }
    });

    // ---- NEW: CSV Download ----
    document.getElementById('downloadRawDataBtn').addEventListener('click', function() {
        if (!filteredRawData.length) return;
        const csvHeader = ['Latitude', 'Longitude', 'Timestamp'];
        const csvRows = filteredRawData.map(r => [
            r.lat || r.latitude || '',
            r.lng || r.longitude || '',
            r.timestamp || r.time || ''
        ]);
        const csv = [csvHeader, ...csvRows].map(e => e.join(',')).join('\n');
        const blob = new Blob([csv], {type: 'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'raw_heatmap_data.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ---- NEW: Raw data table renderer ----
    function renderRawDataTable(data) {
        if (!data.length) {
            document.getElementById('rawDataTable').innerHTML = '<p>No data for selected range.</p>';
            return;
        }
        let html = '<table><thead><tr><th>Latitude</th><th>Longitude</th><th>Timestamp</th></tr></thead><tbody>';
        data.forEach(pt => {
            html += `<tr><td>${pt.lat || pt.latitude || ''}</td><td>${pt.lng || pt.longitude || ''}</td><td>${pt.timestamp || pt.time || ''}</td></tr>`;
        });
        html += '</tbody></table>';
        document.getElementById('rawDataTable').innerHTML = html;
    }

    // ---- Existing logic: Initial data load/vehicle selection ----
    // (You must keep your Geotab API data loading here)
    // Example:
    // function fetchDataForSelection(selectedVehicles, selectedDateRange) {
    //     geotabApi.getTrips({ vehicles: selectedVehicles, fromDate: selectedDateRange[0], toDate: selectedDateRange[1] }, function(trips) {
    //         rawData = trips.map(trip => ({
    //             lat: trip.latitude,
    //             lng: trip.longitude,
    //             timestamp: trip.timestamp
    //         }));
    //         filterAndRender(selectedDateRange);
    //     });
    // }
    // Make sure to call filterAndRender() after you update rawData

    // ---- Initial rendering ----
    filterAndRender(); // This will show initial state (empty or all data)

    // ---- Optionally: wire up vehicle selection ----
    // If you have vehicle selection drop-downs, call fetchDataForSelection() when changed

});
