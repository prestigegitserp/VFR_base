import * as T from 'three';
import { gunzipSync } from 'fflate';
import { asset, clamp } from './catalog.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const eased = (x) => x * x * (3 - 2 * x);
const cache = new Map();

export function parseBody(bytes) {
  return JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
}
export async function bodyModel(sex) {
  if (!cache.has(sex)) {
    cache.set(sex, (async () => {
      const r = await fetch(asset(`models/${sex}.form.gz`));
      if (!r.ok) throw new Error('Reference form unavailable');
      return parseBody(new Uint8Array(await r.arrayBuffer()));
    })().catch((e) => { cache.delete(sex); throw e; }));
  }
  return cache.get(sex);
}

function scaleAt(y, bands) {
  const index = bands.findIndex(([level]) => y <= level);
  if (index < 0) return bands.at(-1)[1];
  if (!index) return bands[0][1];
  const [y0, a] = bands[index - 1], [y1, b] = bands[index];
  return mix(a, b, eased(clamp((y - y0) / (y1 - y0), 0, 1)));
}

function adaptive(data, m) {
  const sY = m.height / 1000 / data.height;
  const ratio = (key) => clamp(m[key] / data.ringMm[key], .70, 1.53);
  const sh = clamp(m.shoulder / data.shoulderWidth, .75, 1.32);
  const { chest, waist, hip } = data.levels;
  const bands = [[.12, 1], [hip - .23, .81 + .19 * ratio('hip')], [hip, ratio('hip')], [waist, ratio('waist')],
    [chest, ratio('chest')], [data.shoulderY, sh], [data.shoulderY + .1, 1]];
  const shape = (x, y, z) => {
    const scale = scaleAt(y, bands);
    const arm = clamp((Math.abs(x) - .17) * 17, 0, 1);
    return V(x * mix(scale, sh, arm * clamp((y - .7) * 5, 0, 1)), y * sY, z * (1 + .86 * (scale - 1)));
  };
  const j = Object.fromEntries(Object.entries(data.joints).map(([k, p]) => [k, shape(...p)]));
  return {
    shape, joints: j, floor: 0, height: m.height * .001, shoulderY: data.shoulderY * sY,
    hipY: data.hipY * sY, face: shape(...data.face),
  };
}

function bentPose(a, b, c, type, time, s, running) {
  const len1 = a.distanceTo(b), len2 = b.distanceTo(c);
  const t = running ? time : .8;
  if (type === 'arm') {
    const swing = running ? Math.sin(t * 2.35 + s * .7) * s * .091 : .008 * s;
    const hb = a.clone().add(V(s * (.037 + .009 * Math.cos(t * 2)), -Math.sqrt(Math.max(.01, len1 * len1 - (.041 ** 2) - swing ** 2)), swing + .007));
    const hc = hb.clone().add(V(s * -.017, -Math.sqrt(Math.max(.005, len2 * len2 - (.039 ** 2))), .04 + swing * .6));
    return [a.clone(), hb, hc];
  }
  const step = running ? Math.sin(t * 2.35) * s : s * .13;
  const hb = b.clone().lerp(a, .012).add(V(s * -.03, Math.max(0, .021 * step), step * .055));
  const hc = c.clone().add(V(s * -.059, Math.max(0, step) * .035, step * .105));
  return [a.clone(), hb, hc];
}

export function makeAvatar(data, measure) {
  const spec = adaptive(data, measure);
  const vertexCount = data.positions.length / 3;
  const rest = new Float32Array(data.positions.length);
  const points = new Float32Array(data.positions.length);
  const colors = new Float32Array(data.positions.length);
  const weights = new Float32Array(vertexCount);
  const segments = new Uint8Array(vertexCount);
  const seams = new Float32Array(vertexCount);
  const pose = { arms: [], legs: [] };
  const concealed = new Uint8Array(vertexCount);
  const skin = new T.Color('#95705e');
  const body = new T.Color('#343235');
  const boots = new T.Color('#29292c');
  for (let i = 0; i < vertexCount; i++) {
    const a = data.positions.slice(i * 3, i * 3 + 3).map((p) => p * .0001);
    const [rx, ry] = a;
    const point = spec.shape(...a);
    point.toArray(rest, i * 3);
    const col = body.clone();
    const skinMix = Math.max(clamp((ry - data.shoulderY + .022) * 28, 0, 1), clamp((Math.abs(rx) - .276) * 28, 0, 1));
    col.lerp(skin, skinMix).lerp(boots, 1 - clamp(ry * 16, 0, 1));
    col.toArray(colors, i * 3);
    if (ry > .76 && ry < data.shoulderY + .062 && Math.abs(rx) > .145) {
      const side = rx > 0 ? 0 : 1;
      const s = side ? 'r' : 'l';
      const el = spec.joints[`${s}-elbow`];
      const blend = clamp((Math.abs(rx) - .153) * 14, 0, 1);
      weights[i] = blend;
      segments[i] = 1 + side;
      seams[i] = clamp((point.y - el.y + .084) / .158, 0, 1);
    } else if (ry < data.hipY - .027) {
      const side = rx > 0 ? 0 : 1;
      const s = side ? 'r' : 'l';
      const k = spec.joints[`${s}-knee`];
      segments[i] = 3 + side;
      weights[i] = clamp((data.hipY - .02 - ry) * 10, 0, 1);
      seams[i] = clamp((point.y - k.y + .109) / .219, 0, 1);
    }
  }
  const mesh = new T.BufferGeometry();
  mesh.setAttribute('position', new T.BufferAttribute(points, 3).setUsage(T.DynamicDrawUsage));
  mesh.setAttribute('color', new T.BufferAttribute(colors, 3));
  mesh.setIndex(data.indices);
  const material = new T.MeshPhysicalMaterial({ vertexColors: true, color: '#d4c5b7', roughness: .56,
    metalness: .09, clearcoat: .16, clearcoatRoughness: .65 });
  const model = new T.Mesh(mesh, material);
  model.castShadow = model.receiveShadow = true;
  model.frustumCulled = false;
  const eyeGeometry=new T.SphereGeometry(.0112,22,15);
  const eyeMaterial=new T.MeshStandardMaterial({color:'#837975',roughness:.5});
  for(const side of ['l','r']){
    const eye=new T.Mesh(eyeGeometry,eyeMaterial);
    eye.position.copy(spec.joints[`${side}-eye`]);eye.position.z+=.002;
    model.add(eye);
  }
  const shoeGeometry=new T.SphereGeometry(1,35,22);
  const shoePosition=shoeGeometry.attributes.position;
  for(let i=0;i<shoePosition.count;i++){
    const x=shoePosition.getX(i), y=shoePosition.getY(i), z=shoePosition.getZ(i);
    shoePosition.setXYZ(i,x*(.94+.075*z),Math.max(-.62,y)*(1-.21*Math.max(0,z)),z);
  }
  shoeGeometry.computeVertexNormals();
  const shoeMaterial=new T.MeshPhysicalMaterial({color:'#3a302a',roughness:.41,clearcoat:.28});
  const shoes=[0,1].map(()=>{
    const shoe=new T.Mesh(shoeGeometry,shoeMaterial);
    shoe.castShadow=true;model.add(shoe);shoe.scale.set(.059,.064,.135);return shoe;
  });
  const groups = [[], []];
  for (const [index, side] of ['l', 'r'].entries()) {
    const find = (things) => things.map((suffix) => spec.joints[`${side}-${suffix}`]);
    groups[0][index] = find(['shoulder', 'elbow', 'hand']);
    groups[1][index] = find(['upper-leg', 'knee', 'ankle']);
  }

  const a = V(), b = V(), c = V();
  function cover(item,size){
    concealed.fill(0);
    const family=item.cut, length=size.garment.length*.001, base=spec.shoulderY;
    if(item.frame!=='face'){
      const sleeved=['coat','jacket','knit'].includes(family);
      const start=family==='skirt'?base-(base-spec.hipY)*.69:base+(family==='dress'?-.093:.052);
      const hem=start-length-(family==='dress'?-.089:sleeved?.022:0);
      for(let i=0;i<vertexCount;i++){
        const at=i*3;
        const x=rest[at], y=rest[at+1];
        if(y<hem+.008||y>start)continue;
        if(sleeved && y>base-.047 && Math.abs(x)<.077)continue;
        if(segments[i]===1||segments[i]===2){
          if(weights[i]>.65){
            if(!sleeved)continue;
            const side=segments[i]===1?'l':'r';
            const wrist=spec.joints[`${side}-hand`];
            if(y<wrist.y+.013&&Math.abs(x)>Math.abs(wrist.x)-.019)continue;
          }
        }
        concealed[i]=1;
      }
    }
    const filtered=[];
    for(let i=0;i<data.indices.length;i+=3){
      const a=data.indices[i],b=data.indices[i+1],c=data.indices[i+2];
      if(concealed[a]+concealed[b]+concealed[c]<3)filtered.push(a,b,c);
    }
    mesh.setIndex(filtered);mesh.computeVertexNormals();
  }
  function pairTransform(original, bent) {
    return [0, 1].map((k) => ({
      anchor: original[k], at: bent[k],
      q: new T.Quaternion().setFromUnitVectors(original[k + 1].clone().sub(original[k]).normalize(), bent[k + 1].clone().sub(bent[k]).normalize()),
    }));
  }
  function update(t, running) {
    pose.arms = groups[0].map(([a,b,c], i) => bentPose(a,b,c,'arm',t,i === 0 ? 1 : -1,running)).reverse();
    pose.legs = groups[1].map(([a,b,c], i) => bentPose(a,b,c,'leg',t,i === 0 ? 1 : -1,running)).reverse();
    const transforms = [...groups[0].map((base,i) => pairTransform(base,pose.arms[1-i])),
      ...groups[1].map((base,i) => pairTransform(base,pose.legs[1-i]))];
    for (let i = 0; i < vertexCount; i++) {
      a.fromArray(rest, i * 3);
      const segment = segments[i];
      if (segment) {
        const [p, q] = transforms[segment - 1];
        b.copy(a).sub(p.anchor).applyQuaternion(p.q).add(p.at);
        c.copy(a).sub(q.anchor).applyQuaternion(q.q).add(q.at);
        a.lerp(c.lerp(b, eased(seams[i])), weights[i]);
      }
      a.toArray(points, i * 3);
    }
    for(let i=0;i<2;i++){
      const ankle=pose.legs[i][2];
      shoes[i].position.copy(ankle).add(V(0,-.031,.052));
      shoes[i].rotation.y=(i===0?-1:1)*.078;
    }
    mesh.attributes.position.needsUpdate = true;
    mesh.computeVertexNormals();
    return pose;
  }
  update(0, false);
  return { model, spec, update, pose, cover, dispose() { mesh.dispose(); material.dispose();eyeGeometry.dispose();eyeMaterial.dispose();shoeGeometry.dispose();shoeMaterial.dispose(); } };
}
