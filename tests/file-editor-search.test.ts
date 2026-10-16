import assert from "node:assert/strict";
import test from "node:test";
import { minimatch } from "minimatch";
import { fileNameSearchPattern } from "../lib/file-editor-search";
test("plain filename queries match nested paths and case without treating brackets as patterns", () => {
 for (const [query, good, bad] of [
   ["config", "plugins/Example/Config.yml", "plugins/example/data.yml"],
   ["plugins/example/config", "plugins/Example/Config.yml", "plugins/other/config.yml"],
   ["file[1]", "nested/file[1].txt", "nested/file1.txt"],
   ["Größe", "nested/Größe.yml", "nested/other.yml"],
 ] as const) {
   const pattern=fileNameSearchPattern(query);
   assert.equal(minimatch(good,pattern),true,query);
   assert.equal(minimatch(bad,pattern),false,query);
 }
});
test("explicit filename globs preserve user intent", () => {
 assert.equal(fileNameSearchPattern("**/*.yml"),"**/*.yml");
 assert.equal(fileNameSearchPattern("*.json"),"*.json");
});
