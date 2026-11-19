import { asset } from './catalog.js';

export class Vision {
  constructor() {
    this.session = 0;
    this.seq = 0;
    this.calls=new Map();
  }
  initWorker() {
    const worker=new Worker(new URL('./vision-worker.js',import.meta.url));
    worker.onmessage=({data})=>{
      const job=this.calls.get(data.id);
      if(!job)return;
      this.calls.delete(data.id);
      if(data.ok)job.resolve(data.result);
      else job.reject(new Error(data.message));
    };
    worker.onerror=(event)=>this.shutdown(new Error(event.message || 'Vision worker failed'));
    this.worker=worker;
  }
  rpc(action,params,bitmap) {
    const id=++this.seq, worker=this.worker;
    if(!worker){bitmap?.close();return Promise.reject(new Error('Worker unavailable'));}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.calls.delete(id);
        reject(new Error('مهلت‌ آماده‌سازی تشخیص پایان یافت.'));
      },45_000);
      this.calls.set(id,{resolve:(value)=>{clearTimeout(timer);resolve(value);},reject:(e)=>{clearTimeout(timer);reject(e);}});
      try{worker.postMessage({id,action,params,bitmap},bitmap?[bitmap]:[]);}catch(e){
        bitmap?.close();this.calls.get(id)?.reject(e);this.calls.delete(id);
      }
    });
  }
  async warm(mode,method) {
    const root=asset('runtime/');
    const serial=++this.session;
    try{
      if(!this.dom && typeof OffscreenCanvas!=='undefined' && typeof createImageBitmap==='function'){
        if(!this.worker){this.initWorker();return await this.rpc('initialize',{root,mode,method});}
        return await this.rpc('warm',{mode,method});
      }
    }catch{
      if(serial!==this.session)throw new Error('Vision request superseded');
      this.shutdown();
    }
    const {VisionCore}=await import('./vision-core.js');
    if(serial!==this.session)throw new Error('Vision request superseded');
    this.dom??=new VisionCore(root);
    return this.dom.warm(mode,method);
  }
  async infer(source,params) {
    if(this.dom)return this.dom.frame(source,params);
    const w=source.videoWidth??source.naturalWidth??source.width;
    const h=source.videoHeight??source.naturalHeight??source.height;
    const limit=params.method==='IMAGE'?1140:params.mode==='face'?720:832;
    const scale=Math.min(1,limit/Math.max(w,h));
    try{
      const bitmap=await createImageBitmap(source,{resizeWidth:Math.round(w*scale),resizeHeight:Math.round(h*scale),resizeQuality:'medium'});
      return await this.rpc('frame',params,bitmap);
    }catch{
      this.shutdown();
      const {VisionCore}=await import('./vision-core.js');
      this.dom=new VisionCore(asset('runtime/'));
      return this.dom.frame(source,params);
    }
  }
  shutdown(error = new Error('Vision session closed')) {
    this.worker?.terminate();this.worker=null;
    for(const job of this.calls.values())job.reject(error);
    this.calls.clear();
  }
}
