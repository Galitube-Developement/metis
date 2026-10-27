import { Worker } from "node:worker_threads";
import path from "node:path";
import { databasePath, getDatabase } from "@/lib/sqlite";
import { pageIsReady } from "@/lib/chat-page-store";

// Submission writes and legacy/backfill work share this bounded serial worker.
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
   workerData:{databasePath},resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:16},
  });
  worker.on("message",(reply:{id?:number;error?:string;errorName?:string;value?:unknown})=>{
   if(reply.id===undefined)return;
   const task=tasks.get(reply.id);if(!task)return;
   tasks.delete(reply.id);
   if(reply.error){const error=new Error(reply.error);error.name=reply.errorName || "Error";task.reject(error);}else task.resolve(reply.value);
   stopIdle();
  });
  const owned=worker;
  worker.on("error",error=>{if(worker===owned)rejectAll(error);});
  worker.on("exit",code=>{if(worker===owned){rejectAll(new Error("Chat history worker exited ("+code+")"));}});
 }
 const id=++serial;
 return new Promise<unknown>((resolve,reject)=>{
  tasks.set(id,{resolve,reject});
  try { worker!.postMessage({id,chatId,...extra}); }
  catch(error) { tasks.delete(id);reject(error);stopIdle(); }
 });
}
export async function submitChatOffThread(request:import("./chat-submit").ChatSubmitRequest) {
 return dispatch("submit",{operation:"submit",request}) as Promise<import("./chat-submit").ChatSubmitResponse>;
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
 // Even a tiny rebuild can wait seconds for another SQLite writer.
 // Keep every backfill off the HTTP thread, regardless of history size.
 if(!db.prepare("SELECT 1 FROM chats WHERE id=?").get(id))return;
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
