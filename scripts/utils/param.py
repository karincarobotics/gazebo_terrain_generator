import os
from pathlib import Path

class globalParam:

    DEM_BUILDING_RESOLUTION     = 15
    TEMPLATE_DIR_PATH           = str(Path(__file__).resolve().parents[2] / 'templates')

    # Maximum heightmap output size (must be 2^n+1 for Gazebo).
    # At zoom 17+, the DEM→satellite upscale factor always exceeds this cap.
    MAX_HEIGHTMAP_SIZE          = 8193

    # Draw tile borders on aerial.png output for debugging tile grid alignment
    DEBUG_TILE_BORDERS          = False

    # Free Mapbox API Key
    MAPBOX_API_KEY              = "pk.eyJ1IjoiYXJhdmluZDE5NDAiLCJhIjoiY21jNDVyYTM5MDdxYjJqc2FjczA3bTBmeSJ9.kNLCV2BhlN0CRCOBJIpM1A"