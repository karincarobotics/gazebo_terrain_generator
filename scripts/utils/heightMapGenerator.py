import cv2
import os
import numpy as np
import math
from PIL import Image
from utils.maptileUtils import maptile_utiles
from utils.utils import ConcatImage


class HeightmapGenerator(ConcatImage):
    def __init__(self,**kwargs):
        super().__init__(**kwargs)
        self.heightmap = None
        self.max_height = self.min_height = 0
        self.size_x=self.size_y=self.size_z=0


    def get_dem_px_bounds(self, true_boundaries, dem_snap_boundaries, height, width):
        crop_px_cord = {}
        lat_max = dem_snap_boundaries["northeast"][0]
        lat_min = dem_snap_boundaries["southwest"][0]
        lon_max = dem_snap_boundaries["northeast"][1]
        lon_min = dem_snap_boundaries["southwest"][1]

        for coord_name in true_boundaries.keys():
            lat, lon = true_boundaries[coord_name]
            # from boundaries and the desired lat/lon get the pixel coordinates
            px = int((lon - lon_min) / (lon_max - lon_min) * width)
            py = int((lat_max - lat) / (lat_max - lat_min) * height)
            crop_px_cord[coord_name] = (px, py)
        return crop_px_cord


    @staticmethod
    def get_amsl(lat: float, lon: float, dem_path: str, dem_resolution: int):
        """
        Get the height above mean sea level (AMSL) for a given latitude and longitude.
        Args:
            lat (float): Latitude in degrees.
            lon (float): Longitude in degrees.
            dem_path (str): Path to the DEM tile directory.
            dem_resolution (int): Zoom level used when downloading DEM tiles.
        Returns:
            float: Height above mean sea level in meters.
        """
        tile_x, tile_y = maptile_utiles.lat_lon_to_tile(lat, lon, dem_resolution)
        boundaries = maptile_utiles.get_tile_bounds(tile_x, tile_y, dem_resolution)
        lat_max = boundaries["northeast"][0]
        lat_min = boundaries["southwest"][0]
        lon_max = boundaries["northeast"][1]
        lon_min = boundaries["southwest"][1]
        dem_tile_path = os.path.join(dem_path, f"[{dem_resolution},{tile_y},{tile_x}].png")
        if os.path.isfile(dem_tile_path):
            # read the image — BGR format
            dem_img = cv2.imread(dem_tile_path)
            height, width = dem_img.shape[:2]
            px = int((lon - lon_min) / (lon_max - lon_min) * width)
            py = int((lat_max - lat) / (lat_max - lat_min) * height)
            b, g, r = dem_img[py, px]
            b, g, r = float(b), float(g), float(r)
            # convert pixel value to elevation in meters
            # reference: https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
            height = ((r * 256 * 256 + g * 256 + b) * 0.1) - 10000
            return height
        else:
            print("Tile not found", tile_x, tile_y, dem_resolution, lat, lon)
            return None


    @staticmethod
    def get_nearest_map_size(height, width):
        """
        Return the nearest valid Gazebo heightmap size (2^n + 1) that fits the given dimensions.
        Gazebo requires heightmap dimensions to be 2^n + 1 (e.g. 129, 257, 513, 1025...).
        """
        value = max(height, width)
        n = math.log2(value - 1)
        n_ceil = int(math.ceil(n))
        return (2 ** n_ceil) + 1


    def generate_rgb_heightmap(self, tile_path, boundaries, zoomlevel, dem_path: str, dem_resolution: int) -> None:

        #get the true boundaries — there is non-uniform padding added by tile alignment
        bound_array = boundaries.split(',')
        true_boundaries = maptile_utiles.get_true_boundaries(bound_array, zoomlevel)
        true_bound_array = [true_boundaries["southwest"][1], true_boundaries["southwest"][0],
                            true_boundaries["northeast"][1], true_boundaries["northeast"][0]]

        # Parse flat DEM tile filenames: [zoom,y,x].png → group by x-column, sort by y-row
        tile_map = {}  # (x, y) → path
        for fname in os.listdir(dem_path):
            if not fname.endswith('.png'):
                continue
            parts = fname[1:-5].split(',')  # strip '[' and '].png'
            z, y, x = int(parts[0]), int(parts[1]), int(parts[2])
            tile_map[(x, y)] = os.path.join(dem_path, fname)

        x_min = min(x for x, y in tile_map)
        x_max = max(x for x, y in tile_map)
        y_min = min(y for x, y in tile_map)
        y_max = max(y for x, y in tile_map)

        column_images = []
        for x in range(x_min, x_max + 1):
            rows = [cv2.imread(tile_map[(x, y)]) for y in range(y_min, y_max + 1) if (x, y) in tile_map]
            rows = [img for img in rows if img is not None]
            if rows:
                column_images.append(cv2.vconcat(rows))
        stitched_image = cv2.hconcat(column_images)

        # dem_snap_boundaries: the tile-aligned bounds of the stitched DEM image at DEM resolution,
        # used to crop back down to the actual desired area (true_boundaries)
        dem_snap_boundaries = maptile_utiles.get_true_boundaries(true_bound_array, dem_resolution)

        height, width = stitched_image.shape[:2]
        crop_px_cord = self.get_dem_px_bounds(true_boundaries, dem_snap_boundaries, height, width)
        # Crop the image based on the true boundaries needed
        cropped_image = self.crop_dem_image(crop_px_cord, stitched_image)
        height, width = cropped_image.shape[:2]

        # Convert to float to avoid overflow during calculation
        cropped_image_float = cropped_image.astype(np.float32)
        # Calculate height map - changed to use float operations
        height_map = ((cropped_image_float[:, :, 2] * 256 * 256 + cropped_image_float[:, :, 1] * 256 + cropped_image_float[:, :, 0]) * 0.1) - 10000
        self.max_height = np.max(height_map)
        self.min_height = np.min(height_map)

        height_img_normalized = ((height_map - np.min(height_map)) / (np.max(height_map) - np.min(height_map)) * 255).astype(np.uint8)

        size = HeightmapGenerator.get_nearest_map_size(height, width)
        resized_map = cv2.resize(height_img_normalized, (size, size), interpolation=cv2.INTER_LINEAR)

        terrain_data_dir = os.path.join(tile_path, 'terrain_data')
        os.makedirs(terrain_data_dir, exist_ok=True)

        # Convert OpenCV image to PIL Image and save as PNG
        self.heightmap = Image.fromarray(resized_map, mode='L')  # 'L' for 8-bit grayscale
        self.heightmap.save(os.path.join(terrain_data_dir, 'height_map.png'), format="PNG")

    def crop_dem_image(self, px_bound, height_map):
        cropped_image = height_map[px_bound["northwest"][1]:px_bound["southeast"][1],
                                   px_bound["southwest"][0]:px_bound["northeast"][0]]
        return cropped_image