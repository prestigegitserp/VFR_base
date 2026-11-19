import { VisionCore } from './vision-core.js';
let engine;
self.onmessage=async ({data:{id,action,params,bitmap}})=>{
  try{
    if(action==='initialize'){
      engine=new VisionCore(params.root);
      self.postMessage({id,ok:true,result:await engine.warm(params.mode,params.method)});
      return;
    }
    const result=action==='warm'? await engine.warm(params.mode,params.method) : await engine.frame(bitmap,params);
    const buffers=result?.mask?[result.mask.data.buffer]:[];
    self.postMessage({id,ok:true,result},buffers);
  }catch(e){self.postMessage({id,ok:false,message:e.message??String(e)});}
  finally{bitmap?.close();}
};
