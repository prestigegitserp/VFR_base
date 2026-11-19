"""Render the browser's own garment meshes using Blender Cycles."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent.parent
VARIANTS = ("luna", "cedar", "siena", "ash", "viola", "noir", "iris", "cobalt", "studio")


def srgb(value):
    return value / 12.92 if value <= 0.04045 else ((value + .055) / 1.055) ** 2.4


def rgb(value):
    return [srgb(int(value[i:i + 2], 16) / 255) for i in (1, 3, 5)]


def surface(spec, fabric):
    material = bpy.data.materials.new(spec["name"])
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*spec["color"], 1)
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    bsdf.inputs["Metallic"].default_value = spec["metalness"]
    bsdf.inputs["Sheen Weight"].default_value = spec["sheen"] * .92
    bsdf.inputs["Sheen Roughness"].default_value = .47
    if spec["sheen"] > .16:
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 128 if fabric in ("silk", "satin") else 89
        tex.inputs["Detail"].default_value = 2.7
        tex.inputs["Roughness"].default_value = .72
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .2 if fabric in ("silk", "satin") else .35
        bump.inputs["Distance"].default_value = .017
        links.new(tex.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def point(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def area(name, location, target, power, size, color):
    lamp = bpy.data.lights.new(name, "AREA")
    lamp.energy, lamp.shape, lamp.size, lamp.color = power, "DISK", size, color
    ob = bpy.data.objects.new(name, lamp)
    bpy.context.collection.objects.link(ob)
    ob.location = location
    point(ob, target)


def render(name, samples):
    data = json.loads((ROOT / ".render" / f"{name}.json").read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 5
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 7
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = .21
    scene.world = bpy.data.worlds.new("Dark studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs[0].default_value = (.066, .061, .049, 1)
    scene.world.node_tree.nodes.get("Background").inputs[1].default_value = .74
    materials = {}
    z_min, z_max = math.inf, -math.inf
    for spec in data["objects"]:
        verts = spec["vertices"]
        indices = spec["indices"]
        shape = bpy.data.meshes.new(spec["name"])
        shape.from_pydata(verts, [], [indices[i:i + 3] for i in range(0, len(indices), 3)])
        shape.update()
        for poly in shape.polygons:
            poly.use_smooth = len(verts) > 150
        ob = bpy.data.objects.new(spec["name"], shape)
        scene.collection.objects.link(ob)
        key = (*spec["color"], spec["roughness"], spec["metalness"], spec["sheen"])
        if key not in materials:
            materials[key] = surface(spec, data["fabric"])
        ob.data.materials.append(materials[key])
        z_min = min(z_min, min(v[2] for v in verts))
        z_max = max(z_max, max(v[2] for v in verts))

    studio = name == "studio"
    center = (z_min + z_max) / 2
    height = z_max - z_min
    color = rgb(data["tile"])
    floor_z = z_min + .006 if studio else z_min - .28
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, floor_z))
    floor = bpy.context.object
    floor.data.materials.append(surface({"name": "Cyclorama floor", "color": [c * .65 for c in color],
        "metalness": .05, "roughness": .53, "sheen": 0}, data["fabric"]))
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 4, center), rotation=(math.pi / 2, 0, 0))
    backdrop = bpy.context.object
    backdrop.data.materials.append(surface({"name": "Cyclorama backdrop", "color": color,
        "metalness": .0, "roughness": .89, "sheen": 0}, data["fabric"]))
    area("Large key", (-2.9, -4.3, center + 3.3), (0, 0, center), 620 if studio else 450, 3.25, (1, .86, .72))
    area("Soft fill", (2.6, -3.1, center + 0.5), (0, 0, center), 246, 3.5, (.79, .87, 1))
    area("Copper edge", (-2, 1.3, center + 1.8), (0, 0, center), 455, 2.1, (1, .60, .42))
    area("Cool edge", (2.3, .6, center + 2.3), (0, 0, center), 528, 2.05, (.60, .75, 1))
    area("Backdrop wash", (1.4, 1.4, center + .2), (0, 4, center), 120, 3.8, (.94, .79, .62))
    camera_data = bpy.data.cameras.new("Look camera")
    camera = bpy.data.objects.new("Look camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = height * (1.46 if studio else 1.28)
    camera.location = (0.35 if studio else 2.12, -8, center + (.89 if studio else .49))
    point(camera, (0, 0, center + (.065 if studio else .035)))
    scene.render.resolution_x, scene.render.resolution_y = (1080, 840) if studio else (460, 520)
    scene.render.filepath = str(ROOT / ".render" / f"{name}.png")
    bpy.ops.render.render(write_still=True)


parser = argparse.ArgumentParser()
parser.add_argument("--samples", type=int, default=24)
parser.add_argument("--only", choices=VARIANTS)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
for look in ((args.only,) if args.only else VARIANTS):
    render(look, args.samples if look != "studio" else max(24, args.samples))
