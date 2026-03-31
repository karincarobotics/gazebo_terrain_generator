import os
from pathlib import Path

class globalParam:

    DEM_BUILDING_RESOLUTION     = 15
    TEMPLATE_DIR_PATH           = str(Path(__file__).resolve().parents[2] / 'templates')

    # Free Mapbox API Key
    MAPBOX_API_KEY              = "pk.eyJ1IjoiYXJhdmluZDE5NDAiLCJhIjoiY21jNDVyYTM5MDdxYjJqc2FjczA3bTBmeSJ9.kNLCV2BhlN0CRCOBJIpM1A"