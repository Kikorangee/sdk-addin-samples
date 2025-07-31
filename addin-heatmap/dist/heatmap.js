// Example dummy data for demonstration
let rawData = [
    { lat: 43.6532, lng: -79.3832, timestamp: '2025-07-30 10:00:00' },
    { lat: 43.6535, lng: -79.3835, timestamp: '2025-07-30 11:00:00' },
    { lat: 43.6540, lng: -79.3840, timestamp: '2025-07-30 12:00:00' }
];

// Date picker setup
const fp = flatpickr("#datePicker", {
    mode: "range",
    dateFormat: "Y-m-d",
    onClose: function(selectedDates, dateStr, instance) {
        // Update based on date selection
        filterAndRender(selectedDates);
    }
});

// Quick range dropdown
document.getElementById('quickRange').addEventListener('change', function() {
    const now = new Date();
    let start, end;
    switch (this.value) {
        case 'today':
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            end = new Date(start);
            end.setHours(23,59,59,999);
            break;
        case '7days':
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
            start = new Date(end);
            start.setDate(start.getDate() - 6);
            break;
        case '30days':
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
            start = new Date(end);
            start.setDate(start.getDate() - 29);
            break;
        default:
            fp.clear();
            return;
    }
    fp.setDate([start, end]);
    filterAndRender([start, end]);
});

// Show/hide raw data table
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

// Download raw data as CSV
document.getElementById('downloadRawDataBtn').addEventListener('click', function() {
    if (!filteredRawData.length) return;
    const csv = [
        ['Latitude', 'Longitude', 'Timestamp'],
        ...filteredRawData.map(r => [r.lat, r.lng, r.timestamp])
    ].map(e => e.join(',')).join('\n');
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

// Filter data based on selected date range
let filteredRawData = rawData.slice();

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

// Render heat map (placeholder)
function renderHeatMap(data) {
    const div = document.getElementById('heatMapCanvas');
    div.innerHTML = `<p>${data.length} data points loaded for heat map.<br>(Integrate actual map rendering here.)</p>`;
}

// Render raw data table
function renderRawDataTable(data) {
    if (!data.length) {
        document.getElementById('rawDataTable').innerHTML = '<p>No data for selected range.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Latitude</th><th>Longitude</th><th>Timestamp</th></tr></thead><tbody>';
    data.forEach(pt => {
        html += `<tr><td>${pt.lat}</td><td>${pt.lng}</td><td>${pt.timestamp}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('rawDataTable').innerHTML = html;
}

// Initial render
filterAndRender();
