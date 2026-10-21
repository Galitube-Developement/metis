import { Worker } from "node:worker_threads";
import path from "node:path";
import { databasePath, getDatabase } from "@/lib/sqlite";
import { pageIsReady, rebuildChatPage } from "@/lib/chat-page-store";

// Only legacy/backfill work uses this worker. Warm pages are indexed bounded reads.
// A single thread and bounded queue keep a burst of cold chats from exhausting RAM.
let worker:Worker|undefined;
let serial=0;
let idle:ReturnType<typeof setTimeout>|undefined;
const tasks=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
const inFlight=new Map<string,Promise<void>>();
function stopIdle() {
 if(tasks.size)return;
 idle=setTimeout(()=>{void worker?.terminate();worker=undefined;},1000);
 idle.unref();
}
function rejectAll(error:Error) {
 for(const task of tasks.values())task.reject(error);
 tasks.clear();worker=undefined;
}
function dispatch(chatId:string,extra:Record<string,unknown>={}) {
 if(tasks.size>=16)return Promise.reject(new Error("Chat history preparation is busy. Retry shortly."));
 if(idle)clearTimeout(idle);
 if(!worker){
  worker=new Worker(path.join(process.env.AI_CHAT_INSTALL_DIR || process.cwd(),"lib/chat-page-worker.mjs"),{
   workerData:{databasePath},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:16},
  });
  worker.on("message",(reply:{id?:number;error?:string;errorName?:string;value?:unknown})=>{
   if(reply.id===undefined)return;
   const task=tasks.get(reply.id);if(!task)return;
   tasks.delete(reply.id);
   if(reply.error){const error=new Error(reply.error);error.name=reply.errorName || "Error";task.reject(error);}else task.resolve(reply.value);
   stopIdle();
  });
  worker.on("error",rejectAll);
  const owned=worker;
  worker.on("exit",code=>{if(worker===owned){rejectAll(new Error("Chat history worker exited ("+code+")"));}});
 }
 const id=++serial;
 return new Promise<unknown>((resolve,reject)=>{tasks.set(id,{resolve,reject});worker!.postMessage({id,chatId,...extra});});
}
export async function updateChatOffThread(id:string,ownerId:string,patch:Parameters<typeof import("./db-store").updateChat>[1]) {
 return dispatch(id,{operation:"patch",ownerId,patch}) as Promise<import("./store").Chat|null>;
}
export async function updateNotePinsOffThread(ownerId:string,update:import("./note-pins").PinUpdate) {
 return dispatch("note-pins",{operation:"notePins",ownerId,update}) as Promise<Record<string,unknown>|null>;
}
export async function ensureChatPage(id:string) {
 const db=getDatabase();
 if(pageIsReady(db,id))return;
 // Small legacy records are bounded; do not make another small chat wait for a
 // large legacy backfill. Never transfer a large blob onto the web event loop.
 const size=db.prepare("SELECT length(CAST(data AS BLOB)) AS bytes FROM chats WHERE id=?").get(id) as {bytes:number}|undefined;
 if(!size)return;
 if(size.bytes<=64*1024){rebuildChatPage(db,id);return;}
 const existing=inFlight.get(id);if(existing)return existing;
 const promise=(async()=>{
  for(let attempt=0;attempt<3;attempt++){
   await dispatch(id);
   if(pageIsReady(db,id))return;
  }
  throw new Error("Chat is changing while history is prepared. Retry shortly.");
 })();
 inFlight.set(id,promise);
 try{await promise;}finally{inFlight.delete(id);}
}
