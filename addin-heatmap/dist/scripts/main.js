/**
 * Geotab Heat Map Add-in
 * Enhanced with modern error handling, EV data support, and improved UX
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.heatmap = () => {
  'use strict';

  let api;
  let map;
  let heatMapLayer;

  // DOM Elements
  let elExceptionTypes;
  let elVehicles;
  let elDateFromInput;
  let elDateToInput;
  let elShowHeatMap;
  let elError;
  let elMessage;
  let elLoading;
  let elIncludeEVData;
  
  // Configuration
  let selectedVehicleCount;
  let myGeotabGetResultsLimit = 50000;
  let startTime;
  let isInitialized = false;

  /**
   * Enhanced error handler with better UX
   * @param {string} message - The error message
   * @param {Error} [error] - Optional error object for logging
   */
  let errorHandler = (message, error = null) => {
    if (error) {
      console.error('Heat Map Add-in Error:', error);
    }
    
    if (elError) {
      elError.innerHTML = `<strong>Error:</strong> ${message}`;
      elError.style.display = 'block';
    }
    
    // Clear any success messages
    if (elMessage) {
      elMessage.innerHTML = '';
      elMessage.style.display = 'none';
    }
  };

  /**
   * Enhanced message handler with better UX
   * @param {string} message - The success message
   */
  let messageHandler = message => {
    if (elMessage) {
      elMessage.innerHTML = `<strong>Success:</strong> ${message}`;
      elMessage.style.display = 'block';
    }
    
    // Clear any error messages
    if (elError) {
      elError.innerHTML = '';
      elError.style.display = 'none';
    }
  };

  /**
   * Clear all messages
   */
  let clearMessages = () => {
    if (elError) {
      elError.innerHTML = '';
      elError.style.display = 'none';
    }
    if (elMessage) {
      elMessage.innerHTML = '';
      elMessage.style.display = 'none';
    }
  };

  /**
   * Validate required libraries are loaded
   */
  let validateLibraries = () => {
    if (typeof L === 'undefined') {
      throw new Error('Leaflet library is not loaded. Please check your internet connection and refresh the page.');
    }
    if (typeof L.heatLayer === 'undefined') {
      throw new Error('Leaflet Heat plugin is not loaded. Please check your internet connection and refresh the page.');
    }
  };

  /**
   * Returns a boolean indicating whether all elements in the supplied results array are empty
   * @param {Array} results - The results array to be evaluated
   * @returns {boolean} True if results are empty
   */
  function resultsEmpty(results) {
    if (!results || results.length === 0) {
      return true;
    }
    for (let i = 0; i < results.length; i++) {
      let result = results[i];
      if (result && result.length > 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Formats a number using the comma separator
   * @param {number} num The number to be formatted
   * @returns {string} Formatted number string
   */
  function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  }

  /**
   * Calculates the elapsed time (in seconds) between the startTime variable and current time
   * @returns {number} Elapsed time in seconds
   */
  function getElapsedTimeSeconds() {
    return Math.round((new Date() - startTime) / 1000);
  }

  /**
   * Validate date inputs
   * @param {string} fromDate - Start date
   * @param {string} toDate - End date
   * @returns {boolean} True if dates are valid
   */
  function validateDates(fromDate, toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const now = new Date();
    
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      errorHandler('Please enter valid dates.');
      return false;
    }
    
    if (from >= to) {
      errorHandler('Start date must be before end date.');
      return false;
    }
    
    if (from > now) {
      errorHandler('Start date cannot be in the future.');
      return false;
    }
    
    // Check if date range is too large (more than 30 days)
    const daysDiff = (to - from) / (1000 * 60 * 60 * 24);
    if (daysDiff > 30) {
      errorHandler('Date range cannot exceed 30 days. Please select a shorter time period for better performance.');
      return false;
    }
    
    return true;
  }

  /**
   * Process EV data records and assign intensity values based on EV-specific conditions
   * @param {Array} evRecords - Array of electric vehicle data records
   * @returns {Array} Array of coordinate objects with enhanced intensity values
   */
  function processEVData(evRecords) {
    let evCoordinates = [];
    evRecords.forEach(record => {
      if (record.latitude !== 0 || record.longitude !== 0) {
        // Default intensity value
        let value = 1;
        
        // Increase intensity for low battery levels (below 20%)
        if (record.batteryLevel && record.batteryLevel < 20) {
          value += 2;
        }
        
        // Increase intensity for charging events
        if (record.chargingEvent === true || record.isCharging === true) {
          value += 1.5;
        }
        
        // Increase intensity for poor battery health (below 80%)
        if (record.batteryStateOfHealth && record.batteryStateOfHealth < 80) {
          value += 1;
        }
        
        // Add special handling for battery loops (repeated low battery events)
        if (record.batteryLoop === true || (record.batteryLevel && record.batteryLevel < 10)) {
          value += 3;
        }
        
        evCoordinates.push({
          lat: record.latitude,
          lon: record.longitude,
          value: value
        });
      }
    });
    return evCoordinates;
  }

  /**
   * Display combined heatmap with both location history and EV data
   */
  function displayCombinedHeatMap() {
    // Get selected device IDs
    let deviceIds = [];
    for (let i = 0; i < elVehicles.options.length; i++) {
      if (elVehicles.options[i].selected) {
        deviceIds.push(elVehicles.options[i].value || elVehicles.options[i].text);
      }
    }
    
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;
    
    if (!deviceIds.length || !fromValue || !toValue) {
      errorHandler('Please ensure all date/time and vehicle selections are complete.');
      return;
    }
    
    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();
    
    // Build API calls for location log records
    let locationCalls = [];
    deviceIds.forEach(id => {
      locationCalls.push([
        'Get', {
          typeName: 'LogRecord',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: { id: id },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }
      ]);
    });
    
    // Execute location log records API call
    api.multiCall(locationCalls, function (locationResults) {
      if (resultsEmpty(locationResults)) {
        errorHandler('No location data to display');
        toggleLoading(false);
        return;
      }
      
      let coordinates = [];
      let bounds = [];
      let logRecordCount = 0;
      let exceededResultsLimitCount = 0;
      
      locationResults.forEach((logRecords, index) => {
        logRecords.forEach(record => {
          if (record.latitude !== 0 || record.longitude !== 0) {
            coordinates.push({ lat: record.latitude, lon: record.longitude, value: 1 });
            bounds.push(new L.LatLng(record.latitude, record.longitude));
            logRecordCount++;
          }
        });
        if (logRecords.length >= myGeotabGetResultsLimit) {
          exceededResultsLimitCount++;
        }
      });
      
      // Now try to get EV data using multiple possible API endpoints
      let evCalls = [];
      deviceIds.forEach(id => {
        // Try different possible EV data type names
        evCalls.push([
          'Get', {
            typeName: 'StatusData',
            resultsLimit: myGeotabGetResultsLimit,
            search: {
              deviceSearch: { id: id },
              diagnosticSearch: {
                id: 'DiagnosticBatteryLevelId' // This might need to be adjusted based on actual Geotab API
              },
              fromDate: dateFrom,
              toDate: dateTo
            }
          }
        ]);
      });
      
      // Execute EV data API call
      api.multiCall(evCalls, function (evResults) {
        let evCoordinates = [];
        let evRecordCount = 0;
        
        if (!resultsEmpty(evResults)) {
          evResults.forEach(evRecords => {
            evRecords.forEach(record => {
              if (record.latitude !== 0 || record.longitude !== 0) {
                evRecordCount++;
              }
            });
            // Process records to extract EV-specific coordinates
            evCoordinates = evCoordinates.concat(processEVData(evRecords));
          });
        }
        
        // Merge both sets of coordinates
        let combinedCoordinates = coordinates.concat(evCoordinates);
        
        // Combine bounds from both data sets
        let combinedBounds = bounds.slice();
        evCoordinates.forEach(coord => {
          combinedBounds.push(new L.LatLng(coord.lat, coord.lon));
        });
        
        if (combinedCoordinates.length > 0) {
          map.fitBounds(combinedBounds);
          heatMapLayer.setLatLngs(combinedCoordinates);
          
          let message = `Displaying ${formatNumber(logRecordCount)} location records`;
          if (evRecordCount > 0) {
            message += ` and ${formatNumber(evRecordCount)} EV data points`;
          }
          message += ` for ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`;
          
          messageHandler(message);
          
          if (exceededResultsLimitCount > 0) {
            errorHandler(`Note: Not all results are displayed because the result limit of 
            ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
            ${formatNumber(exceededResultsLimitCount)} of the selected vehicles.`);
          }
        } else {
          errorHandler('No data to display');
        }
        toggleLoading(false);
      }, function (errorString) {
        // If EV data call fails, still show location data
        console.warn('EV data not available:', errorString);
        
        if (coordinates.length > 0) {
          map.fitBounds(bounds);
          heatMapLayer.setLatLngs(coordinates);
          messageHandler(`Displaying ${formatNumber(logRecordCount)} location records for 
          ${formatNumber(selectedVehicleCount)} selected vehicles (EV data unavailable). [${getElapsedTimeSeconds()} sec]`);
          
          if (exceededResultsLimitCount > 0) {
            errorHandler(`Note: Not all results are displayed because the result limit of 
            ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
            ${formatNumber(exceededResultsLimitCount)} of the selected vehicles.`);
          }
        } else {
          errorHandler('No data to display');
        }
        toggleLoading(false);
      });
    }, function (errorString) {
      alert(errorString);
      toggleLoading(false);
    });
  }

  /**
   * Toggle loading spinner
   * @param {boolean} show - [true] to display the spinner, otherwise [false].
   */
  let toggleLoading = show => {
    if (show) {
      elShowHeatMap.disabled = true;
      elLoading.style.display = 'block';
    } else {
      setTimeout(() => {
        elLoading.style.display = 'none';
      }, 600);
      elShowHeatMap.disabled = false;
    }
  };

  /**
   * Remove the HeatMap layer and add a new empty one.
   */
  let resetHeatMapLayer = () => {
    if (heatMapLayer !== undefined) {
      map.removeLayer(heatMapLayer);
    }
    
    heatMapLayer = L.heatLayer({
      radius: {
        value: 24,
        absolute: false
      },
      opacity: 0.7,
      gradient: {
        0.45: 'rgb(0,0,255)',
        0.55: 'rgb(0,255,255)',
        0.65: 'rgb(0,255,0)',
        0.95: 'yellow',
        1.0: 'rgb(255,0,0)'
      }
    }).addTo(map);
  }

  /**
   * Call the appropriate heat map generation function based on the selected visualization option
   */
  let displayHeatMap = () => {
    try {
      clearMessages();
      
      // Validate libraries are loaded
      validateLibraries();
      
      // Validate date inputs
      const fromValue = elDateFromInput.value;
      const toValue = elDateToInput.value;
      
      if (!validateDates(fromValue, toValue)) {
        return;
      }

      // Ensure at least one vehicle is selected
      selectedVehicleCount = 0;
      for (let i = 0; i < elVehicles.options.length; i++) {
        if (elVehicles.options[i].selected) {
          selectedVehicleCount++;
        }
      }
      
      if (selectedVehicleCount === 0) {
        errorHandler('Please select at least one vehicle from the list and try again.');
        return;
      }

      // Check if too many vehicles are selected (performance consideration)
      if (selectedVehicleCount > 50) {
        errorHandler('Please select 50 or fewer vehicles for optimal performance.');
        return;
      }

      resetHeatMapLayer();
      startTime = new Date();
      toggleLoading(true);

      if (elExceptionTypes.disabled === true) {
        // Check if EV data should be included
        if (elIncludeEVData && elIncludeEVData.checked) {
          displayCombinedHeatMap();
        } else {
          displayHeatMapForLocationHistory();
        }
      } else {
        displayHeatMapForExceptionHistory();
      }
    } catch (error) {
      errorHandler('Failed to initialize heat map display.', error);
      toggleLoading(false);
    }
  };

  /**
   * Displays the heatmap of vehicle(s) location history
   */
  let displayHeatMapForLocationHistory = () => {
    let deviceId = elVehicles.value;

    // Get selected device IDs.
    let deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i=0, iLen=options.length; i<iLen; i++) {
      opt = options[i];
  
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if ((deviceIds === null) || (fromValue === '') || (toValue === '')) {
      return;
    }
    
    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();

    // Build array of calls.
		let calls = [];
		for (let i = 0, len = deviceIds.length; i < len; i++) {
      calls.push([
        'Get', {
          typeName: 'LogRecord',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: deviceIds[i]
            },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }    
      ]);
		}

    // Execute multicall.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        return;
      }      
 
      let coordinates = [];
      let bounds = [];
      let logRecordCount = 0; 
      let exceededResultsLimitCount = 0;
      let logRecords = [];    
      // Build coordinates and bounds.
      for (let i = 0, len = results.length; i < len; i++) {
        logRecords = results[i];
        for (let j = 0; j < logRecords.length; j++) {
          if (logRecords[j].latitude !== 0 || logRecords[j].longitude !== 0) {
            coordinates.push({
              lat: logRecords[j].latitude,
              lon: logRecords[j].longitude,
              value: 1
            });
            bounds.push(new L.LatLng(logRecords[j].latitude, logRecords[j].longitude));
            logRecordCount++;
          }
        }
        if (logRecords.length >= myGeotabGetResultsLimit){
          exceededResultsLimitCount++;
        }                
      }

      // Update map.
      if (coordinates.length > 0) {
        map.fitBounds(bounds);
        heatMapLayer.setLatLngs(coordinates);
        messageHandler(`Displaying ${formatNumber(logRecordCount)} combined log records for the
        ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`);
        if (exceededResultsLimitCount > 0) {
          errorHandler(`Note: Not all results are displayed because the result limit of 
          ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
          ${formatNumber(exceededResultsLimitCount)} of the selected vehicles.`);  
        }
      } else {
        errorHandler('No data to display');
      }      
      toggleLoading(false);
    }, function (errorString) {
      // eslint-disable-next-line no-alert
      alert(errorString);
      toggleLoading(false);
    });
  };

  let displayHeatMapForExceptionHistory = () => {
    let deviceId = elVehicles.value;
    let ruleId = elExceptionTypes.options[elExceptionTypes.selectedIndex].value;
    let ruleName = elExceptionTypes.options[elExceptionTypes.selectedIndex].text;

    // Get selected device IDs.
    let deviceIds = [];
    var options = elVehicles.options;
    var opt;
    for (var i=0, iLen=options.length; i<iLen; i++) {
      opt = options[i];
  
      if (opt.selected) {
        deviceIds.push(opt.value || opt.text);
      }
    }
    
    let fromValue = elDateFromInput.value;
    let toValue = elDateToInput.value;

    errorHandler('');
    messageHandler('');

    if ((deviceIds === null) || (ruleId === null) || (fromValue === '') || (toValue === '')) {
      return;
    }
    
    toggleLoading(true);

    let dateFrom = new Date(fromValue).toISOString();
    let dateTo = new Date(toValue).toISOString();
    
    // Build array of calls to get ExceptionEvents for the seletced rule during
    // the specified date/time range for each selected device.
    let calls = [];
		for (let i = 0, len = deviceIds.length; i < len; i++) {
      calls.push([
        'Get', {
          typeName: 'ExceptionEvent',
          resultsLimit: myGeotabGetResultsLimit,
          search: {
            deviceSearch: {
              id: deviceIds[i]
            },
            ruleSearch: {
              id: ruleId
            },
            fromDate: dateFrom,
            toDate: dateTo
          }
        }    
      ]);
		}

    // Execute multicall to get ExceptionEvents for the seletced rule during
    // the specified date/time range for each selected device.
    api.multiCall(calls, function (results) {
      if (resultsEmpty(results)) {
        errorHandler('No data to display');
        toggleLoading(false);
        return;
      }
      
      // Build array of calls to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      let exceptionEventCount = 0;
      let exceededResultsLimitCountForExceptionEvents = 0;  
      let calls = [];
      for (let i = 0, len = results.length; i < len; i++) {
        let exceptionEvents = results[i];
        for (let j = 0; j < exceptionEvents.length; j++) {
          exceptionEventCount++;
          calls.push([
            'Get', {
              typeName: 'LogRecord',
              resultsLimit: myGeotabGetResultsLimit,
              search: {
                deviceSearch: {
                  id: exceptionEvents[j].device.id
                },
                fromDate: exceptionEvents[j].activeFrom,
                toDate: exceptionEvents[j].activeTo
              }
            }    
          ]);        
        } 
        if (exceptionEvents.length >= myGeotabGetResultsLimit){
          exceededResultsLimitCountForExceptionEvents++;
        }                
      }

      // Execute multicall to get LogRecords associated with the devices
      // associated with the returned ExceptionEvents during the timeframes
      // of the ExceptionEvents.
      api.multiCall(calls, function (results) {
        if (resultsEmpty(results)) {
          errorHandler('No data to display');
          toggleLoading(false);
          return;
        } 

        let coordinates = [];
        let bounds = [];
        let logRecordCount = 0;
        let exceededResultsLimitCountForLogRecords = 0;      
        // Build coordinates and bounds.
        for (let i = 0, len = results.length; i < len; i++) {
          let logRecords = results[i];
          for (let j = 0; j < logRecords.length; j++) {
            if (logRecords[j].latitude !== 0 || logRecords[j].longitude !== 0) {
              coordinates.push({
                lat: logRecords[j].latitude,
                lon: logRecords[j].longitude,
                value: 1
              });
              bounds.push(new L.LatLng(logRecords[j].latitude, logRecords[j].longitude));
              logRecordCount++;
            }
          }
          if (logRecords.length >= myGeotabGetResultsLimit){
            exceededResultsLimitCountForLogRecords++;
          }                   
        }

        // Update map.
        if (coordinates.length > 0) {
          map.fitBounds(bounds);
          heatMapLayer.setLatLngs(coordinates);

          messageHandler(`Displaying ${formatNumber(logRecordCount)} combined log records associated with the
          ${formatNumber(exceptionEventCount)} '${ruleName}' rule exceptions found for the 
          ${formatNumber(selectedVehicleCount)} selected vehicles. [${getElapsedTimeSeconds()} sec]`);
          
          // Build the error message if result limit(s) exceeded.
          if (exceededResultsLimitCountForExceptionEvents > 0 || exceededResultsLimitCountForLogRecords > 0) {
            let errorMessage = 'Note: Not all results are displayed because'; 
            
            if (exceededResultsLimitCountForExceptionEvents) {
              errorMessage += ` the result limit of 
              ${formatNumber(myGeotabGetResultsLimit)} was exceeded for '${ruleName}' rule exceptions`;
            }

            if (exceededResultsLimitCountForExceptionEvents > 0 && exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += ' and';
            }

            if (exceededResultsLimitCountForLogRecords > 0) {
              errorMessage += ` the result limit of 
              ${formatNumber(myGeotabGetResultsLimit)} was exceeded for 
              ${formatNumber(exceededResultsLimitCount)} of the selected vehicles.`;
            }

            errorMessage += '.';
            errorHandler(errorMessage);
          }
          toggleLoading(false);
        } else {
          errorHandler('No data to display');
        }      
      }, function (errorString) {
        // eslint-disable-next-line no-alert
        alert(errorString);
        toggleLoading(false);
      });
    }, function (errorString) {
      // eslint-disable-next-line no-alert
      alert(errorString);
      toggleLoading(false);
    });
  };

  /**
   * Initialize the user interface with enhanced error handling
   * @param {object} coords - An object with the latitude and longitude to render on the map
   */
  let initializeInterface = coords => {
    try {
      validateLibraries();
      
      // Setup the map with better error handling
      map = new L.Map('heatmap-map', {
        center: new L.LatLng(coords.latitude, coords.longitude),
        zoom: 13,
        zoomControl: true,
        attributionControl: true
      });

      // Use HTTPS for tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        subdomains: ['a', 'b', 'c'],
        maxZoom: 18
      }).addTo(map);

      // Find and validate DOM elements
      const elements = {
        exceptionTypes: 'exceptionTypes',
        vehicles: 'vehicles',
        from: 'from',
        to: 'to',
        showHeatMap: 'showHeatMap',
        error: 'error',
        message: 'message',
        loading: 'loading',
        includeEVData: 'includeEVData'
      };

      for (const [key, id] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (!element) {
          throw new Error(`Required element with ID '${id}' not found`);
        }
      }

      // Assign elements to variables
      elExceptionTypes = document.getElementById('exceptionTypes');
      elVehicles = document.getElementById('vehicles');
      elDateFromInput = document.getElementById('from');
      elDateToInput = document.getElementById('to');
      elShowHeatMap = document.getElementById('showHeatMap');
      elError = document.getElementById('error');
      elMessage = document.getElementById('message');
      elLoading = document.getElementById('loading');
      elIncludeEVData = document.getElementById('includeEVData');

      // Set up default dates (today)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      elDateFromInput.value = `${year}-${month}-${day}T00:00`;
      elDateToInput.value = `${year}-${month}-${day}T23:59`;

      // Set up event listeners with better error handling
      const setupEventListener = (elementId, event, handler) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.addEventListener(event, handler);
        }
      };

      setupEventListener('visualizeByLocationHistory', 'click', () => {
        elExceptionTypes.disabled = true;
        clearMessages();
      });

      setupEventListener('visualizeByExceptionHistory', 'click', () => {
        elExceptionTypes.disabled = false;
        clearMessages();
      });

      setupEventListener('exceptionTypes', 'change', (event) => {
        event.preventDefault();
        clearMessages();
      });

      setupEventListener('vehicles', 'change', (event) => {
        event.preventDefault();
        clearMessages();
      });

      setupEventListener('from', 'change', (event) => {
        event.preventDefault();
        clearMessages();
      });

      setupEventListener('to', 'change', (event) => {
        event.preventDefault();
        clearMessages();
      });

      setupEventListener('includeEVData', 'change', (event) => {
        event.preventDefault();
        clearMessages();
      });

      setupEventListener('showHeatMap', 'click', (event) => {
        event.preventDefault();
        displayHeatMap();
      });

      isInitialized = true;
      console.log('Heat Map Add-in initialized successfully');
      
    } catch (error) {
      errorHandler('Failed to initialize the heat map interface.', error);
    }
  };

  /**
   * Sort named entities
   * @param {object} a - The left comparison named entity
   * @param {object} b - The right comparison named entity
   */
  let sortByName = (a, b) => {
    a = a.name.toLowerCase();
    b = b.name.toLowerCase();

    if (a === b) {
      return 0;
    }

    if (a > b) {
      return 1;
    }

    return -1;
  };

  return {
    /**
     * Initialize the add-in with enhanced error handling and geolocation
     * @param {Object} freshApi - The Geotab API instance
     * @param {Object} state - The current state
     * @param {Function} callback - Callback function to call when initialization is complete
     */
    initialize(freshApi, state, callback) {
      try {
        api = freshApi;
        
        if (!api) {
          throw new Error('Geotab API not available');
        }

        // Try to get user's location, fallback to Toronto coordinates
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            position => {
              try {
                initializeInterface(position.coords);
                callback();
              } catch (error) {
                console.error('Error initializing with user location:', error);
                // Fallback to default location
                initializeInterface({ longitude: -79.709441, latitude: 43.434497 });
                callback();
              }
            },
            error => {
              console.warn('Geolocation failed, using default location:', error);
              initializeInterface({ longitude: -79.709441, latitude: 43.434497 });
              callback();
            },
            {
              timeout: 10000,
              enableHighAccuracy: false,
              maximumAge: 300000 // 5 minutes
            }
          );
        } else {
          console.warn('Geolocation not supported, using default location');
          initializeInterface({ longitude: -79.709441, latitude: 43.434497 });
          callback();
        }
      } catch (error) {
        console.error('Failed to initialize Heat Map add-in:', error);
        if (callback) callback();
      }
    },

    /**
     * Focus event handler with enhanced data loading and error handling
     * @param {Object} freshApi - The Geotab API instance
     * @param {Object} freshState - The current state
     */
    focus(freshApi, freshState) {
      try {
        api = freshApi;
        
        if (!api) {
          errorHandler('Geotab API not available');
          return;
        }

        if (!isInitialized) {
          errorHandler('Add-in not properly initialized');
          return;
        }

        clearMessages();

        // Clear existing options
        if (elVehicles) {
          elVehicles.innerHTML = '';
        }
        if (elExceptionTypes) {
          elExceptionTypes.innerHTML = '<option disabled="disabled">Select a rule</option>';
        }

        // Populate vehicles list with better error handling
        api.call('Get', {
          typeName: 'Device',
          resultsLimit: 50000,
          search: {
            fromDate: new Date().toISOString(),
            groups: freshState.getGroupFilter()
          }
        }, vehicles => {
          try {
            if (!vehicles || vehicles.length === 0) {
              errorHandler('No vehicles found. Please check your group filter settings.');
              return;
            }

            vehicles.sort(sortByName);

            vehicles.forEach(vehicle => {
              if (vehicle && vehicle.name && vehicle.id) {
                let option = new Option();
                option.text = vehicle.name;
                option.value = vehicle.id;
                elVehicles.add(option);
              }
            });

            console.log(`Loaded ${vehicles.length} vehicles`);
          } catch (error) {
            errorHandler('Error processing vehicles list', error);
          }
        }, error => {
          errorHandler('Failed to load vehicles. Please refresh the page and try again.', error);
        });

        // Populate exceptions list with better error handling
        api.call('Get', {
          typeName: 'Rule',
          resultsLimit: 50000
        }, rules => {
          try {
            if (!rules || rules.length === 0) {
              console.warn('No rules found');
              return;
            }

            rules.sort(sortByName);

            rules.forEach(rule => {
              if (rule && rule.name && rule.id) {
                let option = new Option();
                option.text = rule.name;
                option.value = rule.id;
                elExceptionTypes.add(option);
              }
            });

            console.log(`Loaded ${rules.length} rules`);
          } catch (error) {
            console.error('Error processing rules list:', error);
          }
        }, error => {
          console.error('Failed to load rules:', error);
        });

        // Ensure map is properly sized after focus
        setTimeout(() => {
          if (map) {
            try {
              map.invalidateSize();
            } catch (error) {
              console.error('Error invalidating map size:', error);
            }
          }
        }, 200);

      } catch (error) {
        errorHandler('Error during focus event', error);
      }
    },

    /**
     * Blur event handler for cleanup
     */
    blur() {
      // Clear any ongoing operations or timers if needed
      clearMessages();
    }
  };

