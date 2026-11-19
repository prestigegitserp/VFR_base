"""Build two covered fitting forms from the CC0 MakeHuman base and adult targets."""
import gzip
import io
import json
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.render'
OUT = ROOT / 'public' / 'models'
GITHUB = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/'
CACHE.mkdir(exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)


def fetch(name, resource):
    local = CACHE / name
    if not local.exists():
        with urllib.request.urlopen(GITHUB + resource, timeout=60) as response:
            local.write_bytes(response.read())
    return local


def obj(source):
    vertices, faces, helper_vertices = [], [], {}
    group = ''
    for row in source.read_text().splitlines():
        parts = row.split()
        if not parts:
            continue
        if parts[0] == 'v':
            vertices.append([float(v) for v in parts[1:4]])
        if parts[0] == 'g':
            group = parts[1]
        if parts[0] == 'f':
            corners = [int(v.split('/')[0]) - 1 for v in parts[1:]]
            if group == 'body':
                faces.extend((corners[0], corners[i], corners[i+1]) for i in range(1, len(corners)-1))
            elif group.startswith('joint-'):
                helper_vertices.setdefault(group[6:], set()).update(corners)
    return np.array(vertices), np.array(faces), helper_vertices


def target(path, count):
    displacement = np.zeros((count, 3))
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0].isdigit():
            displacement[int(parts[0])] = [float(x) for x in parts[1:]]
    return displacement


def hull_perimeter(points):
    pts = sorted(set(map(tuple, np.round(points, 5))))
    if len(pts) < 3:
        return .75
    chain = []
    for ordered in (pts, pts[::-1]):
        half = []
        for p in ordered:
            while len(half) > 1:
                a, b = half[-2:]
                if (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]) > 0:
                    break
                half.pop()
            half.append(p)
        chain += half[:-1]
    return sum(math.dist(p, q) for p,q in zip(chain, chain[1:]+chain[:1]))


def make_shape(sex, sources, base, triangles, joints):
    vertex = base + sum(target(s, len(base)) for s in sources) / len(sources)
    body_indices, remap = np.unique(triangles.ravel(), return_inverse=True)
    body = vertex[body_indices].copy() * .1
    cursor = body.min(axis=0)[1]
    body[:, 1] -= cursor
    joint = {name: vertex[list(indices)].mean(0) * .1 - [0, cursor, 0] for name,indices in joints.items()}
    height = float(body[:, 1].max())
    sy = float(joint['l-shoulder'][1])
    hip_y = float(joint['pelvis'][1]) - .048
    levels = {'chest': sy-.083, 'waist': hip_y+.147, 'hip': hip_y+.024}
    rings = {}
    samples = body[remap.reshape(-1,3)]
    for key, y in levels.items():
        cloud = []
        for i, j in ((0,1),(1,2),(2,0)):
            a,b = samples[:,i],samples[:,j]
            selected = (a[:,1]-y)*(b[:,1]-y)<0
            a,b = a[selected],b[selected]
            t = (y-a[:,1])/(b[:,1]-a[:,1])
            q = a + (b-a)*t[:,None]
            max_x = (.97 if key == 'chest' else 1.2) * float(joint['l-shoulder'][0])
            cloud.extend(q[np.abs(q[:,0]) < max_x][:,[0,2]])
        rings[key] = round(hull_perimeter(cloud)*1000)
    keys = ['l-shoulder', 'r-shoulder', 'l-elbow', 'r-elbow', 'l-hand', 'r-hand',
            'l-upper-leg', 'r-upper-leg', 'l-knee', 'r-knee', 'l-ankle', 'r-ankle', 'l-eye', 'r-eye', 'neck', 'pelvis']
    face = np.vstack([joint[k] for k in ['l-eye','r-eye']]).mean(0)
    face[2] = np.quantile(body[(np.abs(body[:,1]-face[1])<.014) & (np.abs(body[:,0])<.047),2],.94)
    data = {
        'positions': np.rint(body*10000).astype(int).ravel().tolist(),
        'indices': remap.tolist(),
        'height': height, 'ringMm': rings, 'levels': levels, 'shoulderY': sy, 'hipY': hip_y,
        'joints': {key: np.round(joint[key],5).tolist() for key in keys},
        'face': np.round(face,5).tolist(),
        'shoulderWidth': round(abs(joint['l-shoulder'][0] - joint['r-shoulder'][0])*1.13*1000),
    }
    payload = json.dumps(data, separators=(',',':')).encode()
    out = OUT / f'{sex}.form.gz'
    out.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    print(sex, out.stat().st_size, rings, 'height', round(height,3), 'shoulder', round(sy,3), 'face', data['face'])


base, faces, joints = obj(fetch('makehuman.obj','3dobjs/base.obj'))
with ThreadPoolExecutor(max_workers=6) as workers:
    targets = list(workers.map(lambda n: fetch(n, 'targets/macrodetails/' + n),
        [f'{population}-{sex}-young.target' for sex in ('female','male') for population in ('african','asian','caucasian')]))
for i, sex in enumerate(('female','male')):
    make_shape(sex, targets[i*3:i*3+3], base, faces, joints)
