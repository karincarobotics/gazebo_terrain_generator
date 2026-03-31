#!/usr/bin/env python

import os
import urllib.error
import urllib.request

import cv2


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
    def get_x_tile_directories(image_dir: str, tile_boundaries: dict) -> list:
        """
        Get a numerically sorted list of X-tile directories within tile boundary limits.

        Args:
            image_dir (str): Path to the zoom level directory containing X-tile directories.
            tile_boundaries (dict): Dictionary of tile coordinate bounds.

        Returns:
            list: Sorted list of valid X-tile directory names (as strings).
        """
        dir_list = [d for d in os.listdir(image_dir) if d.isdigit()]
        min_x = min(tile_boundaries["southwest"][0], tile_boundaries["southeast"][0])
        max_x = max(tile_boundaries["southwest"][0], tile_boundaries["southeast"][0])
        x_dirs = sorted([d for d in dir_list if min_x <= int(d) <= max_x], key=lambda x: int(x))
        return x_dirs

    @staticmethod
    def process_column_image(dir_name, image_dir, tile_boundaries, temp_output_dir):
        image_list = []
        max_y = max(tile_boundaries["northwest"][1], tile_boundaries["southwest"][1])
        min_y = min(tile_boundaries["northwest"][1], tile_boundaries["southwest"][1])

        dir_path = os.path.join(image_dir, dir_name)
        for image in os.listdir(dir_path):
            tile_num = int(image.split('.')[0])
            if min_y <= tile_num <= max_y:
                image_list.append(os.path.join(dir_path, image))

        image_list.sort()
        images = [cv2.imread(path) for path in image_list if os.path.exists(path)]
        if images:
            output_file = os.path.join(temp_output_dir, dir_name + '.png')
            cv2.imwrite(output_file, cv2.vconcat(images))

    @staticmethod
    def _run_instance_method(args: tuple) -> None:
        """
        Run an instance method with the provided arguments.
        Args:
            args (tuple): A tuple containing the instance and its method arguments.
        Returns:
            None
        """
        instance, dir_name, image_dir, tile_boundaries, temp_output_dir = args
        instance.process_column_image(dir_name, image_dir, tile_boundaries, temp_output_dir)

    @staticmethod
    def are_dimensions_equal(img1, img2) -> bool:
        """
        Check if dimensions of two images are equal.

        Args:
            img1: First image.
            img2: Second image.

        Returns:
            bool: True if dimensions are equal, False otherwise.
        """
        return img1.shape[:2] == img2.shape[:2]