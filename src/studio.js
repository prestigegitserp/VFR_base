import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMannequin, mannequinPose } from './mannequin.js';
import { makeGarment } from './garment.js';
import { HEIGHT } from './pose.js';
import { clamp, cuts } from './catalog.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const point = (p) => V(p.x, p.y, p.z);
const mid = (a, b) => point(a).lerp(point(b), .5);

export function garmentFrame(pose) {
  const [left, right] = pose.shoulders;
  const shoulder = mid(left, right);
  const hip = mid(...pose.hips);
  const dx = point(right).sub(point(left));
  const up = shoulder.clone().sub(hip);
  const w = clamp(Math.hypot(dx.x, dx.y), .22, 1.85);
  const h = clamp(Math.hypot(up.x, up.y), .29, 2.05);
  dx.z = clamp(dx.z, -w * .67, w * .67);
  up.z = clamp(up.z, -h * .28, h * .28);
  const forward = V().crossVectors(dx.normalize(), up.normalize()).normalize();
  if (forward.z < 0) forward.negate();
  const horizontal = V().crossVectors(up, forward).normalize();
  const y = V().crossVectors(forward, horizontal).normalize();
  const rotation = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(horizontal, y, forward));
  const depth = clamp(w / .816 * .88 + h / .944 * .12, .33, 2.15);
  return { position: shoulder, quaternion: rotation, scale: V(w / .816, h / .944, depth) };
}

function lamp(scene, color, power, x, y, z, cast = false) {
  const light = new T.DirectionalLight(color, power);
  light.position.set(x, y, z);
  light.castShadow = cast;
  if (cast) {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -3.7;
    light.shadow.camera.right = 3.7;
    light.shadow.camera.top = 3.9;
    light.shadow.camera.bottom = -3.9;
    light.shadow.bias = -.0015;
    light.shadow.normalBias = .037;
    light.shadow.radius = 6;
  }
  scene.add(light);
  return light;
}

export class Studio {
  constructor(canvas, onLost) {
    this.renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#141613', 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 35);
    this.body = buildMannequin();
    this.root = new T.Group();
    this.root.name = 'Pose aligned fitting transform';
    this.scene.add(this.body.group, this.root);
    this.scene.add(new T.HemisphereLight('#ddd4ca', '#574536', 1.48));
    this.key = lamp(this.scene, '#ffe1ba', 3.05, -3, 4.2, 5, true);
    lamp(this.scene, '#9aafee', 1.32, 3.5, 2.9, -4);
    lamp(this.scene, '#fb9e72', 1.11, -.7, 1.4, -4.2);
    lamp(this.scene, '#ccd7f4', .44, 3.45, 0, 4);
    const environment = new RoomEnvironment();
    const sampler = new T.PMREMGenerator(this.renderer);
    this.scene.environment = sampler.fromScene(environment, .038).texture;
    this.scene.environmentIntensity = .39;
    environment.dispose();
    sampler.dispose();

    this.shadowFloor = new T.Mesh(new T.PlaneGeometry(150, 150), new T.ShadowMaterial({ opacity: .31 }));
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.position.y = -2.011;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);
    this.lastPosition = V();
    this.velocity = V();
    this.acceleration = V();
    this.lastYaw = 0;
    this.prevTurn = 0;
    this.elapsed = 0;
    this.fresh = true;
    this.canvas = canvas;
    this.pose = null;
    this.mode = 'studio';
    this.motion = { x: 0, y: 0, z: 0, turn: 0 };
    this.onLost = onLost;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.onLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.fresh = true;
      this.onLost(false);
    });
  }

  resize(w, h, quality) {
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.35));
    this.renderer.setSize(w, h, false);
  }

  change(item, size, color) {
    if (this.garment) {
      this.root.remove(this.garment.group);
      this.garment.dispose();
    }
    this.garment = makeGarment(item, size, color);
    this.root.add(this.garment.group);
    this.family = cuts[item.cut].family;
    this.fresh = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.fresh = true;
    this.garment?.reset();
  }

  update({ dt, activePose, move, wind, near, zoom, quality }) {
    if (this.lost) return;
    const demo = this.mode === 'studio';
    if (demo && move) this.elapsed += dt;
    const pose = demo ? mannequinPose(this.elapsed, move) : activePose;
    this.pose = pose;
    this.root.visible = Boolean(pose);
    this.body.group.visible = demo;
    this.shadowFloor.visible = demo && !near;
    this.key.castShadow = demo;
    this.renderer.shadowMap.enabled = demo;
    const extent = demo ? (near ? 2.67 : HEIGHT + .25) / zoom : HEIGHT;
    const vertical = extent / 2;
    const horizontal = vertical * (this.width ?? 1) / Math.max(1, this.height ?? 1);
    const bias = demo ? near ? .39 : -.119 : 0;
    Object.assign(this.camera, { left: -horizontal, right: horizontal, top: vertical, bottom: -vertical });
    this.camera.position.set(0, bias + (demo ? .12 : 0), 8);
    this.camera.lookAt(0, bias, 0);
    this.camera.updateProjectionMatrix();

    if (!pose || !this.garment) {
      this.fresh = true;
      return;
    }
    const frame = garmentFrame(pose);
    const rate = this.fresh || demo ? 1 : 1 - Math.exp(-21 * dt);
    this.root.position.lerp(frame.position, rate);
    this.root.quaternion.slerp(frame.quaternion, rate);
    this.root.scale.lerp(frame.scale, rate);
    this.root.position.z = 0;
    this.root.updateMatrixWorld(true);
    const transform = this.root.matrixWorld.clone().invert();
    const toLocal = (p) => point(p).applyMatrix4(transform);
    const arms = [0, 1].map((i) => [pose.shoulders[i], pose.elbows[i], pose.wrists[i]].map(toLocal));
    const legs = [0, 1].flatMap((i) => {
      if (!pose.legVisibility[i]) return [];
      return [[pose.hips[i], pose.knees[i]].map(toLocal), [pose.knees[i], pose.ankles[i]].map(toLocal)];
    });
    const yaw = V(0, 0, 1).applyQuaternion(this.root.quaternion).x;
    const pelvisDepth = mid(...pose.hips).z;
    const origin = this.root.position.clone();
    origin.z = pelvisDepth;
    if (this.fresh) {
      this.lastPosition.copy(origin);
      this.velocity.set(0, 0, 0);
      this.acceleration.set(0, 0, 0);
      this.lastYaw = yaw;
      this.prevTurn = 0;
      this.fresh = false;
    }
    const velocity = origin.clone().sub(this.lastPosition).divideScalar(Math.max(dt, 1 / 240));
    const acceleration = velocity.clone().sub(this.velocity).divideScalar(Math.max(dt, 1 / 240));
    this.velocity.lerp(velocity, .28);
    this.lastPosition.copy(origin);
    this.acceleration.lerp(acceleration.clampScalar(-14, 14), .18);
    this.prevTurn += (clamp((yaw - this.lastYaw) / Math.max(dt, 1 / 100) * 2.7, -11, 11) - this.prevTurn) * .31;
    this.lastYaw = yaw;
    const movement = this.acceleration.clone().applyQuaternion(this.root.quaternion.clone().invert()).divide(this.root.scale);
    Object.assign(this.motion, { x: movement.x + (demo && move ? 1.4 * Math.sin(this.elapsed * 2.22) : 0), y: movement.y, z: movement.z, turn: this.prevTurn });
    this.garment.update({ dt, arms, legs, motion: this.motion, wind: wind ? 6.8 : demo && move ? 1.1 : 0 });
    if (demo) this.body.update(pose, frame, this.family);
    this.scene.environmentIntensity = quality === 'high' ? .47 : .39;
  }

  draw(compare = 0) {
    if (this.lost) return false;
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    if (compare > 0 && this.root.visible) {
      this.renderer.setScissor(0, 0, this.width * compare, this.height);
      this.renderer.setScissorTest(true);
      this.root.visible = false;
      this.renderer.render(this.scene, this.camera);
      this.root.visible = true;
      this.renderer.setScissorTest(false);
    }
    return true;
  }

  location(p) {
    const a = point(p).project(this.camera);
    return [(a.x + 1) * this.width / 2, (1 - a.y) * this.height / 2];
  }
}
