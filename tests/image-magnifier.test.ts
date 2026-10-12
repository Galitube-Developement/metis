import test from "node:test";
import assert from "node:assert/strict";
import { containedImageBounds, magnifierGeometry, magnifierZoom } from "../lib/image-magnifier";
import { fileDownloadUrl } from "../lib/file-types";
test("landscape and portrait pixels exclude letterboxing", () => {
  assert.deepEqual(containedImageBounds({left:10,top:20,width:400,height:400},800,400),{left:10,top:120,width:400,height:200});
  assert.deepEqual(containedImageBounds({left:0,top:0,width:400,height:200},200,400),{left:150,top:0,width:100,height:200});
  assert.equal(containedImageBounds({left:0,top:0,width:0,height:200},200,400),null);
});
test("magnifier samples the cursor and stays inside small viewports", () => {
  const image={left:50,top:100,width:300,height:200}, surface={left:0,top:0,width:390,height:500};
  assert.equal(magnifierGeometry(image,surface,100,90,2),null);
  assert.deepEqual(magnifierGeometry(image,surface,200,200,2),{diameter:240,left:80,top:80,width:600,height:400,imageLeft:-180,imageTop:-80});
  const corner=magnifierGeometry(image,surface,350,300,3)!;
  assert.equal(corner.left+corner.diameter,390);
  assert.equal(corner.imageLeft,120-300*3);
  const tiny=magnifierGeometry({left:0,top:0,width:100,height:80},{left:0,top:0,width:100,height:80},50,40,2)!;
  assert.equal(tiny.diameter,80);
});
test("wheel magnitude is bounded and supports zooming both ways", () => {
  assert.ok(magnifierZoom(2.5,-120)>2.5);
  assert.ok(magnifierZoom(2.5,120)<2.5);
  assert.equal(magnifierZoom(8,-500),8);
  assert.equal(magnifierZoom(1.25,500),1.25);
  assert.equal(magnifierZoom(2.5,0),2.5);
});
test("downloads preserve shared-file parameters and do not mutate external/blob URLs", () => {
  assert.equal(fileDownloadUrl("/api/uploads/chat/image.png"),"/api/uploads/chat/image.png?download=1");
  const shared=fileDownloadUrl("/api/share/attachment?token=abc&name=image.png&download=0");
  const query=new URL(shared,"http://localhost").searchParams;
  assert.equal(query.get("token"),"abc"); assert.equal(query.get("name"),"image.png"); assert.equal(query.get("download"),"1");
  assert.equal(fileDownloadUrl("blob:preview"),"blob:preview");
  assert.equal(fileDownloadUrl("https://example.com/image.png?q=1"),"https://example.com/image.png?q=1");
});
