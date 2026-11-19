import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { zipSync, strToU8 } from 'fflate';
import { catalog, form } from '../src/catalog.js';
import { makeAvatar, parseBody } from '../src/avatar.js';
import { makeWear } from '../src/wear.js';
import { unpackPackage } from '../src/protocol.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => { this.result=buffer; this.onloadend?.(); });
  }
};
const item=catalog.find((i)=>i.id==='meridian');
const reference=form(item.form);
const model=parseBody(await readFile(new URL('../public/models/male.form.gz',import.meta.url)));
const avatar=makeAvatar(model,reference.measure);
const {shoulderY,hipY}=avatar.spec;
const origin=new T.Vector3(0,shoulderY,0);
const anchors={
  leftShoulder:[-reference.measure.shoulder/2000,shoulderY,0],
  rightShoulder:[reference.measure.shoulder/2000,shoulderY,0],
  hip:[0,hipY,0],
};
const files={};
const variants=[];
for(const [label,index] of [['46 Tall',2],['52 Regular',5]]) {
  const size=structuredClone(item.sizes[index]);
  if(label.includes('Tall')){size.garment.sleeve+=29;size.garment.length+=41;}
  const wear=makeWear(item,size,1,shoulderY-hipY);
  wear.update(avatar.pose.arms.map((arm)=>arm.map((p)=>p.clone().sub(origin))),[],.001,{});
  wear.group.position.copy(origin);
  wear.group.traverse((part)=>{
    if(!part.isMesh)return;
    part.geometry.deleteAttribute('uv');
    for(const [key, precision] of [['position', 5000]]){
      const attr=part.geometry.getAttribute(key);
      for(let i=0;i<attr.array.length;i++)attr.array[i]=Math.round(attr.array[i]*precision)/precision;
    }
  });
  const path=`sizes/${size.sku}.glb`;
  const result=await new GLTFExporter().parseAsync(wear.group,{binary:true});
  files[path]=new Uint8Array(result);
  variants.push({label,sku:`SCAN-${size.sku}`,model:path,measurementsMm:size.garment,anchors,toleranceMm:5});
  wear.dispose();
}
avatar.dispose();
const manifest={
  protocol:'vfr.garment/2',axes:'Y_UP_Z_FORWARD_METERS',id:'meridian-package',title:'کت نمونهٔ GLB',
  brand:'ATELIER SAMPLE',description:'نمونهٔ صادرشده از آتلیه با دو مدل GLB مستقل و جدول اندازهٔ اختصاصی.',audience:'men',
  cut:'jacket',fabric:'wool',color:'#57443d',easeMm:item.ease,sizes:variants,
};
files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
files['poster.webp']=await readFile(new URL('../public/looks/meridian.webp',import.meta.url));
const zip=zipSync(files,{level:9});
unpackPackage(zip);
await mkdir(new URL('../public/protocol/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/protocol/atelier-scanned.zip',import.meta.url),zip);
await writeFile(new URL('../docs/garment-manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log('Two valid GLB SKUs in',zip.length,'bytes');
