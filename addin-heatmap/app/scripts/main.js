// heatmap.js
class HeatmapAddin {
    constructor(api, state) {
        this.api = api;
        this.state = state;
        this.map = null;
        this.heatmap = null;
        this.markers = [];
        this.infoWindows = [];
    }

    async initialize() {
        // Load Google Maps API
        await this.loadGoogleMaps();
        
        // Create map container
        const container = document.createElement('div');
        container.id = 'map-container';
        container.style.height = '100%';
        document.body.appendChild(container);
        
        // Initialize map
        this.map = new google.maps.Map(container, {
            center: { lat: 0, lng: 0 },
            zoom: 2,
            mapTypeId: 'roadmap'
        });
        
        // Load data and create heatmap
        await this.loadData();
    }

    async loadGoogleMaps() {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=visualization`;
            script.onload = resolve;
            document.head.appendChild(script);
        });
    }

    async loadData() {
        try {
            // Get data from Geotab API
            const results = await this.api.call('Get', {
                typeName: 'DutyStatusLog',
                resultsLimit: 1000
            });
            
            // Process data points
            const points = results.map(log => ({
                lat: log.latitude,
                lng: log.longitude,
                value: 1, // Default value for heatmap intensity
                deviceId: log.device.id,
                timestamp: log.dateTime
            }));
            
            // Create heatmap
            this.createHeatmap(points);
            
            // Add enhanced visualization
            this.addEnhancedVisualization(points);
            
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    createHeatmap(points) {
        const heatmapData = points.map(point => ({
            location: new google.maps.LatLng(point.lat, point.lng),
            weight: point.value
        }));
        
        this.heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData,
            map: this.map,
            radius: 20
        });
    }

    addEnhancedVisualization(points) {
        // Clear previous markers and info windows
        this.clearMarkers();
        
        // Add data point markers with tooltips
        this.addDataPointMarkers(points);
        
        // Add heatmap legend
        this.addHeatmapLegend();
        
        // Display data statistics
        this.displayDataStats(points);
        
        // Fit bounds to show all points
        this.fitMapBounds(points);
    }

    addDataPointMarkers(points) {
        points.forEach(point => {
            const marker = new google.maps.Marker({
                position: { lat: point.lat, lng: point.lng },
                map: this.map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 3,
                    fillColor: '#4285F4',
                    fillOpacity: 0.8,
                    strokeWeight: 0
                }
            });
            
            const infoWindow = new google.maps.InfoWindow({
                content: this.getTooltipContent(point)
            });
            
            marker.addListener('click', () => {
                // Close all other info windows
                this.infoWindows.forEach(iw => iw.close());
                infoWindow.open(this.map, marker);
            });
            
            this.markers.push(marker);
            this.infoWindows.push(infoWindow);
        });
    }

    getTooltipContent(point) {
        return `
            <div class="heatmap-tooltip">
                <h4>Data Point Details</h4>
                <p><strong>Latitude:</strong> ${point.lat.toFixed(6)}</p>
                <p><strong>Longitude:</strong> ${point.lng.toFixed(6)}</p>
                ${point.deviceId ? `<p><strong>Device ID:</strong> ${point.deviceId}</p>` : ''}
                ${point.timestamp ? `<p><strong>Time:</strong> ${new Date(point.timestamp).toLocaleString()}</p>` : ''}
            </div>
        `;
    }

    addHeatmapLegend() {
        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';
        legend.innerHTML = `
            <h4>Heatmap Intensity</h4>
            <div class="legend-gradient"></div>
            <div class="legend-labels">
                <span>Low</span>
                <span>High</span>
            </div>
        `;
        
        this.map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(legend);
    }

    displayDataStats(points) {
        const statsContainer = document.createElement('div');
        statsContainer.id = 'stats-container';
        
        const values = points.map(p => p.value);
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const max = Math.max(...values);
        const min = Math.min(...values);
        
        statsContainer.innerHTML = `
            <div class="data-stats">
                <h4>Data Statistics</h4>
                <p>Points: ${points.length}</p>
                <p>Average intensity: ${avg.toFixed(2)}</p>
                <p>Maximum: ${max}</p>
                <p>Minimum: ${min}</p>
            </div>
        `;
        
        this.map.controls[google.maps.ControlPosition.LEFT_TOP].push(statsContainer);
    }

    fitMapBounds(points) {
        if (points.length === 0) return;
        
        const bounds = new google.maps.LatLngBounds();
        points.forEach(point => {
            bounds.extend(new google.maps.LatLng(point.lat, point.lng));
        });
        
        this.map.fitBounds(bounds);
    }

    clearMarkers() {
        this.markers.forEach(marker => marker.setMap(null));
        this.markers = [];
        this.infoWindows.forEach(iw => iw.close());
        this.infoWindows = [];
    }

    focus() {
        console.log('Heatmap add-in focused');
    }

    blur() {
        console.log('Heatmap add-in blurred');
    }
}

// Register the add-in
Geotab.addin.Heatmap = HeatmapAddin;
