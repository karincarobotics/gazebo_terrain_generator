#!/usr/bin/env python

from flask import Flask, request, jsonify, send_from_directory, send_file
import threading
import os
import uuid
import json
import shutil
import tempfile
from pathlib import Path
import mimetypes
from utils.demTilesDownloader import download_dem_data
from utils.buildingDownloader import download_streetmap_data
from utils.utils import Utils
from utils.gazeboWorldGenerator import GazeboTerrianGenerator
from utils.maptileUtils import maptile_utiles
from utils.param import globalParam

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


def process_end_download(map_name, bounds, zoom_level, dem_resolution, include_buildings, polygon_vertices, api_key):
	global task_status

	def progress(msg):
		task_status["message"] = msg
		print(msg)

	try:
		task_status["status"] = "in_progress"
		task_status["message"] = ""
		map_dir = get_map_dir(map_name)
		true_boundaries = maptile_utiles.get_true_boundaries(bounds, zoom_level)

		progress("Downloading elevation data (DEM)...")
		dem_path = os.path.join(map_dir, 'dem')
		download_dem_data(true_boundaries, dem_path, dem_resolution, api_key)

		if include_buildings:
			progress("Downloading building footprint data...")
			download_streetmap_data(true_boundaries, os.path.join(map_dir, 'building_tiles'), os.path.join(map_dir, 'terrain_data'), api_key=api_key, polygon_vertices=polygon_vertices)

		terrian_generator = GazeboTerrianGenerator(map_dir, include_buildings)
		terrian_generator.generate_gazebo_world(progress_cb=progress)
		task_status["status"] = "completed"
		task_status["message"] = "World generated successfully."
		print("Gazebo world generation completed successfully.")

	except Exception as e:
		task_status["status"] = "failed"
		task_status["message"] = f"Error: {e}"
		print(f"Error during processing: {e}")



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
	api_key = postvars.get('mapboxApiKey', '')
	dem_resolution = min(zoom_level, 13)

	thread = threading.Thread(target=process_end_download, args=(map_name, bounds, zoom_level, dem_resolution, include_buildings, polygon_vertices, api_key))
	thread.start()

	return jsonify({"code": 200, "message": "Download ended"})


@app.route('/download-world', methods=['GET'])
def download_world():
	map_name = request.args.get('mapName', '')
	if not map_name:
		return jsonify({"code": 400, "message": "mapName required"}), 400

	map_dir = get_map_dir(map_name)
	world_file = os.path.join(map_dir, f"{map_name}.world")
	terrain_data_dir = os.path.join(map_dir, 'terrain_data')

	if not os.path.isfile(world_file):
		return jsonify({"code": 404, "message": "World file not found"}), 404

	include_intermediary = request.args.get('includeIntermediary', 'false').lower() == 'true'

	zip_path = os.path.join(map_dir, f"{map_name}.zip")
	import zipfile
	with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
		zf.write(world_file, f"{map_name}/{map_name}.world")
		zf.write(os.path.join(map_dir, 'metadata.json'), f"{map_name}/metadata.json")
		if os.path.isdir(terrain_data_dir):
			for fname in os.listdir(terrain_data_dir):
				zf.write(os.path.join(terrain_data_dir, fname), f"{map_name}/terrain_data/{fname}")
		if include_intermediary:
			for subdir in ('tiles', 'dem', 'building_tiles'):
				subdir_path = os.path.join(map_dir, subdir)
				if os.path.isdir(subdir_path):
					for fname in os.listdir(subdir_path):
						zf.write(os.path.join(subdir_path, fname), f"{map_name}/{subdir}/{fname}")

	return send_file(zip_path, mimetype='application/zip', as_attachment=True, download_name=f"{map_name}.zip")


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
	print("Starting Flask server...")
	app.run(host='127.0.0.1', port=8080, threaded=True)