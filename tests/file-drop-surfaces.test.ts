import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { chromium } from "playwright";

test("OS files route only to the hovered surface and overlays reset between surfaces", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<aside id="sidebar"></aside><section id="chat" data-file-drop-target><div id="message"></div><div id="note" data-note-drop-target></div></section><section id="browser" data-file-drop-target><div id="page"></div></section><section id="desktop" data-file-drop-target></section>');
    const code = ts.transpileModule(readFileSync(new URL("../lib/file-drop.ts", import.meta.url), "utf8").replace(/export /g, ""),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    await page.addScriptTag({ content: code });
    await page.evaluate(`
      window.states={};window.received=[];window.cleanups=[];
      for(const id of ['chat','browser','desktop']){
        const surface=document.getElementById(id);
        window.cleanups.push(registerFileDrop(document,{
          accepts:event=>ownsFileDrop(surface,event.target),
          containsTarget:target=>ownsFileDrop(surface,target),
          onActive:active=>window.states[id]=active,
          onFiles:files=>window.received.push({id,names:[...files].map(file=>file.name)}),
          resetTarget:window,
        }));
      }
      window.drag=(id,type,files=true)=>{
        const transfer=new DataTransfer();
        if(files)transfer.items.add(new File(['binary'],'sample.bin'));else transfer.setData('text/plain','internal text');
        const event=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer});
        document.getElementById(id).dispatchEvent(event);return event.defaultPrevented;
      };
    `);
    assert.equal(await page.evaluate("drag('message','dragover')"), true);
    assert.deepEqual(await page.evaluate("states"), { chat: true, browser: false, desktop: false });
    assert.equal(await page.evaluate("drag('page','dragover')"), true);
    assert.deepEqual(await page.evaluate("states"), { chat: false, browser: true, desktop: false });
    await page.evaluate("drag('page','drop')");
    assert.deepEqual(await page.evaluate("received"), [{ id: "browser", names: ["sample.bin"] }]);
    await page.evaluate("drag('desktop','dragover');drag('desktop','drop')");
    await page.evaluate("drag('message','dragover');drag('message','drop')");
    assert.deepEqual(await page.evaluate("received.map(item=>item.id)"), ["browser", "desktop", "chat"]);
    assert.equal(await page.evaluate("drag('sidebar','drop')"), false);
    assert.equal(await page.evaluate("drag('note','drop')"), false);
    assert.equal(await page.evaluate("drag('message','dragover',false)"), false);
    assert.deepEqual(await page.evaluate("states"), { chat: false, browser: false, desktop: false });
    await page.evaluate("drag('desktop','dragover');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    assert.deepEqual(await page.evaluate("states"), { chat: false, browser: false, desktop: false });
    await page.evaluate("cleanups.forEach(cleanup=>cleanup())");
    assert.equal(await page.evaluate("drag('page','drop')"), false);
    assert.equal(await page.evaluate("received.length"), 3);
  } finally { await browser.close(); }
});
