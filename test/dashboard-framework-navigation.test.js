"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
process.env.GN_FRAMEWORK_PATCH_TEST='1';
const {patchHtml,CLIENT_JS}=require('../src/dashboard-framework-navigation-v1');
test('final wrapper preserves existing DOM IDs and scripts, patches only once',()=>{
 const original='<title>GN PIVOT</title><body><div id="tabBody"></div><div id="top3"></div><script>window.refreshGN=()=>1;</script></body>';
 const actual=patchHtml(original);
 assert.ok(actual.includes(original.replace('</body>','')));
 assert.equal(patchHtml(actual),actual);
 assert.equal(patchHtml('<body>login</body>'),'<body>login</body>');
 assert.ok(actual.indexOf('window.refreshGN')<actual.indexOf('gn-framework-navigation-v1'));
});
test('injected browser script parses and preserves core document gates',()=>{
 assert.doesNotThrow(()=>new Function(CLIENT_JS));
 for(const s of ['텀프리미엄','브레이크이븐','30일·90일','ROIC','WACC','가격전가력','예상 가격 손실액','D−21','LINEA·XMR·ONT','1973~1982년'])assert.ok(CLIENT_JS.includes(s),s);
 assert.ok(CLIENT_JS.includes("legacy.hidden=!s"));
 assert.ok(CLIENT_JS.includes('tab.click()'));
 assert.ok(!CLIENT_JS.includes('fetch(')); // Existing API renderers retain sole ownership of live data.
});
test('framework runs as final response transformation',()=>{
 const source=fs.readFileSync(require.resolve('../src/start.js'),'utf8');
 assert.ok(source.indexOf('"dashboard-framework-navigation-v1.js"')<source.indexOf('"dashboard-authoritative-v1.js"'));
});
