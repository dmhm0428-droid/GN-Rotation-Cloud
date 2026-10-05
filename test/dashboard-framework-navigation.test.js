"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
process.env.GN_FRAMEWORK_PATCH_TEST='1';
const {patchHtml,CLIENT_JS}=require('../src/dashboard-framework-navigation-v1');
test('final response preserves live IDs and scripts and patches once',()=>{
 const original='<title>GN PIVOT</title><body><div id="tabBody"></div><div id="top3"></div><script>window.refreshGN=()=>1;</script></body>';
 const actual=patchHtml(original);assert.ok(actual.includes(original.replace('</body>','')));assert.equal(patchHtml(actual),actual);assert.equal(patchHtml('<body>login</body>'),'<body>login</body>');
 assert.ok(actual.indexOf('window.refreshGN')<actual.indexOf('gn-framework-navigation-v1'));assert.doesNotThrow(()=>new Function(CLIENT_JS));
});
test('result renderer runs after authoritative response transformation',()=>{
 const s=fs.readFileSync(require.resolve('../src/start.js'),'utf8');assert.ok(s.indexOf('"dashboard-framework-navigation-v1.js"')<s.indexOf('"dashboard-authoritative-v1.js"'));
});
test('actual HTML preserves dollar labels and contains executable injected JavaScript',()=>{
 const html=patchHtml('<title>GN PIVOT</title><body><div id="tabBody"></div></body></html>');
 const injected=html.match(/<script id="gn-framework-navigation-v1">([\s\S]*?)<\/script>/)[1];
 assert.equal(injected,CLIENT_JS);
 assert.doesNotThrow(()=>new Function(injected));
 assert.ok(injected.includes('원시세 $'));
});
