# Frontend Structure

This directory contains the frontend code for the Gazebo Terrain Generator web application.

## Directory Structure

```
frontend/
├── lib/        # Third-party libraries (jQuery, Mapbox, etc.)
├── js/         # Application JavaScript files
├── css/        # Stylesheets
├── assets/     # Static assets
│   ├── images/ # Images, icons, SVGs
│   └── fonts/  # Custom fonts
└── index.html  # Main HTML file
```

## Organization

### `lib/`
Contains all third-party JavaScript libraries and frameworks. This keeps external dependencies separate from application code.

### `js/`
Application-specific JavaScript files organized by functionality:
- Map-related code (Mapbox integration, drawing tools)
- UI interactions and controls
- Download/generation logic
- Utility functions (coordinate conversions, tile calculations)

### `css/`
All stylesheets for the application.

### `assets/`
Static resources like images, icons, and fonts used throughout the application.

## Development

This is a simple, vanilla JavaScript structure designed to be:
- **Easy to understand**: Clear separation of concerns
- **Simple to maintain**: Minimal abstraction
- **Extensible**: Easy to add new features as needed
