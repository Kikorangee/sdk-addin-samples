document.addEventListener('DOMContentLoaded', function () {

    // ... your previous code goes here ...

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

    // ... rest of your code: flatpickr setup, filterAndRender, etc. ...
});
