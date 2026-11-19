import { Matrix4, Vector3 } from 'three';
import { clamp } from './catalog.js';

const mix = (a, b, t) => a + (b - a) * t;

export function solveDrape(rest, rig, toLocal) {
  const [left, right] = rig.shoulder.map(toLocal);
  const collar = toLocal(rig.collar);
  const bodyWidth = right.distanceTo(left);
  const shoulderScale = clamp(bodyWidth / rest.shoulder, .70, 1.36);
  const hip = rig.hip?.map(toLocal);
  const hipCenter = hip ? hip[0].clone().lerp(hip[1], .5) : null;
  const section = (name, defaultY, garmentWidth) => {
    const landmark = rig.sections[name];
    const center = toLocal(landmark.center);
    const contour = landmark.width ? landmark.width / rig.span : 0;
    const projectedWidth = bodyWidth * contour;
    const signal = clamp(projectedWidth / (garmentWidth * shoulderScale), .72, 1.27);
    const reliability = landmark.reliability;
    return { y: defaultY, x: clamp(center.x, -bodyWidth * .29, bodyWidth * .29),
      sx: shoulderScale * mix(1, signal, .59 * reliability) };
  };
  const chest = section('chest', -rest.torso * .30, rest.chest);
  const waist = section('waist', -rest.torso * .69, rest.waist);
  const pelvis = section('hip', -rest.torso, rest.hip);
  if (hipCenter) pelvis.x = mix(pelvis.x, clamp(hipCenter.x, -bodyWidth * .34, bodyWidth * .34), .57);
  const hipOffset = hipCenter ? clamp(hipCenter.y + rest.torso, -.125, .105) : 0;
  const shoulder = { y: 0, x: (left.x + right.x) * .5, sx: shoulderScale };
  const neck = { x: clamp(collar.x - shoulder.x, -.087, .087),
    y: clamp(collar.y - rest.neck, -.041, .061), half: rest.shoulder * .35 };
  const rows = [shoulder, chest, waist, pelvis];
  const values = rows.flatMap(row => [row.x, row.sx]).concat(neck.x, neck.y, hipOffset);
  return { rows, neck, hipOffset, values };
}

export function drapePoint(x, y, z, fit, out = [0, 0, 0], offset = 0) {
  const [shoulder, chest, waist, pelvis] = fit.rows;
  const a = y > chest.y ? shoulder : y > waist.y ? chest : waist;
  const b = y > chest.y ? chest : y > waist.y ? waist : pelvis;
  const t = clamp((y - a.y) / (b.y - a.y), 0, 1);
  const width = mix(a.sx, b.sx, t);
  const collar = clamp(1 - Math.abs(x) / fit.neck.half, 0, 1) * clamp((y + .122) / .148, 0, 1);
  const rise = clamp(y / pelvis.y, 0, 1);
  out[offset] = x * width + mix(a.x, b.x, t) + collar * fit.neck.x;
  out[offset + 1] = y + fit.hipOffset * rise + collar * fit.neck.y;
  out[offset + 2] = z * mix(1, width, .44);
  return out;
}

export function fitMeshes(group, moving) {
  const staticMeshes = [];
  const placements = [];
  const instances = [];
  const matrix = new Matrix4(), point = new Vector3();
  for (const part of group.children) {
    if (!part.isMesh || part === moving) continue;
    if (part.isInstancedMesh) {
      const originals = Array.from({ length: part.count }, (_, i) => {
        part.getMatrixAt(i, matrix);
        return matrix.clone();
      });
      part.frustumCulled = false;
      instances.push({ part, originals });
    } else if (part.position.lengthSq() || part.rotation.x || part.rotation.y || part.rotation.z) {
      placements.push({ part, original: part.position.toArray() });
    } else {
      const position = part.geometry.attributes.position;
      staticMeshes.push({ part, position, original: position.array.slice() });
      part.frustumCulled = false;
    }
  }
  let last = null;
  return fit => {
    if (fit === last) return;
    if (fit && last && fit.values.every((value, i) => Math.abs(value - last.values[i]) < (i % 2 && i < 8 ? .015 : .003))) return;
    last = fit;
    for (const { part, position, original } of staticMeshes) {
      if (!fit) position.array.set(original);
      else {
        for (let i = 0; i < original.length; i += 3) {
          drapePoint(original[i], original[i + 1], original[i + 2], fit, position.array, i);
        }
      }
      position.needsUpdate = true;
      part.geometry.computeVertexNormals();
    }
    for (const { part, original } of placements) {
      part.position.set(...(fit ? drapePoint(...original, fit) : original));
    }
    for (const { part, originals } of instances) {
      originals.forEach((original, i) => {
        matrix.copy(original);
        if (fit) {
          point.setFromMatrixPosition(matrix);
          matrix.setPosition(...drapePoint(point.x, point.y, point.z, fit));
        }
        part.setMatrixAt(i, matrix);
      });
      part.instanceMatrix.needsUpdate = true;
    }
  };
}
