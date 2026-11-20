import { FaceLandmarker, FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';

const modelNames = { pose: 'pose.task', face: 'face.task', mask: 'mask.tflite' };
const classFor = { pose: PoseLandmarker, face: FaceLandmarker, mask: ImageSegmenter };
const options = {
  pose: { numPoses: 1, minPoseDetectionConfidence: .48, minPosePresenceConfidence: .45, minTrackingConfidence: .54 },
  face: { numFaces: 1, minFaceDetectionConfidence: .54, minFacePresenceConfidence: .52, minTrackingConfidence: .55 },
  mask: { outputConfidenceMasks: false, outputCategoryMask: true },
};
const canvas = () => typeof document === 'undefined' ? new OffscreenCanvas(1,1) : document.createElement('canvas');

function smallMask(mask) {
  const { width, height } = mask;
  const source = mask.getAsUint8Array();
  const ratio = Math.min(1,256/Math.max(width,height));
  const w=Math.round(width*ratio), h=Math.round(height*ratio);
  const data=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) data[y*w+x]=source[Math.floor(y*height/h)*width+Math.floor(x*width/w)];
  return { w,h,data };
}

export class VisionCore {
  constructor(root) {
    this.root = root;
    this.model = new Map();
    this.running = new Map();
  }
  async task(key,runningMode) {
    if(!this.model.has(key)){
      this.model.set(key,this.load(key,runningMode).catch(e=>{this.model.delete(key);throw e;}));
      this.running.set(key,runningMode);
    }
    const job=await this.model.get(key);
    if(this.running.get(key)!==runningMode){
      await job.task.setOptions({runningMode});
      this.running.set(key,runningMode);
    }
    return job;
  }
  async load(key,runningMode) {
    this.wasm ??= FilesetResolver.forVisionTasks(new URL('wasm',this.root).href);
    const [set,response]=await Promise.all([this.wasm,fetch(new URL(modelNames[key],this.root),{signal:AbortSignal.timeout(27_000)})]);
    if(!response.ok)throw new Error(`مدل ${key} در دسترس نیست (${response.status}).`);
    const modelAssetBuffer=new Uint8Array(await response.arrayBuffer());
    let err;
    for(const delegate of ['GPU','CPU']){
      try{
        const task=await classFor[key].createFromOptions(set,{...options[key],canvas:canvas(),runningMode,baseOptions:{modelAssetBuffer,delegate}});
        return {task,delegate};
      }catch(e){err=e;}
    }
    throw err;
  }
  async warm(mode, method) {
    const primary=await this.task(mode==='face'?'face':'pose',mode==='upper'?'IMAGE':method);
    return primary.delegate;
  }
  async frame(image,{mode, method, time, masks, fallback=false, headHint=false}) {
    const now=performance.now();
    const key=mode==='face'?'face':'pose';
    const primaryMethod=mode==='upper'?'IMAGE':method;
    const primary=await this.task(key,primaryMethod);
    const run=(k)=>(method==='VIDEO'?k.detectForVideo(image,time):k.detect(image));
    let pose=null, world=null, face=null, mask=null, underlyingError=null;
    if(key==='pose'){
      const output=primaryMethod==='IMAGE'?primary.task.detect(image):run(primary.task);
      pose=output.landmarks[0]??null;
      world=output.worldLandmarks[0]??null;
      output.close();
    }else{
      const output=run(primary.task);
      face=output.faceLandmarks[0]??null;
    }
    const upperShoulders=pose?.slice(11,13);
    const missingShoulders = !upperShoulders?.length || upperShoulders.some(p => (p.visibility??0)<.52 || p.y>.99 || p.x<0 || p.x>1);
    const fullFace=mode==='full'&&(headHint||method==='IMAGE')&&pose?.[0]?.visibility>.65;
    const headAttempted=mode==='face'||fullFace||mode==='upper'&&(headHint||method==='IMAGE'||fallback&&missingShoulders);
    if(mode!=='face'&&headAttempted){
      try{
        const detector=await this.task('face',method);
        const output=run(detector.task);
        face=output.faceLandmarks[0]??null;
      }catch(e){underlyingError=e.message;}
    }
    const poseMs=performance.now()-now;
    let maskMs=0;
    if(masks || mode==='upper'&&fallback&&missingShoulders){
      const started=performance.now();
      try{
        const s=(await this.task('mask',method)).task;
        const copy=(result)=>{ if(result.categoryMask)mask=smallMask(result.categoryMask); };
        if(method==='VIDEO')s.segmentForVideo(image,time,copy);
        else s.segment(image,copy);
      }catch(e){underlyingError=e.message;}
      maskMs=performance.now()-started;
    }
    return {pose,world,face,mask,headAttempted,delegate:primary.delegate,timeMs:performance.now()-now,poseMs,maskMs,underlyingError};
  }
  close() {
    for(const p of this.model.values())p.then(({task})=>task.close()).catch(()=>{});
    this.model.clear();
  }
}
