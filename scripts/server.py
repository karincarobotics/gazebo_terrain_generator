#!/usr/bin/env python

from flask import Flask, request, jsonify, send_from_directory
import threading
import os
import uuid
import json
import shutil
import tempfile
from pathlib import Path
import mimetypes
from utils.demTilesDownloader import download_dem_data
from utils.buildingDownloader import download_steetmap_data
from utils.utils import Utils
from utils.gazeboWorldGenerator import GazeboTerrianGenerator
from utils.maptileUtils import maptile_utiles
from utils.param import globalParam
import requests

app = Flask(__name__)
lock = threading.Lock()

task_status = {"status": "idle"} # Global variable to track task status


def random_string():
	return uuid.uuid4().hex.upper()[0:6]


def get_map_dir(map_name):
	return os.path.join(tempfile.gettempdir(), 'gazebo_terrain_generator', map_name)


def bounds_from_polygon(vertices):
	"""Compute [west, south, east, north] bounding box from a list of [lng, lat] polygon vertices."""
	lngs = [v[0] for v in vertices]
	lats = [v[1] for v in vertices]
	return [min(lngs), min(lats), max(lngs), max(lats)]


def process_end_download(map_name, bounds, zoom_level, dem_resolution, include_buildings):
	global task_status
	try:
		task_status["status"] = "in_progress"
		map_dir = get_map_dir(map_name)
		true_boundaries = maptile_utiles.get_true_boundaries(bounds, zoom_level)
		dem_path = os.path.join(map_dir, 'dem')
		download_dem_data(true_boundaries, dem_path, dem_resolution)

		if include_buildings:
			print("Starting building data download...")
			download_steetmap_data(true_boundaries, globalParam.BUILDING_PATH, map_dir)

		terrian_generator = GazeboTerrianGenerator(map_dir, include_buildings)
		terrian_generator.generate_gazebo_world()
		task_status["status"] = "completed"
		print("Gazebo world generation completed successfully.")

	except Exception as e:
		task_status["status"] = "failed"
		print(f"Error during processing: {e}")


def validate_mapbox_key(api_key):
	try:
		url = f"https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/0,0,1/1x1?access_token={api_key}"
		response = requests.get(url, timeout=5)
		if response.status_code == 200:
			print("Mapbox API key is validated successfully.")
			return True
		elif response.status_code == 401:
			print("Invalid Mapbox API key.")
			return False
		else:
			print(f"Unexpected response: {response.status_code}")
			print(response.text)
			return False
	except requests.exceptions.ConnectionError:
		print("Cannot validate Mapbox API key - no internet connection.")
		return False
	except requests.exceptions.Timeout:
		print("Mapbox API validation timed out.")
		return False
	except Exception as e:
		print(f"Error validating Mapbox API key: {e}")
		return False


@app.route('/api/mapbox-key', methods=['GET'])
def get_mapbox_key():
	return jsonify({"code": 200, "apiKey": globalParam.MAPBOX_API_KEY})


@app.route('/task-status', methods=['GET'])
def task_status_endpoint():
	global task_status
	return jsonify({"code": 200, "message": task_status})


@app.route('/download-tile', methods=['POST'])
def download_tile():
	postvars = request.form
	x = int(postvars['x'])
	y = int(postvars['y'])
	z = int(postvars['z'])
	map_name = str(postvars['mapName'])
	source = str(postvars['source'])

	file_path = os.path.join(get_map_dir(map_name), 'tiles', f"[{z},{y},{x}].png")

	if os.path.isfile(file_path):
		return jsonify({"code": 200, "message": "Tile already exists"})

	os.makedirs(os.path.dirname(file_path), exist_ok=True)
	code = Utils.download_file(source, file_path, x, y, z)

	if code == 200:
		return jsonify({"code": 200, "message": "Tile downloaded"})
	else:
		return jsonify({"code": code, "message": "Download failed"})


@app.route('/start-download', methods=['POST'])
def start_download():
	postvars = request.form
	map_name = postvars['mapName']
	zoom_level = int(postvars['maxZoom'])
	timestamp = int(postvars['timestamp'])
	polygon_vertices = json.loads(postvars['polygonVertices'])
	bounds = bounds_from_polygon(polygon_vertices)
	center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
	launch_location = list(map(float, postvars['launchLocation'].split(",")))
	include_buildings = postvars.get('includeBuildings', 'true').lower() == 'true'
	dem_resolution = min(zoom_level, 13)

	output_dir = get_map_dir(map_name)
	if os.path.exists(output_dir):
		shutil.rmtree(output_dir)
	os.makedirs(output_dir)

	metadata = {
		"name": map_name,
		"polygon_vertices": polygon_vertices,
		"bounds": ','.join(map(str, bounds)),
		"center": ','.join(map(str, center)),
		"zoom_level": zoom_level,
		"dem_resolution": dem_resolution,
		"launch_location": ','.join(map(str, launch_location)),
		"include_buildings": include_buildings,
		"timestamp": timestamp,
	}
	with open(os.path.join(output_dir, 'metadata.json'), 'w') as f:
		json.dump(metadata, f, indent=2)

	global task_status
	task_status = {"status": "idle"}
	return jsonify({"code": 200, "message": "Metadata written"})


@app.route('/end-download', methods=['POST'])
def end_download():
	postvars = request.form
	map_name = postvars['mapName']
	zoom_level = int(postvars['maxZoom'])
	polygon_vertices = json.loads(postvars['polygonVertices'])
	bounds = bounds_from_polygon(polygon_vertices)
	include_buildings = postvars.get('includeBuildings', 'false').lower() == 'true'
	dem_resolution = min(zoom_level, 13)

	thread = threading.Thread(target=process_end_download, args=(map_name, bounds, zoom_level, dem_resolution, include_buildings))
	thread.start()

	return jsonify({"code": 200, "message": "Download ended"})


@app.route('/', defaults={'path': 'index.html'})
@app.route('/<path:path>')
def serve_static(path):
	file_dir = os.path.join(str(Path(__file__).resolve().parent), 'frontend')
	mime_type, _ = mimetypes.guess_type(path)
	return send_from_directory(file_dir, path, mimetype=mime_type)


#VTODO: remove once new frontend is fully functional
@app.route('/old/', defaults={'path': 'index.htm'})
@app.route('/old/<path:path>')
def serve_static_old(path):
	file_dir = os.path.join(str(Path(__file__).resolve().parent), 'UI')
	mime_type, _ = mimetypes.guess_type(path)
	return send_from_directory(file_dir, path, mimetype=mime_type)


if __name__ == '__main__':
	if not validate_mapbox_key(globalParam.MAPBOX_API_KEY):
		exit(1)
	print("Starting Flask server...")
	app.run(host='127.0.0.1', port=8080, threaded=True)