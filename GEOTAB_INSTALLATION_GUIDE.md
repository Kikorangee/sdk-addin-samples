# Geotab Heat Map Add-in - Installation Guide

## Overview
This guide will help you load the enhanced Heat Map add-in into your MyGeotab system. The add-in has been modernized with improved styling, better error handling, and enhanced functionality including Electric Vehicle (EV) data support.

## What's Been Enhanced

### 🎨 **Modern UI/UX**
- Clean, responsive design with Inter font family
- Modern color scheme with gradients and shadows
- Improved form controls and button styling
- Better mobile responsiveness
- Accessibility improvements (keyboard navigation, high contrast support)

### 🔧 **Enhanced Functionality**
- Better error handling and validation
- Date range validation (max 30 days for performance)
- Vehicle selection limit (max 50 for optimal performance)
- Enhanced EV data integration
- Improved loading states and user feedback

### 🛡️ **Reliability Improvements**
- Library validation (checks if Leaflet and plugins are loaded)
- Better geolocation handling with fallbacks
- Enhanced API error handling
- Console logging for debugging

## Installation Methods

### Method 1: Using CDN (Recommended)
This method uses the files hosted on GitHub's CDN, making it easy to deploy without hosting files yourself.

1. **Open MyGeotab**
   - Log into your MyGeotab account
   - Navigate to **System Settings → Add-Ins**

2. **Add the Configuration**
   Copy and paste this JSON configuration:

```json
{
  "name": "Heat Map - Enhanced",
  "supportEmail": "support@geotab.com",
  "version": "2.0.0",
  "items": [{
    "url": "https://cdn.jsdelivr.net/gh/Geotab/sdk-addin-samples@master/addin-heatmap/app/heatmap.html",
    "path": "ActivityLink/",
    "menuName": {
      "en": "Heat Map"
    },
    "icon": "https://cdn.jsdelivr.net/gh/Geotab/sdk-addin-samples@master/addin-heatmap/app/images/icon.svg"
  }],
  "isSigned": false
}
```

3. **Save and Test**
   - Click **Save** to install the add-in
   - Navigate to **Activity → Heat Map** to test the add-in

### Method 2: Self-Hosted
If you prefer to host the files on your own server:

1. **Upload Files**
   - Upload the entire `addin-heatmap/app/` folder to your web server
   - Ensure the files are accessible via HTTPS

2. **Update Configuration**
     Replace the URL in the configuration with your server URL:
```json
{
  "name": "Heat Map - Self Hosted",
  "supportEmail": "your-email@company.com",
  "version": "2.0.0",
  "items": [{
    "url": "https://your-server.com/path/to/heatmap.html",
    "path": "ActivityLink/",
    "menuName": {
      "en": "Heat Map"
    },
    "icon": "https://your-server.com/path/to/images/icon.svg"
  }],
  "isSigned": false
}
```

## Usage Instructions

### Basic Heat Map
1. **Select Visualization Type**: Choose "Location History" (default)
2. **Select Vehicles**: Choose one or more vehicles (max 50 for performance)
3. **Set Date Range**: Select start and end dates (max 30 days)
4. **Generate Map**: Click "Show Heat Map"

### Exception History Heat Map
1. **Select Visualization Type**: Choose "Exception History"
2. **Select Rule**: Choose a rule from the dropdown
3. **Select Vehicles**: Choose one or more vehicles
4. **Set Date Range**: Select start and end dates
5. **Generate Map**: Click "Show Heat Map"

### Electric Vehicle Data (New Feature)
1. **Enable EV Data**: Check "Include Electric Vehicle Data"
2. **Follow Basic Steps**: Complete the basic heat map setup
3. **Enhanced Visualization**: The map will show additional intensity for:
   - Low battery levels (below 20%)
   - Charging events
   - Poor battery health (below 80%)
   - Critical battery levels (below 10%)

## Troubleshooting

### Common Issues

**1. Add-in doesn't load**
- Check that JavaScript is enabled in your browser
- Verify internet connection for CDN resources
- Check browser console for error messages

**2. No vehicles appear**
- Check your MyGeotab group filter settings
- Refresh the page to apply new group filters
- Ensure you have vehicles in your database

**3. Map doesn't display**
- Check internet connection (required for map tiles)
- Verify Leaflet libraries are loading
- Check browser console for errors

**4. Performance issues**
- Reduce date range (max 30 days recommended)
- Select fewer vehicles (max 50 recommended)
- Use smaller time windows for better performance

### Error Messages

**"Date range cannot exceed 30 days"**
- Solution: Select a shorter time period

**"Please select 50 or fewer vehicles"**
- Solution: Reduce vehicle selection for optimal performance

**"No data to display"**
- Solution: Check date range and ensure vehicles have data for selected period

**"Leaflet library is not loaded"**
- Solution: Check internet connection and refresh page

## Features Overview

### 📊 **Data Visualization**
- Interactive heat maps using Leaflet.js
- Customizable intensity gradients
- Zoom and pan functionality
- Responsive design for all devices

### 🚗 **Vehicle Data**
- Location history visualization
- Exception/rule violation mapping
- Multi-vehicle support
- Group filter integration

### 🔋 **Electric Vehicle Support**
- Battery level visualization
- Charging event mapping
- Battery health indicators
- Enhanced intensity for EV-specific events

### 🎛️ **User Controls**
- Date/time range selection
- Vehicle multi-select
- Rule/exception filtering
- Real-time progress indicators

## Technical Details

### Dependencies
- Leaflet.js 1.9.4 (mapping library)
- Leaflet.heat 0.2.0 (heat map plugin)
- Inter font family (typography)
- MyGeotab API (data source)

### Browser Support
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Performance Considerations
- Maximum 50 vehicles per query
- Maximum 30-day date range
- 50,000 record limit per API call
- Automatic result limit warnings

## Support

If you encounter issues:

1. **Check Browser Console**: Look for error messages
2. **Verify Configuration**: Ensure JSON is valid
3. **Test Internet Connection**: CDN resources require internet access
4. **Contact Support**: Use the support email in your configuration

## Version History

**v2.0.0 (Current)**
- Modern UI with Inter font and improved styling
- Enhanced error handling and validation
- Electric Vehicle data support
- Better mobile responsiveness
- Accessibility improvements
- Performance optimizations

**v1.0.0 (Original)**
- Basic heat map functionality
- Location and exception history
- Multi-vehicle support

---

**Note**: This enhanced version maintains full compatibility with the original Geotab Heat Map add-in while providing significant improvements in usability, reliability, and functionality.
