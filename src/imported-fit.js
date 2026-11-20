import { BufferAttribute, Group, Mesh, Quaternion, Vector3 } from 'three';
import { clamp } from './catalog.js';
import { bodyRing } from './body-volume.js';

const armPart = /sleeve|cuff|آستین/i;
const V = () => new Vector3();

function visibleMeshes(node, studio) {
  if (studio.has(node)) return [];
  return (node.isMesh ? [node] : []).concat(node.children.flatMap(child => visibleMeshes(child, studio)));
}

export function prepareImportedFit(source, studioOnly, anchors) {
  const meshes = visibleMeshes(source, new Set(studioOnly));
  const count = meshes.reduce((sum, m) => sum + m.geometry.attributes.position.count, 0);
  if (!count || count > 28_000 || meshes.some(m => m.isSkinnedMesh || m.isInstancedMesh || m.morphTargetInfluences)) return null;
  source.updateMatrixWorld(true);
  const group = new Group();
  group.name = 'Dressed scan';
  const parts = meshes.map(m => {
    const mesh = new Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld), m.material);
    mesh.name = m.name;
    mesh.frustumCulled = false;
    group.add(mesh);
    const src = mesh.geometry.attributes.position;
    const rest = new Float32Array(src.count * 3);
    for (let i=0;i<src.count;i++) {
      rest[i*3]=src.getX(i);rest[i*3+1]=src.getY(i);rest[i*3+2]=src.getZ(i);
    }
    const attr = new BufferAttribute(rest.slice(),3);
    mesh.geometry.setAttribute('position',attr);
    const centerX = rest.reduce((sum, value, i) => i % 3 === 0 ? sum + value : sum, 0) / attr.count;
    const arm = armPart.test(m.name) && Math.abs(centerX) > anchors.span * .33 ? (centerX >= 0 ? 1 : 0) : null;
    return { mesh, attr, rest, arm };
  });

  const sleeves = [0, 1].map(i => {
    const components = parts.filter(p => p.arm === i);
    if (!components.length) return null;
    const shoulder = new Vector3((i ? 1 : -1) * anchors.span * .5, 0, 0);
    let lowest = Infinity;
    for (const { rest } of components) for (let j = 1; j < rest.length; j += 3) lowest = Math.min(lowest, rest[j]);
    const cuff = V();
    let n = 0;
    for (const { rest } of components) {
      for (let j = 0; j < rest.length; j += 3) {
        if (rest[j + 1] < lowest + .034) { cuff.x += rest[j]; cuff.y += rest[j + 1]; cuff.z += rest[j + 2]; n++; }
      }
    }
    cuff.divideScalar(n);
    const axis = cuff.clone().sub(shoulder), length = axis.length();
    return length > .27 ? { shoulder, cuff, axis: axis.normalize(), length } : null;
  });

  const p = V(), base = V(), mapped = V(), perRow = Array.from({ length: 31 }, () => V());
  return {
    group,
    fit(volume, arms, collider, adjustment) {
      const shiftX = volume.width * adjustment.x / 100, shiftY = -volume.width * adjustment.y / 100, shiftZ = adjustment.depth * .001;
      const sx = clamp(volume.width / anchors.span, .86, 1.17) * (1 + adjustment.width / 100);
      const sy = clamp(volume.length / anchors.torso, .89, 1.12) * (1 + adjustment.length / 100);
      perRow.forEach((p, i) => p.copy(bodyRing(volume, i / 30).center));
      const limbs = sleeves.map((sleeve, i) => {
        if (!sleeve) return null;
        const [a, b, c] = arms[i];
        const u = b.clone().sub(a).normalize(), v = c.clone().sub(b).normalize();
        const offset = clamp(sleeve.length - a.distanceTo(b) - b.distanceTo(c), -.061, .044);
        const end = c.clone().addScaledVector(v, offset);
        const first = new Quaternion().setFromUnitVectors(sleeve.axis, u), second = new Quaternion().setFromUnitVectors(sleeve.axis, v);
        return { sleeve, a, b, end, first, second };
      });
      let contacts = 0, maxCorrection = 0;
      for (const { mesh, attr, rest, arm } of parts) {
        const limb = limbs[arm], values = attr.array;
        for (let j = 0; j < values.length; j += 3) {
          p.fromArray(rest, j);
          if (limb) {
            const { sleeve, a, b, end, first, second } = limb;
            const t = clamp(base.copy(p).sub(sleeve.shoulder).dot(sleeve.axis) / sleeve.length, -.08, 1.04);
            const blend = clamp((t - .40) / .24, 0, 1);
            const elbow = .53;
            base.copy(sleeve.shoulder).addScaledVector(sleeve.axis, t * sleeve.length);
            p.sub(base);
            mapped.copy(p).applyQuaternion(first).lerp(p.applyQuaternion(second), blend);
            base.copy(t < elbow ? a : b).lerp(t < elbow ? b : end, t < elbow ? t / elbow : (t - elbow) / (1 - elbow));
            mapped.add(base);
          } else {
            const u = clamp(-p.y / anchors.torso, 0, 1);
            const center = perRow[Math.round(u * 30)];
            mapped.set(p.x * sx + center.x * u, p.y * sy, p.z + center.z * u * .67);
          }
          mapped.x += shiftX; mapped.y += shiftY; mapped.z += shiftZ;
          mapped.toArray(values, j);
          const adjust = collider.project(values, j, .0065, .105);
          if (adjust) { contacts++; maxCorrection = Math.max(maxCorrection, adjust); }
        }
        attr.needsUpdate = true; mesh.geometry.computeVertexNormals();
      }
      return { contacts, maxCorrection, vertices: count };
    },
    dispose() { for (const { mesh } of parts) mesh.geometry.dispose(); },
  };
}
