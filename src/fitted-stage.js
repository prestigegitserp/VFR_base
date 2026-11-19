import * as T from 'three';
import { clamp } from './catalog.js';
import { faceTriangles } from './camera-fit.js';
import { makeLiveShell } from './live-shell.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const forward = V(0, 0, 1);
const vertical = V(0, 1, 0);
const tau = Math.PI * 2;

function sphere(parent, geometry, material) {
  const mesh = new T.Mesh(geometry, material);
  mesh.visible = false;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

function capsule(mesh, a, b, width, depth = width) {
  const d = b.clone().sub(a);
  const length = d.length();
  mesh.position.copy(a).lerp(b, .5);
  mesh.quaternion.setFromUnitVectors(vertical, length > .0005 ? d.divideScalar(length) : vertical);
  mesh.scale.set(width, length / 2 + width * .62, depth);
  mesh.visible = true;
}

function curveTube(points, radius, material, closed = false) {
  return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points, closed), Math.max(15, points.length * 2), radius, 7, closed), material);
}

function makeOptics(item, size, color) {
  const group = new T.Group();
  const metal = item.id === 'arc';
  const tint = item.colors[color]?.value ?? item.colors[0].value;
  const frame = new T.MeshPhysicalMaterial({ color: tint, roughness: .26, metalness: metal ? .69 : .14, clearcoat: .63 });
  const lens = new T.MeshPhysicalMaterial({
    color: '#cbdce5', transparent: true, opacity: .072, roughness: .18, depthWrite: false,
    side: T.DoubleSide, clearcoat: .71,
  });
  const pad = new T.MeshStandardMaterial({ color: '#c1a67d', roughness: .38, metalness: .31 });
  const width = size.garment.width * .001;
  const centers = size.garment.eye * .0005;
  const radius = width * .5 - centers - .0027;
  const level = metal ? -.008 : -.006;
  const edges = [], anchors = [];
  for (const s of [-1, 1]) {
    const rx = radius * (metal ? .95 : 1);
    const ry = metal ? .0198 : .0163;
    const points = Array.from({ length: 40 }, (_, i) => {
      const a = i / 40 * tau;
      const x = s * centers + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (metal ? .92 : .78) * rx;
      const y = level + Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (metal ? .94 : .78) * ry;
      return V(x, y, .005 - Math.abs(x / width) ** 2 * .020);
    });
    const rim = curveTube(points, metal ? .00145 : .00235, frame, true);
    const shape = new T.Shape(points.map(p => new T.Vector2(p.x, p.y)));
    const surface = new T.ShapeGeometry(shape), position = surface.attributes.position;
    for (let i = 0; i < position.count; i++) position.setZ(i, .004 - (position.getX(i) / width) ** 2 * .020);
    surface.computeVertexNormals();
    const lensMesh = new T.Mesh(surface, lens);
    const hinge = V(s * (centers + rx + .0015), level + .0045, -.0008);
    const joint = new T.Mesh(new T.SphereGeometry(.0036, 14, 10), pad);
    joint.scale.set(.85, .85, 1.25); joint.position.copy(hinge);
    group.add(rim, lensMesh, joint);
    anchors.push(hinge);
    const arm = new T.Mesh(new T.BufferGeometry(), frame);
    arm.name = 'Temple arm';
    arm.frustumCulled = false; group.add(arm); edges.push(arm);
  }
  const gap = size.garment.bridge * .0005;
  group.add(curveTube([V(-gap, .006, .005), V(0, .0081, .006), V(gap, .006, .005)], metal ? .0017 : .0024, frame));
  if (metal) group.add(curveTube([V(-gap, .016, .002), V(0, .019, .004), V(gap, .016, .002)], .00145, frame));
  return {
    group,
    fit(head, adjustment) {
      const toLocal = p => p.clone().sub(head.origin).applyQuaternion(head.q.clone().invert());
      const visualWidth = width * head.size;
      group.position.copy(head.bridge).addScaledVector(head.forward, .0065 + adjustment.depth * .001);
      group.position.add(V(adjustment.x * width / 100, -adjustment.y * width / 100, 0).applyQuaternion(head.q));
      group.quaternion.copy(head.q);
      group.scale.set(head.size * (1 + adjustment.width / 100),
        head.size * (1 + adjustment.length / 100), head.size);
      edges.forEach((edge, i) => {
        const sign = i ? 1 : -1, hinge = anchors[i];
        const temple = toLocal(head.temples[i]).divide(group.scale);
        temple.x = sign * Math.max(Math.abs(temple.x) + .0035, Math.abs(hinge.x) + .0014);
        temple.z = clamp(temple.z - .013, -.110, -.043);
        temple.y = clamp(temple.y, -.025, .017);
        const mid = hinge.clone().lerp(temple, .56); mid.x += sign * .0025;
        const tip = temple.clone().add(V(-sign * .003, -.018, -.014));
        const line = new T.CatmullRomCurve3([hinge, mid, temple, tip]);
        const geometry = new T.TubeGeometry(line, 17, visualWidth > .14 ? .0019 : .00165, 6, false);
        edge.geometry.dispose(); edge.geometry = geometry;
      });
    },
    dispose() {
      group.traverse(o => o.geometry?.dispose());
      [frame, lens, pad].forEach(m => m.dispose());
    },
  };
}

export class FittedStage {
  constructor(scene) {
    this.group = new T.Group();
    this.group.visible = false;
    this.body = new T.Group();
    this.overlay = new T.Group();
    this.group.add(this.body, this.overlay);
    scene.add(this.group);
    this.depth = new T.MeshBasicMaterial({ colorWrite: false, side: T.DoubleSide });
    this.proxy = new T.MeshStandardMaterial({ color: '#ab9481', roughness: .77, side: T.DoubleSide });
    this.sphere = new T.SphereGeometry(1, 22, 14);
    this.face = new T.BufferGeometry();
    this.face.setAttribute('position', new T.BufferAttribute(new Float32Array(468 * 3), 3).setUsage(T.DynamicDrawUsage));
    this.face.setIndex(new T.BufferAttribute(faceTriangles, 1));
    this.head = sphere(this.group, this.face, this.depth);
    this.skull = sphere(this.group, this.sphere, this.proxy);
    this.skull.renderOrder = -4;
    this.neck = sphere(this.body, this.sphere, this.depth);
    this.trunk = Array.from({ length: 4 }, () => sphere(this.body, this.sphere, this.depth));
    this.limbs = Array.from({ length: 8 }, () => sphere(this.body, this.sphere, this.depth));
    this.occluders = [this.head, this.neck, ...this.trunk, ...this.limbs];
    this.camera = new T.PerspectiveCamera(45, 1, .12, 12);
  }

  clear() {
    if (this.product) {
      this.product.group.removeFromParent(); this.product.dispose();
    }
    this.product = null;
    this.changed = null;
  }

  prepare(item, size, color) {
    this.item = item;
    this.product = item.source === 'scan' ? null : item.frame === 'face' ? makeOptics(item, size, color) : makeLiveShell(item, size, color);
  }

  maskHead(head) {
    this.head.visible = Boolean(head);
    this.skull.visible = Boolean(head) && this.inspecting;
    if (!head) return;
    const positions = this.face.attributes.position;
    head.surface.forEach((p, i) => positions.setXYZ(i, p.x, p.y, p.z));
    positions.needsUpdate = true;
    if (this.inspecting) {
      this.face.computeVertexNormals();
      this.skull.position.copy(head.bridge).add(V(0, .001, -.085).multiplyScalar(head.size).applyQuaternion(head.q));
      this.skull.quaternion.copy(head.q);
      this.skull.scale.set(.071 * head.size, .100 * head.size, .066 * head.size);
    }
  }

  poseBody(rig, local, arms, inspection) {
    this.body.position.copy(rig.origin);
    this.body.quaternion.copy(rig.q);
    const { neck, length, width, rings } = rig.volume;
    const base = neck.center.clone().add(V(0, -.031, -.003));
    capsule(this.neck, base, neck.joint, neck.rx * .89, neck.rz * .83);
    rings.forEach((ring, i) => {
      const mesh = this.trunk[i];
      mesh.visible = !inspection || this.item.cut === 'dress' || this.item.cut === 'skirt';
      mesh.position.copy(ring.center);
      mesh.scale.set(ring.rx * .93, length * (i === 0 ? .149 : .215), ring.rz * .90);
    });
    const bareSleeves = this.item.cut === 'dress' || this.item.cut === 'skirt';
    arms.forEach((chain, i) => {
      capsule(this.limbs[i * 2], chain[0], chain[1], width * .102, width * .091);
      capsule(this.limbs[i * 2 + 1], chain[1], chain[2], width * .076, width * .068);
      for (const limb of this.limbs.slice(i * 2, i * 2 + 2)) limb.visible = bareSleeves;
    });
    rig.hands.forEach((hand, i) => {
      capsule(this.limbs[4 + i], hand.wrist, hand.palm, hand.radius, hand.radius * .76);
      this.limbs[4 + i].visible = inspection || hand.front > .13;
    });
    if (inspection && rig.leg.length) {
      rig.leg.forEach((l, i) => capsule(this.limbs[6 + i], local(l[0]), local(l[2]), width * .098));
    }
  }

  update({ rig, mirror, adjustment, orbit, width, height, time, dt, breeze, scanned }) {
    this.group.visible = Boolean(rig);
    const cam = this.camera;
    if (!rig) return cam;
    const mode = rig.kind === 'face' ? 'face' : 'body';
    const inspection = orbit !== null;
    const adjustId = [adjustment.x, adjustment.y, adjustment.width, adjustment.length, adjustment.depth, inspection, mirror].join('/');
    const changed = rig !== this.changed || this.adjustId !== adjustId;
    this.changed = rig; this.adjustId = adjustId;
    this.inspecting = inspection;
    this.group.scale.x = mirror ? -1 : 1;
    const wear = this.product ?? scanned;
    if (wear && wear.group.parent !== this.overlay) this.overlay.add(wear.group);
    if (wear) wear.group.visible = true;
    this.occluders.forEach(mesh => {
      mesh.material = inspection ? this.proxy : this.depth;
      if (changed) mesh.visible = false;
    });
    if(changed)this.skull.visible=false;
    this.overlay.position.set(0, 0, 0); this.overlay.quaternion.identity(); this.overlay.scale.setScalar(1);
    if (mode === 'face') {
      if (changed) {
        this.maskHead(rig);
        this.product?.fit(rig, adjustment);
      }
    } else {
      const { volume } = rig;
      const inv = rig.q.clone().invert();
      const local = p => p.clone().sub(rig.origin).applyQuaternion(inv);
      if (changed) {
        this.maskHead(rig.head);
        this.poseBody(rig, local, rig.arms.map(chain => chain.map(local)), inspection);
      }
      const shift = V(volume.width * adjustment.x / 100, -volume.width * adjustment.y / 100, adjustment.depth * .001);
      this.overlay.position.copy(shift.applyQuaternion(rig.q).add(rig.origin));
      this.overlay.quaternion.copy(rig.q);
      this.overlay.scale.set(1 + adjustment.width / 100, 1 + adjustment.length / 100, 1);
      if (this.product && (changed || breeze)) {
        this.product.update(volume, rig.arms.map(chain => chain.map(local)), time, dt, breeze, rig.origin);
      } else if (scanned?.anchors) {
        const sx = clamp(volume.width / scanned.anchors.span, .70, 1.38);
        const sy = clamp(volume.length / scanned.anchors.torso, .71, 1.41);
        this.overlay.scale.multiply(V(sx, sy, Math.sqrt(sx * sy)));
      }
    }
    if (inspection) {
      const center = rig.origin.clone();
      center.x *= mirror ? -1 : 1;
      const top = mode === 'face' ? rig.surface[10].y + .065 : (rig.head?.surface[10].y ?? center.y + .23) + .055;
      const bottom = mode === 'face' ? rig.surface[152].y - .042 : center.y - (rig.full ? 1.02 : .66);
      center.y = (top + bottom) / 2;
      const distance = Math.max(mode === 'face' ? .49 : 1.05, (top - bottom) / .67);
      const angle = orbit * Math.PI / 180;
      cam.fov = 41;
      cam.position.copy(center).add(V(Math.sin(angle) * distance, mode === 'face' ? .014 : .053, Math.cos(angle) * distance));
      cam.lookAt(center);
    } else {
      cam.position.set(0, 0, 0); cam.quaternion.identity();
      cam.fov = 2 * Math.atan(height / (2 * rig.camera.focal)) * 180 / Math.PI;
    }
    cam.aspect = width / height; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return cam;
  }
}
