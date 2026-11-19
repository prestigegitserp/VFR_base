import { readFile, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { catalog, form, startingSize } from '../src/catalog.js';
import { parseBody, makeAvatar } from '../src/avatar.js';
import { makeWear } from '../src/wear.js';

const variant = (name) => new URL(`../.render/${name}`,import.meta.url);
const data = Object.fromEntries(await Promise.all(['female','male'].map(async (sex) => [
  sex,parseBody(await readFile(new URL(`../public/models/${sex}.form.gz`,import.meta.url))),
])));

function packet(group) {
  group.updateMatrixWorld(true);
  const objects=[];
  const tmp=new T.Vector3(), instance=new T.Matrix4();
  group.traverse((object)=>{
    if(!object.isMesh||!object.visible)return;
    const geometry=object.geometry, material=object.material, attr=geometry.getAttribute('position');
    const idx=geometry.getIndex();
    const matrices = new T.Matrix4();
    for(let i=0;i<(object.isInstancedMesh?object.count:1);i++){
      if(object.isInstancedMesh){
        object.getMatrixAt(i,instance);
        matrices.multiplyMatrices(object.matrixWorld,instance);
      }else matrices.copy(object.matrixWorld);
      const vertices = Array.from({length:attr.count},(_,i)=>{
        tmp.fromBufferAttribute(attr,i).applyMatrix4(matrices);
        return [tmp.x,-tmp.z,tmp.y].map(n=>Math.round(n*1e5)/1e5);
      });
      objects.push({
        name:object.name||'Fitting form', vertices, indices:idx?[...idx.array]:Array.from({length:attr.count},(_,i)=>i),
        color:material.color.toArray(), roughness:material.roughness, metalness:material.metalness,
        sheen:material.sheen??0, alpha:material.opacity??1,
        vertexColor:geometry.hasAttribute('color') ? [...geometry.getAttribute('color').array].map(n=>Math.round(n*1e4)/1e4):null,
      });
    }
  });
  return objects;
}

for (const item of catalog) {
  const f=form(item.form), avatar=makeAvatar(data[f.shape],f.measure), spec=avatar.spec;
  const reference=startingSize(item);
  avatar.cover(item,reference);
  const d=spec.shoulderY-spec.hipY;
  const wear=makeWear(item,reference,0,d);
  const offset = new T.Vector3(0,spec.shoulderY,0);
  const pose = avatar.update(.32,true);
  const ground = pose.legs.flatMap(([a,b,c])=>[[a,b],[b,c]].map(([a,b])=>({a:a.clone().sub(offset),b:b.clone().sub(offset),radius:.095})));
  wear.update(pose.arms.map((a)=>a.map(p=>p.clone().sub(offset))),ground,.015,{wind:0});
  wear.group.position.copy(item.frame==='face'? spec.face : offset);
  const scene=new T.Group();scene.add(avatar.model,wear.group);
  const objects=packet(scene);
  await writeFile(variant(`${item.id}.json`),JSON.stringify({id:item.id,frame:item.frame,fabric:item.fabric,face:spec.face.toArray(),height:spec.height,torso:spec.shoulderY,poses:objects}));
  if(item.id==='terra') await writeFile(variant('atelier.json'),JSON.stringify({id:'atelier',frame:'full',fabric:item.fabric,face:spec.face.toArray(),height:spec.height,torso:spec.shoulderY,poses:objects}));
  wear.dispose();avatar.dispose();
}
