/**
 * Offline, bounded performance harness. No provider credentials or production data.
 * Run: node --expose-gc --import tsx scripts/benchmark-performance.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

async function main() {
  const startup = process.argv.includes("--startup-child");
  const root = startup ? process.env.CHAT_DATA_DIR! : mkdtempSync(path.join(os.tmpdir(), "metis-performance-"));
  if (!root || !path.basename(root).startsWith("metis-performance-")) throw new Error("Isolated fixture directory required");
  process.env.CHAT_DATA_DIR = root;
  process.env.CHAT_DB_PATH = path.join(root, "fixture.sqlite");
  process.env.AGENT_CWD = root;
  delete process.env.AI_CHAT_JOB_ID;
  delete process.env.AI_CHAT_WORKER_ID;
  delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
  const { getDatabase } = await import("../lib/sqlite");
  if (startup) {
    const t = performance.now();
    getDatabase();
    console.log(JSON.stringify({ ms: performance.now() - t }));
    return;
  }
  const quantiles = (samples: number[]) => {
    const sorted = [...samples].sort((a,b) => a-b);
    return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.min(sorted.length-1, Math.floor(sorted.length * .95))] };
  };
  try {
    const start = performance.now();
    const db = getDatabase();
    const freshStartMs = performance.now() - start;
    const store = await import("../lib/db-store");
    const jobs = await import("../lib/db-jobs");
    const { waitForSchedulerTick } = await import("../lib/worker-scheduler");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('fixture-owner','fixture-owner','unused',?)").run(now);
    // Mark the same legacy bootstrap state a completed first-user installation has.
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('legacy_owner_assigned','1')").run();
    const messages = Array.from({length: 250}, (_, i) => ({
      id: "message-" + i, role: i % 2 ? "assistant" : "user", content: "synthetic text ".repeat(300), createdAt: now,
    }));
    const toolOutput = "synthetic tool output ".repeat(25_000) + "COMPLETE_OUTPUT_END";
    messages.push({id:"tool-message",role:"assistant",content:toolOutput,createdAt:now});
    const insert = db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES(?,?,?,?,?)");
    let transcriptBytes = 0;
    db.exec("BEGIN");
    for (let i=0; i<32; i++) {
      const raw = JSON.stringify({id:"fixture-"+i,ownerId:"fixture-owner",title:"Fixture "+i,createdAt:now,updatedAt:now,messages});
      transcriptBytes += Buffer.byteLength(raw);
      insert.run("fixture-"+i,"fixture-owner",raw,now,now);
    }
    for (const id of ["old-job","current-job"]) db.prepare("INSERT INTO jobs(id,chat_id,user_id,status,data,updated_at) VALUES(?,?,?,'completed',?,?)").run(id,"fixture-0","fixture-owner",JSON.stringify({id,status:"completed"}),now);
    const eventInsert = db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES(?,?,?,?,?,?)");
    for (let i=0; i<10_000; i++) eventInsert.run(i<9_990 ? "old-job":"current-job","fixture-0","fixture-owner","text",JSON.stringify({text:"delta-"+i}),now);
    db.exec("COMMIT");
    const startupMs: number[]=[];
    for(let i=0;i<6;i++){
      const child=spawnSync(process.execPath,["--import","tsx",import.meta.filename,"--startup-child"],{
        cwd:process.cwd(),encoding:"utf8",timeout:30_000,
        env:{NODE_ENV:"test",PATH:process.env.PATH,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"fixture.sqlite"),AGENT_CWD:root},
      });
      if(child.status!==0) throw new Error(child.stderr);
      startupMs.push(JSON.parse(child.stdout.trim()).ms);
    }
    const reads: number[]=[];
    for(let i=0;i<100;i++){
      const t=performance.now();
      const events=jobs.listRunEvents("fixture-0","fixture-owner",0,"current-job");
      if(events.length!==10) throw new Error("Missing events");
      reads.push(performance.now()-t);
    }
    const pageMs: number[]=[];
    for(let i=0;i<32;i++){
      const t=performance.now();
      store.getChatPage("fixture-"+i,"fixture-owner",10,0);
      pageMs.push(performance.now()-t);
    }
    let reactions=0;
    const resolvers: Array<()=>void>=[];
    // Controlled provider stub: 24 concurrent jobs remain pending for 1,000 scheduler polls.
    const active=new Set(Array.from({length:24},()=>{
      const p=new Promise<void>(resolve=>resolvers.push(resolve));
      const original=p.then.bind(p);
      p.then=((...args: Parameters<typeof p.then>)=>{reactions++;return original(...args);}) as typeof p.then;
      return p;
    }));
    global.gc?.();
    const heapBefore=process.memoryUsage().heapUsed;
    const cpuBefore=process.cpuUsage();
    const delay=monitorEventLoopDelay({resolution:10}); delay.enable();
    const schedulerStart=performance.now();
    for(let i=0;i<1_000;i++) await waitForSchedulerTick(active,25,0);
    global.gc?.();
    const retainedHeapBytes=process.memoryUsage().heapUsed-heapBefore;
    const schedulerMs=performance.now()-schedulerStart;
    const cpu=process.cpuUsage(cpuBefore);
    delay.disable();
    resolvers.forEach(resolve=>resolve());
    await Promise.all(active);
    console.log(JSON.stringify({
      environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length},
      fixture:{chats:32,messagesPerChat:messages.length,transcriptBytes,events:10_000,currentJobEvents:10,concurrentStubJobs:24,polls:1000},
      freshStartMs,startup:{firstBackfillMs:startupMs[0],repeated:quantiles(startupMs.slice(1))},
      eventReadMs:quantiles(reads),coldChatPageMs:quantiles(pageMs),
      scheduler:{reactions,retainedHeapBytes,wallMs:schedulerMs,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,eventLoopP95Ms:delay.percentile(95)/1e6},
    },null,2));
    db.close();
  } finally { rmSync(root,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
