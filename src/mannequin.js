import * as T from 'three';

const V = (x, y, z) => new T.Vector3(x, y, z);
const UP = V(0, 1, 0);

export function mannequinPose(time = 0, move = false) {
  const t = move ? time : 0;
  const step = move ? Math.sin(t * 2.12) : 0;
  const spin = move ? .47 * Math.sin(t * .9) + .23 * Math.sin(t * 1.71) : -.11;
  const yaw = new T.Quaternion().setFromAxisAngle(UP, spin);
  const lean = new T.Quaternion().setFromAxisAngle(V(0, 0, 1), .028 * step - .025);
  yaw.multiply(lean);
  const center = V(move ? .22 * Math.sin(t * .94) : 0, 1.04 + .041 * Math.abs(step), 0);
  const world = (x, y, z) => V(x, y, z).applyQuaternion(yaw).add(center);
  const sides = [-1, 1];
  const pose = {
    shoulders: sides.map((s) => world(.408 * s, .008 * s, .008)),
    hips: sides.map((s) => world((.22 + step * .016) * s, -.944, -.008)),
    elbows: sides.map((s) => world((.529 + .038 * step * s) * s, -.615, .062 + .13 * step * s)),
    wrists: sides.map((s) => world((.593 - .062 * step * s) * s, -1.102 + .066 * step * s, .111 + .245 * step * s)),
    hands: sides.map((s) => world((.605 - .063 * step * s) * s, -1.21 + .06 * step * s, .13 + .26 * step * s)),
    knees: sides.map((s) => world(s * .203 + .029 * step, -1.96, .085 + .26 * step * s)),
    ankles: sides.map((s) => world(s * .185 - .02 * step, -2.883 + Math.max(0, step * s) * .13, .047 + .44 * step * s)),
    nose: world(.026, .386, .236),
    armVisibility: [true, true], legVisibility: [true, true],
  };
  return pose;
}

function oval(group, material, radius = [1, 1, 1], geometry = new T.SphereGeometry(1, 36, 22)) {
  const object = new T.Mesh(geometry, material);
  object.scale.set(...radius);
  object.castShadow = true;
  group.add(object);
  return object;
}

export function buildMannequin() {
  const group = new T.Group();
  group.name = 'Fitting mannequin';
  const shell = new T.MeshPhysicalMaterial({
    color: '#8d8174', roughness: .38, metalness: .45, clearcoat: .20, clearcoatRoughness: .38,
  });
  const textile = new T.MeshStandardMaterial({ color: '#302c29', roughness: .79, metalness: .06 });
  const leather = new T.MeshStandardMaterial({ color: '#262722', roughness: .38, metalness: .08 });
  const armUpper = [-1, 1].map(() => oval(group, shell));
  const forearm = [-1, 1].map(() => oval(group, shell));
  const hands = [-1, 1].map(() => oval(group, shell));
  const thumbs = [-1, 1].map(() => oval(group, shell));
  const thigh = [-1, 1].map(() => oval(group, textile));
  const shins = [-1, 1].map(() => oval(group, textile));
  const shoe = [-1, 1].map(() => oval(group, leather, [.137, .102, .249]));
  const sole = [-1, 1].map(() => oval(group, textile, [.14, .031, .254]));
  const pelvis = oval(group, textile, [.323, .361, .201]);
  const torso = oval(group, shell, [.336, .51, .179]);
  const chest = oval(group, shell, [.356, .244, .19]);
  const tube = oval(group, shell, [.119, .233, .119]);
  const skirtTop = oval(group, textile, [.333, .356, .209]);
  const headGeo = new T.SphereGeometry(1, 64, 44);
  const pos = headGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const jaw = 1 - .29 * Math.max(0, -y) ** .67;
    const nose = Math.exp(-21 * x * x - 14 * (y + .07) ** 2) * Math.max(0, z) ** 12;
    const cheek = .045 * Math.sin(Math.abs(x) * Math.PI) * Math.max(0, z) * Math.exp(-6 * (y + .19) ** 2);
    pos.setXYZ(i, x * jaw, y, z * (1 + cheek) + .22 * nose);
  }
  headGeo.computeVertexNormals();
  const head = oval(group, shell, [.247, .315, .234], headGeo);
  const ears = [-1, 1].map(() => oval(group, shell, [.046, .083, .052]));
  const tmp = V(0, 0, 0);
  const shoulder = V(0, 0, 0), hip = V(0, 0, 0);
  const q = new T.Quaternion();

  function between(object, a, b, width, depth, pad = .055) {
    object.position.copy(a).lerp(b, .5);
    tmp.subVectors(a, b);
    object.quaternion.setFromUnitVectors(UP, tmp.clone().normalize());
    object.scale.set(width, tmp.length() * .5 + pad, depth);
  }

  function update(pose, frame, family) {
    const { shoulders, elbows, wrists, hands: fingers, hips, knees, ankles } = pose;
    q.copy(frame.quaternion);
    shoulder.copy(shoulders[0]).lerp(shoulders[1], .5);
    hip.copy(hips[0]).lerp(hips[1], .5);
    const base = (object, x, y, z) => {
      object.position.copy(V(x, y, z).applyQuaternion(q).add(shoulder));
      object.quaternion.copy(q);
    };
    base(torso, 0, -.489, -.018);
    base(chest, 0, -.198, .005);
    base(tube, 0, .14, -.025);
    base(head, .017, .445, .013);
    base(pelvis, 0, -.928, -.023);
    base(skirtTop, 0, -.258, .015);
    skirtTop.visible = family === 'skirt';
    const legsMaterial = family === 'jacket' || family === 'coat' ? textile : shell;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      between(armUpper[i], shoulders[i], elbows[i], .112, .102);
      between(forearm[i], elbows[i], wrists[i], .079, .076, .043);
      between(hands[i], wrists[i], fingers[i], .057, .046, .061);
      thumbs[i].position.copy(hands[i].position).add(V(-s * .036, -.012, .024));
      thumbs[i].quaternion.copy(hands[i].quaternion);
      thumbs[i].scale.set(.024, .058, .028);
      between(thigh[i], hips[i], knees[i], .162, .138, .102);
      between(shins[i], knees[i], ankles[i], .105, .108, .067);
      thigh[i].material = legsMaterial;
      shins[i].material = legsMaterial;
      shoe[i].position.copy(ankles[i]).add(V(0, -.066, .102));
      shoe[i].quaternion.copy(q);
      sole[i].position.copy(shoe[i].position).add(V(0, -.082, .009));
      sole[i].quaternion.copy(q);
      base(ears[i], s * .234 + .017, .416, .003);
    }
  }
  return { group, update };
}
