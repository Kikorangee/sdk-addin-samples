// ---------------------------------------------
// Use your actual heatmap data array/object here!
// Replace 'heatmapData' with the correct variable name if needed.
// ---------------------------------------------

document.getElementById('showRawDataBtn').addEventListener('click', function() {
    const tableDiv = document.getElementById('rawDataTable');
    if (tableDiv.style.display === 'none' || tableDiv.style.display === '') {
        renderRawDataTable(heatmapData); // Uses your real data
        tableDiv.style.display = 'block';
        this.textContent = 'Hide Raw Data';
    } else {
        tableDiv.style.display = 'none';
        this.textContent = 'Show Raw Data';
    }
});

document.getElementById('downloadRawDataBtn').addEventListener('click', function() {
    if (!Array.isArray(heatmapData) || !heatmapData.length) return;
    // If your data format differs, adjust the keys accordingly
    const csvHeader = ['Latitude', 'Longitude', 'Timestamp'];
    const csvRows = heatmapData.map(r => [
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

function renderRawDataTable(data) {
    if (!Array.isArray(data) || !data.length) {
        document.getElementById('rawDataTable').innerHTML = '<p>No data available.</p>';
        return;
    }
    // If your data format differs, adjust the keys accordingly
    let html = '<table><thead><tr><th>Latitude</th><th>Longitude</th><th>Timestamp</th></tr></thead><tbody>';
    data.forEach(pt => {
        html += `<tr><td>${pt.lat || pt.latitude || ''}</td><td>${pt.lng || pt.longitude || ''}</td><td>${pt.timestamp || pt.time || ''}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('rawDataTable').innerHTML = html;
}

// ---------------------------------------------
// Your existing heatmap initialization and rendering code goes here
// This file does NOT change or duplicate your heatmap logic!
// ---------------------------------------------
