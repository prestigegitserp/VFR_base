import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { projection, referencePoints, solveHead } from '../src/camera-fit.js';
import { solveBody } from '../src/body-volume.js';
import { makeLiveShell } from '../src/live-shell.js';
import { subjectMask } from '../src/subject-mask.js';
import { FittedStage } from '../src/fitted-stage.js';
import { catalog, startingSize } from '../src/catalog.js';
import { contain } from '../src/tracking.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const view = {w:1200,h:660};
const rect = contain(1280,720,view.w,view.h);
const camera = projection(rect,view,63);

function faceFixture(yaw = .44, pitch = -.26, position = V(.028,.11,-.62)) {
  const points = referencePoints();
  const q = new T.Quaternion().setFromEuler(new T.Euler(pitch,yaw,.13,'YXZ'));
  const eye = points[33].clone().lerp(points[133],.5).distanceTo(points[263].clone().lerp(points[362],.5));
  const pose = points.map(p=>p.applyQuaternion(q).add(position));
  const face=pose.map(p=>({...camera.image(p),z:(position.z-p.z)*camera.focal/rect.w/-position.z}));
  for(let i=0;i<10;i++)face.push({x:.44+i*.01,y:.34,z:0});
  return {face,pose,eye:eye*1000,q,position};
}

test('perspective face fit recovers a turned head and ignores iris gaze',()=>{
  const data=faceFixture();
  data.face[61].x+=.014;
  const fitted=solveHead(data.face,camera,data.eye);
  assert.ok(fitted);
  assert.ok(Math.abs(fitted.yaw-.44)<.07,JSON.stringify({yaw:fitted.yaw,reprojection:fitted.reprojection}));
  assert.ok(fitted.reprojection<4.9);
  const onImage=camera.screen(fitted.bridge), nose=camera.pixel(data.face[168]);
  assert.ok(Math.hypot(onImage.x-nose.x,onImage.y-nose.y)<7);
  assert.ok(fitted.temples.every(p=>p.clone().sub(fitted.bridge).dot(fitted.forward)<-.055));
  const lookingAside=data.face.map((p,i)=>i>=468?{...p,x:p.x+.37,y:p.y-.11}:p);
  const second=solveHead(lookingAside,camera,data.eye);
  assert.ok(second.origin.distanceTo(fitted.origin)<1e-8);
});

function seatedFixture(){
  const pose=Array.from({length:33},()=>({x:.5,y:.65,z:0,visibility:0}));
  for(const [i,x,y,z] of [[0,.508,.49,-.17],[11,.30,.68,.02],[12,.70,.635,-.044],[13,.28,.85,-.025],
    [14,.74,.817,-.12],[15,.38,.972,-.11],[16,.59,.802,-.245],[19,.40,.971,-.116],[20,.54,.78,-.249]]){
    pose[i]={x,y,z,visibility:.97};
  }
  const mask={w:160,h:90,data:new Uint8Array(160*90)};
  for(let y=49;y<90;y++){
    const radius=Math.min(39,11+Math.floor((y-49)*3.0));
    mask.data.fill(4,y*160+81-radius,y*160+81+radius);
  }
  for(let y=22;y<59;y++)mask.data.fill(3,y*160+70,y*160+93);
  const head=faceFixture(.20,-.25,V(.037,.027,-.60));
  return {pose,mask,face:head.face,head:solveHead(head.face,camera,head.eye)};
}

test('seated near-camera fit measures shoulders and keeps neckline behind a forward head',()=>{
  const fixture=seatedFixture();
  const rig=solveBody(fixture,'upper',camera,fixture.head);
  assert.ok(rig?.volume && rig.hip===null);
  assert.ok(rig.head && rig.head.depth < rig.depth);
  assert.ok(rig.volume.topCount>=1);
  assert.ok(rig.volume.neck.joint.distanceTo(rig.volume.neck.center)<rig.volume.width*.47);
  const joint=camera.pixel(fixture.pose[16]), fitted=camera.screen(rig.arms[1][2]);
  assert.ok(Math.hypot(joint.x-fitted.x,joint.y-fitted.y)<.01);
  const local=p=>p.clone().sub(rig.origin).applyQuaternion(rig.q.clone().invert());
  assert.ok(Math.abs(rig.volume.neck.center.x)<.039);
  assert.ok(rig.volume.neck.center.z<local(rig.head.bridge).z);
  assert.ok(rig.hands.some(x=>x.front>.35));
});

test('the garment sockets share edges with the sleeves and the cuffs follow a bent arm',()=>{
  const f=seatedFixture(), rig=solveBody(f,'upper',camera,f.head);
  const item=catalog.find(x=>x.id==='orion'), shell=makeLiveShell(item,startingSize(item),0);
  const local=p=>p.clone().sub(rig.origin).applyQuaternion(rig.q.clone().invert());
  shell.update(rig.volume,rig.arms.map(a=>a.map(local)),0,1/30,false,rig.origin);
  const geometry=shell.shell.geometry, pos=geometry.attributes.position;
  assert.ok(pos.array.every(Number.isFinite));
  const touches=new Map(), arr=geometry.index.array;
  const key=(a,b)=>a<b?a+':'+b:b+':'+a;
  for(let i=0;i<arr.length;i+=3){
    for(const [a,b] of [[arr[i],arr[i+1]],[arr[i+1],arr[i+2]],[arr[i+2],arr[i]]]){
      const edge=key(a,b);touches.set(edge,(touches.get(edge)??0)+1);
    }
  }
  for(const [i,hole] of shell.holes.entries()){
    const vs=hole.vertices;
    for(let k=0;k<vs.length;k++){
      assert.equal(touches.get(key(vs[k].at,vs[(k+1)%vs.length].at)),2);
    }
    const cuff=V();
    for(let k=0;k<vs.length;k++)cuff.add(V().fromBufferAttribute(pos,hole.offset+20*vs.length+k));
    cuff.divideScalar(vs.length);
    assert.ok(cuff.distanceTo(local(rig.arms[i][2]))<.051);
  }
  shell.dispose();
});

test('segmentation drops an isolated person in the background',()=>{
  const fixture=seatedFixture();
  const {mask}=fixture;
  for(let y=26;y<81;y++)mask.data.fill(4,y*mask.w+142,y*mask.w+155);
  const refined=subjectMask(mask,fixture.pose,fixture.face);
  assert.equal(refined.data[60*mask.w+148],0);
  assert.equal(refined.data[82*mask.w+80],4);
  assert.equal(refined.data[31*mask.w+82],3);
});

test('the face writes depth in front of the far-side eyewear arm',()=>{
  const fixture=faceFixture(.73,-.18,V(.010,.13,-.68));
  const head=solveHead(fixture.face,camera,fixture.eye);
  const item=catalog.find(x=>x.id==='linea');
  const scene=new T.Scene(), stage=new FittedStage(scene);
  stage.prepare(item,startingSize(item),1);
  stage.update({rig:head,mirror:false,adjustment:{x:0,y:0,width:0,length:0,depth:0},orbit:null,
    width:view.w,height:view.h,time:0,dt:1/30,breeze:false});
  scene.updateMatrixWorld(true);
  assert.equal(stage.head.material.colorWrite,false);
  const arms=stage.product.group.children.filter(o=>o.name==='Temple arm');
  const blocked=arms.map(arm=>[.32,.45,.56,.65,.74,.85].filter(t=>{
    const pt=arm.localToWorld(arm.geometry.parameters.path.getPoint(t));
    const cast=new T.Raycaster(V(),pt.clone().normalize());
    const hit=cast.intersectObject(stage.head)[0];
    return hit&&hit.distance<pt.length()-.001;
  }).length);
  assert.ok(Math.max(...blocked)>=2 && Math.min(...blocked)<Math.max(...blocked),JSON.stringify(blocked));
  stage.clear();
});
