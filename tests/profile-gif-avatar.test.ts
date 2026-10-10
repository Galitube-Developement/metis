import assert from "node:assert/strict";
import test, {after} from "node:test";
import {mkdtempSync,rmSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import sharp from "sharp";
const dir=mkdtempSync(path.join(tmpdir(),"metis-gif-"));
process.env.CHAT_DATA_DIR=dir;process.env.CHAT_DB_PATH=path.join(dir,"chat.sqlite");process.env.AI_CHAT_ROOT=dir;process.env.AGENT_CWD=dir;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(dir,{recursive:true,force:true});});
const gif=Buffer.from("R0lGODlhGAAYAIEAADMzMwAAAAAAAAAAACH5BAAoAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAGAAYAAAIKQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDPgwIACH5BAAoAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAGAAYAIH//8z/zP/M//////8IeAAHAAggYGBBggYTIly48KBDhQ8JChQQAABFAAMiajRY8eLFhhATCvDYEaTJhyQthjw50GLJlRsJvqQYc2PKmitd6mR5ciZPmzNh5kz5E6JPnCBvCjWp8yPSghmPLkUZtOjCphWtOpSqFavKrj6nJoyK9anIqmYDAgA7","base64");
const profile={displayName:"GIF test",bio:"",links:[],sharing:false,shareActivity:false};
async function owner(name:string) {
  const auth=await import("../lib/auth");const user=auth.createUser(name,"gif-fixture-password-123");
  return {...user,token:auth.authenticateUser(name,"gif-fixture-password-123")!.token};
}
function upload(body:Uint8Array,token?:string,headers:Record<string,string>={}) {
  return new Request("http://localhost/api/profile/avatar",{method:"PUT",headers:{"content-type":"image/gif",...(token?{cookie:"ai_chat_auth="+token}:{}),...headers},body:new Uint8Array(body)});
}
async function image(url:string,token?:string,etag?:string) {
  const {GET}=await import("../app/api/profile/avatar/[avatarId]/route");
  return GET(new Request("http://localhost"+url,{headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(etag?{"if-none-match":etag}:{})}}),{params:Promise.resolve({avatarId:url.split("/").at(-1)!})});
}
test("GIF upload requires authentication and preserves animation bytes, frames, delay and loop",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const user=await owner("gif-owner");
  assert.equal((await PUT(upload(gif))).status,401);
  const response=await PUT(upload(gif,user.token));assert.equal(response.status,200);
  const {avatar}=await response.json();const loaded=await image(avatar,user.token);
  assert.equal(loaded.headers.get("content-type"),"image/gif");assert.equal(loaded.headers.get("cache-control"),"private, max-age=31536000, immutable");
  const actual=Buffer.from(await loaded.arrayBuffer());assert.deepEqual(actual,gif);
  const metadata=await sharp(actual).metadata();assert.equal(metadata.pages,2);assert.deepEqual(metadata.delay,[400,400]);assert.equal(metadata.loop,0);
});
test("drafts remain private, foreign references are rejected, sharing and revocation control image access",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");
  const {saveAccountProfile}=await import("../lib/account-profile");
  const first=await owner("gif-private"),second=await owner("gif-foreign");
  const {avatar}=await (await PUT(upload(gif,first.token))).json();
  assert.equal((await image(avatar)).status,404);assert.equal((await image(avatar,second.token)).status,404);
  assert.throws(()=>saveAccountProfile(second.id,{...profile,avatar}));
  assert.throws(()=>saveAccountProfile(first.id,{...profile,avatar:"/api/profile/avatar/"+"0".repeat(48)}));
  assert.throws(()=>saveAccountProfile(first.id,{...profile,avatar:"https://example.com/a.gif"}));
  saveAccountProfile(first.id,{...profile,avatar});
  assert.equal((await image(avatar)).status,404);
  saveAccountProfile(first.id,{...profile,avatar,sharing:true});assert.equal((await image(avatar)).status,200);
  saveAccountProfile(first.id,{...profile,avatar});assert.equal((await image(avatar)).status,404);
  assert.equal((await image(avatar,first.token)).status,200);
});
test("replacing or removing an avatar removes the previous GIF and rejects stale references",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const {saveAccountProfile}=await import("../lib/account-profile");
  const user=await owner("gif-replace"),first=(await (await PUT(upload(gif,user.token))).json()).avatar;
  saveAccountProfile(user.id,{...profile,avatar:first});
  const second=(await (await PUT(upload(gif,user.token))).json()).avatar;
  saveAccountProfile(user.id,{...profile,avatar:second});
  assert.equal((await image(first,user.token)).status,404);assert.equal((await image(second,user.token)).status,200);
  assert.throws(()=>saveAccountProfile(user.id,{...profile,avatar:first}));
  saveAccountProfile(user.id,{...profile,avatar:null});assert.equal((await image(second,user.token)).status,404);
});
test("invalid content, MIME mismatch, empty and oversized declared uploads are rejected without partial files",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const user=await owner("gif-invalid");
  const before=readdirSync(path.join(dir,"profile-avatars")).length;
  assert.equal((await PUT(upload(gif,user.token,{"content-type":"image/png"}))).status,415);
  for(const body of [new Uint8Array(),Buffer.from("<svg><script/></svg>"),Buffer.from("GIF89a")])
    assert.equal((await PUT(upload(body,user.token))).status,400);
  assert.equal((await PUT(upload(gif,user.token,{"content-length":"50000001"}))).status,413);
  assert.equal(readdirSync(path.join(dir,"profile-avatars")).length,before);
});
function paddedGif(size:number) {
  // Valid GIF comment extension before the trailer; exercise an actual exact-size file.
  const result=Buffer.alloc(size),head=gif.subarray(0,-1);head.copy(result);
  let offset=head.length;result[offset++]=0x21;result[offset++]=0xfe;
  while(size-offset>2) {
    const count=Math.min(255,size-offset-3);
    if(count<=0)break;
    result[offset++]=count;result.fill(0x61,offset,offset+count);offset+=count;
  }
  result[offset++]=0;result[offset++]=0x3b;
  assert.equal(offset,size);return result;
}
test("exactly 50 MB is accepted and returned unchanged; profile JSON stays small",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const {saveAccountProfile}=await import("../lib/account-profile");
  const user=await owner("gif-large"),large=paddedGif(50_000_000);
  const response=await PUT(upload(large,user.token));assert.equal(response.status,200,await response.clone().text());
  const {avatar}=await response.json();saveAccountProfile(user.id,{...profile,avatar});
  const loaded=await image(avatar,user.token);assert.equal(loaded.headers.get("content-length"),"50000000");
  assert.deepEqual(Buffer.from(await loaded.arrayBuffer()),large);
  const {GET}=await import("../app/api/profile/route");
  const json=await (await GET(new Request("http://localhost/api/profile",{headers:{cookie:"ai_chat_auth="+user.token}}))).text();
  assert.ok(json.length<1000);assert.ok(json.includes(avatar));
});
test("chunked uploads cannot bypass the 50 MB limit and partial files are removed",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const user=await owner("gif-stream-limit");
  const before=readdirSync(path.join(dir,"profile-avatars")).length;
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(50_000_000));controller.enqueue(new Uint8Array(1));controller.close();}});
  const req=new Request("http://localhost/api/profile/avatar",{method:"PUT",headers:{"content-type":"image/gif",cookie:"ai_chat_auth="+user.token},body:stream,duplex:"half"} as RequestInit);
  assert.equal((await PUT(req)).status,413);assert.equal(readdirSync(path.join(dir,"profile-avatars")).length,before);
});

test("repeated draft uploads keep the saved image and only the newest draft",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const {saveAccountProfile}=await import("../lib/account-profile");
  const user=await owner("gif-drafts"),saved=(await (await PUT(upload(gif,user.token))).json()).avatar;
  saveAccountProfile(user.id,{...profile,avatar:saved});
  const discarded=(await (await PUT(upload(gif,user.token))).json()).avatar;
  const newest=(await (await PUT(upload(gif,user.token))).json()).avatar;
  assert.equal((await image(saved,user.token)).status,200);assert.equal((await image(discarded,user.token)).status,404);
  assert.equal((await image(newest,user.token)).status,200);
});

test("owner images have immutable URLs, private cookie-separated caching and body-free conditional responses",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route");const user=await owner("gif-cached");
  const {avatar}=await (await PUT(upload(gif,user.token))).json();
  const response=await image(avatar,user.token);const etag=response.headers.get("etag")!;
  assert.equal(response.headers.get("vary"),"Cookie");
  assert.equal(etag,'"'+avatar.split("/").at(-1)+'"');
  await response.arrayBuffer();
  for(const value of [etag,"W/"+etag,'"other", '+etag,"*"]) {
    const cached=await image(avatar,user.token,value);
    assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
    assert.equal(cached.headers.get("etag"),etag);assert.equal(cached.headers.get("cache-control"),"private, max-age=31536000, immutable");
  }
  const stale=await image(avatar,user.token,'"other"');assert.equal(stale.status,200);await stale.arrayBuffer();
  const denied=await image(avatar,undefined,etag);assert.equal(denied.status,404);assert.equal(denied.headers.get("cache-control"),"private, no-store");
});
test("public image cache revalidates sharing before accepting an ETag",async()=>{
  const {PUT}=await import("../app/api/profile/avatar/route"),{saveAccountProfile}=await import("../lib/account-profile");
  const user=await owner("gif-public-cache"),other=await owner("gif-public-viewer");
  const {avatar}=await (await PUT(upload(gif,user.token))).json();
  saveAccountProfile(user.id,{...profile,avatar,sharing:true});
  const response=await image(avatar);const etag=response.headers.get("etag")!;
  assert.equal(response.headers.get("cache-control"),"private, no-cache");await response.arrayBuffer();
  assert.equal((await image(avatar,undefined,etag)).status,304);
  assert.equal((await image(avatar,other.token,etag)).status,304);
  saveAccountProfile(user.id,{...profile,avatar,sharing:false});
  for(const token of [undefined,other.token]) {
    const denied=await image(avatar,token,etag);assert.equal(denied.status,404);assert.equal(denied.headers.get("cache-control"),"private, no-store");
  }
});
