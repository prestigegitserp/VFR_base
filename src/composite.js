const canvas=()=>document.createElement('canvas');
const stencil=canvas(), layer=canvas();
const context=stencil.getContext('2d'), temp=layer.getContext('2d');
export function drawMedia(ctx, source, rect, mirror) {
  if(!source||!rect)return;
  ctx.save();
  if(mirror){ctx.translate(rect.x*2+rect.w,0);ctx.scale(-1,1);}
  ctx.drawImage(source,rect.x,rect.y,rect.w,rect.h);
  ctx.restore();
}

const distanceTo=(x,y,a,b,ratio)=>{
  const ax=a.x*ratio, ay=a.y, bx=b.x*ratio, by=b.y;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=Math.max(0,Math.min(1,den?((x-ax)*dx +(y-ay)*dy)/den:0));
  return Math.hypot(x-(ax+t*dx),y-(ay+t*dy));
};

function stencilFor(mask, rig, sleeve, mode, ratio){
  if(stencil.width!==mask.w||stencil.height!==mask.h){stencil.width=mask.w;stencil.height=mask.h;}
  const buf=context.createImageData(mask.w,mask.h);
  const {w,h,data}=mask;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,c=data[p];
    if(c===1){buf.data[p*4+3]=255;continue;}
    if(c!==2||mode==='face'||!rig.occluders?.length)continue;
    for(const hand of rig.occluders) {
      const threshold=hand.radius*ratio;
      const fore=sleeve?0:255*Math.max(0,Math.min(1,1.55-distanceTo(x*ratio/w,y/h,hand.elbow,hand.wrist,ratio)/threshold*1.16));
      const fingers=255*Math.max(0,Math.min(1,1.64-distanceTo(x*ratio/w,y/h,hand.wrist,hand.hand,ratio)/threshold*1.2));
      buf.data[p*4+3]=Math.max(fore,fingers);
    }
  }
  context.putImageData(buf,0,0);
}

export function layerFrame(ctx, studio, data) {
  const {source,rect,mirror,mask,rig,debug,sleeve,mode}=data;
  const {width,height}=studio;
  const dpr=Math.min(devicePixelRatio||1,1.5);
  const w=Math.round(width*dpr),h=Math.round(height*dpr);
  if(ctx.canvas.width!==w||ctx.canvas.height!==h){ctx.canvas.width=w;ctx.canvas.height=h;}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  if(!rig)return;
  if(mask&&source&&rect){
    stencilFor(mask,rig,sleeve,mode,rect.w/rect.h);
    if(layer.width!==w||layer.height!==h){layer.width=w;layer.height=h;}
    temp.setTransform(dpr,0,0,dpr,0,0);
    temp.globalCompositeOperation='source-over';temp.clearRect(0,0,width,height);
    drawMedia(temp,source,rect,mirror);
    temp.globalCompositeOperation='destination-in';
    drawMedia(temp,stencil,rect,mirror);
    temp.globalCompositeOperation='source-over';
    ctx.drawImage(layer,0,0,width,height);
  }
  if(debug){
    ctx.save();
    ctx.strokeStyle='#f2b985';ctx.fillStyle='#ffce95';ctx.lineWidth=1.4;
    const chains=rig.arms?[...rig.arms,...rig.leg,rig.shoulder,...(rig.hip?[rig.hip]:[])]:[rig.eyes];
    for(const chain of chains){
      const a=chain.map(p=>studio.point(p));
      ctx.beginPath();ctx.moveTo(...a[0]);a.slice(1).forEach(p=>ctx.lineTo(...p));ctx.stroke();
      for(const [x,y] of a){ctx.beginPath();ctx.arc(x,y,2.8,0,2*Math.PI);ctx.fill();}
    }
    ctx.restore();
  }
}
