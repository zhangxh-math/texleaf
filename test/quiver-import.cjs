'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
// The parser and exporter are real; only inert browser startup/diagnostic elements are supplied.
const element = () => ({textContent:'',style:{},setAttribute(){},appendChild(n){this.textContent += n.textContent;}});
global.window = {addEventListener(){}};
global.document = {compatMode:'CSS1Compat',documentElement:{},addEventListener(){},createElement:element,createTextNode:textContent=>({textContent})};
(async () => {
  const {Parser} = await import(pathToFileURL(path.resolve('vendor/quiver/parser.mjs')).href);
  const {Quiver} = await import(pathToFileURL(path.resolve('vendor/quiver/quiver.mjs')).href);
  function parse(options) {
    const ui = {panel:{sep:{column:1.8,row:1.8}},settings:new Map([['export.cramped',false]])};
    const parser = new Parser(ui, options);
    parser.parse_diagram_options();
    return {ui,parser};
  }
  const imported = parse('[row sep=huge,column sep=small,cramped]');
  assert.deepEqual(imported.ui.panel.sep,{column:0.9,row:3.6});
  assert.equal(imported.ui.settings.get('export.cramped'),true);
  assert.equal(imported.parser.diagnostics.length,0);
  const exported = new Quiver().export('tikz-cd', imported.ui.settings, {sep:imported.ui.panel.sep}, {});
  assert.match(exported.data,/\\begin\{tikzcd\}\[cramped,column sep=small,row sep=huge\]/);
  for(const option of ['sep=1cm','row sep=0.333em','column sep=unknown']) {
    const unsupported = parse('['+option+']');
    assert.ok(unsupported.parser.diagnostics.length, option+' must require conversion consent');
  }
  assert.ok(parse('[mystery=42]').parser.diagnostics.length);
  assert.deepEqual(parse('[sep=large,column sep=0.90em]').ui.panel.sep,{column:0.9,row:2.7});
  console.log('quiver import spacing/cramped preserve export and unsupported values warn');
})().catch(error=>{console.error(error);process.exitCode=1;});
