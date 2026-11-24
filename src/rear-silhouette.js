import { clamp } from './catalog.js';

function mainRun(mask, y) {
  const {w,data}=mask;
  let first=0,length=0,best=null;
  for(let x=0;x<=w;x++){
    if(x<w&&data[y*w+x]!==0){if(!length)first=x;length++;continue;}
    if(length>(best?.width??0))best={left:first,width:length};
    length=0;
  }
  if(!best)return null;
  let face=0,garment=0,head=0;
  for(let x=best.left,end=x+best.width;x<end;x++){
    const label=data[y*w+x];
    face+=label===3;garment+=label===4;head+=label===1||label===2||label===5;
  }
  return {...best,center:best.left+best.width*.5,y,face,garment,head};
}

export function rearShoulders(mask) {
  if(!mask||mask.w<45||mask.h<45)return null;
  const {w,h}=mask;
  const rows=Array.from({length:h},(_,i)=>mainRun(mask,i));
  const top=rows.findIndex((row,i)=>row?.width>w*.066&&rows[Math.min(h-1,i+3)]?.width>w*.066);
  if(top<2||top>h*.48)return null;
  const probe=rows.slice(top+Math.round(h*.032),top+Math.round(h*.106)).filter(Boolean);
  if(probe.length<h*.041)return null;
  const ranked=probe.slice().sort((a,b)=>a.width-b.width);
  const head=ranked[Math.floor(ranked.length*.56)];
  if(head.width>w*.50||head.width<w*.083)return null;
  const faces=probe.reduce((sum,row)=>sum+row.face,0), semantics=probe.reduce((sum,row)=>sum+row.head,0);
  const headArea=probe.reduce((sum,row)=>sum+row.width,0);
  // A viable fallback needs a head through multiple rows and a separate, wider clothing region.
  if(faces>headArea*.055||semantics<headArea*.47)return null;
  const from=top+Math.round(h*.128),until=Math.min(h-12,top+Math.round(h*.39));
  const candidates=[];
  for(let i=from;i<=until;i++){
    const row=rows[i], prior=rows[Math.max(0,i-Math.round(h*.038))];
    const ahead=rows[Math.min(h-1,i+Math.round(h*.047))];
    if(!row||!prior||!ahead||row.garment<row.width*.77||ahead.garment<ahead.width*.74)continue;
    const ratio=row.width/head.width;
    if(ratio<1.74||ratio>3.21||prior.width>row.width*.91||ahead.width<row.width*.88)continue;
    if(Math.abs(row.center-head.center)>head.width*.61||row.left<3||row.left+row.width>w-3)continue;
    candidates.push(row);
  }
  if(candidates.length<3)return null;
  const row=candidates[Math.floor(candidates.length*.69)];
  const width=clamp(row.width*.85,head.width*1.65,w*.76);
  return [(row.center+width*.5)/w,(row.center-width*.5)/w].map(x=>({x,y:row.y/h,z:0,visibility:.55}));
}
