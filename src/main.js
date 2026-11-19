import './style.css';
import { asset, catalog, cm, compatible, fabrics, fitModes, form, forms, metrics, show, startingSize } from './catalog.js';
import { Atelier } from './atelier.js';
import { Vision } from './vision.js';
import { bodyRig, contain, faceRig, Temporal } from './tracking.js';
import { drawMedia, layerFrame } from './composite.js';
import { checkSize, chooseSize, manualProfile, TwoViewScan } from './sizing.js';
import { listPackages, readBodyScan, storePackage, unpackPackage } from './protocol.js';
import { lineFor, makeOrder } from './order.js';
import { fillIcons, icon } from './icons.js';

const $=(id)=>document.getElementById(id);
const $$=(sel)=>[...document.querySelectorAll(sel)];
const el=(tag,content,cls)=>{
  const n=document.createElement(tag);
  if(content!=null)n.textContent=content;
  if(cls)n.className=cls;
  return n;
};
const stage=$('stage'), video=$('video'), img=$('photo'), canvas=$('render'), ctx=$('foreground').getContext('2d');
const storage='vfr-atelier:v2:';
const get=(key)=>{try{return JSON.parse(localStorage.getItem(storage+key));}catch{return null;}};
const put=(key,value)=>{
  try{ if(value==null)localStorage.removeItem(storage+key);else localStorage.setItem(storage+key,JSON.stringify(value)); }
  catch{/* Preview and imports can run without local preferences. */}
};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={
  source:'studio',mode:'full',item:catalog[0],size:startingSize(catalog[0]),color:0,formId:catalog[0].form,formPinned:false,
  body:get('profile'),preference:get('preference')??'regular',cart:get('cart')??[],filter:'all',records:new Map(),
  move:!reduce,wind:false,turn:0,zoom:1,high:false,mirror:true,occlusion:true,debug:false,split:0,splitAt:50,apply:false,
  busy:false,ready:false,tracked:null,mask:null,stamp:0,delegate:'',lastInfer:0,light:.50,scan:null,
};
const vision=new Vision(), smoothPose=new Temporal(), smoothFace=new Temporal();
const urls=new Map();
let studio, stream, photoURL, frame=0, operation=0, display=0, pending=false, resultTime=0, lastFrame=-1;
let commands=Promise.resolve(), metricsAt=0, reportCount=0, prev=0, noticeTimer, messageAction, guidanceAction;
let bounds={w:1,h:1}, renderKey=null;
const enqueue=(fn)=>{const p=commands.then(fn);commands=p.catch(()=>{});return p;};
const gpu=()=>!!studio&&!studio.lost;
const semantic=()=>state.occlusion||Boolean(state.scan);
const source=()=>state.source==='live'&&video.readyState>=2?video:state.source==='photo'&&img.complete&&img.naturalWidth?img:null;
const mediaSize=(m)=>[m?.videoWidth??m?.naturalWidth,m?.videoHeight??m?.naturalHeight];
const sourceRect=(media)=>{
  const [w,h]=mediaSize(media);
  return w&&h?contain(w,h,bounds.w,bounds.h):null;
};

fillIcons();
try {
  studio=new Atelier(canvas,(restored)=>{
    stage.dataset.renderer=restored?'webgl':'flat';
    if(!restored)changeSource('studio');
    controls();
  });
} catch(error) {
  console.info('WebGL2',error.message);
  stage.dataset.renderer='flat';
}

function press(node,value){node.setAttribute('aria-pressed',String(Boolean(value)));}
function signal(text,kind=''){
  if($('state-label').textContent!==text)$('state-label').textContent=text;
  $('state-dot').className=kind;
}
function message(title,body,config={}) {
  $('message').hidden=!title;
  if(!title)return;
  $('message-title').textContent=title;$('message-body').textContent=body;
  $('message-icon').innerHTML=icon(config.icon??'scan');
  $('message-action').hidden=!config.click;
  $('message-action').textContent=config.label??'دوباره تلاش کن';
  messageAction=config.click;
}
function guide(text,action=null,label='') {
  $('guidance').hidden=!text;
  if(text&&$('guidance-text').textContent!==text)$('guidance-text').textContent=text;
  $('guidance-action').hidden=!action;
  $('guidance-action').textContent=label;
  guidanceAction=action;
}
$('message-action').addEventListener('click',()=>messageAction?.());
$('guidance-action').addEventListener('click',()=>guidanceAction?.());
function toast(text){
  const box=$('toast');box.hidden=false;box.textContent=text;clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>{box.hidden=true;},4200);
}

const items=()=>[...catalog,...[...state.records.values()].map((r)=>r.item)];
function showList(change=false){
  const host=$('look-list'), old=change?0:host.scrollTop;
  const choices=items().filter((l)=>state.filter==='all'||(state.filter==='scan'?l.source==='scan':l.audience===state.filter));
  const fragment=document.createDocumentFragment();
  for(const item of choices){
    const button=$('look-card').content.firstElementChild.cloneNode(true);
    button.dataset.look=item.id;
    button.title=item.description;
    press(button,state.item.id===item.id);
    button.querySelector('img').src=thumbnail(item);
    button.querySelector('img').loading='lazy';
    button.querySelector('strong').textContent=item.title;
    button.querySelector('small').textContent=item.source==='scan'?item.english:fabrics[item.fabric].name;
    fillIcons(button);
    button.addEventListener('click',()=>select(item));
    fragment.append(button);
  }
  if(!choices.length)fragment.append(el('div','از «ورود اسکن» بستهٔ نمونه یا فایل لباس را باز کن.','empty'));
  host.replaceChildren(fragment);
  host.scrollTop=old;
  $('look-count').textContent=`${show(choices.length)} مدل`;
  $$('button[data-filter]').forEach(x=>press(x,x.dataset.filter===state.filter));
}
function thumbnail(item) {
  if(item.source==='atelier')return asset(`looks/${item.id}.webp`);
  if(urls.has(item.id))return urls.get(item.id);
  return asset('looks/atelier.webp');
}
function poster(){
  const n=$('poster');
  n.src=state.item.id==='terra'&&state.mode==='full'?asset('looks/atelier.webp'):thumbnail(state.item);
  n.alt=`پیش‌نمایش ${state.item.title}`;
}

const verdicts={
  match:['سازگار با اندازه‌های واردشده','بازهٔ آزادی همهٔ اندازه‌های این سایز در محدودهٔ تعریف‌شده است.'],
  estimate:['سازگار در برآورد دوربین','برای سفارش، اندازه‌ها را با متر بررسی کن.'],
  borderline:['تن‌خور مرزی','دست‌کم یک اندازه نزدیک حد بازه است. جدول را باز کن.'],
  incompatible:['این سایز مناسب نیست','یکی از ابعاد از بازهٔ آزادی خارج است.'],
  insufficient:['اندازه‌های بیشتری لازم است','پیشنهاد سایز بعد از تکمیل اندازه‌های موردنیاز نمایش داده می‌شود.'],
};
const measures=()=>checkSize(state.item,state.size,state.body,state.preference);
function fitBadge(){
  const result=measures(), advice=chooseSize(state.item,state.body,state.preference);
  const [title,copy]=verdicts[result.status];
  $('fit-badge').dataset.status=result.status;$('fit-title').textContent=title;
  $('fit-copy').textContent=advice&&['match','estimate','borderline'].includes(advice.status)&&advice.size!==state.size
    ? `سایز قابل بررسی ${advice.size.label} · ${copy}` : copy;
}
function product(){
  const {item,size,color}=state;
  $('item-title').textContent=$('stage-label').textContent=item.title;
  const type=fabrics[item.fabric].name;
  $('item-sub').textContent=`${type} · ${size.sku}`;
  $('stage-caption').textContent=`${type} · ${item.colors[color].label}`;
  $('size-select').replaceChildren(...item.sizes.map(s=>new Option(s.label,s.sku,false,s===size)));
  $('colors').replaceChildren(...item.colors.map((swatch,i)=>{
    const b=el('button');b.type='button';b.style.setProperty('--swatch',swatch.value);
    b.setAttribute('aria-label',swatch.label);b.title=swatch.label;press(b,i===color);
    b.addEventListener('click',()=>{state.color=i;product();updateLook(false);});return b;
  }));
  $$('.look').forEach(b=>press(b,b.dataset.look===item.id));
  poster();fitBadge();
}
function controls(){
  const demo=state.source==='studio', supported=gpu(), hasFrame=demo||Boolean(source());
  $('stage').dataset.source=state.source;
  $('stage').dataset.frame=state.mode;
  $$('button[data-source]').forEach(b=>press(b,b.dataset.source===state.source));
  $$('button[data-frame]').forEach(b=>press(b,b.dataset.frame===state.mode));
  $('motion').disabled=!demo||!supported;$('turn').disabled=!demo||!supported;
  $('wind').disabled=!supported||!['dress','skirt','coat'].includes(state.item.cut)||state.item.source==='scan'||!hasFrame;
  $('compare').disabled=!supported||!hasFrame;
  $('capture').disabled=!hasFrame;
  press($('motion'),state.move);press($('wind'),state.wind&&!$('wind').disabled);press($('compare'),state.split>0&&!$('compare').disabled);
  $('split').hidden=!(state.split&&hasFrame&&supported);
  $('split').style.setProperty('--split',`${state.splitAt}%`);
}
function currentForm(){
  const f=form(state.formId);
  if(!state.apply||!state.body)return f;
  return {...f,measure:Object.fromEntries(Object.entries(f.measure).map(([key,value])=>[key,state.body.measures?.[key]?.value??value]))};
}
async function updateLook(updateForm) {
  const id=++display;
  if(!studio)return;
  try {
    if(updateForm||!studio.avatar)await studio.body(currentForm());
    if(id!==display)return;
    const bytes=state.records.get(state.item.id)?.files[state.size.model];
    const ok=await studio.garment(state.item,state.size,state.color,bytes);
    if(!ok||id!==display)return;
    if(!studio.lost)stage.dataset.renderer='webgl';
    if(state.source==='studio'){
      if(studio.lost)signal('رندر کاتالوگ');
      else{signal('مانکن سه‌بعدی','ready');message();}
    }
  }catch(error){
    if(id!==display)return;
    if(state.source==='studio'){
      stage.dataset.renderer='flat';
      signal('رندر کاتالوگ','pending');
    }
    toast(error.message);
  }
  controls();
}
function select(item,adjust=true){
  state.item=item;state.size=chooseSize(item,state.body,state.preference)?.size??startingSize(item);
  state.color=0;state.wind=false;
  if(!state.formPinned){state.formId=item.form;$('form-select').value=item.form;}
  if(adjust&&!compatible(item,state.mode))changeFrame(item.frame,false);
  product();controls();
  updateLook(true);
}
$('size-select').addEventListener('change',(e)=>{
  state.size=state.item.sizes.find(s=>s.sku===e.currentTarget.value)??state.size;
  product();updateLook(false);
});
$$('button[data-filter]').forEach((b)=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;showList(true);}));

function resetVision() {
  state.ready=false;state.tracked=null;state.mask=null;state.stamp=0;
  state.lastInfer=0;state.delegate='';
  delete stage.dataset.mask;delete stage.dataset.vision;
  smoothPose.clear();smoothFace.clear();
  lastFrame=-1;
  guide(null);message();
}
function stop() {
  stream?.getTracks().forEach((t)=>t.stop());
  stream=null;
  video.pause();video.srcObject=null;video.hidden=true;
}
function changeSource(mode) {
  const id=++operation;
  stop();
  resetVision();
  state.source=mode;state.busy=false;state.split=0;state.scan=null;
  video.hidden=true;img.hidden=mode!=='photo'||!photoURL;
  studio?.setSource(mode);
  controls();
  if(mode==='studio'){
    signal(studio?.avatar&&!studio.lost?'مانکن سه‌بعدی':'رندر کاتالوگ',studio?.avatar&&!studio.lost?'ready':'');
    return;
  }
  if(!gpu()){
    signal('شتاب‌دهی گرافیکی غیرفعال است','pending');
    message('مرورگر به WebGL2 نیاز دارد','رندرهای کاتالوگ و جدول تناسب در حالت مانکن در دسترس‌اند.',
      {label:'بازگشت به مانکن',click:()=>changeSource('studio'),icon:'cube'});
    return;
  }
  if(mode==='live')startCamera(id);
  else if(photoURL)analyzePhoto(id);
  else {
    signal('آمادهٔ انتخاب عکس');
    message('پرو روی عکس','یک عکس روشن و روبه‌رو با قاب مناسب انتخاب کن.',{icon:'image',label:'انتخاب عکس',click:pickPhoto});
  }
}
function changeFrame(mode,selectCompatible=true) {
  if(mode===state.mode)return;
  state.mode=mode;state.turn=0;state.zoom=1;$('zoom').value='100';
  const id=++operation;
  const needsCamera=state.source==='live'&&!stream&&state.busy;
  state.scan=null;state.split=0;
  resetVision();
  if(selectCompatible&&!compatible(state.item,mode)){
    const item=items().find(l=>compatible(l,mode)&&l.frame===mode)??catalog[0];
    if(state.filter!=='all'){state.filter='all';showList(true);}
    select(item,false);
  }
  if(state.source==='live'&&stream)setupCamera(id);
  else if(needsCamera)startCamera(id);
  else if(state.source==='photo'&&photoURL)analyzePhoto(id);
  poster();controls();
}

async function startCamera(id) {
  state.busy=true;
  signal('در انتظار اجازهٔ دوربین','pending');
  message('دوربین را فعال کن','درخواست مرورگر را تأیید کن تا قاب زنده باز شود.',{icon:'video'});
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('این مرورگر دسترسی دوربین را روی این آدرس فعال نمی‌کند.');
    const videoStream=await navigator.mediaDevices.getUserMedia({
      video:{width:{ideal:1280},height:{ideal:720},facingMode:'user',frameRate:{ideal:30}},audio:false,
    });
    if(id!==operation){videoStream.getTracks().forEach(t=>t.stop());return;}
    stream=videoStream;
    video.srcObject=stream;video.hidden=false;
    video.classList.toggle('is-mirror',state.mirror);
    await video.play();
    stream?.getVideoTracks()[0]?.addEventListener('ended',()=>{if(state.source==='live')fail(new Error('جریان دوربین قطع شد.'),operation);},{once:true});
    if(id===operation)await setupCamera(id);
  }catch(e){fail(e,id);}
}
async function setupCamera(id){
  state.busy=true;
  signal('بارگذاری مدل تشخیص','pending');
  const m=fitModes[state.mode];
  message(m.title,m.description);
  try{
    const mode=state.mode;
    const delegate=await enqueue(()=>vision.warm(mode,'VIDEO'));
    if(id!==operation)return;
    state.delegate=delegate;state.ready=true;state.busy=false;
    message();controls();
  }catch(e){fail(e,id);}
}
function fail(error,id){
  if(id!==operation)return;
  const live=state.source==='live';
  if(live)stop();
  resetVision();state.busy=false;state.scan=null;
  const common={
    NotAllowedError:'اجازهٔ دوربین برای این صفحه صادر نشده است.',
    NotFoundError:'دوربین متصل پیدا نشد.',
    NotReadableError:'دوربین در برنامه‌ای دیگر در حال استفاده است.',
  };
  const info=common[error.name]??(live?'دوربین یا مدل تشخیص آماده نشد.':error.message);
  signal('تشخیص آماده نیست','pending');
  message(live?'اتصال دوربین برقرار نشد':'عکس تحلیل نشد',info,
    {icon:live?'video':'image',click:live?()=>changeSource('live'):pickPhoto,label:live?'اتصال دوباره':'انتخاب عکس دیگر'});
}

function pickPhoto(){$('photo-file').value='';$('photo-file').click();}
$('photo-file').addEventListener('change',async(e)=>{
  const file=e.currentTarget.files[0];
  if(!file)return;
  if(!file.type.startsWith('image/')||file.size>24_000_000){toast('عکس JPEG، PNG، WebP یا AVIF تا ۲۴ مگابایت انتخاب کن.');return;}
  const url=URL.createObjectURL(file);
  const test=new Image();test.src=url;
  try{
    await test.decode();
    if(state.source!=='photo'){URL.revokeObjectURL(url);return;}
    if(photoURL)URL.revokeObjectURL(photoURL);
    photoURL=url;img.src=url;img.hidden=false;
    await img.decode();
    const id=++operation;
    resetVision();controls();
    await analyzePhoto(id);
  }catch{if(photoURL!==url)URL.revokeObjectURL(url);toast('عکس باز نشد. فایل JPEG یا PNG امتحان کن.');}
});
async function analyzePhoto(id){
  const mode=state.mode;
  state.busy=true;
  signal('تحلیل عکس','pending');
  message('تحلیل قاب عکس',fitModes[mode].description,{icon:'image'});
  try{
    await enqueue(()=>vision.warm(mode,'IMAGE'));
    if(id!==operation)return;
    const result=await enqueue(()=>vision.infer(img,{mode,method:'IMAGE',time:performance.now(),masks:semantic(),fallback:true}));
    if(id!==operation)return;
    applyTracking(result,performance.now());
    state.ready=true;state.busy=false;
    const rig=project();
    if(rig){signal('پرو روی عکس','ready');message();}
    else {signal('قاب مناسب پیدا نشد','pending');message(fitModes[mode].title,fitModes[mode].description,{icon:'image',click:pickPhoto,label:'انتخاب عکس دیگر'});}
  }catch(e){fail(e,id);}
}

function applyTracking(result,at){
  state.delegate=result.delegate;state.lastInfer=result.timeMs;
  stage.dataset.vision=vision.worker?'worker':'main';
  if(result.mask)stage.dataset.mask='ready';
  const {pose,face,mask,matrix}=result;
  state.tracked={pose:pose?smoothPose.update(pose,at):null,face:face?smoothFace.update(face,at):null,matrix,
    mask:mask??state.mask};
  if(mask)state.mask=mask;
  if(pose||face)state.stamp=at;
  if(state.scan&&mask&&pose){
    const [w,h]=mediaSize(video);
    const next=state.scan.sensor;
    next.ingest(pose,mask,w/h);
    const profile=next.result();
    if(profile){state.body=profile;state.scan=null;put('profile',profile);fitBadge();toast('برآورد روبه‌رو و نیم‌رخ ذخیره شد.');}
  }
}

function project() {
  const rect=sourceRect(source());
  if(!state.tracked||!rect)return null;
  const stages=state.tracked;
  return state.mode==='face'
    ? faceRig(stages.face,stages.matrix,rect,bounds,state.source==='live'&&state.mirror,state.body)
    : bodyRig(stages,state.mode,rect,bounds,state.source==='live'&&state.mirror,studio?.reference??{torso:.45,shoulder:400},state.body);
}
function sense(now){
  if(!state.ready||pending||video.readyState<2||video.currentTime===lastFrame||now-resultTime<Math.max(state.high?39:52,state.lastInfer*.93))return;
  pending=true;lastFrame=video.currentTime;resultTime=now;
  const id=operation, mode=state.mode;
  const masks=semantic()&&(state.scan||mode==='upper'&&frame%2===0||frame%3===0);
  enqueue(()=>vision.infer(video,{mode,method:'VIDEO',time:now,masks:!!masks,fallback:mode==='upper'}))
    .then(result=>{if(id===operation)applyTracking(result,performance.now());})
    .catch(e=>{if(id===operation)fail(e,id);})
    .finally(()=>{pending=false;});
}

const exposure=document.createElement('canvas');exposure.width=9;exposure.height=9;
const exposureCtx=exposure.getContext('2d',{willReadFrequently:true});
function light(media) {
  if(!media)return;
  try{
    exposureCtx.drawImage(media,0,0,9,9);
    const data=exposureCtx.getImageData(0,0,9,9).data;
    let avg=0;
    for(let i=0;i<data.length;i+=4)avg+=data[i]*.25+data[i+1]*.61+data[i+2]*.14;
    state.light=state.light*.8+avg/(81*255)*.2;
  }catch{/* A delayed camera frame may not be available for light estimation yet. */}
}
function scanPrompt(now){
  if(!state.scan)return false;
  const {sensor,deadline}=state.scan;
  if(now>deadline){
    state.scan=null;toast('هر دو نما کامل نشدند. لباس جذب، نور یکنواخت یا اندازه‌های مترخورده را امتحان کن.');
    return false;
  }
  if(sensor.view==='turn'){guide('نمای روبه‌رو ثبت شد. یک‌چهارم دور بچرخ و در قاب بمان.',()=>{
    sensor.view='side';state.scan.deadline=performance.now()+26000;
  },'شروع نیم‌رخ');}
  else {
    const count=show(sensor[sensor.view].length);
    guide(`${sensor.view==='front'?'روبه‌رو بایست و دست‌ها را کمی باز کن':'به پهلو بایست و ثابت بمان'} · ${count} از ۸`,()=>{
      state.scan=null;guide(null);
    },'لغو');
  }
  return true;
}

function resize(){
  bounds={w:stage.clientWidth,h:stage.clientHeight};
  if(gpu()&&bounds.w&&bounds.h)studio.resize(bounds.w,bounds.h,state.high);
}
new ResizeObserver(resize).observe(stage);
resize();
function animate(now){
  requestAnimationFrame(animate);
  if(!gpu()||document.hidden||!bounds.w||!bounds.h)return;
  const dt=Math.max(.003,Math.min(.045,(now-prev)/1000));
  prev=now;frame++;
  if(state.source==='live'&&state.ready){
    sense(now);
    if(state.stamp&&now-state.stamp>730){
      state.tracked=null;state.mask=null;smoothPose.clear();smoothFace.clear();
    }
  }
  const key=state.source==='studio'&&!state.move&&!state.wind
    ? [display,studio.wear?.group.uuid,studio.avatar?.model.uuid,bounds.w,bounds.h,state.split,state.splitAt,state.turn,state.zoom,state.mode,state.high,state.debug].join('|')
    : null;
  if(key&&key===renderKey)return;
  renderKey=key;
  const media=source(), rect=sourceRect(media);
  const rig=project();
  if(state.source==='live'&&state.ready){
    signal(rig?.kind==='estimate'?'برآورد بالاتنه':rig?state.mode==='face'?'ردیابی چهره':'ردیابی بدن':'در انتظار قاب مناسب',rig?'ready':'pending');
    if(!scanPrompt(now))guide(!rig?fitModes[state.mode].title : state.mode==='full'&&!rig.full?'برای حرکت دامن، پاها هم در قاب باشند.':null);
  }
  if(frame%15===0)light(media);
  studio.update({dt,time:now,mode:state.mode,rig,move:state.move,wind:state.wind,turn:state.turn,zoom:state.zoom,lightValue:state.light,reduce});
  studio.draw(state.split?state.splitAt/100:0);
  layerFrame(ctx,studio,{
    source:media,rect,mirror:state.source==='live'&&state.mirror,mode:state.mode,rig,
    mask:state.occlusion?state.mask:null,debug:state.debug,
    sleeve:['coat','jacket','knit'].includes(state.item.cut),
  });
  reportCount++;
  if(now-metricsAt>1050){
    $('telemetry').textContent=metricsAt?
      (state.ready&&state.source!=='studio'?`${state.delegate} · ${Math.round(state.lastInfer)} ms`:`WEBGL · ${Math.round(reportCount*1000/(now-metricsAt))} FPS`):'';
    metricsAt=now;reportCount=0;
  }
}
requestAnimationFrame(animate);

function download(blob,name){
  const url=URL.createObjectURL(blob), a=el('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
$('capture').addEventListener('click',()=>{
  const shot=document.createElement('canvas');
  shot.width=bounds.w;shot.height=bounds.h;
  const g=shot.getContext('2d');
  const bg=g.createRadialGradient(bounds.w/2,bounds.h*.46,0,bounds.w/2,bounds.h*.46,bounds.w*.54);
  bg.addColorStop(0,'#7d6c5c');bg.addColorStop(1,'#352921');
  g.fillStyle=bg;g.fillRect(0,0,bounds.w,bounds.h);
  const media=source();
  if(media)drawMedia(g,media,sourceRect(media),state.source==='live'&&state.mirror);
  if(gpu()&&studio.draw(state.split?state.splitAt/100:0)){
    g.drawImage(canvas,0,0,bounds.w,bounds.h);g.drawImage(ctx.canvas,0,0,bounds.w,bounds.h);
  } else if(state.source==='studio'&&$('poster').complete&&$('poster').naturalWidth){
    const p=$('poster');drawMedia(g,p,contain(p.naturalWidth,p.naturalHeight,bounds.w,bounds.h),false);
  }
  const id=state.size.sku;
  shot.toBlob((b)=>{if(b){download(b,`VFR-${id}.png`);toast('عکس آینه ذخیره شد.');}},'image/png');
});

$$('button[data-source]').forEach(b=>b.addEventListener('click',()=>{
  const next=b.dataset.source;
  if(next==='photo'&&state.source===next){pickPhoto();return;}
  if(next==='live'&&state.source===next){changeSource(stream||state.busy?'studio':'live');return;}
  changeSource(next);
}));
$$('button[data-frame]').forEach(b=>b.addEventListener('click',()=>changeFrame(b.dataset.frame)));
$('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(stage.requestFullscreen)await stage.requestFullscreen();else toast('این مرورگر تمام‌صفحهٔ آینه را پشتیبانی نمی‌کند.');}
  catch{toast('تمام‌صفحه باز نشد.');}
});
$('turn').addEventListener('click',()=>{state.turn=state.turn>=.78?0:state.turn+.39;});
$('motion').addEventListener('click',()=>{state.move=!state.move;controls();});
$('wind').addEventListener('click',()=>{state.wind=!state.wind;controls();});
$('compare').addEventListener('click',()=>{state.split=state.split?0:1;controls();});
$('split-slider').addEventListener('input',e=>{state.splitAt=Number(e.currentTarget.value);controls();});
$('quality').addEventListener('change',e=>{state.high=e.currentTarget.value==='high';resize();});
$('zoom').addEventListener('input',e=>{state.zoom=Number(e.currentTarget.value)/100;});
for(const id of ['mirror','occlusion','debug']){
  $(id).addEventListener('change',(e)=>{state[id]=e.currentTarget.checked;if(id==='mirror')video.classList.toggle('is-mirror',state.mirror);});
}
$('form-select').replaceChildren(...forms.map(f=>new Option(f.label,f.id,false,state.formId===f.id)));
$('form-select').addEventListener('change',e=>{state.formId=e.currentTarget.value;state.formPinned=true;updateLook(true);});
$('apply-profile').addEventListener('change',e=>{state.apply=e.currentTarget.checked;updateLook(true);});

const getFields=()=>$('measurement-form').elements;
const scale=(k)=>['eye','bridge'].includes(k)?1:10;
const bodyMethods={manual:'اندازه‌های ثبت‌شده با متر',scan:'اندازه‌های فایل اسکن واردشده',camera:'برآورد دو نمای دوربین'};
function fillMeasurements(){
  const fields=getFields(), body=state.body;
  for(const key of Object.keys(metrics))fields.namedItem(key).value=body?.measures?.[key]?Number((body.measures[key].value/scale(key)).toFixed(1)):'';
  $('fit-preference').value=state.preference;
  $('measure-detail').textContent=bodyMethods[body?.method]??'اندازه‌ها برای پیشنهاد سایز و فرم مرجع مانکن استفاده می‌شوند.';
}
$('measurement-form').addEventListener('submit',(e)=>{
  e.preventDefault();
  const fields=getFields();
  const values=Object.fromEntries(Object.keys(metrics).map(key=>[key,fields.namedItem(key).valueAsNumber*scale(key)]));
  const profile=manualProfile(values);
  const keep=state.body;
  if(keep){
    let retained=false;
    for(const [key,m] of Object.entries(profile.measures)){
      const old=keep.measures[key];
      if(old && Math.abs(old.value-m.value)<.11){profile.measures[key]=old;retained=true;}
    }
    if(retained)profile.method=keep.method;
  }
  state.body=Object.keys(profile.measures).length?profile:null;
  state.preference=$('fit-preference').value;
  put('profile',state.body);put('preference',state.preference);
  fitBadge();if(state.apply)updateLook(true);
  $('fit-dialog').close();toast('پروفایل اندازه ذخیره شد.');
});
$('clear-measure').addEventListener('click',()=>{state.body=null;put('profile',null);fillMeasurements();fitBadge();if(state.apply)updateLook(true);toast('اندازه‌ها پاک شدند.');});
$('import-body').addEventListener('click',()=>{$('body-file').value='';$('body-file').click();});
$('body-file').addEventListener('change',async(e)=>{
  const f=e.currentTarget.files[0];if(!f)return;
  try{
    if(f.size>40_000)throw new Error('حجم JSON بیش از حد است.');
    state.body=readBodyScan(JSON.parse(await f.text()));put('profile',state.body);fillMeasurements();fitBadge();
    if(state.apply)updateLook(true);
    toast('اندازه‌های فایل اسکن ذخیره شدند.');
  }catch(error){$('measure-hint').textContent=error instanceof SyntaxError?'JSON معتبر نیست.':error.message;}
});
$('scan-start').addEventListener('click',()=>{
  const v=getFields().namedItem('height');
  if(!v.value||!v.checkValidity()){$('measure-hint').textContent='قد را بین ۱۳۵ و ۲۱۸ سانتی‌متر وارد کن.';v.focus();return;}
  if(!gpu()){$('measure-hint').textContent='برآورد دوربینی به شتاب‌دهی WebGL2 نیاز دارد.';return;}
  const heightMm=Math.round(v.valueAsNumber*10);
  $('fit-dialog').close();changeFrame('full');
  if(state.source!=='live'||!stream&&!state.busy)changeSource('live');
  state.scan={sensor:new TwoViewScan(heightMm),deadline:performance.now()+42000};
  guide('برای نمای اول، تمام‌قد روبه‌رو بایست.');
});

const chartLabels={...Object.fromEntries(Object.entries(metrics).map(([k,m])=>[k,m.label])),length:'قد لباس',width:'عرض فریم'};
const dimValue=(k,v)=>v==null?'—':k==='eye'||k==='bridge'||k==='width'?show(v):cm(v);
const displayStatus={missing:'اندازه وارد نشده',clear:'در بازه',tight:'کمتر از حد',loose:'بیشتر از حد',uncertain:'مرزی'};
function chart(){
  const {item,size}=state, keys=Object.keys(size.garment);
  $('chart-context').textContent=`${item.title} · ${item.frame==='face'?'میلی‌متر':'سانتی‌متر'} · ابعاد خود کالا`;
  const table=el('table'),thead=el('thead'),row=el('tr');
  for(const v of ['سایز',...keys.map(k=>chartLabels[k])])row.append(el('th',v));
  thead.append(row);table.append(thead);
  const b=el('tbody');
  for(const s of item.sizes){
    const t=el('tr',null,s===size?'active':'');
    for(const v of [s.label,...keys.map(k=>dimValue(k,s.garment[k]))])t.append(el('td',v));
    b.append(t);
  }
  table.append(b);$('chart').replaceChildren(table);
  $('checks').replaceChildren(...measures().checks.map(c=>{
    const row=el('div');
    const message=c.status==='missing'?displayStatus[c.status]:`${displayStatus[c.status]} · اختلاف ${dimValue(c.key,c.raw)}`;
    const d=el('b',message);d.dataset.verdict=c.status;row.append(el('span',chartLabels[c.key]),d);
    return row;
  }));
}

function register(record){
  const id=record.item.id;
  state.records.set(id,record);
  if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id);}
  if(record.files['poster.webp'])urls.set(id,URL.createObjectURL(new Blob([record.files['poster.webp']],{type:'image/webp'})));
}
async function importBytes(bytes){
  const status=$('import-status');status.textContent='در حال اعتبارسنجی بسته و فایل‌های GLB…';
  const p=unpackPackage(bytes);
  try{await storePackage(p);}catch{toast('این مرورگر ذخیرهٔ محلی بسته را محدود کرده است.');}
  register(p);state.filter='scan';showList(true);select(p.item);
  $('import-dialog').close();
  toast(`${p.item.title} با ${show(p.item.sizes.length)} سایز وارد شد.`);
}
$('import-zip').addEventListener('click',()=>{$('zip-file').value='';$('zip-file').click();});
$('zip-file').addEventListener('change',async e=>{
  const f=e.currentTarget.files[0];if(!f)return;
  try{
    if(f.size>42*1024*1024)throw new Error('حجم بسته باید کمتر از ۴۲ مگابایت باشد.');
    await importBytes(new Uint8Array(await f.arrayBuffer()));
  }catch(error){$('import-status').textContent=error instanceof SyntaxError?'manifest.json خوانده نشد.':error.message;}
});
$('sample-zip').addEventListener('click',async()=>{
  const button=$('sample-zip');button.disabled=true;
  try{
    const response=await fetch(asset('protocol/atelier-scanned.zip'));
    if(!response.ok)throw new Error('بستهٔ نمونه در دسترس نیست.');
    await importBytes(new Uint8Array(await response.arrayBuffer()));
  }catch(error){$('import-status').textContent=error.message;}
  finally{button.disabled=false;}
});

function cart(){
  $('cart-count').hidden=!state.cart.length;
  $('cart-count').textContent=show(state.cart.length);
  $('export-cart').disabled=!state.cart.length;
  const host=$('cart-lines');
  host.replaceChildren(...(state.cart.length?state.cart.map((line)=>{
    const row=el('div',null,'cart-line'), copy=el('div');
    copy.append(el('strong',line.title),el('small',`${line.size} · ${line.color} · ${line.sku}`),
      el('small',line.availability==='demo'?'نمونهٔ نمایشی':verdicts[line.fit]?.[0]??'تناسب بررسی نشده'));
    row.append(copy);
    if(line.url){
      const a=el('a','رفتن به فروشگاه','quiet');a.href=line.url;a.target='_blank';a.rel='noopener noreferrer';row.append(a);
    }
    const remove=el('button','حذف','quiet');remove.type='button';
    remove.addEventListener('click',()=>{state.cart=state.cart.filter(x=>x.id!==line.id);put('cart',state.cart);cart();});row.append(remove);
    return row;
  }):[el('p','هنوز محصولی در پیش‌نویس نیست.','hint')]));
}
$('add-cart').addEventListener('click',()=>{
  const line=lineFor(state.item,state.size,state.color,measures());
  state.cart=[line,...state.cart.filter(l=>l.id!==line.id)];
  put('cart',state.cart);cart();open('cart-dialog');
});
$('export-cart').addEventListener('click',()=>download(new Blob([JSON.stringify(makeOrder(state.cart),null,2)],{type:'application/json'}),'VFR-order-draft.json'));
function open(id){
  if(id==='fit-dialog')fillMeasurements();
  if(id==='size-dialog')chart();
  if(id==='cart-dialog')cart();
  if(id==='import-dialog')$('import-status').textContent='';
  $(id).showModal();
}
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.open)));
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
for(const d of $$('dialog'))d.addEventListener('click',(e)=>{
  if(e.target!==d)return;
  const b=d.getBoundingClientRect();
  if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close();
});
window.addEventListener('pagehide',()=>{if(state.source==='live')changeSource('studio');});

showList();product();cart();changeSource('studio');updateLook(true);
listPackages().then(records=>{records.forEach(register);showList();}).catch(()=>{});
