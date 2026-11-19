"""Render catalogue material and fitting form using Blender Cycles."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
LOOKS = ['terra','celeste','meridian','orion','solene','rune','linea','arc','atelier']


def prop(name, color, roughness, metallic=0):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Metallic'].default_value=metallic
    return m,p


def fabric(spec, style):
    material, p = prop(spec['name'],spec['color'],spec['roughness'],spec['metalness'])
    nd, li=material.node_tree.nodes, material.node_tree.links
    if spec['vertexColor']:
        shared=nd.new('ShaderNodeVertexColor')
        shared.layer_name='Pigment'
        li.new(shared.outputs['Color'],p.inputs['Base Color'])
        p.inputs['Coat Weight'].default_value=.24
        p.inputs['Coat Roughness'].default_value=.64
    if spec['alpha'] < .5:
        p.inputs['Transmission Weight'].default_value=.48
        p.inputs['IOR'].default_value=1.41
        p.inputs['Roughness'].default_value=.23
    if spec['sheen']>.12:
        p.inputs['Sheen Weight'].default_value=spec['sheen']
        p.inputs['Sheen Roughness'].default_value=.53
        coords=nd.new('ShaderNodeTexCoord')
        noise=nd.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value=249
        noise.inputs['Roughness'].default_value=.63
        noise.inputs['Detail'].default_value=1.6
        li.new(coords.outputs['Object'],noise.inputs['Vector'])
        band=nd.new('ShaderNodeTexWave')
        band.bands_direction='DIAGONAL' if style in ('gabardine','wool') else 'X'
        band.inputs['Scale'].default_value=125 if style in ('satin','silk') else 74 if style!='knit' else 46
        band.inputs['Distortion'].default_value=.19
        li.new(coords.outputs['Object'],band.inputs['Vector'])
        blend=nd.new('ShaderNodeMath');blend.operation='MULTIPLY'
        li.new(noise.outputs['Fac'],blend.inputs[0]);li.new(band.outputs['Fac'],blend.inputs[1])
        bump=nd.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value=.00135 if style in ('satin','silk') else .0027
        bump.inputs['Strength'].default_value=.23 if style in ('satin','silk') else .37
        li.new(blend.outputs[0],bump.inputs['Height']);li.new(bump.outputs[0],p.inputs['Normal'])
    return material


def aim(ob, target):
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()


def lamp(name, xyz, target, energy, size, color):
    data = bpy.data.lights.new(name,'AREA')
    data.energy,data.shape,data.size,data.color=energy,'DISK',size,color
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=xyz;aim(o,target)


def render(name, samples):
    rec=json.loads((ROOT / '.render' / (name+'.json')).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene
    sc.render.engine='CYCLES'
    sc.cycles.samples=samples
    sc.cycles.use_denoising=False
    sc.cycles.use_adaptive_sampling=True
    sc.cycles.adaptive_threshold=.073
    sc.cycles.max_bounces=6
    sc.render.threads_mode='FIXED';sc.render.threads=8
    sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
    sc.view_settings.exposure=-.32
    sc.world=bpy.data.worlds.new('Light spill');sc.world.use_nodes=True
    sc.world.node_tree.nodes.get('Background').inputs[0].default_value=(.114,.100,.09,1)
    sc.world.node_tree.nodes.get('Background').inputs[1].default_value=.58
    materials={}
    for spec in rec['poses']:
        shape=bpy.data.meshes.new(spec['name'])
        idx=spec['indices']
        shape.from_pydata(spec['vertices'],[],[idx[i:i+3] for i in range(0,len(idx),3)])
        shape.update()
        for poly in shape.polygons: poly.use_smooth=len(spec['vertices'])>100
        o=bpy.data.objects.new(spec['name'],shape);sc.collection.objects.link(o)
        key=(tuple(spec['color']),spec['roughness'],spec['metalness'],spec['sheen'],spec['alpha'],bool(spec['vertexColor']))
        if key not in materials: materials[key]=fabric(spec,rec['fabric'])
        o.data.materials.append(materials[key])
        if spec['vertexColor']:
            channel=shape.color_attributes.new(name='Pigment',type='FLOAT_COLOR',domain='POINT')
            vals=spec['vertexColor']
            for i, slot in enumerate(channel.data): slot.color=(*vals[3*i:3*i+3],1)
    full=rec['frame']=='full'
    face=rec['frame']=='face'
    hero=name=='atelier'
    h=rec['height']; head_y=rec['face'][1]
    camera_z=head_y+.014 if face else (1.24 if not full else h*.51)
    target=(0,.00,camera_z)
    bpy.ops.mesh.primitive_plane_add(size=60,location=(0,0,-.013))
    floor=bpy.context.object
    floor.data.materials.append(prop('Limestone under daylight',(.105,.080,.063),.57)[0])
    bpy.ops.mesh.primitive_plane_add(size=60,location=(0,1.75,1.18),rotation=(math.pi/2,0,0))
    bpy.context.object.data.materials.append(prop('Fitting room wall',(.095,.074,.064),.83)[0])
    if hero:
        bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=.61,depth=.055,location=(0,0,-.035))
        platform=bpy.context.object;platform.data.materials.append(prop('Warm limestone edge',(.111,.087,.063),.51)[0])
        b=platform.modifiers.new('Rounded stone','BEVEL');b.width=.016;b.segments=4
    lamp('Window key',(-1.08,-1.5,2.57),target,300 if not face else 180,1.7,(1,.86,.73))
    lamp('Neutral fill',(1.3,-1.72,1.9),target,89,1.6,(.81,.89,1))
    lamp('Soft edge',(.74,.51,2.32),target,226,1.25,(1,.70,.52))
    lamp('Tall bounce',(-.80,.53,1.48),target,105,1.1,(.72,.82,1))
    if hero:
        lamp('Wall wash',(1.4,.5,1.62),(0,1.72,1.20),98,1.2,(.99,.79,.59))
    ca=bpy.data.cameras.new('Product camera');cam=bpy.data.objects.new('Product camera',ca)
    sc.collection.objects.link(cam);sc.camera=cam
    ca.type='ORTHO'
    ca.ortho_scale=(h*1.85 if hero else .90*h if full else .49 if face else .87)
    cam.location=(.58 if not hero else .32,-3.4,camera_z+(.12 if face else .19 if not hero else .24))
    aim(cam,target if not face else (0,-.035,head_y-.031))
    sc.render.resolution_x,sc.render.resolution_y=(1440,960) if hero else (560,700)
    sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG'
    sc.render.filepath=str(ROOT / '.render' / (name+'.png'))
    bpy.ops.render.render(write_still=True)


parser=argparse.ArgumentParser()
parser.add_argument('--samples',type=int,default=42)
parser.add_argument('--only',choices=LOOKS)
arg=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for n in ([arg.only] if arg.only else LOOKS): render(n, max(50,arg.samples) if n=='atelier' else arg.samples)
