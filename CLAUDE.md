# Gazebo Terrain Generator — Project Context for AI Assistants

This file captures key architectural decisions, gotchas, and design intent for this project.
It exists so that anyone (human or AI) resuming work has the context needed without re-deriving it.

---

## What this project does

A web-based tool that generates a Gazebo world from real-world satellite and terrain data.
The user draws a polygon on a map, selects a zoom level and launch location, and the tool:
1. Downloads satellite tiles (Mapbox) and DEM tiles (Mapbox Terrain-DEM-v1) for the selected area
2. Stitches satellite tiles into an aerial texture (`aerial.png`)
3. Generates a normalized grayscale heightmap (`height_map.tif`) for Gazebo
4. Optionally downloads and converts OSM buildings to a 3D mesh (`buildings.dae`)
5. Writes a self-contained Gazebo world file (`{model_name}.world`)

The generated world is fully self-contained — no `GAZEBO_MODEL_PATH` or environment variables required.

---

## Output structure

```
/tmp/gazebo_terrain_generator/{model_name}/
  metadata.json          — polygon_vertices, bounds, center, zoom_level, dem_resolution,
                           launch_location, include_buildings, timestamp
  tiles/[zoom,y,x].png   — flat satellite tiles
  dem/[zoom,y,x].png     — flat DEM tiles (zoom = min(satellite_zoom, 13))
  terrain_data/
    aerial.png            — stitched satellite image
    height_map.tif        — normalized grayscale heightmap (2^n+1 size for Gazebo)
    buildings.dae         — only if include_buildings=True
    buildings.geojson     — only if include_buildings=True
  {model_name}.world      — self-contained Gazebo world file
```

To open: `gz sim /tmp/gazebo_terrain_generator/{model_name}/{model_name}.world`

---

## Tile filename convention

Both satellite and DEM tiles use flat filenames: `[zoom,y,x].png`

- `zoom` = zoom level (integer)
- `y` = tile row (north→south)
- `x` = tile column (west→east)

This is slippy map tile notation. `y` comes before `x` in the filename to match the download sort order.
Do NOT confuse `z` with a 3D axis — it is always the zoom level.

---

## DEM resolution

`dem_resolution = min(satellite_zoom, 13)`

Mapbox Terrain-DEM-v1 is based on SRTM (~30m ground resolution). Zoom levels above 13 are
interpolated with no real additional detail. Capping at 13 avoids downloading useless data.
If the user selects zoom 8, both satellite and DEM tiles are downloaded at zoom 8.

---

## Coordinate system and Gazebo world origin

`<spherical_coordinates>` in the world file maps a GPS coordinate to Gazebo world position (0, 0, 0).
We set this to the **launch location** (user-selected point), so a robot spawned at world origin
reports the correct GPS coordinates immediately.

The terrain heightmap is geographically centered at `get_true_origin()` — the center of the
downloaded tile bounding rectangle — which is generally NOT the same as the launch location.
The model `<pose>` offsets the terrain so it sits correctly relative to the launch point.

`get_offset(origin_coord, launch_location)` computes that offset in meters (ENU frame:
X=East, Y=North, Z=Up). The model pose applies the negative of this to position the terrain
so the launch point aligns with world (0, 0, 0).

### Heightmap positioning — confirmed gz-sim behavior (live tested)

OGRE2 (visual) and DART/Bullet (collision) use **different** positioning mechanisms for heightmaps:

**Visual (OGRE2):**
- `<heightmap><pos>` is in **world frame** and is the only way to position the visual heightmap
- Model `<pose>` AND link `<pose>` are both **ignored** by OGRE2 for heightmap visuals (confirmed by test)

**Collision (DART/Bullet):**
- `<heightmap><pos>` is **ignored** by DART (changing it has no effect on collisions)
- `<collision><pose>` (standard SDF pose) IS respected by DART

Correct template pattern:
```xml
<collision name="collision">
    <pose>$POSX$ $POSY$ $POSZ$ 0 0 0</pose>   <!-- DART respects this -->
    <geometry><heightmap><pos>0 0 0</pos>...    <!-- DART ignores this -->

<visual name="ground_visual">
    <geometry><heightmap><pos>$POSX$ $POSY$ $POSZ$</pos>...  <!-- OGRE2 respects this -->
```

Do NOT try to use model or link `<pose>` to position heightmaps — both are ignored by OGRE2.

---

## Elevation data — `get_amsl()`

Located in `heightMapGenerator.py`. Despite the name "AMSL" (Above Mean Sea Level), this is
NOT a mean/average calculation. It's a single-pixel lookup:

1. Map lat/lon to pixel coordinates within the DEM tile
2. Decode the RGB value using Mapbox Terrain-DEM-v1 formula:
   `height = (R × 256² + G × 256 + B) × 0.1 − 10000`

"AMSL" refers to the datum — the returned value is elevation in meters relative to mean sea level.

---

## World file templating

Templates live in `templates/`. Python does simple string substitution (`$PLACEHOLDER$` style).

- `gazebo_world_template.sdf` — full world file with inline `<model>` block
- `building_template.sdf` — buildings link fragment, injected into `$BUILDING$` when `include_buildings=True`

### Placeholders in gazebo_world_template.sdf

| Placeholder | Meaning |
|---|---|
| `$MODELNAME$` | World/model name |
| `$SIZEX$`, `$SIZEY$`, `$SIZEZ$` | Terrain dimensions in meters |
| `$POSX$`, `$POSY$`, `$POSZ$` | Model pose offset in meters (terrain center → launch point) |
| `$ORIGIN_LAT$`, `$ORIGIN_LONG$` | Launch location GPS coordinates |
| `$ORIGIN_ELEVATION$` | Launch location elevation in meters |
| `$BUILDING$` | Replaced with building_template.sdf content or empty string |

### Paths in templates are relative

All `uri` fields use relative paths (`terrain_data/height_map.tif`, `terrain_data/aerial.png`, etc.).
Gazebo resolves these relative to the world file's directory. This makes the output portable —
zip and extract anywhere, then run directly.

### What NOT to do

Do NOT hardcode SDF/XML blocks as Python strings. All SDF content belongs in template files.

---

## Key architectural decisions

### Self-contained world file (no GAZEBO_MODEL_PATH)

The `<model>` block is inlined directly into the world file instead of using
`<include><uri>model://...</uri></include>`. This eliminates the need for `GAZEBO_MODEL_PATH`
or any host environment variables. The world file works standalone.

### Frontend is dumb, server computes geometry

The frontend sends raw `polygonVertices` (array of [lng, lat] pairs) to the server.
The server computes bounds, center, and `dem_resolution`. This avoids multi-user state issues
and keeps geographic logic in one place.

### Polygon selection with gray fill

Tiles are downloaded for all tiles intersecting the selected polygon's bounding rectangle.
Some tiles within the rectangle may be missing (polygon corners). `generate_ortho()` fills
missing tiles with a gray placeholder (RGB 128, 128, 128) to produce a complete rectangular texture.

### Physics engine

ODE does not behave correctly with heightmaps. The world uses Bullet collision detector via DART:
```xml
<physics name="1ms" type="ignored">
    <dart>
        <collision_detector>bullet</collision_detector>
    </dart>
</physics>
```

---

## File map

```
scripts/
  server.py                    — HTTP server, orchestrates the pipeline
  utils/
    param.py                   — Global constants (MAPBOX_API_KEY, TEMPLATE_DIR_PATH, DEM_BUILDING_RESOLUTION)
    demTilesDownloader.py      — Downloads Mapbox DEM tiles as flat [zoom,y,x].png
    gazeboWorldGenerator.py    — OrthoGenerator, GazeboTerrainGenerator; main pipeline entry point
    heightMapGenerator.py      — Stitches DEM tiles, generates height_map.tif; get_amsl()
    fileWriter.py              — read_template(), write_world_file(); no SDF logic in Python
    buildingsGenerator.py      — GeoJSON → .dae conversion
    buildingDownloader.py      — OSM buildings GeoJSON downloader
    maptileUtils.py            — Tile coordinate math (lat/lon ↔ tile x/y/z, bounds)
    utils.py                   — ConcatImage base class
  frontend/
    index.html                 — Main UI
    js/main.js                 — Mapbox GL JS, polygon draw, launch pin, POST to server
    css/main.css
templates/
  gazebo_world_template.sdf   — Full world file template
  building_template.sdf       — Buildings link fragment (conditional)
  config_temp.txt             — DEAD: leftover from old gen_config() flow, to be deleted
  sdf_temp.txt                — DEAD: leftover from old gen_sdf() flow, to be deleted
scripts/UI/                   — OLD frontend (pre-refactor), superseded by scripts/frontend/
```
