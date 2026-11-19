import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalog, form, startingSize } from '../src/catalog.js';
import { checkSize, chooseSize, manualProfile, TwoViewScan } from '../src/sizing.js';
import { readBodyScan, readGlb, unpackPackage } from '../src/protocol.js';
import { lineFor, makeOrder } from '../src/order.js';
import { bodyRig, contain, faceRig, Temporal } from '../src/tracking.js';
import { buildFitMatte } from '../src/composite.js';
import { drapePoint, solveDrape } from '../src/fit.js';
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
  assert.ok(readGlb(files[item.sizes[0].model]).nodes.some(node=>node.extras?.studioOnly===true));
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

function torsoFixture(){
  const pose=Array.from({length:33},()=>({x:.50,y:.60,z:0,visibility:0}));
  const place=(i,x,y,z=0)=>{pose[i]={x,y,z,visibility:.96};};
  place(9,.53,.365);place(10,.555,.373);
  place(11,.315,.524,.05);place(12,.682,.478,-.05);
  place(13,.27,.73,.02);place(14,.684,.68,-.14);
  place(16,.562,.61,-.245);place(20,.515,.58,-.25);
  const mask={w:160,h:96,data:new Uint8Array(160*96)};
  for(let y=30;y<96;y++){
    const bounds=y<48?[77,97]:[56+(y>71?10:0),114+(y>71?6:0)];
    mask.data.fill(y<53?2:4,y*mask.w+bounds[0],y*mask.w+bounds[1]);
  }
  return {pose,mask};
}

test('seated and tilted upper-body captures keep real shoulder and sleeve anchors',()=>{
  const input=torsoFixture();
  const view={w:1200,h:650},rect=contain(1280,720,view.w,view.h);
  const reference={shoulder:424,torso:.46,sleeve:603};
  const rig=bodyRig(input,'upper',rect,view,false,reference);
  assert.ok(rig);
  assert.equal(rig.hip,null);
  assert.ok(rig.collar.y>rig.origin.y && rig.collar.x>rig.origin.x);
  assert.ok(rig.yaw>.10);
  assert.ok(rig.sections.chest.reliability>.75 && rig.sections.chest.center.x>rig.origin.x);
  assert.ok(rig.arms[1][2].x<rig.arms[1][1].x && rig.arms[1][2].y>rig.arms[1][1].y);
  assert.ok(rig.occluders[0].front>.9);
  const mirrored=bodyRig(input,'upper',rect,view,true,reference);
  assert.ok(Math.abs(rig.collar.x+mirrored.collar.x)<1e-7);
  assert.ok(Math.abs(rig.yaw+mirrored.yaw)<1e-7);
  const size=startingSize(jacket), wear=makeWear(jacket,size,0,reference.torso);
  const toLocal=p=>p.clone().sub(rig.origin).applyQuaternion(rig.q.clone().invert()).divide(rig.scale);
  const fit=solveDrape(wear.fit,rig,toLocal);
  const y=-reference.torso*.30;
  const [shift]=drapePoint(0,y,0,fit);
  assert.ok(shift>.004);
  wear.update(rig.arms.map(chain=>chain.map(toLocal)),[],1/30,{},fit);
  wear.setPresentation(false);
  const collar=wear.group.children.find(child=>child.name==='Knit underlayer');
  assert.equal(collar.visible,false);
  const cuffs=wear.group.children.filter(child=>child.name==='Sleeve cuff');
  const position=cuffs[1].geometry.attributes.position;
  const wrist=toLocal(rig.arms[1][2]);
  const endCenter=wrist.clone().set(0,0,0);
  for(let i=185;i<221;i++)endCenter.add(wrist.clone().fromBufferAttribute(position,i));
  endCenter.divideScalar(36);
  assert.ok(endCenter.distanceTo(wrist)<.045);
  wear.dispose();
});

test('semantic matte preserves skin in the collar and keeps garment edges near the wearer',()=>{
  const mask={w:100,h:100,data:new Uint8Array(10000)};
  const at=(x,y)=>y*mask.w+x;
  for(let y=27;y<100;y++)mask.data.fill(4,at(31,y),at(70,y));
  mask.data[at(50,41)]=2;
  mask.data[at(50,32)]=3;
  mask.data[at(58,61)]=2;
  mask.data[at(56,35)]=1;
  const rig={kind:'body',screenCollar:{x:.5,y:.40},screenSpan:.33,screenSlope:0,imageRatio:1,
    occluders:[{elbow:{x:.7,y:.65},wrist:{x:.58,y:.62},hand:{x:.57,y:.60},radius:.05,front:1}]};
  const settings={coverage:'balanced',occlusion:true,cut:'jacket',tailored:true};
  const matte=buildFitMatte(mask,rig,settings);
  assert.equal(matte[at(16,63)],0);
  assert.ok(matte[at(29,63)]>65 && matte[at(29,63)]<255);
  assert.ok(matte[at(50,41)]<18);
  assert.equal(matte[at(50,32)],0);
  assert.ok(matte[at(58,61)]<18);
  assert.ok(matte[at(56,35)]<18);
  assert.equal(matte[at(45,55)],255);
  const raw=buildFitMatte(mask,rig,{...settings,coverage:'off',occlusion:false});
  assert.ok(raw.every(a=>a===255));
  const eyewear=buildFitMatte(mask,{kind:'face',imageRatio:1},settings);
  assert.equal(eyewear[at(50,32)],255);
  assert.ok(eyewear[at(56,35)]<30);
});

test('confidence smoothing rejects failed joints and reacquires a different position promptly',()=>{
  const {pose}=torsoFixture();
  const filter=new Temporal();
  filter.update(pose,100);
  const newer=pose.map(p=>({...p,x:p.x+.018}));
  newer[16]={...newer[16],x:.04,visibility:.10};
  const steady=filter.update(newer,117);
  assert.ok(steady[11].x>pose[11].x&&steady[11].x<newer[11].x);
  assert.equal(steady[16].x,pose[16].x);
  assert.equal(steady[16].visibility,.10);
  const moved=pose.map(p=>({...p,x:p.x+.28}));
  assert.equal(filter.update(moved,155)[11].x,moved[11].x);
});
