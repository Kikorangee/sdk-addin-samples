document.addEventListener('DOMContentLoaded', function () {

    // --- EXISTING LOGIC: Sample structure, replace with your actual Geotab-fetching code ---
    // If you fetch data from Geotab, keep your code here. This part is preserved.
    let rawData = [
        // Your actual data from Geotab goes here. Example:
        // { lat: ..., lng: ..., timestamp: ... }
    ];
    let filteredRawData = rawData.slice();

    // Date picker setup (existing logic)
    const fp = flatpickr("#datePicker", {
        mode: "range",
        dateFormat: "Y-m-d",
        onClose: function(selectedDates, dateStr, instance) {
            filterAndRender(selectedDates);
        }
    });

    // Filtering and rendering logic (existing)
    function filterAndRender(selectedDates) {
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

    // YOUR EXISTING HEATMAP RENDERING LOGIC GOES HERE:
    // Replace this with your actual map rendering code (Geotab, Leaflet, Google Maps, etc).
    function renderHeatMap(data) {
        const div = document.getElementById('heatMapCanvas');
        div.innerHTML = ''; // Clear prev map
        // --- Your code to draw the heatmap using 'data' ---
        // Example: heatNet.draw(data); or similar
        // If you used a library, keep your previous map code here.
    }

    // --- ADDED FUNCTIONALITY: Raw Data Table Button ---
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

    // --- ADDED FUNCTIONALITY: CSV Download Button ---
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

    // --- ADDED FUNCTIONALITY: Raw Data Table Renderer ---
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

    // --- EXISTING LOGIC: Initial render ---
    filterAndRender();

    // --- EXISTING LOGIC: If you have vehicle selection or other controls, keep those event listeners and calls here ---

});
