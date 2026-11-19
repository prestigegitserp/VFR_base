import * as T from 'three';
import { clamp } from './catalog.js';

export const WORLD_HEIGHT=1.98;
export const joint={ nose:0, sl:11,sr:12,el:13,er:14,wl:15,wr:16, il:19,ir:20,hl:23,hr:24,kl:25,kr:26,al:27,ar:28 };
const V = (x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const mid=(a,b)=>a.clone().lerp(b,.5);
const pointOkay=(p)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
export const confident=(p,min=.48)=>pointOkay(p)&&(p.visibility??1)>=min;

export function contain(width,height,w,h) {
  const scale=Math.min(w/width,h/height);
  const x=width*scale,y=height*scale;
  return {x:(w-x)/2,y:(h-y)/2,w:x,h:y};
}

export class Temporal {
  constructor(){this.value=null;this.when=0;this.velocity=[];}
  update(next,time){
    if(!next)return null;
    if(!this.value||time-this.when>450){
      this.value=next.map(p=>({...p}));this.velocity=next.map(()=>V());this.when=time;return this.value;
    }
    const dt=clamp((time-this.when)/1000,.004,.21);
    const df=1-Math.exp(-dt*19);
    this.value=next.map((p,i)=>{
      const a=this.value[i], speed=this.velocity[i];
      const v=V(p.x-a.x,p.y-a.y,(p.z-a.z)*.66).divideScalar(dt);
      speed.lerp(v,df);
      const alpha=clamp(1-Math.exp(-dt*(11+speed.length()*19)),.22,.93);
      return {x:a.x+(p.x-a.x)*alpha,y:a.y+(p.y-a.y)*alpha,z:a.z+(p.z-a.z)*alpha*.73,visibility:p.visibility};
    });
    this.when=time;
    return this.value;
  }
  clear(){this.value=null;}
}

function unproject(points, rect, view, mirror, zCenter) {
  const scale=WORLD_HEIGHT/view.h;
  return points.map((p)=>V((rect.x+rect.w*(mirror?1-p.x:p.x)-view.w/2)*scale,
    (view.h/2-rect.y-rect.h*p.y)*scale,clamp((zCenter-p.z)*rect.w*scale*.81,-.85,.85)));
}

function basis(x,up){
  const z=V().crossVectors(x,up).normalize();
  if(z.z<0)z.negate();
  const xx=V().crossVectors(up,z).normalize();
  const yy=V().crossVectors(z,xx).normalize();
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(xx,yy,z));
}

export function faceRig(points,matrix,rect,view,mirror,body) {
  if(!points||![points[33],points[263],points[152]].every(pointOkay))return null;
  const normalLeft=pointOkay(points[468])?points[468]:points[33];
  const normalRight=pointOkay(points[473])?points[473]:points[263];
  const gaze=unproject([normalLeft,normalRight,points[152],points[168]??points[6]],rect,view,mirror,(normalLeft.z+normalRight.z)/2);
  const left=gaze[0].x<gaze[1].x?gaze[0]:gaze[1],right=gaze[0].x<gaze[1].x?gaze[1]:gaze[0];
  const center=mid(left,right), span=right.clone().sub(left).length();
  if(span<.031||span>.91||Math.abs(normalLeft.x-normalRight.x)<.055)return null;
  const x=right.clone().sub(left);
  x.z=clamp(x.z,-span*.69,span*.69);
  const y=center.clone().sub(gaze[2]);
  y.z=clamp(y.z,-y.length()*.33,y.length()*.33);
  if(matrix?.length===16 && matrix.every(Number.isFinite)){
    const correction=clamp(-matrix[6]*(mirror?-1:1),-.42,.42)*span;
    x.z=.7*x.z+.3*correction;
  }
  const q=basis(x.normalize(),y.normalize());
  center.y+=span*.010;
  center.z=.012;
  const scale=span/((body?.measures?.eye?.value??63)*.001);
  return {origin:center,q,scale:V(scale,scale,scale),eyes:[left,right],kind:'face'};
}

function shoulderFallback(face,mask) {
  if(!face?.[152]||!mask)return null;
  const chin=face[152],head=face[10], x=chin.x;
  const y=chin.y+(chin.y-head.y)*.25;
  if(y>.88)return null;
  const {data,w,h}=mask,row=Math.round(y*(h-1))*w;
  const center=Math.round(clamp(x,0,1)*(w-1));
  let left=center,right=center;
  while(left>1&&data[row+left-1]!==0)left--;
  while(right<w-2&&data[row+right+1]!==0)right++;
  if(right-left<w*.19||right-left>w*.88||center-left<(right-left)*.22||right-center<(right-left)*.22)return null;
  const make=(a,b,z)=>({x:a,y:b,z,visibility:.92});
  const points=Array.from({length:33},()=>make(x,chin.y,0));
  points[0]=face[1];points[11]=make((left+(right-left)*.13)/w,y,0);points[12]=make((right-(right-left)*.13)/w,y,0);
  for(const i of [13,14,15,16,19,20,23,24,25,26,27,28])points[i].visibility=0;
  return points;
}

export function bodyRig({pose,face,mask},mode,rect,view,mirror,reference,profile) {
  if(!rect)return null;
  let detected=pose, fallback=false;
  const shoulders=(p)=>p&&[joint.sl,joint.sr].every((i)=>confident(p[i],.50));
  if(!shoulders(detected)){
    if(mode!=='upper')return null;
    detected=shoulderFallback(face,mask);fallback=!!detected;
  }
  if(!detected||!shoulders(detected))return null;
  const j=joint, ls=detected[j.sl],rs=detected[j.sr];
  if(Math.abs(ls.x-rs.x)<.043)return null;
  const P=unproject(detected,rect,view,mirror,(ls.z+rs.z)/2);
  const reverse=P[j.sl].x>P[j.sr].x;
  const map=reverse?[[j.sr,j.er,j.wr,j.ir,j.hr,j.kr,j.ar],[j.sl,j.el,j.wl,j.il,j.hl,j.kl,j.al]]
    : [[j.sl,j.el,j.wl,j.il,j.hl,j.kl,j.al],[j.sr,j.er,j.wr,j.ir,j.hr,j.kr,j.ar]];
  const shoulder=map.map(([s])=>P[s]), origin=mid(...shoulder), direction=shoulder[1].clone().sub(shoulder[0]);
  const span=direction.length();
  if(!Number.isFinite(span)||span<.10)return null;
  const nominalShoulders=(profile?.measures?.shoulder?.value??reference.shoulder)*.001;
  const nominalTorso=reference.torso;
  const hips=map.map((side)=>P[side[4]]);
  const visibleHips=map.every((s)=>confident(detected[s[4]],.53)&&detected[s[4]].y<.984)
    && origin.y-mid(...hips).y>span*.57;
  const realY=visibleHips?origin.y-mid(...hips).y : span*nominalTorso/nominalShoulders;
  if(mode==='full'&&!visibleHips)return null;
  const axis=visibleHips?origin.clone().sub(mid(...hips)):V(0,1,0);
  axis.z=clamp(axis.z,-realY*.27,realY*.27);
  direction.z=clamp(direction.z,-span*.68,span*.68);
  const q=basis(direction.normalize(),axis.normalize());
  const calibrated=clamp(span/nominalShoulders,.34,3.8);
  const sy=clamp(realY/nominalTorso,calibrated*.56,calibrated*1.61);
  const scale=V(calibrated,sy,(calibrated*.68+sy*.32));
  origin.z=0;
  const arms=map.map(([s,e,w],i)=>{
    const side=i===0?-1:1;
    const elbow=confident(detected[e],.43)&&detected[e].y<1.15?P[e]:P[s].clone().add(V(side*span*.11,-span*.65,.01));
    const end=confident(detected[w],.43)&&detected[w].y<1.16?P[w]:elbow.clone().add(V(0,-span*.62,.014));
    return [P[s],elbow,end];
  });
  const leg=map.flatMap((idx)=>idx.slice(4).every(k=>confident(detected[k],.52))?[idx.slice(4).map(k=>P[k])]:[]);
  const occluders=map.flatMap(([s,e,w,h])=>[e,w].every(k=>confident(detected[k],.62))&&P[w].z>span*.17
    ? [{elbow:detected[e],wrist:detected[w],hand:confident(detected[h],.55)?detected[h]:detected[w],radius:Math.abs(ls.x-rs.x)*.118}] : []);
  return {origin,q,scale,arms,leg,occluders,kind:fallback?'estimate':'body',full:leg.length===2,shoulder,hip:visibleHips?hips:null};
}
