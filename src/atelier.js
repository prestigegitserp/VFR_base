import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bodyModel, makeAvatar } from './avatar.js';
import { clamp } from './catalog.js';
import { dispose, makeWear } from './wear.js';
import { FittedStage } from './fitted-stage.js';
import { prepareImportedFit } from './imported-fit.js';
import { BodyMesh } from './body-mesh.js';
import { shapeSections } from './body-shape.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
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
  const left=V(...size.anchors.leftShoulder), right=V(...size.anchors.rightShoulder);
  const center=left.clone().lerp(right,.5), span=left.distanceTo(right);
  const side=right.clone().sub(left).normalize(), torso=center.clone().sub(V(...size.anchors.hip));
  const front=V().crossVectors(side,torso).normalize();
  const vertical=V().crossVectors(front,side).normalize();
  const rig=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side,vertical,front)).invert();
  const container=new T.Group();
  model.scene.quaternion.premultiply(rig);
  model.scene.position.sub(center.applyQuaternion(rig));
  container.add(model.scene);
  container.name=item.english;
  const studioParts=[];
  model.scene.traverse(o=>{
    if(o.isMesh)o.castShadow=o.receiveShadow=true;
    if(o.userData.studioOnly===true)studioParts.push(o);
  });
  const box=new T.Box3().setFromObject(container);
  const extent=box.getSize(V());
  if(!extent.toArray().every(Number.isFinite)||extent.x<.12||extent.x>2.25||extent.y<.12||extent.y>2.25||
    Math.max(Math.abs(box.min.x),Math.abs(box.max.x), Math.abs(box.min.z),Math.abs(box.max.z))>1.2||
    box.max.y>.28 || box.min.y>-.15) {
    dispose(container);throw new Error('ابعاد مدل نسبت به نقاط مرجع در مقیاس متر سازگار نیست.');
  }
  const anchors={span,torso:torso.dot(vertical)};
  const fitted=prepareImportedFit(container,studioParts,anchors);
  return {group:container,anchors,fittedGroup:fitted?.group,update(){},reset(){this.surfaceStats=null;},
    fitSurface:fitted&&function (...args){this.surfaceStats=fitted.fit(...args);},
    setPresentation(studio){for(const piece of studioParts)piece.visible=studio;},dispose(){
    fitted?.dispose();
    const textures=new Set();
    container.traverse((o)=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean))for(const value of Object.values(m))if(value?.isTexture)textures.add(value);});
    dispose(container);textures.forEach((t)=>t.dispose());
  }};
}

function mannequinVolume(avatar, measures, pose, origin) {
  const local=chain=>chain.map(p=>p.clone().sub(origin));
  const order=chains=>chains.map(local).sort((a,b)=>a[0].x-b[0].x);
  const arms=order(pose.arms), legs=order(pose.legs);
  const width=measures.shoulder*.001, length=avatar.spec.shoulderY-avatar.spec.hipY;
  const profile={method:'manual',measures:Object.fromEntries(Object.entries(measures).map(([key,value])=>[key,{value}]))};
  const rings=shapeSections(width,profile).rings.map(r=>({...r,
    center:V(0,-length*r.t,-.017*r.t),front:1.11,back:.89}));
  const crowns=arms.map(([p])=>p.clone().add(V(0,.032,0)));
  const center=V(0,.045,-.009);
  const neck={center,rx:width*.147,rz:width*.131,joint:center.clone().add(V(0,.072,-.003))};
  return { arms, volume:{width,length,crowns,rings,neck,leg:legs,mode:'full',height:measures.height*.001} };
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
    this.studioCamera=new T.OrthographicCamera(-1,1,1,-1,.02,22);
    this.camera=this.studioCamera;
    this.root=new T.Group();
    this.dressed=new T.Group();
    this.scene.add(this.root);
    this.fitted=new FittedStage(this.scene);
    this.root.add(this.dressed);
    this.key=light(this.scene,'#ffe4c8',3.10,[-2.1,3.2,2.7],true);
    this.rim=[light(this.scene,'#ffb78e',1.58,[1.15,2.05,-1.89]),light(this.scene,'#dad3e0',.64,[-1.54,1.7,-2.2])];
    light(this.scene,'#e3e9fa',.88,[2.8,2.1,2.8]);
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
    const signature=JSON.stringify([spec.shape,spec.measure]);
    if(signature===this.bodySignature)return;
    const data=await bodyModel(spec.shape);
    if(tag!==this.frameId)return;
    if(this.avatar){this.root.remove(this.avatar.model);this.avatar.dispose();}
    this.avatar=makeAvatar(data,spec.measure);
    this.bodyMeasures=spec.measure;
    this.bodySignature=signature;
    this.root.add(this.avatar.model);
    this.reference={ shoulder:spec.measure.shoulder, sleeve:spec.measure.sleeve, torso:this.avatar.spec.shoulderY-this.avatar.spec.hipY };
    this.fresh=true;
  }
  clearGarment(){
    this.pendingGarment=false;
    const shared=this.wear===this.fitted.product;
    this.fitted.clear();
    if(this.wear&&!shared){
      this.wear.group.removeFromParent();this.wear.fittedGroup?.removeFromParent();
      this.wear.dispose();
    }
    this.wear=null;this.studioFit=null;
  }
  async garment(item,size,color,bytes) {
    const tag=++this.assetId;
    this.pendingGarment=true;
    const p=bytes?await importWear(item,size,bytes):item.frame==='face'?makeWear(item,size,color,this.reference?.torso??.45):null;
    if(tag!==this.assetId){p?.dispose();return false;}
    this.clearGarment();
    this.fitted.prepare(item,size,color);
    this.wear=p??this.fitted.product;
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
    this.fitted.reset();
  }
  update({dt,time,mode,rig,move,wind,turn,zoom,lightValue,reduce,adjustment,mirror=false,orbit=null,orbitMode='fit',quick=false,diagnose=false}){
    if(this.lost)return;
    const demo=this.source==='studio';
    this.plinth.visible=this.floor.visible=demo&&mode==='full';
    this.r.shadowMap.enabled=demo;
    this.key.castShadow=demo;
    this.root.visible=demo;
    this.mirror=!demo&&mirror;
    this.r.toneMappingExposure=demo||orbit!==null?1.06:clamp(.81+lightValue*.44,.82,1.18);
    this.key.intensity=demo?3.10:2.17;
    this.rim[0].intensity=demo?1.58:.51;
    this.rim[1].intensity=demo?.64:.29;
    const wear=this.wear;
    if(!demo){
      const compatible=wear&&(mode==='face')===(this.attachment==='face');
      if(wear)wear.setPresentation?.(false);
      this.activeGarment=compatible?(this.fitted.product?.group??wear.fittedGroup??wear.group):null;
      this.camera=this.fitted.update({rig:compatible?rig:null,mirror,adjustment,orbit,width:this.width,
        height:this.height,time,dt,breeze:wind,scanned:wear,orbitMode,quick,diagnose});
      return;
    }
    this.fitted.group.visible=false;
    this.activeGarment=wear?.group;
    const avatar=this.avatar;
    const center=avatar ? mode==='face'?avatar.spec.face.y-.021:mode==='upper'?avatar.spec.shoulderY-.102:avatar.spec.height*.49 : 0;
    const extent=(avatar?(mode==='face'?.355:mode==='upper'?.94:avatar.spec.height*1.115):1.98)/zoom;
    const half=extent*.5,horizontal=half*this.width/this.height;
    const camera=this.studioCamera;
    this.camera=camera;
    Object.assign(camera,{left:-horizontal,right:horizontal,top:half,bottom:-half});
    camera.position.set(0,center+(mode==='full'?.072:0),5);
    camera.lookAt(0,center,0);camera.updateProjectionMatrix();
    if(!wear||!avatar){this.fresh=true;return;}
    const root=this.dressed;
    if(wear.group.parent!==root)root.add(wear.group);
    wear.setPresentation?.(true);
    wear.group.visible=(mode==='face')===(this.attachment==='face');
    const rootAngle=turn;
    if(move)this.play+=dt;
    this.root.rotation.y=rootAngle;
    this.root.position.x=mode==='full'&&move? .041*Math.sin(this.play*1.19):0;
    root.position.copy(this.attachment==='face'?avatar.spec.face:V(0,avatar.spec.shoulderY,0));
    const updatePose=this.fresh||move&&time-this.clock>61;
    const elapsed=this.clock?clamp((time-this.clock)*.001,dt,.049):dt;
    const pose=updatePose?avatar.update(this.play,move):avatar.pose;
    if(wear.group.visible&&this.fitted.product===wear) {
      if(updatePose||!this.studioFit){
        this.studioCollider??=new BodyMesh(true);
        this.studioFit=mannequinVolume(avatar,this.bodyMeasures,pose,root.position);
        this.studioCollider.update(this.studioFit.volume,this.studioFit.arms,[]);
      }
      if(updatePose||wind&&time-this.clock>63||!wear.stats()){
        wear.view('fit');
        wear.update(this.studioFit.volume,this.studioFit.arms,time,elapsed,wind,root.position,
          {skin:this.studioCollider,collider:this.studioCollider.collider,quick:true,diagnose});
        this.clock=time;
      }
    }else if(updatePose)this.clock=time;
    this.fresh=false;
  }
  draw(split=0){
    if(this.lost)return false;
    this.r.setScissorTest(false);
    this.r.render(this.scene,this.camera);
    const obj=this.activeGarment;
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
    const point=p.clone();
    if(this.mirror)point.x*=-1;
    const n=point.project(this.camera);
    return [(n.x+1)*this.width/2,(1-n.y)*this.height/2];
  }
}
