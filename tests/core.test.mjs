import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { catalog, cuts, dimensions, fabrics, patternData, readPattern, recommendSize } from '../src/catalog.js';
import { Cloth } from '../src/cloth.js';
import { makeGarment } from '../src/garment.js';
import { mannequinPose } from '../src/mannequin.js';
import { Calibration, containRect, project, projectRig, validPose } from '../src/pose.js';

test('size recommendation respects the tightest dimension and skips chest for skirts', () => {
  assert.equal(recommendSize(catalog[0], { chest: 92, waist: 70, hips: 98 }), 'L');
  assert.equal(recommendSize(catalog[0], { chest: 120, waist: 70, hips: 98 }), 'outside');
  assert.equal(recommendSize(catalog[2], { waist: 70, hips: 95 }), 'M');
  assert.equal(recommendSize(catalog[0], { waist: 70, hips: 95 }), null);
  assert.equal(dimensions(catalog[0], 'XL').length, 124.8);
});

test('custom template round-trips and rejects unsupported geometry or malformed metrics', () => {
  for (const item of catalog) {
    const data = patternData(item);
    assert.deepEqual(patternData(readPattern(data)), data);
  }
  const data = patternData(catalog[0]);
  assert.throws(() => readPattern({ ...data, schema: 8 }));
  assert.throws(() => readPattern({ ...data, cut: 'toString' }));
  assert.throws(() => readPattern({ ...data, hips: '105' }));
  assert.throws(() => readPattern({ ...data, color: 'red' }));
  assert.throws(() => readPattern({ ...data, length: 200 }));
});

test('all garment variants generate finite geometry, including tracked cuffs and skirt vertices', () => {
  const pose = mannequinPose(.55, true);
  const offset = pose.shoulders[0].clone().lerp(pose.shoulders[1], .5);
  const arms = [0, 1].map((i) => [pose.shoulders[i], pose.elbows[i], pose.wrists[i]].map((p) => p.clone().sub(offset)));
  for (const item of catalog) {
    const g = makeGarment(item, 'XL', 2);
    g.update({ dt: .032, arms, legs: [[new T.Vector3(.2, -.9, 0), new T.Vector3(.2, -2, 0)]], wind: 6.8 });
    let meshes = 0;
    g.group.traverse((mesh) => {
      const attr = mesh.geometry?.attributes.position;
      if (!attr) return;
      meshes++;
      assert.ok(attr.array.every(Number.isFinite), item.name);
    });
    assert.ok(meshes > 1, cuts[item.cut].label);
    g.dispose();
  }
});

test('cloth keeps the waist pinned and returns smoothly towards rest after wind', () => {
  const columns = 36, rows = 13;
  const vertices = new Float32Array((columns + 1) * rows * 3);
  const cloth = new Cloth({ columns, rows, vertexPositions: vertices, fabric: fabrics.silk, pattern: {
    top: -.64, width: .33, depth: .2, flare: .78, length: 1.5, pleats: 9, fold: .04, phase: 0,
  } });
  const initial = vertices.slice();
  const zero = { x: 0, y: 0, z: 0, turn: 0 };
  const hemDelta = () => {
    const row = (columns + 1) * (rows - 1) * 3;
    return Math.abs(vertices[row] - initial[row]);
  };
  for (let i = 0; i < 75; i++) cloth.update(1 / 75, zero, [], 7);
  const inWind = hemDelta();
  assert.ok(inWind > .01, `hem moved ${inWind}`);
  assert.deepEqual(vertices.slice(0, (columns + 1) * 3), initial.slice(0, (columns + 1) * 3));
  for (let i = 0; i < 75; i++) cloth.update(1 / 75, zero, [], 0);
  assert.ok(hemDelta() < inWind);
});

test('pose projection shares video geometry with mirror and aspect-ratio handling', () => {
  const rect = containRect(1280, 720, 500, 500);
  assert.deepEqual(project({ x: .2, y: .5 }, rect, true), { x: 400, y: 250 });
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  for (const [i, x, y] of [[0,.5,.11],[11,.4,.24],[12,.6,.24],[13,.37,.4],[14,.63,.4],[23,.424,.51],[24,.576,.51],
    [27,.43,.89],[28,.57,.89],[29,.43,.9],[30,.57,.9]]) points[i] = { x, y, z: 0, visibility: 1 };
  assert.equal(validPose(points), true);
  const mirror = projectRig(points, rect, 500, 500, true);
  assert.ok(mirror.shoulders[0].x < mirror.shoulders[1].x);
  const calibration = new Calibration(172);
  const mask = { width: 100, height: 100, getAsFloat32Array: () => Float32Array.from({ length: 10000 }, (_, i) => i % 100 >= 40 && i % 100 <= 60 ? 1 : 0) };
  for (let i = 0; i < Calibration.count; i++) assert.equal(calibration.push(points, mask, 1), true);
  assert.ok(calibration.result().chest > 90);
  points[11].visibility = .03;
  assert.equal(validPose(points), false);
});
