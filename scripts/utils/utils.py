#!/usr/bin/env python

import os
import urllib.error
import urllib.request

import cv2
import numpy as np


class Utils:
    @staticmethod
    def make_quad_key(tile_x, tile_y, level):
        quadkey = ""
        for i in range(level):
            bit = level - i
            digit = ord('0')
            mask = 1 << (bit - 1)
            if (tile_x & mask) != 0:
                digit += 1
            if (tile_y & mask) != 0:
                digit += 2
            quadkey += chr(digit)
        return quadkey

    @staticmethod
    def qualify_url(url, x, y, z):
        replace_map = {
            "x": str(x),
            "y": str(y),
            "z": str(z),
            "quad": Utils.make_quad_key(x, y, z),
        }
        for key, value in replace_map.items():
            url = url.replace(f"{{{key}}}", value)
        return url

    @staticmethod
    def download_file(url, destination, x, y, z):
        url = Utils.qualify_url(url, x, y, z)
        try:
            urllib.request.urlretrieve(url, destination)
            return 200
        except urllib.error.URLError as e:
            print(e)
            return e.code if hasattr(e, "code") else -1


class ConcatImage:
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    @staticmethod
    def stitch_flat_tiles(tiles_dir: str, zoom_level: int, missing_fill=None):
        """
        Stitch flat tile files ([zoom,y,x].png) from tiles_dir into a single image.

        Tiles at zoom levels other than zoom_level are ignored.
        Missing tiles within the bounding rectangle are filled with missing_fill
        (a pre-built numpy array matching one tile's shape), or omitted if None.

        Args:
            tiles_dir (str): Directory containing flat [zoom,y,x].png tile files.
            zoom_level (int): Zoom level to filter tiles by.
            missing_fill: Optional numpy array used to fill gaps (e.g. gray tile).

        Returns:
            tuple: (stitched_image, tile_map, x_min, x_max, y_min, y_max)
                   stitched_image — cv2 numpy array of the combined image
                   tile_map       — dict mapping (x, y) → file path
                   x/y min/max    — bounding tile coordinate extents
        """
        tile_map = {}
        for fname in os.listdir(tiles_dir):
            if not fname.endswith('.png'):
                continue
            parts = fname[1:-5].split(',')  # strip '[' and '].png'
            z, y, x = int(parts[0]), int(parts[1]), int(parts[2])
            if zoom_level is not None and z != zoom_level:
                continue
            tile_map[(x, y)] = os.path.join(tiles_dir, fname)

        x_min = min(x for x, y in tile_map)
        x_max = max(x for x, y in tile_map)
        y_min = min(y for x, y in tile_map)
        y_max = max(y for x, y in tile_map)

        if missing_fill is not None:
            column_images = []
            for x in range(x_min, x_max + 1):
                rows = []
                for y in range(y_min, y_max + 1):
                    if (x, y) in tile_map:
                        img = cv2.imread(tile_map[(x, y)])
                        rows.append(img if img is not None else missing_fill)
                    else:
                        rows.append(missing_fill)
                column_images.append(cv2.vconcat(rows))
        else:
            column_images = []
            for x in range(x_min, x_max + 1):
                rows = [cv2.imread(tile_map[(x, y)]) for y in range(y_min, y_max + 1) if (x, y) in tile_map]
                rows = [img for img in rows if img is not None]
                if rows:
                    column_images.append(cv2.vconcat(rows))

        stitched_image = cv2.hconcat(column_images)
        return stitched_image, tile_map, x_min, x_max, y_min, y_max
