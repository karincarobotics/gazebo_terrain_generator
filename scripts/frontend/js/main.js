// Main application entry point
(function () {
    'use strict';

    let map = null;
    let mapboxApiKey = null;
    let centerMarker = null;
    let draw = null;
    let coordinateOverlays = [];
    let showCoordinates = false;
    let vertexDeletePopup = null;
    let selectedVertex = null; // Store {featureId, coordIndex}
    let mouseDownOnVertex = false;
    let gridVisible = false;
    const GRID_LAYER_ID = 'grid-preview';
    const STORAGE_KEY = 'gazebo_terrain_generator_settings';

    const DEFAULT_CONFIG = {
        zoomLevel: 17,
        includeBuildings: true,
        tileSource: 'http://ecn.t0.tiles.virtualearth.net/tiles/a{quad}.jpeg?g=129&mkt=en&stl=H',
        parallelDownloads: 4
    };

    const config = loadConfig();

    const TILE_SOURCES = [
        { label: 'Bing Maps', url: 'http://ecn.t0.tiles.virtualearth.net/tiles/r{quad}.jpeg?g=129&mkt=en&stl=H' },
        { label: 'Bing Maps Satellite', url: 'http://ecn.t0.tiles.virtualearth.net/tiles/a{quad}.jpeg?g=129&mkt=en&stl=H' },
        { label: 'Bing Maps Hybrid', url: 'http://ecn.t0.tiles.virtualearth.net/tiles/h{quad}.jpeg?g=129&mkt=en&stl=H' },
        null,
        { label: 'Google Maps', url: 'https://mt0.google.com/vt?lyrs=m&x={x}&s=&y={y}&z={z}' },
        { label: 'Google Maps Satellite', url: 'https://mt0.google.com/vt?lyrs=s&x={x}&s=&y={y}&z={z}' },
        { label: 'Google Maps Hybrid', url: 'https://mt0.google.com/vt?lyrs=h&x={x}&s=&y={y}&z={z}' },
        { label: 'Google Maps Terrain', url: 'https://mt0.google.com/vt?lyrs=p&x={x}&s=&y={y}&z={z}' },
        null,
        { label: 'Open Street Maps', url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png' },
        { label: 'Open Cycle Maps', url: 'http://a.tile.opencyclemap.org/cycle/{z}/{x}/{y}.png' },
        null,
        { label: 'ESRI World Imagery', url: 'http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
        { label: 'Wikimedia Maps', url: 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png' },
        null,
        { label: 'Carto Light', url: 'http://cartodb-basemaps-c.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png' },
        { label: 'Stamen Toner B&W', url: 'http://a.tile.stamen.com/toner/{z}/{x}/{y}.png' },
    ];

    function loadConfig() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return Object.assign({}, DEFAULT_CONFIG, JSON.parse(stored));
            }
        } catch (e) {
            console.warn('Failed to load settings from localStorage:', e);
        }
        return Object.assign({}, DEFAULT_CONFIG);
    }

    function saveConfig() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch (e) {
            console.warn('Failed to save settings to localStorage:', e);
        }
    }

    function applyConfigToForm() {
        document.getElementById('setting-zoom-level').value = config.zoomLevel;
        document.getElementById('setting-include-buildings').checked = config.includeBuildings;
        document.getElementById('setting-tile-source').value = config.tileSource;
        document.getElementById('setting-parallel-downloads').value = config.parallelDownloads;

        const matchedSource = TILE_SOURCES.find(s => s && s.url === config.tileSource);
        document.getElementById('setting-source-display').textContent =
            matchedSource ? matchedSource.label : 'Custom';
    }

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

        map.on('load', function () {
            console.log('Map loaded successfully');

            // Initialize drawing tools
            initializeDrawing();

            // Add center marker after map loads
            addCenterMarker();

            // Setup search button
            setupSearchButton();

            // Setup draw controls
            setupDrawControls();

            // Setup settings panel
            setupSettingsPanel();

            // Setup generate button
            document.getElementById('generate-btn').addEventListener('click', function () {
                if (validateForGeneration()) {
                    generateTerrain();
                }
            });

        });

        map.on('error', function (e) {
            console.error('Map error:', e);
            const errorMsg = e.error?.message || e.message || 'Unknown error';
            showError('Unexpected runtime error: ' + errorMsg);
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
        centerMarker.on('drag', function () {
            const lngLat = centerMarker.getLngLat();
            updateCoordinateInput(lngLat.lat, lngLat.lng);
        });

        centerMarker.on('dragend', function () {
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
            searchButton.addEventListener('click', function () {
                searchCoordinates();
            });

            input.addEventListener('keypress', function (e) {
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
            showError('Invalid coordinates. Please use format: lat, lng (e.g., 39.778518, -86.246375)');
        }
    }

    // Initialize drawing tools
    function initializeDrawing() {
        draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {},
            defaultMode: 'simple_select'
        });

        map.addControl(draw, 'top-right');

        // Listen for draw events
        map.on('draw.create', onDrawCreate);
        map.on('draw.update', onDrawUpdate);
        map.on('draw.delete', onDrawDelete);
        map.on('draw.selectionchange', onSelectionChange);

        // Set up drag detection
        setupDragDetection();

        // Add keyboard listener for delete key
        document.addEventListener('keydown', handleKeyPress);

        // Add right-click handler for vertices
        setupVertexContextMenu();
    }

    // Handle draw create event
    function onDrawCreate(e) {
        console.log('Polygon created:', e.features);
        setGridVisible(false);
        updateCoordinateOverlays();
    }

    // Handle draw update event
    function onDrawUpdate(e) {
        console.log('Polygon updated:', e.features);
        updateCoordinateOverlays();
    }

    // Handle draw delete event
    function onDrawDelete(e) {
        console.log('Polygon deleted:', e.features);
        clearCoordinateOverlays();
        hideVertexDeletePopup();
    }

    // Handle selection change
    function onSelectionChange(e) {
        // Remove old popup first
        if (vertexDeletePopup) {
            vertexDeletePopup.remove();
            vertexDeletePopup = null;
        }

        if (e.features.length > 0 && e.points && e.points.length > 0) {
            // A vertex is selected
            const point = e.points[0];
            const feature = e.features[0];

            console.log('Selection event:', e);
            console.log('Point:', point);
            console.log('Feature:', feature);

            // Find which vertex was clicked by matching coordinates
            const clickedCoord = point.geometry.coordinates;
            const featureCoords = feature.geometry.coordinates[0];

            let coordIndex = -1;
            for (let i = 0; i < featureCoords.length - 1; i++) { // -1 to skip closing point
                if (Math.abs(featureCoords[i][0] - clickedCoord[0]) < 0.000001 &&
                    Math.abs(featureCoords[i][1] - clickedCoord[1]) < 0.000001) {
                    coordIndex = i;
                    break;
                }
            }

            if (coordIndex >= 0) {
                selectedVertex = {
                    featureId: feature.id,
                    coordIndex: coordIndex
                };
                console.log('Vertex selected at index:', coordIndex);
                // Mark that mouse is down on a vertex
                mouseDownOnVertex = true;
                showVertexDeletePopup(point);
            }
        } else {
            // No vertex selected, clear everything
            selectedVertex = null;
            mouseDownOnVertex = false;
        }
    }

    // Setup drag detection
    function setupDragDetection() {
        map.on('mousemove', function (e) {
            if (mouseDownOnVertex && vertexDeletePopup) {
                console.log('Drag detected, hiding popup');
                hideVertexDeletePopup();
            }
        });

        map.on('mousedown', function (e) {
            if (gridVisible) {
                hideGrid();
            }
        })

        map.on('mouseup', function (e) {
            if (selectedVertex) {
                const feature = draw.get(selectedVertex.featureId);
                const coords = feature.geometry.coordinates[0][selectedVertex.coordIndex];
                showVertexDeletePopup({geometry: {coordinates: coords}});
            }
            if (gridVisible) {
                showGrid();
            }
            mouseDownOnVertex = false;
        });
    }

    // Setup vertex context menu (right-click)
    function setupVertexContextMenu() {
        map.on('contextmenu', function (e) {
            // Check if we're clicking on a draw feature
            const features = map.queryRenderedFeatures(e.point);
            const isDrawFeature = features.some(f =>
                f.source === 'mapbox-gl-draw-cold' ||
                f.source === 'mapbox-gl-draw-hot'
            );

            if (isDrawFeature && selectedVertex) {
                e.preventDefault();
                deleteSelectedVertex();
            }
        });
    }

    // Handle keyboard events
    function handleKeyPress(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedVertex) {
                e.preventDefault();
                deleteSelectedVertex();
            }
        }
    }

    // Show vertex delete popup
    function showVertexDeletePopup(point) {
        // Remove old popup if exists
        if (vertexDeletePopup) {
            vertexDeletePopup.remove();
            vertexDeletePopup = null;
        }

        const coords = [point.geometry.coordinates[0], point.geometry.coordinates[1]];

        vertexDeletePopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'vertex-delete-popup',
            anchor: 'top',
            offset: 15
        })
            .setLngLat(coords)
            .setHTML('<button id="delete-vertex-btn" class="delete-vertex-btn"><i class="fas fa-trash-alt"></i></button>')
            .addTo(map);

        // Add click handler to delete button
        setTimeout(function () {
            const deleteBtn = document.getElementById('delete-vertex-btn');
            if (deleteBtn) {
                deleteBtn.onclick = function (e) {
                    e.stopPropagation();
                    console.log('Delete button clicked, selectedVertex:', selectedVertex);
                    deleteSelectedVertex();
                };
            }
        }, 0);
    }

    // Hide vertex delete popup
    function hideVertexDeletePopup() {
        if (vertexDeletePopup) {
            vertexDeletePopup.remove();
            vertexDeletePopup = null;
        }
        //selectedVertex = null;
    }

    // Delete selected vertex
    function deleteSelectedVertex() {
        if (!selectedVertex) {
            console.log('No vertex selected');
            return;
        }

        console.log('Attempting to delete vertex:', selectedVertex);

        // Get the feature by ID
        const allFeatures = draw.getAll().features;
        const feature = allFeatures.find(f => f.id === selectedVertex.featureId);

        if (!feature) {
            console.log('Feature not found');
            return;
        }

        if (feature.geometry.type !== 'Polygon') {
            console.log('Selected feature is not a polygon');
            return;
        }

        const coordinates = feature.geometry.coordinates[0].slice(); // Make a copy

        // Don't allow deletion if polygon would have less than 4 points (3 unique + closing)
        if (coordinates.length <= 4) {
            showError('Cannot delete vertex: polygon must have at least 3 vertices');
            return;
        }

        const coordIndex = selectedVertex.coordIndex;

        console.log('Deleting vertex at index:', coordIndex, 'from', coordinates.length, 'coordinates');

        // Remove the vertex
        coordinates.splice(coordIndex, 1);

        // Ensure the polygon is closed (first and last points are the same)
        if (coordIndex === 0) {
            coordinates[coordinates.length - 1] = [coordinates[0][0], coordinates[0][1]];
        }

        // Update the feature
        const featureId = feature.id;
        const updatedFeature = {
            id: featureId,
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            },
            properties: feature.properties
        };

        draw.delete(featureId);
        draw.add(updatedFeature);
        draw.changeMode('simple_select', {featureIds: [featureId]});

        hideVertexDeletePopup();
        updateCoordinateOverlays();

        console.log('Vertex deleted successfully. New coordinate count:', coordinates.length);
    }

    // Setup draw control buttons
    function setupDrawControls() {
        // Create custom control container
        const controlContainer = document.createElement('div');
        controlContainer.className = 'mapboxgl-ctrl mapboxgl-ctrl-group custom-draw-controls';

        // Draw polygon button
        const drawButton = document.createElement('button');
        drawButton.className = 'mapbox-gl-draw_ctrl-draw-btn';
        drawButton.title = 'Draw polygon';
        drawButton.innerHTML = '<i class="fas fa-draw-polygon"></i>';
        drawButton.onclick = function () {
            // Clear existing polygons
            draw.deleteAll();
            clearCoordinateOverlays();
            // Start drawing
            draw.changeMode('draw_polygon');
        };

        // Toggle coordinates button
        const coordButton = document.createElement('button');
        coordButton.className = 'mapbox-gl-draw_ctrl-draw-btn';
        coordButton.title = 'Toggle coordinate labels';
        coordButton.innerHTML = '<i class="fas fa-tag"></i>';
        coordButton.onclick = function () {
            showCoordinates = !showCoordinates;
            coordButton.style.backgroundColor = showCoordinates ? '#3bb2d0' : '';
            updateCoordinateOverlays();
        };

        // Grid preview button
        const gridButton = document.createElement('button');
        gridButton.className = 'mapbox-gl-draw_ctrl-draw-btn';
        gridButton.title = 'Toggle grid preview';
        gridButton.innerHTML = '<i class="fas fa-th"></i>';
        gridButton.onclick = function () {
            setGridVisible(!gridVisible, gridButton);
        };

        // Expose button so other functions can reset its style
        window._gridButton = gridButton;

        // Settings button
        const settingsButton = document.createElement('button');
        settingsButton.className = 'mapbox-gl-draw_ctrl-draw-btn';
        settingsButton.title = 'Settings';
        settingsButton.innerHTML = '<i class="fas fa-cog"></i>';
        settingsButton.onclick = function () {
            document.getElementById('settings-panel').classList.toggle('open');
        };

        controlContainer.appendChild(drawButton);
        controlContainer.appendChild(coordButton);
        controlContainer.appendChild(gridButton);
        controlContainer.appendChild(settingsButton);

        // Add to map
        map.getContainer().querySelector('.mapboxgl-ctrl-top-right').appendChild(controlContainer);
    }

    // Update coordinate overlays
    function updateCoordinateOverlays() {
        clearCoordinateOverlays();

        if (!showCoordinates) return;

        const features = draw.getAll().features;
        features.forEach(function (feature) {
            if (feature.geometry.type === 'Polygon') {
                const coordinates = feature.geometry.coordinates[0];
                coordinates.forEach(function (coord, index) {
                    // Skip last coordinate (same as first)
                    if (index === coordinates.length - 1) return;

                    const popup = new mapboxgl.Popup({
                        closeButton: false,
                        closeOnClick: false,
                        className: 'coordinate-label'
                    })
                        .setLngLat(coord)
                        .setHTML(`${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}`)
                        .addTo(map);

                    coordinateOverlays.push(popup);
                });
            }
        });
    }

    // Clear coordinate overlays
    function clearCoordinateOverlays() {
        coordinateOverlays.forEach(function (popup) {
            popup.remove();
        });
        coordinateOverlays = [];
    }

    // Validate inputs before generation
    function validateForGeneration() {
        const features = draw.getAll().features;

        if (features.length === 0) {
            showError('Draw a polygon on the map first.');
            return false;
        }

        const polygon = features[0];

        // Check convexity by comparing polygon area to its convex hull area
        const hull = turf.convex(polygon);
        if (!hull) {
            showError('Invalid polygon shape.');
            return false;
        }
        const areaDiff = Math.abs(turf.area(hull) - turf.area(polygon)) / turf.area(polygon);
        if (areaDiff > 0.001) {
            showError('Polygon must be convex. Remove inward vertices to fix it.');
            return false;
        }

        // Check pivot point is inside the polygon
        const lngLat = centerMarker.getLngLat();
        const pivotPoint = turf.point([lngLat.lng, lngLat.lat]);
        if (!turf.booleanPointInPolygon(pivotPoint, polygon)) {
            showError('The pivot point (red marker) must be inside the polygon.');
            return false;
        }

        return true;
    }

    // Generate terrain (stub — to be implemented with console UI)
    function generateTerrain() {
        showSuccess('Validation passed. Generation coming soon...');
    }

    // Setup settings panel
    function setupSettingsPanel() {
        // Apply loaded/default config to form fields
        applyConfigToForm();

        // Populate source presets dropdown
        const presetsDropdown = document.getElementById('source-presets-dropdown');
        TILE_SOURCES.forEach(function (source) {
            if (source === null) {
                const divider = document.createElement('div');
                divider.className = 'source-preset-divider';
                presetsDropdown.appendChild(divider);
            } else {
                const item = document.createElement('div');
                item.className = 'source-preset-item';
                item.textContent = source.label;
                item.addEventListener('click', function () {
                    document.getElementById('setting-tile-source').value = source.url;
                    document.getElementById('setting-source-display').textContent = source.label;
                    config.tileSource = source.url;
                    presetsDropdown.classList.remove('open');
                    saveConfig();
                });
                presetsDropdown.appendChild(item);
            }
        });

        // Toggle presets dropdown via display button or chevron
        function togglePresetsDropdown(e) {
            e.stopPropagation();
            presetsDropdown.classList.toggle('open');
        }
        document.getElementById('setting-source-display').addEventListener('click', togglePresetsDropdown);
        document.getElementById('setting-source-presets-btn').addEventListener('click', togglePresetsDropdown);

        // Close presets dropdown on outside click
        document.addEventListener('click', function (e) {
            if (!e.target.closest('#setting-source-display') &&
                !e.target.closest('#setting-source-presets-btn') &&
                !e.target.closest('#source-presets-dropdown')) {
                presetsDropdown.classList.remove('open');
            }
        });

        // Close panel button
        document.getElementById('settings-close-btn').addEventListener('click', function () {
            document.getElementById('settings-panel').classList.remove('open');
        });

        // Sync config on input change
        document.getElementById('setting-zoom-level').addEventListener('change', function () {
            config.zoomLevel = parseInt(this.value, 10) || 17;
            saveConfig();
            if (gridVisible) { showGrid(); }
        });

        document.getElementById('setting-include-buildings').addEventListener('change', function () {
            config.includeBuildings = this.checked;
            saveConfig();
        });

        document.getElementById('setting-parallel-downloads').addEventListener('change', function () {
            config.parallelDownloads = parseInt(this.value, 10) || 4;
            saveConfig();
        });

        document.getElementById('settings-revert-btn').addEventListener('click', function () {
            Object.assign(config, DEFAULT_CONFIG);
            localStorage.removeItem(STORAGE_KEY);
            applyConfigToForm();
            if (gridVisible) { showGrid(); }
        });
    }

    // --- Tile utilities ---

    function long2tile(lon, zoom) {
        return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    }

    function lat2tile(lat, zoom) {
        return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    }

    function tile2long(x, z) {
        return x / Math.pow(2, z) * 360 - 180;
    }

    function tile2lat(y, z) {
        const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }

    function getTileRect(x, y, zoom) {
        return [
            [tile2long(x, zoom), tile2lat(y + 1, zoom)], // SW
            [tile2long(x + 1, zoom), tile2lat(y + 1, zoom)], // SE
            [tile2long(x + 1, zoom), tile2lat(y, zoom)],     // NE
            [tile2long(x, zoom), tile2lat(y, zoom)],     // NW
            [tile2long(x, zoom), tile2lat(y + 1, zoom)]  // SW close
        ];
    }

    function getGrid(zoomLevel) {
        const features = draw.getAll().features;
        if (features.length === 0) return [];

        const polygon = features[0];
        const coords = polygon.geometry.coordinates[0];

        // Get bounding box of polygon
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);

        const TY = lat2tile(maxLat, zoomLevel);
        const BY = lat2tile(minLat, zoomLevel);
        const LX = long2tile(minLng, zoomLevel);
        const RX = long2tile(maxLng, zoomLevel);

        const rects = [];
        for (let y = TY; y <= BY; y++) {
            for (let x = LX; x <= RX; x++) {
                const tileRect = getTileRect(x, y, zoomLevel);
                const tilePolygon = turf.polygon([tileRect]);
                if (!turf.booleanDisjoint(tilePolygon, polygon)) {
                    rects.push(tileRect);
                }
            }
        }
        return rects;
    }

    function setGridVisible(visible, button) {
        gridVisible = visible;
        const btn = button || window._gridButton;
        if (btn) btn.style.backgroundColor = gridVisible ? '#3bb2d0' : '';
        if (gridVisible) {
            showGrid();
        } else {
            hideGrid();
        }
    }

    function showGrid() {
        if (draw.getAll().features.length === 0) {
            showError('Draw a polygon first before previewing the grid.');
            setGridVisible(false);
            return;
        }

        hideGrid();

        const grid = getGrid(config.zoomLevel);

        if (grid.length === 0) {
            showError('No tiles found in selection.');
            setGridVisible(false);
            return;
        }

        const gridFeatures = grid.map(rect => turf.polygon([rect]));

        map.addSource(GRID_LAYER_ID, {
            type: 'geojson',
            data: turf.featureCollection(gridFeatures)
        });

        map.addLayer({
            id: GRID_LAYER_ID,
            type: 'line',
            source: GRID_LAYER_ID,
            paint: {
                'line-color': '#ffffff',
                'line-width': 1,
                'line-opacity': 0.45
            }
        });

        //showInfo(`Grid preview: ${grid.length} tiles at zoom level ${GRID_ZOOM_LEVEL}`);
    }

    function hideGrid() {
        if (map.getSource(GRID_LAYER_ID)) {
            map.removeLayer(GRID_LAYER_ID);
            map.removeSource(GRID_LAYER_ID);
        }
    }

    // Show error message
    function showError(message) {
        console.error(message);
        Toastify({
            text: message,
            duration: 5000,
            gravity: "top",
            position: "center",
            style: { background: "linear-gradient(to right, #e74c3c, #c0392b)" },
            stopOnFocus: true
        }).showToast();
    }

    // Show success message
    function showSuccess(message) {
        console.log(message);
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "center",
            style: { background: "linear-gradient(to right, #27ae60, #1e8449)" },
            stopOnFocus: true
        }).showToast();
    }

    // Show info message
    function showInfo(message) {
        console.log(message);
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "center",
            style: { background: "linear-gradient(to right, #3498db, #2980b9)" },
            stopOnFocus: true
        }).showToast();
    }

    // Start the application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
