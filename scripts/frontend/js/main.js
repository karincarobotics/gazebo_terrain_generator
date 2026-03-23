// Main application entry point
(function() {
    'use strict';

    let map = null;
    let mapboxApiKey = null;
    let centerMarker = null;

    // Initialize the application
    async function init() {
        try {
            // Fetch Mapbox API key from server
            await fetchMapboxKey();

            // Initialize the map
            initializeMap();

            console.log('Application initialized successfully');
        } catch (error) {
            console.error('Failed to initialize application:', error);
            showError('Failed to load the application. Please refresh the page.');
        }
    }

    // Fetch Mapbox API key from server
    async function fetchMapboxKey() {
        try {
            const response = await fetch('/api/mapbox-key');
            const data = await response.json();

            if (data.code === 200 && data.apiKey) {
                mapboxApiKey = data.apiKey;
                mapboxgl.accessToken = mapboxApiKey;
            } else {
                throw new Error('Invalid API key response');
            }
        } catch (error) {
            throw new Error('Failed to fetch Mapbox API key: ' + error.message);
        }
    }

    // Initialize Mapbox map
    function initializeMap() {
        map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [-86.246375, 39.778518], // Default: Allison Track
            zoom: 12
        });

        // Add navigation controls
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        // Add scale control
        map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

        map.on('load', function() {
            console.log('Map loaded successfully');
            updateSidebar('Map ready! Select a region to begin.');

            // Add center marker after map loads
            addCenterMarker();

            // Setup search button
            setupSearchButton();
        });

        map.on('error', function(e) {
            console.error('Map error:', e);
            showError('Map failed to load properly.');
        });
    }

    // Add draggable marker at map center
    function addCenterMarker() {
        const center = map.getCenter();

        // Create draggable marker
        centerMarker = new mapboxgl.Marker({
            draggable: true,
            color: '#e74c3c'
        })
        .setLngLat([center.lng, center.lat])
        .addTo(map);

        // Update coordinate input with initial position
        updateCoordinateInput(center.lat, center.lng);

        // Listen for drag events
        centerMarker.on('drag', function() {
            const lngLat = centerMarker.getLngLat();
            updateCoordinateInput(lngLat.lat, lngLat.lng);
        });

        centerMarker.on('dragend', function() {
            const lngLat = centerMarker.getLngLat();
            console.log('Marker moved to:', lngLat.lat, lngLat.lng);
        });
    }

    // Update coordinate input field
    function updateCoordinateInput(lat, lng) {
        const input = document.getElementById('coordinate-input');
        if (input) {
            input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
    }

    // Setup search button functionality
    function setupSearchButton() {
        const searchButton = document.getElementById('search-button');
        const input = document.getElementById('coordinate-input');

        if (searchButton && input) {
            searchButton.addEventListener('click', function() {
                searchCoordinates();
            });

            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    searchCoordinates();
                }
            });
        }
    }

    // Search for coordinates
    function searchCoordinates() {
        const input = document.getElementById('coordinate-input');
        const value = input.value.trim();

        // Parse coordinates (format: lat, lng)
        const coords = value.split(',').map(s => parseFloat(s.trim()));

        if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
            const lat = coords[0];
            const lng = coords[1];

            // Move map to new location
            map.flyTo({
                center: [lng, lat],
                zoom: 15
            });

            // Move marker to new location
            if (centerMarker) {
                centerMarker.setLngLat([lng, lat]);
            }

            console.log('Searched coordinates:', lat, lng);
        } else {
            alert('Invalid coordinates. Please use format: lat, lng (e.g., 39.778518, -86.246375)');
        }
    }

    // Update sidebar content
    function updateSidebar(message) {
        const sidebar = document.querySelector('.sidebar-content');
        if (sidebar) {
            sidebar.innerHTML = `
                <h2>Getting Started</h2>
                <p>${message}</p>
            `;
        }
    }

    // Show error message
    function showError(message) {
        const sidebar = document.querySelector('.sidebar-content');
        if (sidebar) {
            sidebar.innerHTML = `
                <h2>Error</h2>
                <p style="color: #e74c3c;">${message}</p>
            `;
        }
    }

    // Start the application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
