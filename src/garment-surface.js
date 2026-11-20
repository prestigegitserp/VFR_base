import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import { clamp } from './catalog.js';

function attribute(count, size) {
  return new BufferAttribute(new Float32Array(count * size), size).setUsage(DynamicDrawUsage);
}

/**
 * Reconstruct a welded, curved display mesh from the simulation mesh. Edges are shared
 * across panels, including the torso-to-sleeve seams. Cut edges have explicit fabric thickness.
 */
export class GarmentSurface {
  constructor(cage, thickness) {
    const size=cage.attributes.position.count, index=cage.index.array;
    const edges=[], lookup=new Map(), triangles=[];
    const midpoint=(a,b)=>{
      const k=Math.min(a,b)*size+Math.max(a,b);
      const found=lookup.get(k);
      if(found!=null){edges[found].uses++;return size+found;}
      const e=edges.length;
      edges.push({a,b,uses:1});
      lookup.set(k,e);
      return size+e;
    };
    for(let k=0;k<index.length;k+=3){
      const a=index[k],b=index[k+1],c=index[k+2];
      const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
      triangles.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca);
    }
    const surfaceCount=size+edges.length;
    const lip=new Map(), lipIndex=[];
    const underside=a=>{
      if(!lip.has(a))lip.set(a,surfaceCount+lip.size);
      return lip.get(a);
    };
    for(let i=0;i<edges.length;i++){
      const e=edges[i];
      if(e.uses!==1)continue;
      const a=e.a,b=e.b,m=size+i,lowA=underside(a),lowM=underside(m),lowB=underside(b);
      lipIndex.push(m,a,lowA, m,lowA,lowM, b,m,lowM, b,lowM,lowB);
    }
    const geometry=new BufferGeometry();
    const total=surfaceCount+lip.size;
    geometry.setAttribute('position',attribute(total,3));
    geometry.setAttribute('normal',attribute(total,3));
    geometry.setAttribute('color',attribute(total,3));
    const srcUv=cage.attributes.uv;
    if(srcUv){
      const uv=attribute(total,2);
      uv.array.set(srcUv.array);
      edges.forEach(({a,b},i)=>{
        const start=srcUv.getX(a),end=srcUv.getX(b);
        const delta=end-start;
        const s=Math.abs(delta)>.70 ? (start+(delta-Math.sign(delta))*.5+1)%1 : (start+end)*.5;
        uv.setXY(size+i,s,(srcUv.getY(a)+srcUv.getY(b))*.5);
      });
      for(const [from,to] of lip)uv.setXY(to,uv.getX(from),uv.getY(from));
      geometry.setAttribute('uv',uv);
    }
    geometry.setIndex(triangles.concat(lipIndex));
    geometry.addGroup(0,triangles.length,0);
    geometry.addGroup(triangles.length,lipIndex.length,1);
    this.geometry=geometry;
    this.size=size;
    this.edges=edges;
    this.lip=lip;
    this.cage=cage;
    this.thickness=thickness;
    this.triangles=geometry.index.count/3;
    this.surfaceTriangles=triangles.length/3;
  }

  colors() {
    const source=this.cage.attributes.color.array;
    const target=this.geometry.attributes.color;
    target.array.set(source);
    this.edges.forEach(({a,b},i)=>{
      const at=(this.size+i)*3;
      for(let k=0;k<3;k++)target.array[at+k]=(source[a*3+k]+source[b*3+k])*.5;
    });
    for(const [from,to] of this.lip) {
      const i=from*3,j=to*3;
      for(let k=0;k<3;k++)target.array[j+k]=target.array[i+k]*.90;
    }
    target.needsUpdate=true;
  }

  update() {
    const {size,edges,lip,cage,geometry,thickness}=this;
    const pos=geometry.attributes.position, normals=geometry.attributes.normal;
    const original=cage.attributes.position.array, n=cage.attributes.normal.array;
    const out=pos.array, outNormals=normals.array;
    out.set(original);outNormals.set(n);
    // Project the edge midpoint onto endpoint tangent planes and limit the curvature displacement.
    for(let i=0;i<edges.length;i++){
      const e=edges[i],a=e.a*3,b=e.b*3,at=(i+size)*3;
      const dx=(original[b]-original[a])*.5,dy=(original[b+1]-original[a+1])*.5,dz=(original[b+2]-original[a+2])*.5;
      const dot=clamp(n[a]*n[b]+n[a+1]*n[b+1]+n[a+2]*n[b+2],0,1);
      const blend=(e.uses===1?.31:.57)*dot;
      const first=clamp(dx*n[a]+dy*n[a+1]+dz*n[a+2],-.005,.005)*blend;
      const second=clamp(dx*n[b]+dy*n[b+1]+dz*n[b+2],-.005,.005)*blend;
      for(let k=0;k<3;k++){
        out[at+k]=(original[a+k]+original[b+k])*.5+(n[b+k]*second-n[a+k]*first)*.5;
        outNormals[at+k]=(n[a+k]+n[b+k])*.5;
      }
    }
    for(const [from,to] of lip) {
      const a=from*3,b=to*3;
      for(let k=0;k<3;k++)out[b+k]=out[a+k]-thickness*outNormals[a+k];
    }
    pos.needsUpdate=true;
    geometry.computeVertexNormals();
  }
}
