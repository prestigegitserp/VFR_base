import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalog, form, startingSize } from '../src/catalog.js';
import { checkSize, chooseSize, manualProfile, TwoViewScan } from '../src/sizing.js';
import { readBodyScan, readGlb, unpackPackage } from '../src/protocol.js';
import { lineFor, makeOrder } from '../src/order.js';
import { bodyRig, contain, faceRig } from '../src/tracking.js';
import { makeAvatar, parseBody } from '../src/avatar.js';
import { makeWear } from '../src/wear.js';

const jacket=catalog.find((i)=>i.id==='meridian');
test('grade is per SKU and evaluates the full tolerance range of each dimension',()=>{
  const size=jacket.sizes[4];
  const body=manualProfile(Object.fromEntries(Object.entries(jacket.ease).map(([key,[a,b]])=>[key,size.garment[key]-(a+b)/2])));
  assert.equal(checkSize(jacket,size,body).status,'match');
  assert.equal(chooseSize(jacket,body).size.sku,size.sku);
  assert.equal(checkSize(jacket,size,{...body,method:'camera'}).status,'estimate');
  assert.equal(checkSize(jacket,size,manualProfile({chest:body.measures.chest.value})).status,'insufficient');
  const tooLarge={method:'manual',measures:{chest:{value:1490,uncertainty:7}}};
  assert.equal(chooseSize(jacket,tooLarge),null);
});

test('scanner package consists of two actual independent GLB sizes and standard anchors',async()=>{
  const bytes=new Uint8Array(await readFile(new URL('../public/protocol/atelier-scanned.zip',import.meta.url)));
  const {item,files}=unpackPackage(bytes);
  assert.deepEqual(item.sizes.map(s=>s.label),['46 Tall','52 Regular']);
  assert.notEqual(item.sizes[0].model,item.sizes[1].model);
  for(const size of item.sizes)assert.ok(readGlb(files[size.model]).meshes.length>2);
  assert.throws(()=>readGlb(new Uint8Array(64)));
  assert.throws(()=>unpackPackage(bytes.slice(0,40)));
});

test('only SKU, color and quantity go into an order draft',()=>{
  const line=lineFor(jacket,jacket.sizes[3],1);
  const doc=makeOrder([line]);
  assert.equal(doc.items[0].sku,jacket.sizes[3].sku);
  assert.deepEqual(Object.keys(doc.items[0]).sort(),['availability','color','itemId','quantity','size','sku','title']);
  assert.equal(line.url,null);
  assert.throws(()=>readBodyScan({protocol:'vfr.body/1',unit:'cm',measures:{}}));
});

test('upper framing needs neither hips nor feet while full mode requires hips',()=>{
  const pose=Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:0}));
  pose[11]={x:.34,y:.42,z:.018,visibility:.96};pose[12]={x:.65,y:.43,z:-.018,visibility:.97};
  const view={w:850,h:560},rect=contain(1280,720,view.w,view.h);
  const ref={shoulder:410,torso:.45};
  assert.equal(bodyRig({pose},'full',rect,view,true,ref),null);
  const front=bodyRig({pose},'upper',rect,view,true,ref);
  assert.equal(front.kind,'body');assert.equal(front.full,false);
  assert.equal(front.arms.length,2);assert.ok(front.scale.x>0);
});

test('face rig uses eye and chin markers on their own',()=>{
  const face=Array.from({length:478},()=>({x:.5,y:.45,z:0,visibility:0}));
  face[468]={x:.40,y:.43,z:0};face[473]={x:.62,y:.44,z:.020};face[152]={x:.51,y:.66,z:.01};
  const view={w:850,h:560};
  const rig=faceRig(face,null,contain(1280,720,view.w,view.h),view,false,null);
  assert.equal(rig.kind,'face');assert.ok(rig.scale.x>1);
});

test('two-view sizing needs both views and reports uncertainty',()=>{
  const scan=new TwoViewScan(1720);
  assert.equal(scan.result(),null);
  scan.front=Array.from({length:8},()=>({chest:385,waist:320,hip:388,shoulder:395}));
  scan.side=Array.from({length:8},()=>({chest:230,waist:212,hip:249}));
  scan.view='complete';
  const r=scan.result();
  assert.equal(r.method,'camera');
  assert.ok(r.measures.chest.value>940&&r.measures.chest.uncertainty>=52);
  assert.equal(r.measures.sleeve,undefined);
});

test('covered fitting forms use continuous mesh and wardrobe geometry is finite',async()=>{
  const body=parseBody(await readFile(new URL('../public/models/female.form.gz',import.meta.url)));
  const avatar=makeAvatar(body,form('f36').measure);
  assert.ok(avatar.model.geometry.getAttribute('position').count>10000);
  for(const item of catalog){
    const size=startingSize(item);avatar.cover(item,size);
    const g=makeWear(item,size,0,avatar.spec.shoulderY-avatar.spec.hipY);
    const arms=avatar.pose.arms.map(ar=>ar.map(p=>p.clone().setY(p.y-avatar.spec.shoulderY)));
    g.update(arms,[],.047,{wind:4});
    g.group.traverse(m=>{if(m.geometry)assert.ok(m.geometry.attributes.position.array.every(Number.isFinite),item.id);});
    g.dispose();
  }
  avatar.dispose();
});
