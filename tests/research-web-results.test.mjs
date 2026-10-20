import test from "node:test";
import assert from "node:assert/strict";
import {researchSearchResults, researchFetchResults} from "../lib/mcp-core/research-web-results.mjs";
const text = value => ({content:[{type:"text",text:value}]});
test("canonical search adapters accept structured and textual fallback results without treating snippets as opened pages",()=>{
 const formatted="Title: First\nURL: https://example.org/1\nPublished: 2026\nHighlights:\nSeveral\nlines.\n---\nTitle: Second\nURL: https://example.org/2";
 const result=researchSearchResults(text(formatted));
 assert.equal(result.results.length,2);
 assert.equal(result.results[0].title,"First");
 assert.match(result.results[0].content,/Several\nlines/);
 assert.equal(result.results[1].url,"https://example.org/2");
 assert.equal(result.results[1].content,"");
 assert.equal(researchSearchResults(text(JSON.stringify({results:[{url:"https://example.org"}]}))).results.length,1);
 assert.throws(()=>researchSearchResults(text("No results")),/no structured/);
 assert.throws(()=>researchSearchResults({isError:true,content:[{type:"text",text:"Denied"}]}),/Denied/);
});
test("fetch adapter retains explicit browser routing and validates fallback source URLs",()=>{
 const page=text("# Source\nURL: https://example.org/1\n\nOriginal text.");
 const fetched=researchFetchResults(text(JSON.stringify({results:[{ok:false}],exa:page})),"https://example.org/1");
 assert.equal(fetched.results[0].ok,true);
 assert.match(fetched.results[0].content,/Original text/);
 const blocked={results:[{ok:false,requiresBrowser:true}],exa:page};
 assert.equal(researchFetchResults(blocked,"https://example.org/1").results[0].requiresBrowser,true);
 assert.throws(()=>researchFetchResults(text("No content found"),"https://example.org/1"),/identify/);
 assert.throws(()=>researchFetchResults(page,"https://example.org/other"),/identify/);
});
