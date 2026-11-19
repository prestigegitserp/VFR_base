import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bodyModel, makeAvatar } from './avatar.js';
import { clamp } from './catalog.js';
import { dispose, makeWear } from './wear.js';
import { WORLD_HEIGHT } from './tracking.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const up=V(0,1,0);
function light(scene,color,intensity,position,shadow=false){
  const l=new T.DirectionalLight(color,intensity);
  l.position.set(...position);
  l.castShadow=shadow;
  if(shadow){
    l.shadow.mapSize.set(1024,1024);
    Object.assign(l.shadow.camera,{left:-1.5,right:1.5,top:2.5,bottom:-1.9,near:.05,far:7});
    l.shadow.normalBias=.005;
    l.shadow.bias=-.00013;
    l.shadow.radius=6;
  }
  scene.add(l);
  return l;
}
async function importWear(item,size,bytes) {
  const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const center=V(...size.anchors.leftShoulder).lerp(V(...size.anchors.rightShoulder),.5);
  const delta=V(...size.anchors.rightShoulder).sub(V(...size.anchors.leftShoulder)).normalize();
  const rig=new T.Quaternion().setFromUnitVectors(delta,V(1,0,0));
  const container=new T.Group();
  model.scene.quaternion.premultiply(rig);
  model.scene.position.sub(center.applyQuaternion(rig));
  container.add(model.scene);
  container.name=item.english;
  model.scene.traverse((o)=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});
  const box=new T.Box3().setFromObject(container);
  const extent=box.getSize(V());
  if(!extent.toArray().every(Number.isFinite)||extent.x<.12||extent.x>2.25||extent.y<.12||extent.y>2.25||
    Math.max(Math.abs(box.min.x),Math.abs(box.max.x), Math.abs(box.min.z),Math.abs(box.max.z))>1.2||
    box.max.y>.28 || box.min.y>-.15) {
    dispose(container);throw new Error('ابعاد مدل نسبت به نقاط مرجع در مقیاس متر سازگار نیست.');
  }
  return {group:container,update(){},reset(){},dispose(){
    const textures=new Set();
    container.traverse((o)=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean))for(const value of Object.values(m))if(value?.isTexture)textures.add(value);});
    dispose(container);textures.forEach((t)=>t.dispose());
  }};
}

export class Atelier {
  constructor(canvas, restored) {
    const r = new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    r.setClearColor('#27221d',0);
    r.outputColorSpace=T.SRGBColorSpace;
    r.toneMapping=T.ACESFilmicToneMapping;
    r.toneMappingExposure=1.06;
    r.shadowMap.enabled=true;
    r.shadowMap.type=T.PCFShadowMap;
    this.r=r;
    this.canvas=canvas;
    this.scene=new T.Scene();
    this.camera=new T.OrthographicCamera(-1,1,1,-1,.02,22);
    this.root=new T.Group();
    this.ar=new T.Group();
    this.dressed=new T.Group();
    this.scene.add(this.root,this.ar);
    this.root.add(this.dressed);
    this.key=light(this.scene,'#ffe4c8',3.10,[-2.1,3.2,2.7],true);
    light(this.scene,'#c1d2ee',.82,[2.8,2.1,2.8]);
    light(this.scene,'#ffb78e',1.58,[1.15,2.05,-1.89]);
    light(this.scene,'#dad3e0',.64,[-1.54,1.7,-2.2]);
    this.scene.add(new T.HemisphereLight('#e8d8c4','#4a4139',1.05));
    const env=new RoomEnvironment(), pmrem=new T.PMREMGenerator(r);
    this.scene.environment=pmrem.fromScene(env,.040).texture;
    this.scene.environmentIntensity=.37;
    env.dispose();pmrem.dispose();
    this.floor=new T.Mesh(new T.PlaneGeometry(99,99),new T.ShadowMaterial({opacity:.31}));
    this.floor.rotation.x=-Math.PI/2;
    this.floor.position.y=-.031;
    this.floor.receiveShadow=true;
    this.scene.add(this.floor);
    this.plinth=new T.Mesh(new T.CylinderGeometry(.57,.61,.07,96),new T.MeshStandardMaterial({color:'#6f5e50',roughness:.66,metalness:.08}));
    this.plinth.position.y=-.043;
    this.plinth.receiveShadow=true;
    this.scene.add(this.plinth);
    this.state={mode:'full',width:1,height:1,source:'studio'};
    this.frameId=0;
    this.assetId=0;
    this.play=0;
    this.clock=0;
    this.velocity=V();
    this.lastOrigin=V();
    this.lastAngle=0;
    this.fresh=true;
    this.mode='full';
    canvas.addEventListener('webglcontextlost',(event)=>{event.preventDefault();this.lost=true;restored(false);});
    canvas.addEventListener('webglcontextrestored',()=>{this.lost=false;this.fresh=true;restored(true);});
  }
  resize(width,height,high){
    this.width=width;this.height=height;
    this.r.setPixelRatio(Math.min(devicePixelRatio||1,high?2:1.4));
    this.r.setSize(width,height,false);
  }
  async body(spec) {
    const tag=++this.frameId;
    const data=await bodyModel(spec.shape);
    if(tag!==this.frameId)return;
    if(this.avatar){this.root.remove(this.avatar.model);this.avatar.dispose();}
    this.avatar=makeAvatar(data,spec.measure);
    this.root.add(this.avatar.model);
    this.reference={ shoulder:spec.measure.shoulder, torso:this.avatar.spec.shoulderY-this.avatar.spec.hipY };
    this.fresh=true;
  }
  clearGarment(){
    this.pendingGarment=false;
    if(!this.wear)return;
    this.wear.group.parent?.remove(this.wear.group);
    this.wear.dispose();
    this.wear=null;
  }
  async garment(item,size,color,bytes) {
    const tag=++this.assetId;
    this.pendingGarment=true;
    const p=bytes?await importWear(item,size,bytes):makeWear(item,size,color,this.reference?.torso??.45);
    if(tag!==this.assetId){p.dispose();return false;}
    this.clearGarment();
    this.wear=p;
    this.item=item;
    this.attachment=item.frame;
    this.avatar?.cover(item,size);
    this.fresh=true;
    return true;
  }
  setSource(source) {
    if(this.source===source)return;
    this.source=source;
    this.fresh=true;
    this.wear?.reset();
  }
  update({dt,time,mode,rig,move,wind,turn,zoom,lightValue,reduce}){
    if(this.lost)return;
    const demo=this.source==='studio';
    this.plinth.visible=this.floor.visible=demo&&mode==='full';
    this.r.shadowMap.enabled=demo;
    this.key.castShadow=demo;
    this.root.visible=demo;
    this.ar.visible=!demo&&Boolean(rig);
    this.r.toneMappingExposure=demo?1.06:clamp(.9+lightValue*.37,.88,1.17);
    const avatar=this.avatar;
    const center=demo && avatar ? mode==='face'?avatar.spec.face.y-.021:mode==='upper'?avatar.spec.shoulderY-.102:avatar.spec.height*.49 : 0;
    const extent=demo&&avatar?(mode==='face'?.355:mode==='upper'?.94:avatar.spec.height*1.115)/zoom:WORLD_HEIGHT;
    const half=extent*.5,horizontal=half*this.width/this.height;
    Object.assign(this.camera,{left:-horizontal,right:horizontal,top:half,bottom:-half});
    this.camera.position.set(0,center+(demo&&mode==='full'?.072:0),5);
    this.camera.lookAt(0,center,0);this.camera.updateProjectionMatrix();
    const wear=this.wear;
    if(!wear||!avatar){this.fresh=true;return;}
    const root=demo?this.dressed:this.ar;
    if(wear.group.parent!==root)root.add(wear.group);
    wear.group.visible=(mode==='face')===(this.attachment==='face');
    if(demo) {
      const rootAngle=mode==='face'?turn + (move?.23*Math.sin(this.play*.95):0):turn-.095+(move?.29*Math.sin(this.play*1.25):0);
      if(move)this.play+=dt;
      this.root.rotation.y=rootAngle;
      this.root.position.x=mode==='full'&&move? .041*Math.sin(this.play*1.19):0;
      root.rotation.set(0,0,0);root.scale.set(1,1,1);
      root.position.copy(this.attachment==='face'?avatar.spec.face:V(0,avatar.spec.shoulderY,0));
      const changed=this.fresh||move&&time-this.clock>29;
      const pose=changed?avatar.update(this.play,move):avatar.pose;
      if(changed)this.clock=time;
      const loc=([a,b,c])=>[a,b,c].map(q=>q.clone().sub(root.position));
      const legs=pose.legs.map(loc).flatMap(([a,b,c])=>[{a,b,radius:.073},{a:b,b:c,radius:.052}]);
      if (wear.group.visible) wear.update(pose.arms.map(loc),legs,dt,{
        x:move?2.5*Math.sin(this.play*3.1):0,z:0,y:0,turn:move?2.0*Math.cos(this.play*1.25):0,wind:wind?7.4:move&&!reduce?1.0:0,
      });
      this.fresh=false;
    } else if(rig) {
      const blend=this.fresh?1:1-Math.exp(-dt*23);
      root.position.lerp(rig.origin,blend);
      root.quaternion.slerp(rig.q,blend);
      root.scale.lerp(rig.scale,blend);
      root.updateMatrixWorld(true);
      const inverse=root.matrixWorld.clone().invert();
      const toLocal=(p)=>p.clone().applyMatrix4(inverse);
      if(rig.arms){
        if(this.fresh)this.lastOrigin.copy(root.position);
        const vel=root.position.clone().sub(this.lastOrigin).divideScalar(dt);
        const acc=vel.clone().sub(this.velocity).divideScalar(dt).clampScalar(-14,14);
        this.velocity.lerp(vel,.27);
        this.lastOrigin.copy(root.position);
        const angle=V(0,0,1).applyQuaternion(root.quaternion).x;
        const twist=this.fresh?0:clamp((angle-this.lastAngle)/dt,-7,7);
        this.lastAngle=angle;
        wear.update(rig.arms.map((a)=>a.map(toLocal)),rig.leg.flatMap((l)=>{
          const [a,b,c]=l.map(toLocal);return [{a,b,radius:.069},{a:b,b:c,radius:.051}];
        }),dt,{x:acc.x,z:acc.z,y:acc.y,turn:twist,wind:wind?7.4:0});
      }
      this.fresh=false;
    } else {
      this.fresh=true;
    }
  }
  draw(split=0){
    if(this.lost)return false;
    this.r.setScissorTest(false);
    this.r.render(this.scene,this.camera);
    const obj=this.wear?.group;
    if(split&&obj?.visible){
      this.r.setScissor(0,0,this.width*split,this.height);
      this.r.setScissorTest(true);obj.visible=false;
      this.r.render(this.scene,this.camera);
      obj.visible=true;
      this.r.setScissorTest(false);
    }
    return true;
  }
  point(p){
    const n=p.clone().project(this.camera);
    return [(n.x+1)*this.width/2,(1-n.y)*this.height/2];
  }
}
