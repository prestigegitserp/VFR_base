import * as T from 'three';
import { clamp, fabrics } from './catalog.js';
import { Cloth } from './cloth.js';

const tau = Math.PI * 2;
const V = (x=0,y=0,z=0) => new T.Vector3(x,y,z);
const mix = (a,b,t) => a+(b-a)*t;
const textureCache = new Map();

function textile(name) {
  if (typeof document === 'undefined') return null;
  if (textureCache.has(name)) return textureCache.get(name);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(192,192);
  let seed = 127977;
  const style = fabrics[name].thread;
  for (let y=0;y<192;y++) for (let x=0;x<192;x++) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    const noise = (seed / 4294967296 - .5) * (style==='grain' ? 76 : 31);
    const weave = style==='rib' ? 38 * Math.cos(x*tau/12) + 8*Math.sin(y*tau/3) :
      style==='diagonal' ? 25 * Math.cos((x+y)*tau/7) + 7*Math.cos(x*tau/3) :
        style==='fine' ? 15*Math.cos(x*tau/5) + 9*Math.cos(y*tau/3) : 9*Math.cos((x+y)*tau/7);
    const i = (y*192+x)*4;
    image.data.set([128+weave+noise,128+weave+noise,128+weave+noise,255], i);
  }
  ctx.putImageData(image,0,0);
  const t = new T.CanvasTexture(canvas);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(style==='rib'? 7 : 13, 10);
  t.anisotropy = 8;
  textureCache.set(name,t);
  return t;
}

function materials(style, color) {
  const description = fabrics[style];
  const dye = new T.Color(color);
  const main = new T.MeshPhysicalMaterial({
    color: dye, side: T.DoubleSide, roughness: description.roughness,
    sheen: description.sheen, sheenRoughness: .65, sheenColor: dye.clone().lerp(new T.Color('#efe2cf'), .45),
    bumpMap: textile(style), bumpScale: description.thickness * 1.55, specularIntensity: style==='satin'? .78 : .45,
  });
  const lapel = main.clone(); lapel.color.multiplyScalar(.84);
  const lining = main.clone(); lining.color.multiplyScalar(.69);
  const edge = new T.MeshStandardMaterial({color:dye.clone().lerp(new T.Color('#c4a282'),.17),roughness:.62});
  const dark = new T.MeshStandardMaterial({color:'#322923',roughness:.42,metalness:.1});
  const metal = new T.MeshStandardMaterial({color:'#9b7551',roughness:.26,metalness:.78});
  return { main, lapel, lining, edge, dark, metal };
}

function mesh(group, g, m, name) {
  const o = new T.Mesh(g,m);
  o.name = name;
  o.castShadow = o.receiveShadow = true;
  group.add(o);
  return o;
}
function grid(cols, rows, fn, closed = true) {
  const pos = new Float32Array((cols+1)*(rows+1)*3);
  const uv = new Float32Array((cols+1)*(rows+1)*2);
  const idx = [];
  for (let i=0;i<=rows;i++) for (let j=0;j<=cols;j++) {
    const k = i*(cols+1)+j;
    const s = j/cols, t = i/rows;
    pos.set(fn(s*(closed?tau:1),t),3*k);
    uv.set([s,1-t],2*k);
    if(i<rows && j<cols) idx.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(pos,3));
  g.setAttribute('uv',new T.BufferAttribute(uv,2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const tube = (group, material, points, width, label, closed=false) =>
  mesh(group,new T.TubeGeometry(new T.CatmullRomCurve3(points,closed), Math.max(9, points.length*3), width, 7, closed),material,label);

function panel(group, material, coords, indices, label) {
  const g = new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(coords.flat(),3));
  g.setAttribute('uv',new T.Float32BufferAttribute(coords.flatMap(([x,y])=>[x+.5,1+y]),2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return mesh(group,g,material,label);
}
function ringRadius(mm, ratio) {
  const c = (mm || 960)*.001/(Math.PI*(3*(1+ratio)-Math.sqrt((3+ratio)*(1+3*ratio))));
  return [c,c*ratio];
}
function disc(group, material, p, radius) {
  const m=mesh(group,new T.CylinderGeometry(radius,radius,.0036,22),material,'Horn button');
  m.position.copy(p);m.rotation.x=Math.PI/2;
}

export function makeWear(item, size, color, torso=.45) {
  if(item.cut==='glasses') return glasses(item,size,color);
  const r=size.garment, kind=item.cut, description=fabrics[item.fabric];
  const dress=kind==='dress', skirt=kind==='skirt', coat=kind==='coat', knit=kind==='knit';
  const zipped=item.id==='orion';
  const tailored=(kind==='jacket'&&!zipped)||coat;
  const sleeves=coat||kind==='jacket'||knit;
  const m=materials(item.fabric,item.colors[color]?.value??item.colors[0].value);
  const group = new T.Group();
  group.name=item.english;
  const shoulder=(r.shoulder??388)*.0005;
  const fullLength=r.length*.001;
  const bottom = dress||coat ? -torso-.002 : -fullLength;
  const waistY=-torso * .69;
  const c=ringRadius(r.chest,.62), w=ringRadius(r.waist,.64), h=ringRadius(r.hip,.69);
  const centerZ=.031;
  const ringAt = [
    [0,shoulder,.074], [.14,c[0]*1.04,c[1]*.94], [.29,c[0],c[1]], [.64,w[0],w[1]],
    [.88,mix(w[0],h[0],.70),mix(w[1],h[1],.78)], [1,h[0],h[1]],
  ];
  function bodyAt(a,t,offset=0) {
    const k=Math.max(1,ringAt.findIndex(([j])=>t<=j+.000001));
    const [t0,x0,z0]=ringAt[k-1], [t1,x1,z1]=ringAt[k];
    const u=clamp((t-t0)/(t1-t0),0,1);
    const b=u*u*(3-2*u);
    const sa=Math.sin(a),ca=Math.cos(a), front=Math.max(0,ca);
    const fold=(Math.sin(a*(dress?6:13)+t*(dress?12:19))*.0042+Math.cos(a*21+t*14)*.0013)
      *Math.sin(t*Math.PI)*(.6+description.softness*.8);
    const y0=dress? -.095 - .043*front + .014*sa*sa : .040 - front**6*(tailored?.105:knit?.035:.023);
    return [sa*(mix(x0,x1,b)+fold+offset-(dress&&t<.15?.033*(1-t/.15):0)),
      y0*(1-t)+bottom*t,
      ca*(mix(z0,z1,b)+fold*.53+offset) + centerZ + .005*Math.sin(2*t*Math.PI)];
  }
  const at=(a,t,o=.003)=>V(...bodyAt(a,t,o));
  const track=(a,b,u,v,n=18)=>Array.from({length:n},(_,i)=>{const t=i/(n-1);return at(mix(a,b,t),mix(u,v,t));});
  const circle = (fn,n=64)=>Array.from({length:n},(_,i)=>fn(i*tau/n));
  if (!skirt) {
    mesh(group,grid(100,46,bodyAt),m.main,'Shaped fabric panels');
    if (dress) {
      tube(group,m.lapel,circle(a=>at(a,.005)),.0027,'Rolled binding',true);
      for (const s of [-1,1]) tube(group,m.main,[at(s*.75,.015),V(s*shoulder*.79,-.012,.067),
        V(s*shoulder*.81,.017,.018),V(s*shoulder*.77,-.015,-.068),at(s*2.61,.007)],.0068,'Bias strap');
      for(let i=0;i<4;i++) tube(group,m.lapel,track(-1.57+i*.063,.74,.13+i*.075,.31+i*.085),.0022,'Draped dart');
    } else {
      const cap = (a,t) => {
        const [x,y,z]=bodyAt(a,0);
        const front=Math.max(0,Math.cos(a));
        const neckX=(knit?.089:.083)*Math.sin(a), neckZ=(knit?.074:.086)*Math.cos(a)+centerZ*.76;
        const neckY=(zipped?.050:.049)-front**5*(tailored?.116:knit?.047:.041);
        return [mix(x,neckX,t),mix(y,neckY,t)+.013*Math.sin(t*Math.PI)*Math.abs(Math.sin(a)),mix(z,neckZ,t)];
      };
      mesh(group,grid(72,13,cap),m.main,'Shoulder and collar opening');
      tube(group,m.lapel,circle(a=>V(...cap(a,1))),zipped?.009:knit?.006:.003,'Collar binding',true);
    }
    for(const a of [-1.57,1.57,Math.PI]) tube(group,m.lapel,track(a-.04,a,.19,.993),.0018,'Seam topstitch');
  }
  if(tailored) {
    const v=.037+centerZ;
    const insert=[[-.087,.041,v+.021],[0,.030,v+.056],[.087,.041,v+.021],
      [.054,-.094,v+.085],[0,-.137,v+.080],[-.054,-.094,v+.085]];
    panel(group,m.dark,insert,[0,1,5,1,4,5,1,2,3,1,3,4],'Underlayer at neckline');
    for(const s of [-1,1]) {
      const scale=shoulder/.214;
      const neck = [[.068,.014,.079],[.139,-.059,.111],[.093,-.127,.138],[.106,-.104,.144],
        [.029,-.211,.146],[.014,-.206,.138]].map(([x,y,z])=>[x*s*scale,y,z*(c[1]/.121)+centerZ]);
      panel(group,m.lapel,neck,[0,1,3,1,2,3,0,3,5,3,4,5],'Notched lapel');
      tube(group,m.edge,neck.slice(0,5).map(([x,y,z])=>V(x,y,z+.0009)),.00135,'Lapel pick stitch');
      tube(group,m.lapel,track(s*.56,s*1.21,.81,.75),.0085,'Welt pocket');
      tube(group,m.edge,track(s*.56,s*1.21,.835,.78),.00125,'Pocket stitch');
    }
    tube(group,m.lining,track(-.025,-.022,.35,1),.005,'Overlapping front');
    for(const t of [.51,.66,.81]) {
      disc(group,m.dark,at(-.22,t,.005),.010);
      if(coat) disc(group,m.dark,at(.23,t,.005),.010);
    }
    if(coat) {
      const belt=(a,t)=>[Math.sin(a)*(w[0]+.009),waistY+.018-t*.040,Math.cos(a)*(w[1]+.012)+centerZ+.004];
      mesh(group,grid(76,6,belt),m.lapel,'Topstitched belt');
      tube(group,m.edge,circle(a=>V(...belt(a,.86))),.0013,'Belt stitch',true);
      tube(group,m.metal,[V(-.037,waistY+.020,w[1]+centerZ+.019),V(.033,waistY+.020,w[1]+centerZ+.019),
        V(.033,waistY-.023,w[1]+centerZ+.019),V(-.037,waistY-.023,w[1]+centerZ+.019)],.0034,'Aged brass buckle',true);
    }
  }
  if(zipped) {
    tube(group,m.dark,track(0,0,0,.99),.005,'Zipper tape');
    const teeth=new T.InstancedMesh(new T.BoxGeometry(.007,.0034,.0025),m.metal,104);
    const mat=new T.Matrix4();
    for(let i=0;i<teeth.count;i++){const p=at(0,.008+i/105,.010);mat.makeTranslation(i%2?.001:-.001,p.y,p.z);teeth.setMatrixAt(i,mat);}
    teeth.name='Metal zipper';group.add(teeth);
    disc(group,m.metal,at(0,.036,.012),.009);
    for(const s of [-1,1]) tube(group,m.lapel,track(s*.77,s*1.18,.75,.54),.005,'Slanted pockets');
  }
  if(!dress&&!coat&&!skirt) tube(group,m.lapel,circle(a=>at(a,.977,.004)), knit||zipped?.009:.003,'Hem binding',true);

  let skirtMesh, sim;
  if(dress||coat||skirt) {
    const rise=skirt?waistY:bottom;
    const len=skirt?fullLength:Math.max(.21,fullLength+rise);
    const start=skirt?w:h;
    const count=skirt?20:coat?9:8, columns=skirt?100:76, rows=18;
    const pleat=skirt?.019:coat?.009:.017;
    const flare=len*(skirt?.24:dress?.20:.15);
    const shape=(a,t)=>{
      const p=Math.pow(t,.83), wave=Math.cos(a*count+.5*t)*.77+Math.sin(a*count*2)*.23;
      const fold=pleat*wave*(.03+.97*p);
      return [Math.sin(a)*(start[0]+p*flare+fold),rise-t*len+.012*t**2*Math.cos(3*a),
        Math.cos(a)*(start[1]+p*flare*.76+fold*.7)+centerZ+.008*t*Math.sin(a*2)];
    };
    const rest = new Float32Array(columns*(rows+1)*3);
    for(let row=0;row<=rows;row++) for(let col=0;col<columns;col++) rest.set(shape(col*tau/columns,row/rows),(row*columns+col)*3);
    skirtMesh=mesh(group,grid(columns,rows,shape),m.main,'Moving skirt panels');
    skirtMesh.frustumCulled=false;
    sim=new Cloth(columns,rows+1,rest,description.softness);
    if(skirt) {
      mesh(group,grid(72,7,(a,t)=>[Math.sin(a)*(w[0]+.004),rise+.006-t*.033,Math.cos(a)*(w[1]+.004)+centerZ]),m.lapel,'Stable waistband');
      tube(group,m.edge,circle(a=>V(Math.sin(a)*(w[0]+.005),rise-.021,Math.cos(a)*(w[1]+.004))),.0012,'Waist topstitch',true);
    }
  }
  const armParts=[];
  if(sleeves) for(const side of [-1,1]){
    const shell=mesh(group,grid(36,30,()=>[0,0,0]),m.main,'Fitted sleeve');
    const cuff=mesh(group,grid(36,5,()=>[0,0,0]),m.lapel,'Sleeve cuff');
    shell.frustumCulled=cuff.frustumCulled=false;
    armParts.push({side,shell,cuff});
  }
  function shapeArm(part, joint, high, low, rows, s, edge) {
    const [sh,el,wr]=joint;
    const start=V(s*shoulder*.84, sh.y+.043, sh.z+.013);
    const end=wr.clone();
    const expected=Math.max(.40,(r.sleeve??590)*.001), arm=sh.distanceTo(el)+el.distanceTo(wr);
    end.addScaledVector(wr.clone().sub(el).normalize(), clamp(expected-arm,-.095,.086));
    const spline=new T.CatmullRomCurve3([start, sh.clone().lerp(el,.36),el,end]);
    const attr=part.geometry.attributes.position;
    for(let j=0;j<=rows;j++){
      const t=mix(low,high,j/rows);
      const pos=spline.getPoint(t), tangent=spline.getTangent(t);
      pos.z+=.011*Math.sin(Math.PI*t);
      const side=tangent.clone().cross(V(0,0,1)).normalize();
      const front=side.clone().cross(tangent).normalize();
      const crown=.54+.46*Math.sin(Math.PI/2*clamp(t/.20,0,1));
      const radius=(.078+(coat?.009:knit?.005:.008))*(1-.48*t)*crown +.005*Math.sin(Math.PI*t);
      for(let i=0;i<=36;i++){
        const a=i*tau/36, ripple=.0034*Math.sin(a*6+t*28)*Math.sin(Math.PI*t)**2 + .0012*Math.sin(a*17-t*46);
        const r=radius+ripple+(edge?.001+.0014*Math.cos(a*18):0);
        const p=pos.clone().addScaledVector(side,Math.sin(a)*r).addScaledVector(front,Math.cos(a)*r*.88);
        attr.setXYZ(j*37+i,p.x,p.y,p.z);
      }
    }
    attr.needsUpdate=true;
    part.geometry.computeVertexNormals();
  }
  function update(arms,legs,dt,drive) {
    armParts.forEach(({side,shell,cuff},i)=>{
      shapeArm(shell,arms[i],1,0,30,side,false);
      shapeArm(cuff,arms[i],1,.924,5,side,true);
    });
    if (sim?.advance(dt,drive,legs)){
      const { pos, columns:n, rows:count }=sim;
      const a=skirtMesh.geometry.attributes.position;
      for(let i=0;i<count;i++){
        a.array.set(pos.subarray(i*n*3,(i+1)*n*3),i*(n+1)*3);
        a.array.set(pos.subarray(i*n*3,i*n*3+3),(i*(n+1)+n)*3);
      }
      a.needsUpdate=true;skirtMesh.geometry.computeVertexNormals();
    }
  }
  return { group, update, reset(){sim?.reset();}, dispose:()=>dispose(group,new Set(Object.values(m))) };
}

function glasses(item,size,color) {
  const group=new T.Group();
  group.name=item.english;
  const paint=new T.MeshPhysicalMaterial({color:item.colors[color]?.value,roughness:.22,metalness:item.id==='arc'?.65:.16,clearcoat:.84});
  const metal=new T.MeshStandardMaterial({color:'#9c8569',metalness:.88,roughness:.31});
  const lens=new T.MeshPhysicalMaterial({color:'#d3e0e5',roughness:.21,transparent:true,opacity:.16,metalness:.11,side:T.DoubleSide,depthWrite:false});
  const separation=size.garment.eye*.0005, round=item.id==='arc';
  const sizeX=(size.garment.width*.0005-separation)*.83;
  const outline=(a,s)=>V(s*separation+Math.sin(a)*(round?sizeX*.88:sizeX)*(1+.09*Math.cos(a)),
    Math.cos(a)*(round?.022:.018)*(.91+.09*Math.cos(2*a)), .013+.005*Math.cos(a)-.004*Math.sin(a)*s);
  for(const s of [-1,1]){
    const rim=Array.from({length:40},(_,i)=>outline(i*tau/40,s));
    tube(group,paint,rim,round?.0023:.0033,'Optical frame',true);
    panel(group,lens,[[s*separation,0,.016],...rim.map(p=>p.toArray())],
      rim.flatMap((_,i)=>[0,i+1,(i+1)%rim.length+1]),'Lens');
    tube(group,metal,[V(s*(separation+sizeX*.92),.004,.016),V(s*(separation+sizeX*1.04),.006,-.016),
      V(s*(separation+sizeX*1.11),.008,-.074),V(s*(separation+sizeX*.96),.001,-.104)],.0024,'Temple');
  }
  const bridge=size.garment.bridge*.0005;
  tube(group,paint,[V(-bridge,.002,.015),V(0,.011,.020),V(bridge,.002,.015)],.0028,'Bridge');
  if(round) tube(group,metal,[V(-bridge*.96,.014,.017),V(0,.020,.020),V(bridge*.96,.014,.017)],.0018,'Double bridge');
  return {group,update(){},reset(){},dispose:()=>dispose(group,new Set([paint,metal,lens]))};
}

export function dispose(group, materials = new Set()) {
  group.traverse((object)=>{
    object.geometry?.dispose();
    if(object.material && !Array.isArray(object.material)) materials.add(object.material);
    else object.material?.forEach((m)=>materials.add(m));
    if(object.isInstancedMesh)object.dispose();
  });
  materials.forEach((m)=>m.dispose());
}
