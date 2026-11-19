import { mkdir, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { catalog, cuts } from '../src/catalog.js';
import { makeGarment } from '../src/garment.js';
import { buildMannequin, mannequinPose } from '../src/mannequin.js';
import { garmentFrame } from '../src/studio.js';

const output = new URL('../.render/', import.meta.url);
await mkdir(output, { recursive: true });
const pose = mannequinPose();
const frame = garmentFrame(pose);
const local = (p) => p.clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert()).divide(frame.scale);
const arms = [0, 1].map((i) => [pose.shoulders[i], pose.elbows[i], pose.wrists[i]].map(local));

function packet(group) {
  group.updateMatrixWorld(true);
  const objects = [];
  const q = new T.Vector3();
  const instance = new T.Matrix4();
  group.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    const shape = object.geometry;
    const material = object.material;
    const attr = shape.getAttribute('position');
    const index = shape.getIndex();
    const color = material.color.toArray();
    const at = (new T.Matrix4()).copy(object.matrixWorld);
    const n = object.isInstancedMesh ? object.count : 1;
    for (let i = 0; i < n; i++) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(i, instance);
        at.multiplyMatrices(object.matrixWorld, instance);
      }
      const vertices = Array.from({ length: attr.count }, (_, j) => {
        q.fromBufferAttribute(attr, j).applyMatrix4(at);
        return [q.x, -q.z, q.y].map((x) => Math.round(x * 1e6) / 1e6);
      });
      objects.push({
        name: object.name || 'Mannequin',
        color, roughness: material.roughness, metalness: material.metalness,
        sheen: material.sheen ?? 0,
        vertices, indices: index ? [...index.array] : Array.from({ length: attr.count }, (_, base) => base),
      });
    }
  });
  return objects;
}

for (const item of catalog) {
  const garment = makeGarment(item);
  garment.update({ arms });
  await writeFile(new URL(`${item.id}.json`, output), JSON.stringify({
    id: item.id, fabric: item.fabric, tile: item.tile, objects: packet(garment.group),
  }));
  if (item.id === 'luna') {
    const body = buildMannequin();
    body.update(pose, frame, cuts[item.cut].family);
    garment.group.position.copy(frame.position);
    garment.group.quaternion.copy(frame.quaternion);
    garment.group.scale.copy(frame.scale);
    await writeFile(new URL('studio.json', output), JSON.stringify({
      id: 'studio', fabric: item.fabric, tile: '#2c2e24', objects: [...packet(garment.group), ...packet(body.group)],
    }));
  }
  garment.dispose();
}
