'use strict';
// Native Linux acceptance against read-only corpus originals. Run serially under
// systemd-run MemoryMax=1G, MemorySwapMax=0. Artifacts live in .tmp/max-compat.
// Usage: node test/run-visual-compatibility-qa.cjs arXiv-2609.04378v1 [--full]
// Native regressions: node test/run-visual-compatibility-qa.cjs ime|synctex|synctex-global|table-edit
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {WebviewProbePool, connectWorkbench, findAvailablePort, delay} = require('./helpers/nativeWebview.cjs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.tmp/max-compat');
const paper = process.argv[2] || 'arXiv-2609.04378v1';
const confirmedFixes = process.argv.includes('--confirmed-fixes');
const imeAudit = paper === 'ime';
const localTable = paper === 'table-edit' && process.argv.includes('--local-table');
const enhancedPreview = localTable || process.argv.includes('--enhanced');
const preciseSynctex = paper === 'synctex-global';
const syntheticFixture = imeAudit || paper === 'synctex' || preciseSynctex;
const full = process.argv.includes('--full');
const frontMatterOnly = process.argv.includes('--front-matter');
const boundaryCase = process.argv.find(value=>value.startsWith('--boundary-case='))?.slice('--boundary-case='.length);
const boundaryAudit = process.argv.includes('--boundary-audit');
const sourceAudit = process.argv.includes('--source-audit');
const renderAudit = process.argv.includes('--render-audit');
const beamerAudit = process.argv.includes('--beamer-audit');
const exerciseCache = process.argv.includes('--exercise-cache');
const corpus = process.env.LATEX_TEST_ROOT || '/home/zhangxh/下载/Latex Test';
const guide = process.env.TEXLEAF_GUIDE || path.resolve(root, '../../output/pdf/texleaf-compatibility-guide.tex');
const fixture = ['performance', 'counters', 'compiled', 'source-access', 'title-citation', 'table-edit', 'diagram-edit', 'diagram-complex', 'quiver-edit'].includes(paper);
const folder = syntheticFixture ? root : paper === 'guide' ? path.dirname(guide) : fixture ? path.join(root, 'test/fixtures/visual-compatibility', paper) : path.join(corpus, paper);
const filename = syntheticFixture ? paper+'.tex' : paper === 'guide' ? path.basename(guide) : fs.readdirSync(folder).find(name => name.endsWith('.tex') && /\\documentclass\b/u.test(fs.readFileSync(path.join(folder, name), 'utf8')));
assert.ok(filename, 'paper entry point');
const source = syntheticFixture ? String.raw`\documentclass{beamer}
${preciseSynctex ? String.raw`\let\OriginalFrame\frame
\renewcommand{\frame}[1][]{\OriginalFrame[fragile=singleslide,#1]}` : ""}
\begin{document}
${!imeAudit ? String.raw`\begin{frame}{Previous slide}
This frame must not receive the next slide's SyncTeX navigation.
\end{frame}
` : ""}\begin{frame}{Partitions}
Let $P_{g-1}$ be the set of partitions.
\begin{itemize}
\item $l_1<l_2$
\item $l_1=l_2$ and \(d_{j}^{(1)}<d\)
\end{itemize}
\end{frame}
\end{document}
` : fs.readFileSync(path.join(folder, filename), 'utf8').replace(/\r\n?/g, '\n');
const report = {paper, full, frontMatterOnly, renderAudit, modes: [], interactions: []};
let owned, child, log, workbench, pool;
const count = () => fs.existsSync(path.join(owned, 'launches.jsonl')) ? fs.readFileSync(path.join(owned, 'launches.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
const waitFor = async (read, predicate, label, timeout=30000) => {
  const end = Date.now() + timeout; let value;
  do { value = await read(); if (predicate(value)) return value; await delay(100); } while(Date.now() < end);
  throw Error(`Timeout: ${label}: ${JSON.stringify(value)}`);
};
const snapshotExpression = `(()=>{const v=window.__paperView;return {
 sourceFrom:v.lineBlockAtHeight(v.scrollDOM.scrollTop).from,
 sourceTo:v.lineBlockAtHeight(Math.min(v.contentHeight-1,v.scrollDOM.scrollTop+v.scrollDOM.clientHeight)).to,
 top:v.scrollDOM.scrollTop,height:v.scrollDOM.scrollHeight,viewport:v.scrollDOM.clientHeight,
 mode:document.querySelector('#visual-mode-button')?.textContent,
 formulas:document.querySelectorAll('.texleaf-formula-widget svg').length,
 hints:document.querySelectorAll('.texleaf-enhanced-visualization-hint').length,
 errors:[...document.querySelectorAll('[data-texleaf-render-error],.texleaf-math-preview-tooltip-error,svg[aria-label^="公式渲染失败"]')].map(e=>({message:e.dataset.texleafRenderError??e.getAttribute('aria-label'),source:e.dataset.formulaSource??e.textContent})),
 graphs:[...document.querySelectorAll('.texleaf-tikzpicture-card')].map(e=>({text:e.textContent.slice(0,300),svg:e.querySelectorAll('.texleaf-local-latex-preview svg').length,source:e.closest('[data-texleaf-line-number-anchor-id]')?.dataset.texleafLineNumberAnchorId})),
 footnotes:[...document.querySelectorAll('.texleaf-footnote-marker')].map(e=>({text:e.textContent,title:e.title})),
 title:document.querySelector('.texleaf-document-title')?.textContent,
 sourceLength:v.state.doc.length};})()`;
(async()=>{try {
 assert.equal(process.platform,'linux','This native runner uses Linux executable wrappers.');
 fs.mkdirSync(out,{recursive:true});
 owned=fs.mkdtempSync(path.join(out,`native-${paper}-`));report.directory=owned;
 const user=path.join(owned,'user'), workspace=path.join(owned,'workspace'), extensions=path.join(owned,'extensions'), bin=path.join(owned,'bin');
 for(const dir of [path.join(user,'User'),workspace,extensions,bin])fs.mkdirSync(dir,{recursive:true});
 if(paper==='compiled'||paper==='synctex'||preciseSynctex){assert.ok(process.env.TEXLEAF_WORKSHOP_PATH,'Set TEXLEAF_WORKSHOP_PATH to an installed LaTeX Workshop directory.');fs.cpSync(path.resolve(process.env.TEXLEAF_WORKSHOP_PATH),path.join(extensions,'james-yu.latex-workshop'),{recursive:true});}
 if(syntheticFixture)fs.writeFileSync(path.join(workspace,filename),source);else if(paper==='guide')fs.copyFileSync(guide,path.join(workspace,filename));else fs.cpSync(folder,workspace,{recursive:true});
 for(const engine of ['latex','pdflatex','xelatex']){
  const executable=spawnSync('which',[engine],{encoding:'utf8'}).stdout.trim();assert.ok(executable,engine);
  fs.writeFileSync(path.join(bin,engine),`#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(path.join(owned,'launches.jsonl'))},JSON.stringify({engine:${JSON.stringify(engine)},time:Date.now(),cwd:process.cwd()})+'\\n');const start=()=>{if(fs.existsSync(${JSON.stringify(path.join(owned,'hold-tex'))})){setTimeout(start,25);return;}const child=require('node:child_process').spawn(${JSON.stringify(executable)},process.argv.slice(2),{stdio:'inherit'});child.on('exit',(code)=>process.exit(code??1));child.on('error',()=>process.exit(1));};start();`,{mode:0o755});
 }
 fs.writeFileSync(path.join(user,'User/settings.json'),JSON.stringify({
  'workbench.startupEditor':'none','extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,
  'telemetry.telemetryLevel':'off','update.mode':'none','security.workspace.trust.enabled':false,
  'files.autoSave':'off','latex-workshop.latex.autoBuild.run':'never','texleaf.visualEditor.texBinPath':bin,
  'texleaf.visualEditor.compatibilityMode':enhancedPreview?'maximum':'basic','window.zoomLevel':0,
  ...(confirmedFixes ? {'workbench.colorCustomizations': {'editor.lineHighlightBackground':'#ffcc00','editor.selectionBackground':'#0000ff','textCodeBlock.background':'#ffcc00'}} : {}),
  ...(paper==='synctex'||preciseSynctex?{
   'latex-workshop.latex.outDir':'%DIR%', 'latex-workshop.view.pdf.viewer':'tab',
   'latex-workshop.view.pdf.zoom':'page-fit', 'latex-workshop.view.pdf.internal.synctex.keybinding':'ctrl-click',
   'latex-workshop.synctex.indicator':'rectangle', 'latex-workshop.synctex.afterBuild.enabled':false,
  }:{}),
 }));
 const testFile=path.join(owned,'extension.cjs'),done=path.join(owned,'done');
 fs.writeFileSync(testFile,`const vscode=require('vscode'),fs=require('node:fs');exports.run=async()=>{
 const ext=vscode.extensions.getExtension('zhangxh-math.texleaf');if(!ext)throw Error('extension missing');await ext.activate();
 const uri=vscode.Uri.file(${JSON.stringify(path.join(workspace,filename))});await vscode.workspace.getConfiguration('texleaf',uri).update('visualEditor.compatibilityMode',${JSON.stringify(enhancedPreview?'maximum':'basic')},vscode.ConfigurationTarget.WorkspaceFolder);const doc=await vscode.workspace.openTextDocument(uri);
 await vscode.commands.executeCommand('vscode.openWith',uri,'texleaf.visualEditor');
 const end=Date.now()+480000;while(Date.now()<end&&!fs.existsSync(${JSON.stringify(done)})){
 const modeRequest=${JSON.stringify(path.join(owned,'mode-request'))};if(fs.existsSync(modeRequest)){const mode=fs.readFileSync(modeRequest,'utf8');fs.unlinkSync(modeRequest);await vscode.workspace.getConfiguration('texleaf',uri).update('visualEditor.compatibilityMode',mode,vscode.ConfigurationTarget.WorkspaceFolder);}
 const zoomRequest=${JSON.stringify(path.join(owned,'preview-zoom-request'))};if(fs.existsSync(zoomRequest)){const zoom=Number(fs.readFileSync(zoomRequest,'utf8'));fs.unlinkSync(zoomRequest);await vscode.workspace.getConfiguration('texleaf',uri).update('visualEditor.previewZoomPercent',zoom,vscode.ConfigurationTarget.WorkspaceFolder);}

 fs.writeFileSync(${JSON.stringify(path.join(owned,'host.next'))},JSON.stringify({mode:vscode.workspace.getConfiguration('texleaf',uri).get('visualEditor.compatibilityMode'),dirty:doc.isDirty,text:doc.getText().replace(/\\r\\n?/g,"\\n"),length:doc.getText().replace(/\\r\\n?/g,"\\n").length}));fs.renameSync(${JSON.stringify(path.join(owned,'host.next'))},${JSON.stringify(path.join(owned,'host.json'))});await new Promise(r=>setTimeout(r,150));}};`);
 const port=await findAvailablePort();report.port=port;log=fs.openSync(path.join(owned,'code.log'),'w');
 const env={...process.env,DISPLAY:process.env.DISPLAY||':0',XDG_CONFIG_HOME:path.join(owned,'xdg')};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(process.env.VSCODE_EXECUTABLE||'/usr/bin/code',[
  `--user-data-dir=${user}`,`--extensions-dir=${extensions}`,'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-telemetry','--sync','off','--new-window','--wait','--disable-gpu','--js-flags=--max-old-space-size=128','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--extensionDevelopmentPath=${root}`,`--extensionTestsPath=${testFile}`,workspace,
 ],{cwd:root,env,detached:true,stdio:['ignore',log,log]});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
 pool=new WebviewProbePool(port);workbench=await connectWorkbench(port,'');await workbench.client.request('Page.bringToFront');
 try{const {windowId}=await workbench.client.request('Browser.getWindowForTarget',{targetId:workbench.target.id});await workbench.client.request('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await workbench.client.request('Browser.setWindowBounds',{windowId,bounds:{width:1440,height:1000}});}catch{}
 const {client}=await pool.waitFor(`!!document.querySelector('.cm-content')`,v=>v===true,'visual editor',60000);
 await client.evaluate(`window.__paperView=document.querySelector('.cm-content').cmTile?.root?.view;true`);
 if(confirmedFixes){
  await require('./helpers/visualConfirmedFixes.cjs')({client,pool,workbench,owned,report,waitFor,source});
  report.success=true;return;
 }
 if(renderAudit)await client.evaluate(`(()=>{
  const original=window.__paperView.state.doc.toString(),seen=new Set();window.__paperRenderFailures=[];
  const capture=()=>{for(const e of document.querySelectorAll('[data-texleaf-render-error],.texleaf-math-preview-tooltip-error,svg[aria-label^="公式渲染失败"]')){
   const v=window.__paperView,entry={message:e.dataset.texleafRenderError??e.getAttribute('aria-label'),source:e.dataset.formulaSource??e.textContent,mode:document.querySelector('#visual-mode-button')?.textContent,originalSource:v.state.doc.toString()===original,anchor:v.state.selection.main.head};
   const key=JSON.stringify(entry);if(!seen.has(key)){seen.add(key);window.__paperRenderFailures.push(entry);}
  }};
  new MutationObserver(capture).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-texleaf-render-error','class','aria-label']});capture();return true;
 })()`);
 await client.evaluate(`document.addEventListener('pointerdown',e=>{const line=e.target.closest?.('.cm-line');window.__paperLastPointer={x:e.clientX,y:e.clientY,target:e.target.className,line:line?window.__paperView.posAtDOM(line,0):null};},true);true`);
 await delay(1400);
 await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});document.querySelector('.texleaf-preamble-header[aria-expanded="true"]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
 const shot=async name=>{const result=await workbench.client.request('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(owned,name+'.png'),Buffer.from(result.data,'base64'));};
 const scroll=async pos=>{await client.evaluate(`window.__paperView.dispatch({effects:window.__paperView.constructor.scrollIntoView(${pos},{y:'start',yMargin:32})});true`);await delay(450);};


 if(paper==='diagram-complex'){
  if(enhancedPreview){
   await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-local-latex-preview svg')`),v=>v===true,'enhanced diagram SVG',20000);
   const renderedCount=count();
   const inspect=()=>client.evaluate(`(()=>{const root=document.querySelector('.texleaf-local-latex-preview');if(!root)return null;const svg=root.querySelector('svg'),r=svg.getBoundingClientRect();return {width:r.width,height:r.height,background:getComputedStyle(root).backgroundColor,zoom:[...root.querySelectorAll('button')].map(e=>e.textContent),ink:[...svg.querySelectorAll('path,rect,line,polygon,use')].flatMap(e=>[getComputedStyle(e).fill,getComputedStyle(e).stroke]).filter(c=>c!=='none')};})()`);
   await client.evaluate(`document.documentElement.style.setProperty('--vscode-editor-foreground','#eeeeee');document.documentElement.style.setProperty('--vscode-editorWidget-background','#202020');true`);
   const dark=await inspect();
   assert.equal(dark.background,'rgb(241, 241, 241)','opaque paper preview');
   assert.ok(dark.zoom.includes('150% · 重置'),'readable 150% default');
   assert.ok(dark.ink.includes('rgb(0, 0, 0)'),'original dark ink remains readable on paper');
   assert.ok(dark.ink.includes('rgb(255, 0, 0)')&&dark.ink.includes('rgb(0, 0, 255)'),'authored red and blue stay colored');
   assert.ok(!dark.ink.includes('rgb(238, 238, 238)'),'outside dark theme does not recolor paper ink');
   await shot('enhanced-dark-preview');
   assert.ok(!dark.ink.includes('rgb(255, 255, 255)'), 'default description label matches the paper');
   assert.ok(dark.ink.includes('rgb(241, 241, 241)'), 'label knockout paint uses paper background');
   await client.evaluate(`(()=>{const root=document.querySelector('.texleaf-local-latex-preview');[...root.querySelectorAll('button')].find(b=>b.textContent==='放大').click();return true;})()`);
   const larger=await inspect();assert.ok(Math.abs(larger.width/dark.width-7/6)<0.02&&Math.abs(larger.height/dark.height-7/6)<0.02,'proportional enlargement');
   await client.evaluate(`(()=>{const root=document.querySelector('.texleaf-local-latex-preview');[...root.querySelectorAll('button')].find(b=>b.textContent.includes('重置')).click();document.documentElement.style.setProperty('--vscode-editor-foreground','#222222');document.documentElement.style.setProperty('--vscode-editorWidget-background','#f0f0f0');return true;})()`);
   const light=await inspect();assert.deepEqual(light.ink,dark.ink,'paper ink is stable across surrounding themes');
   assert.equal(light.background,dark.background,'paper background is stable across surrounding themes');
   assert.ok(Math.abs(light.width-dark.width)<1,'reset returns to default');
   fs.writeFileSync(path.join(owned,'preview-zoom-request'),'125');
   const configured=await waitFor(inspect,v=>v?.zoom.includes('125% · 重置'),'configured default applied to mounted preview');
   assert.ok(Math.abs(configured.width/dark.width-5/6)<0.02,'configured default reaches webview from VS Code settings');
   await client.evaluate(`(()=>{const root=document.querySelector('.texleaf-local-latex-preview');[...root.querySelectorAll('button')].find(b=>b.textContent==='放大').click();return true;})()`);
   assert.ok((await inspect()).zoom.includes('150% · 重置'),'manual zoom starts at configured default');
   await client.evaluate(`(()=>{const root=document.querySelector('.texleaf-local-latex-preview');[...root.querySelectorAll('button')].find(b=>b.textContent.includes('重置')).click();return true;})()`);
   assert.ok((await inspect()).zoom.includes('125% · 重置'),'reset returns to configured default');
   assert.equal(count(),renderedCount,'zoom and color changes do not rerun TeX');
   assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source,'preview controls preserve source');
   await client.evaluate(`document.documentElement.style.removeProperty('--vscode-editor-foreground');document.documentElement.style.removeProperty('--vscode-editorWidget-background');true`);
   report.interactions.push({name:'native enhanced dark/light colors and proportional zoom',success:true,dark,larger,light});
  }
  await client.evaluate(`(()=>{const v=window.__paperView;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('After the diagram.')}});v.focus();return true;})()`);
  await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-tikzcd-card')`),v=>v===true,'complex diagram');
  assert.equal(await client.evaluate(`document.querySelectorAll('.texleaf-tikzcd-card > .texleaf-structure-actions button').length`),2,'one visual editor plus source access');
  await client.evaluate(`document.querySelector('.texleaf-tikzcd-card .texleaf-structure-action-primary').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));true`);
  await waitFor(()=>client.evaluate(`document.querySelector('.texleaf-quiver-editor label')?.hidden`),v=>v===false,'complex import compatibility notice');
  await shot('complex-quiver-editor');
  await client.evaluate(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='应用修改').click();true`);
  await waitFor(()=>client.evaluate(`!document.querySelector('.texleaf-quiver-editor')`),v=>v===true,'unchanged complex diagram closes');
  assert.equal(await client.evaluate('window.__paperView.state.doc.toString()'),source,'unchanged complex source is preserved exactly');
  assert.equal(JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).text,source);
  report.interactions.push({name:'one graphical editor, complex import notice and no-op preserve source',success:true});
  report.success=true;return;
 }

 if(paper==='quiver-edit'||paper==='diagram-edit'){
  const parentContext=client.preferredContextId;
  const parentEval=expression=>client.evaluate(expression,15000,parentContext);
  const original=await parentEval('window.__paperView.state.doc.toString()');
  await waitFor(()=>parentEval(`!!document.querySelector('.texleaf-tikzcd-card')`),v=>v===true,'diagram card');
  assert.equal(await parentEval(`!!document.querySelector('.texleaf-tikzcd-basic-edit')`),false,'only one graphical editor is offered');
  const open=async()=>{
   await waitFor(()=>parentEval(`(()=>{const card=document.querySelector('.texleaf-tikzcd-card');return !!card && window.__paperView.state.doc.toString().includes(card.dataset.texleafTikzcdSource);})()`),v=>v===true,'updated diagram card');
   await parentEval(`document.querySelector('.texleaf-tikzcd-card .texleaf-structure-action-primary').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));true`);
   await waitFor(()=>parentEval(`!!document.querySelector('.texleaf-quiver-editor button:not(:disabled) + button:not(:disabled)')`),v=>v===true,'quiver import',15000);
   const probe=await pool.waitFor(`!!document.querySelector('.side.panel') && document.querySelectorAll('.arrow.cell').length===4`,v=>v===true,'quiver canvas',15000);
   const context=probe.client.preferredContextId;
   return expression=>probe.client.evaluate(expression,15000,context);
  };
  const apply=()=>parentEval(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='应用修改').click();true`);
  const closed=()=>waitFor(()=>parentEval(`!document.querySelector('.texleaf-quiver-editor')`),v=>v===true,'quiver close');
  let childEval=await open();
  report.cardAppearance=await parentEval(`({background:getComputedStyle(document.querySelector('.texleaf-tikzcd-card')).backgroundColor,color:getComputedStyle(document.querySelector('.texleaf-tikzcd-card')).color})`);
  assert.equal(report.cardAppearance.background,'rgb(241, 241, 241)');assert.equal(report.cardAppearance.color,'rgb(0, 0, 0)');
  report.quiverUi=await childEval(`({vertices:document.querySelectorAll('.vertex').length,arrows:document.querySelectorAll('.arrow.cell').length,fonts:document.fonts.status,resources:performance.getEntriesByType('resource').map(e=>e.name)})`);
  assert.equal(report.quiverUi.vertices,4);assert.equal(report.quiverUi.arrows,4);
  assert.equal(await childEval(`getComputedStyle(document.querySelector('.global.panel')).display`),'none','standalone import/export bar is removed');
  await childEval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',ctrlKey:true,bubbles:true,cancelable:true}));true`);
  assert.equal(await childEval(`!!document.querySelector('.port:not(.hidden)')`),false,'standalone export shortcut is disabled');
  await apply();await closed();
  assert.equal(await parentEval('window.__paperView.state.doc.toString()'),original,'unchanged application preserves exact handwritten source');
  childEval=await open();
  await childEval(`(()=>{const e=document.querySelector('.arrow.cell');for(const type of ['pointerdown','pointerup'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));return true;})()`);
  await waitFor(()=>childEval(`!document.querySelector('.side.panel').classList.contains('hidden')`),v=>v===true,'selected arrow panel');
  report.panel=await childEval(`({text:document.querySelector('.side.panel').innerText,background:getComputedStyle(document.querySelector('.side.panel .wrapper')).backgroundColor,radios:document.querySelectorAll('.side.panel input[type=radio]').length})`);
  assert.match(report.panel.text,/反向箭头/);assert.match(report.panel.text,/标签位置/);assert.ok(report.panel.radios>=25);
  assert.equal(report.panel.background,'rgb(241, 241, 241)');
  await childEval(`(()=>{const input=document.querySelector('.label-input');input.value='\\\\psi';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await childEval(`document.querySelector('input[name="body-type"][value="dashed"]').click();true`);
  await childEval(`(()=>{const track=document.querySelector('.slider[data-name="curve"] .track'),r=track.getBoundingClientRect();track.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:r.x+r.width*.7,clientY:r.y+r.height/2,pointerType:'mouse'}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));return true;})()`);
  await parentEval(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='放大 / 还原').click();true`);
  fs.writeFileSync(path.join(owned,'quiver.png'),Buffer.from((await workbench.client.request('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await parentEval(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='放大 / 还原').click();true`);
  fs.writeFileSync(path.join(owned,'quiver-card.png'),Buffer.from((await workbench.client.request('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await apply();await closed();
  const edited=await parentEval('window.__paperView.state.doc.toString()');
  assert.match(edited,/psi/);assert.match(edited,/dashed/);assert.match(edited,/curve=/);assert.match(edited,/texleaf-quiver-v1:/);
  assert.ok(edited.includes('\\usepackage{quiver}'),'the main document loads quiver in the same undoable edit');
  fs.writeFileSync(path.join(owned,'quiver-edited.tex'),edited);
  if(enhancedPreview){
   const compile=spawnSync('pdflatex',['-interaction=nonstopmode','-halt-on-error','-no-shell-escape',`-output-directory=${owned}`,path.join(owned,'quiver-edited.tex')],{cwd:owned,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
   fs.writeFileSync(path.join(owned,'quiver-compile.log'),compile.stdout+compile.stderr);
   assert.equal(compile.status,0,'generated diagram compiles as a complete document');
  }
  if(enhancedPreview)await waitFor(()=>parentEval(`!!document.querySelector('.texleaf-local-latex-preview svg') && document.querySelector('.texleaf-tikzcd-card')?.dataset.texleafTikzcdSource.includes('texleaf-quiver-v1:')`),v=>v===true,'quiver local TeX preview',25000);
  await waitFor(()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).text,t=>t===edited,'quiver applied to host');
  childEval=await open();
  assert.equal(await parentEval(`document.querySelector('.texleaf-quiver-editor label').hidden`),true,'stored native graph bypasses lossy TikZ import');
  await apply();await closed();
  assert.equal(await parentEval('window.__paperView.state.doc.toString()'),edited,'reopening and applying preserves exact generated source');
  childEval=await open();
  await childEval(`(()=>{const e=document.querySelector('.arrow.cell');for(const type of ['pointerdown','pointerup'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));document.querySelector('input[name="head-type"][value="multimap"]').click();const track=document.querySelector('.slider[data-name="level"] .track'),r=track.getBoundingClientRect();track.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:r.x+r.width*.5,clientY:r.y+r.height/2,pointerType:'mouse'}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));return true;})()`);
  await apply();
  await waitFor(()=>parentEval(`document.querySelector('.texleaf-quiver-editor p')?.textContent`),t=>t?.includes('TikZ 无法准确表示'),'unsupported export is not silently flattened');
  assert.equal(await parentEval('window.__paperView.state.doc.toString()'),edited);
  await parentEval(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='取消').click();true`);await closed();
  await parentEval(`window.__paperView.focus();window.__paperView.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));true`);
  await waitFor(()=>parentEval('window.__paperView.state.doc.toString()'),text=>text===original,'undo quiver application');
  const unsupported=original.replace('\\begin{tikzcd}', '\\begin{tikzcd}[every arrow/.append style={red}]');
  await parentEval(`window.__paperView.dispatch({changes:{from:0,to:window.__paperView.state.doc.length,insert:${JSON.stringify(unsupported)}}});true`);
  childEval=await open();
  assert.equal(await parentEval(`document.querySelector('.texleaf-quiver-editor label').hidden`),false,'unsupported handwritten options are visible before editing');
  await childEval(`(()=>{const e=document.querySelector('.arrow.cell');for(const type of ['pointerdown','pointerup'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));const input=document.querySelector('.label-input');input.value='g';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await apply();
  await waitFor(()=>parentEval(`document.querySelector('.texleaf-quiver-editor p')?.textContent`),t=>t?.includes('请先勾选'),'explicit conversion protection');
  assert.equal(await parentEval('window.__paperView.state.doc.toString()'),unsupported);
  await parentEval(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='取消').click();true`);await closed();
  assert.equal(await parentEval('window.__paperView.state.doc.toString()'),unsupported,'cancel preserves unsupported options');
  report.success=true;return;
 }

 if(paper==='table-edit'){
  const checks=[];
  const check=async(name,run)=>{try{await run();checks.push({name,success:true});}catch(error){checks.push({name,success:false,error:String(error.message)});process.stdout.write(JSON.stringify(checks.at(-1))+'\n');throw error;}process.stdout.write(JSON.stringify(checks.at(-1))+'\n');};
  const key=async(key,code,keyCode,text)=>{
   await workbench.client.request('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,...(text?{text,unmodifiedText:text}:{})});
   await workbench.client.request('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
  };
  const open=async()=>{
   await client.evaluate(`(()=>{const v=window.__paperView;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('After the table.')}});v.focus();return true;})()`);
   await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-table-card')`),v=>v===true,'table card');
   await client.evaluate(`(()=>{const card=document.querySelector('.texleaf-table-card');if(!card.querySelector('.texleaf-visual-structure-editor'))card.querySelector('.texleaf-structure-action-primary').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return true;})()`);
   await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-table-cell-input')`),v=>v===true,'table inputs');
   await delay(200);
  };
  await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-table-card')`),v=>v===true,'initial table');
  await check('expanded table source has Math Preview',async()=>{
   await client.evaluate(`(()=>{const card=document.querySelector('.texleaf-table-card');[...card.querySelectorAll('button')].find(e=>e.textContent==='编辑环境源码').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return true;})()`);
   const pos=source.indexOf(localTable?String.raw`\ydiagram`:String.raw`\frac`)+4;
   await scroll(pos);
   await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${pos}}});window.__paperView.focus();true`);
   await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-math-preview-tooltip svg')`),v=>v===true,'source Math Preview',localTable?20000:4000);
   if(localTable){
    fs.writeFileSync(path.join(owned,'local-table-tooltip.html'),await client.evaluate(`document.querySelector('.texleaf-math-preview-tooltip').outerHTML`));
    assert.equal(await client.evaluate(`!!document.querySelector('.texleaf-math-preview-tooltip svg path,.texleaf-math-preview-tooltip svg rect')`),true,'first entry produces local TeX geometry');
    assert.ok(count()>0,'local TeX is exercised');
   }
   assert.equal(await client.evaluate(`document.querySelectorAll('.texleaf-table-card').length`),0,'whole table remains in source form');
   await shot('table-source-preview');
  });
  await open();
  await check('mixed cell previews math after moving the caret without editing',async()=>{
   await client.evaluate(`(()=>{const e=[...document.querySelectorAll('.texleaf-table-cell-input')].find(e=>e.value.startsWith('Genus'));e.setSelectionRange(0,0);e.focus();window.__tableInput=e;return true;})()`);
   await delay(200);
   await key('End','End',35);
   await key('ArrowLeft','ArrowLeft',37);
   await key('ArrowLeft','ArrowLeft',37);
   await key('ArrowLeft','ArrowLeft',37);
   await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-virtual-math-preview svg')`),v=>v===true,'mixed cell Math Preview',4000);
   assert.equal(await client.evaluate(`window.__tableInput.value`),String.raw`Genus \(g(d)\)`,'caret movement preserves cell text');
   await shot('table-mixed-preview');
  });
  await check('mixed preview aligns with opening delimiter',async()=>{
   const layout=await client.evaluate(`(()=>{const e=window.__tableInput,p=document.querySelector('.texleaf-virtual-math-preview');const s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font=s.font;const expected=e.getBoundingClientRect().left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft)+c.measureText(e.value.slice(0,e.value.indexOf(String.fromCharCode(92)+'('))).width-e.scrollLeft;return {expected,left:p.getBoundingClientRect().left};})()`);
   assert.ok(Math.abs(layout.left-layout.expected)<2,JSON.stringify(layout));
  });
  const fields=await client.evaluate(`[...document.querySelectorAll('.texleaf-visual-structure-editor input[type="text"]')].filter(e=>!e.disabled).map(e=>e.getAttribute('aria-label'))`);
  for(const label of fields){
   await open();
   await check('Space stays inside '+label,async()=>{
    const before=await client.evaluate(`(()=>{const e=[...document.querySelectorAll('.texleaf-visual-structure-editor input')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)});e.focus();e.setSelectionRange(e.value.length,e.value.length);window.__tableInput=e;return e.value;})()`);
    await key(' ','Space',32,' ');
    await delay(250);
    const after=await client.evaluate(`({connected:window.__tableInput.isConnected,focused:document.activeElement===window.__tableInput,value:window.__tableInput.value,source:window.__paperView.state.doc.toString()})`);
    assert.ok(after.connected&&after.focused,'input remains mounted and focused: '+JSON.stringify(after));
    assert.equal(after.value,before+' ','exactly one space is inserted');
    assert.equal(after.source,source,'draft editing does not rewrite source');
   });
  }
  const insertions=await client.evaluate(`[...document.querySelectorAll('#toolbar button,.toolbar-popup-menu button,#editing-context-menu button')].map((e,index)=>({index,command:e.getAttribute('data-texleaf-insert')??e.getAttribute('data-texleafz-insert')})).filter(e=>e.command)`);
  for(const item of insertions){
   await check('toolbar/context insertion '+item.command,async()=>{
    await client.evaluate(`(()=>{const v=window.__paperView;const p=v.state.doc.toString().indexOf('After the table.');v.dispatch({selection:{anchor:p,head:p+5}});v.focus();const b=[...document.querySelectorAll('#toolbar button,.toolbar-popup-menu button,#editing-context-menu button')][${item.index}];const menu=b.closest('.toolbar-popup-menu');if(menu){const trigger=document.querySelector('[data-toolbar-menu="'+menu.id+'"]');trigger.click();if(menu.hidden)throw Error('menu did not open');}b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));b.click();return true;})()`);
    const changed=await client.evaluate(`window.__paperView.state.doc.toString()`);
    assert.notEqual(changed,source,'choosing a menu item changes document content');
    await waitFor(()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).text,v=>v===changed,'host insertion',3000);
    await client.evaluate(`document.querySelector('#edit-undo').click();true`);
    await waitFor(()=>client.evaluate(`window.__paperView.state.doc.toString()`),v=>v===source,'toolbar insertion undo',3000);
    await waitFor(()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).text,v=>v===source,'host undo',3000);
   });
  }
  report.interactions=checks;
  process.stdout.write(JSON.stringify(checks)+'\n');
  assert.ok(checks.every(c=>c.success),'all table editing checks pass');
  assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source,'inspection preserves exact source');
  report.success=true;return;
 }

 if(paper==='synctex'||preciseSynctex){
  assert.ok(spawnSync('which',['synctex'],{encoding:'utf8'}).stdout.trim(),'native synctex is required for Workshop rectangle indicators');
  const frameStart=source.indexOf(String.raw`\begin{frame}{Partitions}`);
  const anchor=source.indexOf(preciseSynctex?'Let ':'d_{j}',frameStart);
  const frameEnd=source.indexOf(String.raw`\end{frame}`,frameStart);
  // Workshop does not build implicitly when its SyncTeX command is called.
  await waitFor(()=>client.evaluate(`document.querySelector('#build-pdflatex').disabled`),v=>v===false,'Workshop build available');
  await client.evaluate(`document.querySelector('#build-pdflatex').click();true`);
  const stem=path.join(workspace,path.basename(filename,'.tex'));
  await waitFor(()=>{
   const pdf=stem+'.pdf',synctex=stem+'.synctex.gz',log=stem+'.log';
   return fs.existsSync(pdf)&&fs.statSync(pdf).size>0&&fs.existsSync(synctex)&&fs.statSync(synctex).size>0&&fs.existsSync(log)&&fs.readFileSync(log,'utf8').includes('Output written on');
  },v=>v===true,'Workshop PDF and SyncTeX build artifacts',60000);
  await client.evaluate(`document.querySelector('#top-view-pdf').click();true`);
  // The standard pool follows TeXLeaf only; Workshop hosts PDF.js in a second,
  // localhost iframe inside its own extension Webview.
  pool.targets=async()=>{
   const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});
   const targets=await response.json();
   return targets.filter(target=>target.type==='iframe'&&typeof target.webSocketDebuggerUrl==='string'&&
    (/(?:[?&])extensionId=(?:zhangxh-math\.texleaf|james-yu\.latex-workshop)(?:&|$)/iu.test(target.url??'')||
     /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/viewer\.html\?/u.test(target.url??'')));
  };
  const pdf=await pool.waitFor(`!!globalThis.PDFViewerApplication?.pdfDocument&&PDFViewerApplication.pdfDocument.numPages===2&&document.querySelectorAll('#viewer .page').length===2`,v=>v===true,'Workshop two-slide PDF viewer',60000);
  // Observe the native indicator before clicking; Workshop removes rectangles
  // when their one-second animation ends.
  await pdf.client.evaluate(`(()=>{window.__workshopForwardIndicators=[];new MutationObserver(records=>{
   for(const record of records)for(const e of record.addedNodes){if(!(e instanceof Element)||!e.matches('.synctex-indicator-rect'))continue;
    const b=e.getBoundingClientRect(),y=(b.top+b.bottom)/2;
    const page=[...document.querySelectorAll('#viewer .page')].find(p=>{const r=p.getBoundingClientRect();return y>=r.top&&y<=r.bottom;});
    const p=page?.getBoundingClientRect();window.__workshopForwardIndicators.push({page:Number(page?.dataset.pageNumber),width:b.width,height:b.height,pageWidth:p?.width,pageHeight:p?.height});
   }}).observe(document.querySelector('#viewerContainer'),{childList:true,subtree:true});return true;})()`);
  for(const target of preciseSynctex?[anchor]:[anchor,frameEnd]){
   await scroll(target);
   await pdf.client.evaluate(`window.__workshopForwardIndicators=[];true`);
   await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${target}}});document.querySelector('#synctex').click();true`);
   const indicator=await waitFor(()=>pdf.client.evaluate(`window.__workshopForwardIndicators.at(-1)`),v=>v?.width>0&&v?.height>0,'Workshop forward rectangle',10000);
   assert.equal(indicator.page,2,'forward SyncTeX must target the second slide, never its predecessor');
   if(preciseSynctex)assert.ok(indicator.height<indicator.pageHeight*.2,'global direct frames retain row-level highlights');
   await waitFor(()=>pdf.client.evaluate(`PDFViewerApplication.pdfViewer.currentPageNumber`),v=>v===2,'Workshop scrolls to the second slide');
   report.interactions.push({check:'Workshop forward SyncTeX',target,indicator});
   await shot(target===frameEnd?'workshop-forward-frame-end':'workshop-forward-body');
  }
  const textSelector='#viewer .page[data-page-number="2"] .textLayer span';
  const reverseText=preciseSynctex?'Let':'Partitions';
  await waitFor(()=>pdf.client.evaluate(`[...document.querySelectorAll(${JSON.stringify(textSelector)})].some(e=>e.textContent.includes(${JSON.stringify(reverseText)}))`),v=>v===true,'Workshop second-slide text layer');
  await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);
  const click=await pdf.client.evaluate(`(()=>{const span=[...document.querySelectorAll(${JSON.stringify(textSelector)})].find(e=>e.textContent.includes(${JSON.stringify(reverseText)}));span.scrollIntoView({block:'center'});const b=span.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,text:span.textContent};})()`);
  // Exercise Workshop's real page onclick handler with its configured Ctrl+click.
  await pdf.client.request('Input.dispatchMouseEvent',{type:'mouseMoved',x:click.x,y:click.y});
  await pdf.client.request('Input.dispatchMouseEvent',{type:'mousePressed',x:click.x,y:click.y,button:'left',buttons:1,modifiers:2,clickCount:1});
  await pdf.client.request('Input.dispatchMouseEvent',{type:'mouseReleased',x:click.x,y:click.y,button:'left',buttons:0,modifiers:2,clickCount:1});
  const flash=await waitFor(()=>client.evaluate(`[...document.querySelectorAll('[data-texleaf-reverse-sync-target]')].map(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,animation:getComputedStyle(e).animationName};}).find(b=>b.width>0&&b.height>0)`),v=>v?.width>0,'visible reverse source highlight',3000);
  assert.equal(flash.animation,'texleaf-reverse-sync-flash');
  if(preciseSynctex)assert.equal(await client.evaluate(`window.__paperView.state.doc.lineAt(window.__paperView.state.selection.main.head).number`),source.slice(0,anchor).split('\n').length,'global direct frames reverse to the clicked body line');
  else assert.equal(await client.evaluate(`window.__paperView.state.selection.main.head`),frameStart,'collected frame-end reverse hit reveals its frame header');
  assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source,'navigation preserves source');
  report.interactions.push({check:'Workshop Ctrl+click reveals and flashes the correct source location',click,flash});
  await shot('workshop-reverse-synctex');
  report.success=true;return;
 }
 if(imeAudit){
  const read=()=>client.evaluate(`({text:window.__paperView.state.doc.toString(),head:window.__paperView.state.selection.main.head,composing:window.__paperView.composing})`);
  const key=async name=>{
   const code=name==='x'?'KeyX':name, value=name==='x'?88:name==='Process'?229:8;
   await client.request('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:value,...(name==='x'?{text:'x'}:{})});
   await client.request('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:value});
   await delay(100);
  };
  const compose=async text=>{
   await client.request('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
   await delay(100);
  };
  for(const anchor of [source.indexOf('d_{j}')+5,source.indexOf('<d')+2]){
   for(const recovery of ['Backspace','x']){
    await scroll(anchor);
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${anchor}}});window.__paperView.focus();true`);
    await delay(200);
    for(const text of ['n','ni','n']){
     await compose(text);
     assert.equal((await read()).text,source.slice(0,anchor)+text+source.slice(anchor),'complete candidate replaces the previous candidate');
     if(text==='ni'){
      await key('Process');
      assert.equal((await read()).composing,true,'keyCode 229 still belongs to the live IME');
     }
    }
    await compose('');
    const before=await read();
    const residual=source.slice(0,anchor)+'n'+source.slice(anchor);
    assert.ok(before.text===source||before.text===residual,'cancellation never changes surrounding LaTeX');
    // Some Chromium builds lose the native range and omit compositionend.
    // The next real key must exit that state before CodeMirror handles it.
    if(recovery==='x'||before.text===source){
     await key('x');
     assert.equal((await read()).text,before.text.slice(0,before.head)+'x'+before.text.slice(before.head),'ordinary typing resumes');
     assert.equal((await read()).composing,false,'ordinary typing releases the IME');
     await key('Backspace');
    }
    if(before.text===residual)await key('Backspace');
    const after=await read();
    assert.equal(after.composing,false,'ordinary Backspace releases the IME');
    assert.equal(after.text,source,'Backspace removes only the typed text');
    // Editing a different range also works after releasing the old session.
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${source.indexOf('Let')+3}}});true`);
    await key('x');await key('Backspace');
    assert.equal((await read()).text,source,'the old candidate range no longer intercepts later editing');
    report.interactions.push({anchor,recovery,missingEnd:before.composing,success:true});
   }
  }
  const anchor=source.indexOf('<d')+2;
  await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${anchor}}});window.__paperView.focus();true`);
  await compose('ni');
  await client.request('Input.insertText',{text:'你'});await delay(200);
  const committed=source.slice(0,anchor)+'你'+source.slice(anchor);
  assert.equal((await read()).text,committed,'Chinese candidate commit remains intact');
  await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')),host=>host.text===committed,'host receives committed Chinese text');
  await key('Backspace');
  assert.equal((await read()).text,source,'committed Chinese text can be deleted normally');
  await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')),host=>host.text===source,'host receives edits after IME recovery');
  report.interactions.push({check:'Chinese commit, deletion and host synchronization',success:true});
  report.success=true;return;
 }
 const {scanVisualDocumentStructure}=require('../.test-dist/src/core/visualStructure');
 const {scanMathPreviewDocument,createMathPreviewRenderInput}=require('../.test-dist/src/core/mathPreview');
 const {localLatexPreviewKind}=require('../.test-dist/src/core/localLatexPreview');
 const preambleFile=path.join(folder,'preamble.tex');
 const inherited=fs.existsSync(preambleFile)?scanMathPreviewDocument(fs.readFileSync(preambleFile,'utf8'),{fragmentKind:'preamble'}):undefined;
 const preview=scanMathPreviewDocument(source,{inheritedMacroEnvironment:inherited,maxSourceLength:32768});
 const structures=scanVisualDocumentStructure(source,{compatibilityMode:'maximum'}).records;
 const waitForRestoredStructure=async()=>{
  const title=structures.find(r=>r.kind==='maketitle');
  if(!title)return;
  await waitFor(()=>client.evaluate(`(()=>{const field=window.__paperView.state.values.find(v=>v&&Array.isArray(v.records)&&'preambleExpanded' in v);return field?.records.some(r=>r.kind==='maketitle'&&r.replacement.sourceFrom===${title.replacement.sourceFrom}&&r.replacement.sourceTo===${title.replacement.sourceTo});})()`),v=>v===true,'restored source structure snapshot');
 };
 const dismissCompletion=async()=>{
  for(const type of ['rawKeyDown','keyUp'])await client.request('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
 };
 const visibleClickPoint=async position=>{
  let previous;
  const result=await waitFor(async()=>{
   const state=await client.evaluate(`(()=>{const v=window.__paperView,r=v.coordsAtPos(${position}),box=v.scrollDOM.getBoundingClientRect();if(!r)return {ready:false,position:${position}};const point={x:r.left+1,y:(r.top+r.bottom)/2};const line=document.elementFromPoint(point.x,point.y)?.closest('.cm-line');return {point,position:${position},target:document.elementFromPoint(point.x,point.y)?.className,lineFrom:line?v.posAtDOM(line,0):null,expectedLine:v.state.doc.lineAt(${position}).from,ready:point.y>box.top&&point.y<box.bottom&&!!line&&v.posAtDOM(line,0)===v.state.doc.lineAt(${position}).from};})()`);
   const key=JSON.stringify(state.point),stable=state.ready&&key===previous;previous=key;
   if(!state.ready)await scroll(position);
   return {...state,stable};
  },v=>v.stable,'visible, stable source line click position');
  return result.point;
 };
 const targets=[['title',source.indexOf('\\maketitle')]];
 for(const r of structures){
  if(beamerAudit && r.kind==='frame') targets.push(['frame-'+(targets.length),r.begin.sourceFrom]);
  if(['figure','tikzpicture','tikzcd','footnote'].includes(r.kind)){
   const pos=r.replacement?.sourceFrom??r.from;
   targets.push([`${r.kind}-${source.slice(0,pos).split('\n').length}`,pos]);
  }
 }
 for(const f of preview.formulas){const input=createMathPreviewRenderInput(source,f,preview);if(input&&localLatexPreviewKind(input))targets.push([`special-math-${source.slice(0,f.outerRange.start).split('\n').length}`,f.outerRange.start]);}
 for(const match of source.matchAll(/\\begin\{appendices\}|\\intertext\{/g))targets.push([`text-${source.slice(0,match.index).split('\n').length}`,match.index]);
 if(frontMatterOnly) targets.splice(1);
 for(const mode of ['basic','maximum']){
  if(mode==='maximum'){
   if(exerciseCache)fs.writeFileSync(path.join(owned,'hold-tex'),'hold');
   await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-maximum').click();true`);
   await waitFor(()=>client.evaluate(`document.querySelector('#visual-mode-button')?.textContent`),v=>v==='增强可视化','mode menu synchronization');
   if(exerciseCache){
    await waitFor(async()=>count(),v=>v>0,'held native compiler starts');
    await waitFor(()=>client.evaluate(`document.querySelectorAll('.texleaf-formula-widget svg').length`),v=>v>0,'ordinary math renders while native compiler is held');
    const insert='Native input remains responsive.\n',at=source.indexOf('\\end{document}'),started=Date.now();
    await client.evaluate(`window.__paperView.dispatch({changes:{from:${at},insert:${JSON.stringify(insert)}}});true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length+insert.length,'input acknowledgement while native compiler is held',3000);
    report.interactions.push({check:'ordinary formula and host input while native compiler held',acknowledgementMs:Date.now()-started});
    await client.evaluate(`window.__paperView.dispatch({changes:{from:${at},to:${at+insert.length},insert:''}});true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length,'source restoration');
    fs.unlinkSync(path.join(owned,'hold-tex'));
    await client.evaluate(`document.querySelector('#top-save-document').click();true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).dirty,v=>v===false,'save restored test copy');
   }
  }
  await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length}});document.querySelector('.texleaf-preamble-header[aria-expanded="true"]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
  assert.equal(await client.evaluate(`document.querySelector('#visual-mode-button')?.textContent`),mode==='basic'?'标准可视化':'增强可视化','native mode matches the mode being tested');
  const sourceControls=new Map();
  const collectSourceControls=async()=>{
   if(!sourceAudit)return;
   const controls=await client.evaluate(`Array.from(document.querySelectorAll('.texleaf-source-command, .texleaf-transparent-wrapper-edit-chip, .texleaf-title-source, .texleaf-abstract-begin .texleaf-environment-edit-chip, .texleaf-label-chip')).filter(e=>e.getBoundingClientRect().width>0).map(e=>({from:Number(e.dataset.texleafSourceFrom),to:Number(e.dataset.texleafSourceTo),scrollFrom:Number(e.closest('.texleaf-theorem-begin')?.querySelector('.texleaf-theorem-label')?.dataset.texleafLineNumberAnchorId??e.closest('[data-texleaf-indent-from]')?.dataset.texleafIndentFrom??e.dataset.texleafSourceFrom),kind:e.className}))`);
   for(const control of controls)if(Number.isInteger(control.from)&&control.to>control.from)sourceControls.set(control.from+':'+control.to,control);
  };
  const result={mode,targets:[],pages:[],launchesBefore:count()};let checkedFootnote=false,checkedMathReference=false,checkedModeHint=false;
  for(const [label,pos] of targets.filter(([,pos])=>Number.isFinite(pos)&&pos>=0)){
   await scroll(pos);
   if(mode==='basic')assert.equal(await client.evaluate(`document.querySelectorAll('.texleaf-formula-widget:has(.texleaf-enhanced-visualization-hint) svg[aria-label^="公式渲染失败"]').length`),0,'standard mode requirements must not retain a red formula failure card');
   if(renderAudit&&mode==='basic'&&!checkedModeHint&&label.startsWith('special-math-')){
    await client.evaluate(`document.querySelector('.texleaf-formula-widget[data-formula-from="${pos}"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));true`);
    await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-math-preview-tooltip .texleaf-enhanced-visualization-hint')`),v=>v,'source tooltip offers enhanced mode');
    assert.equal(await client.evaluate(`document.querySelectorAll('.texleaf-math-preview-tooltip-error,.texleaf-math-preview-tooltip svg[aria-label^="公式渲染失败"]').length`),0,'source tooltip mode requirement is informational');
    await shot('basic-mode-required-tooltip');
    report.interactions.push({check:'standard formula and source tooltip show mode hint without failure card',from:pos});
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length}});true`);
    await scroll(pos);checkedModeHint=true;
   }
   if(mode==='maximum')await waitFor(()=>client.evaluate(`![...document.querySelectorAll('.texleaf-tikzpicture-card')].some(e=>e.textContent.includes('正在生成图形预览'))`),v=>v,'visible graphs settle');
   if(mode==='maximum'&&label.startsWith('special-math-'))await waitFor(()=>client.evaluate(`!!document.querySelector('.texleaf-formula-widget[data-formula-from="${pos}"] svg')`),v=>v,`${label} renders completely`);
   await collectSourceControls();
   const state=await client.evaluate(snapshotExpression);result.targets.push({label,pos,...state});await shot(`${mode}-${label}`);
   if(label.startsWith('text-')&&!checkedMathReference){
    const selector='.texleaf-formula-references .texleaf-reference-chip-target';
    const key=await client.evaluate(`document.querySelector('${selector}')?.dataset.referenceKey`);
    if(key&&source.includes('\\label{'+key+'}')){
     await client.evaluate(`document.querySelector('${selector}').dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));true`);
     const hover=await waitFor(()=>client.evaluate(`(()=>{const e=document.querySelector('#reference-hover');return e&&!e.hidden?e.textContent:'';})()`),v=>!!v&&!v.includes('正在'),'math reference hover');
     await shot(`${mode}-math-reference-hover`);
     await client.evaluate(`document.querySelector('${selector}').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,ctrlKey:true}));true`);
     const at=source.indexOf('\\label{'+key+'}');
     const anchor=await waitFor(()=>client.evaluate(`window.__paperView.state.selection.main.anchor`),v=>v>=at&&v<=at+key.length+8,'math reference source navigation');
     report.interactions.push({mode,check:'math reference hover and Ctrl-click',key,anchor,preview:hover.slice(0,160)});
     await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);
     checkedMathReference=true;
    }
   }
   if(label.startsWith('footnote-')&&!checkedFootnote){
    const selector=`.texleaf-footnote-marker[data-texleaf-source-from="${pos}"]`;
    if(await client.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)){
     await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));true`);
     const note=await waitFor(()=>client.evaluate(`document.querySelector('.texleaf-footnote-hover:not([hidden])')?.textContent`),v=>typeof v==='string'&&v.includes('编辑脚注源码'),'footnote hover');
     await shot(`${mode}-footnote-hover`);
     await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
     const anchor=await client.evaluate(`window.__paperView.state.selection.main.anchor`);
     const record=structures.find(r=>r.kind==='footnote'&&r.from===pos);
     assert.ok(anchor>=record.from&&anchor<=record.to,'footnote edit selects original source');
     report.interactions.push({mode,check:'footnote hover and source',from:pos,anchor,preview:note.slice(0,160)});
     await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);
     checkedFootnote=true;
    }
   }
  }
  if(beamerAudit){
   const groups=structures.filter(r=>r.kind==='textStyle' && r.fontSize!==undefined);
   assert.ok(groups.length>0,'presentation font declarations discovered');
   for(const record of groups){
    await scroll(record.contentFrom);
    const rendered=await client.evaluate(`(()=>{const n=window.__paperView.domAtPos(${record.contentFrom}).node,e=n.nodeType===1?n:n.parentElement;const style=e.closest('.texleaf-text-style');return style?{fontSize:style.style.fontSize,color:style.style.color,text:style.textContent}:null;})()`);
    assert.ok(rendered?.fontSize,'presentation font applied to editable text');
   }
   const wrappers=structures.filter(r=>r.kind==='textStyle' && ['columns','column','source','fontsize'].includes(r.command));
   for(const record of wrappers){
    await scroll(record.prefixFrom);
    const selector=`.texleaf-transparent-wrapper-edit-chip[data-texleaf-source-from="${record.prefixFrom}"]`;
    assert.ok(await client.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),'wrapper has an edit control');
    await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
    const exposed=await client.evaluate(`(()=>{const n=window.__paperView.domAtPos(${record.prefixFrom+1}).node;return (n.nodeType===1?n:n.parentElement).closest('.cm-line')?.textContent;})()`);
    assert.ok(exposed.includes(source.slice(record.prefixFrom,record.prefixTo).trim().split('\n')[0]),'wrapper click exposes exact syntax');
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);
   }
   const at=groups[0].contentFrom+1,insert=' QA';
   await scroll(at);
   await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${at}}});window.__paperView.focus();true`);
   await client.request('Input.insertText',{text:insert});
   await waitFor(()=>client.evaluate(`window.__paperView.state.doc.toString()`),v=>v===source.slice(0,at)+insert+source.slice(at),'styled body native typing');
   await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length+insert.length,'styled body edit reaches TextDocument');
   for(const type of ['rawKeyDown','keyUp'])await client.request('Input.dispatchKeyEvent',{type,key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90,nativeVirtualKeyCode:90});
   await waitFor(()=>client.evaluate(`window.__paperView.state.doc.toString()`),v=>v===source,'styled body native undo');
   await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length,'styled body undo reaches TextDocument');
   await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});document.querySelector('#top-save-document').click();true`);
   await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).dirty,v=>v===false,'restored test copy saved');
   report.interactions.push({mode,check:'Beamer typography, wrapper source access and native typing/undo',groups:groups.length,wrappers:wrappers.length});
  }
  if(paper==='title-citation'){
   const failures=[],layouts=[];
   for(const width of [360,600,1000]){
    await client.evaluate(`document.querySelector('.cm-editor').style.width='${width}px';true`);
    await scroll(source.indexOf('\\maketitle'));
    const layout=await client.evaluate(`(()=>{const b=document.querySelector('.texleaf-title-source').getBoundingClientRect(),h=document.querySelector('.texleaf-document-title').getBoundingClientRect();return {buttonBottom:b.bottom,titleTop:h.top,buttonRight:b.right,titleRight:h.right}})()`);
    layouts.push({width,...layout});
    if(layout.buttonBottom>layout.titleTop||layout.buttonRight>layout.titleRight+1)failures.push('title button overlaps or overflows at '+width);
    await shot(mode+'-title-'+width);
   }
   await client.evaluate(`document.querySelector('.cm-editor').style.width='600px';true`);
   for(const key of ['vakil-zinger','literal-title','bad-title']){
    const at=source.indexOf('\\cite{'+key+'}');await scroll(at);
    await client.evaluate(`document.querySelector('.texleaf-citation-chip-target[data-citation-key="${key}"]').dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));true`);
    await waitFor(()=>client.evaluate(`document.querySelector('#reference-hover.visible')?.textContent`),v=>typeof v==='string'&&v.includes(key),'citation hover opens');
    const title=await client.evaluate(`(()=>{const h=document.querySelector('#reference-hover h3');return {text:h?.textContent,svg:h?.querySelectorAll('.texleaf-structure-math svg').length,unsafe:h?.querySelectorAll('img,script').length,error:h?.querySelector('[data-texleaf-render-error]')?.dataset.texleafRenderError}})()`);
    if(key==='bad-title' ? title.svg!==0||!title.error||!title.text.includes('UndefinedCitationTitleCommand')||title.text.includes('渲染失败') : title.svg!==1||title.unsafe!==0||title.text.includes('$'))failures.push('citation title is not safely rendered: '+JSON.stringify({key,...title}));
    await shot(mode+'-citation-'+key);
    await client.evaluate(`document.querySelector('.texleaf-citation-chip-target[data-citation-key="${key}"]').dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));true`);await delay(180);
   }
   await client.evaluate(`document.querySelector('.cm-editor').style.removeProperty('width');true`);
   report.interactions.push({mode,check:'nonoverlapping title action and safe visual citation titles',layouts,failures});
   assert.deepEqual(failures,[],'title layout and citation-title rendering');
  }
  if(paper==='source-access'){
   const reset=async()=>{await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);await scroll(0);};
   await reset();
   const commands=structures.filter(r=>r.kind==='accent'&&r.text==='');assert.ok(commands.length>=3);
   for(const r of commands){
    const selector=`.texleaf-source-command[data-texleaf-source-from="${r.from}"]`;
    assert.ok(await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&e.getBoundingClientRect().width>12;})()`),'every empty command has a visible source control');
    await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
    const raw=await client.evaluate(`(()=>{const n=window.__paperView.domAtPos(${r.from+1}).node;return (n.nodeType===1?n:n.parentElement).closest('.cm-line')?.textContent;})()`);
    assert.ok(raw.includes(source.slice(r.from,r.to)),'command control exposes exact source in visual mode');
    await reset();
   }
   // A collapsed caret must reveal an empty atomic command before deletion.
   for(const r of [...commands,...structures.filter(r=>r.kind==='textStyle'&&r.contentFrom===r.contentTo)]){
    await reset();await scroll(r.to);
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${r.to}}});window.__paperView.focus();true`);
    for(let press=0;press<3;press++){
     const before=await client.evaluate(`({source:window.__paperView.state.doc.toString(),anchor:window.__paperView.state.selection.main.head})`);
     await client.request('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
     await client.request('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
     const after=await client.evaluate(`window.__paperView.state.doc.toString()`);
     assert.equal(after,press===0?before.source:before.source.slice(0,before.anchor-1)+before.source.slice(before.anchor),'empty atomic command must first reveal, then delete one character per Backspace');
    }
    await client.evaluate(`window.__paperView.dispatch({changes:{from:0,to:window.__paperView.state.doc.length,insert:${JSON.stringify(source)}},selection:{anchor:${source.length-1}}});true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length,'empty command Backspace source restored');
    await dismissCompletion();await waitForRestoredStructure();
   }
   await reset();
   const emptyAt=source.indexOf('\\emph{}');
   const empty=`.texleaf-transparent-wrapper-edit-chip[data-texleaf-source-from="${emptyAt}"]`;
   await waitFor(()=>client.evaluate(`({present:!!document.querySelector(${JSON.stringify(empty)}),chips:[...document.querySelectorAll('.texleaf-transparent-wrapper-edit-chip')].map(e=>({from:e.dataset.texleafSourceFrom,to:e.dataset.texleafSourceTo})),selection:window.__paperView.state.selection.main.head,completion:!!document.querySelector('.cm-tooltip-autocomplete')})`),v=>v.present,'empty style wrapper restored');
   await client.evaluate(`document.querySelector(${JSON.stringify(empty)}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
   assert.ok(await client.evaluate(`document.querySelector('.cm-content').textContent.includes('\\\\emph{}')`));
   await client.request('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
   await client.request('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
   assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source.slice(0,emptyAt)+source.slice(emptyAt+7),'deleting the selected empty style removes the complete command without orphan braces');
   await client.evaluate(`window.__paperView.dispatch({changes:{from:${emptyAt},insert:'\\\\emph{}'},selection:{anchor:${source.length-1}}});true`);
   await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length,'empty style source restored');
   await client.evaluate(`document.querySelector('#top-save-document').click();true`);await reset();
   const abstractSelector=mode==='maximum'?'.texleaf-front-matter-abstract .texleaf-environment-edit-chip':'.texleaf-abstract-begin .texleaf-environment-edit-chip';
   assert.ok(await client.evaluate(`!!document.querySelector('${abstractSelector}')`),'abstract has an explicit source control in both layouts');
   const frame=await client.evaluate(`(()=>{const e=document.querySelector('.texleaf-abstract-begin');return {border:getComputedStyle(e).borderTopStyle,align:getComputedStyle(e.querySelector('.texleaf-abstract-label')).textAlign,titleOutside:!e.closest('.texleaf-title-card'),bodyAligned:!document.querySelector('.texleaf-front-matter-abstract-body')||Math.abs(document.querySelector('.texleaf-front-matter-abstract-body').getBoundingClientRect().width-e.getBoundingClientRect().width)<1};})()`);
   assert.deepEqual(frame,{border:'solid',align:'center',titleOutside:true,bodyAligned:true});
   await shot(`${mode}-consistent-abstract`);
   await client.evaluate(`document.querySelector('${abstractSelector}').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
   assert.ok(await client.evaluate(`document.querySelector('.cm-content').textContent.includes('\\\\begin{abstract}')&&document.querySelector('.cm-content').textContent.includes('\\\\end{abstract}')`),'abstract source reveals both boundaries');await reset();
   await client.evaluate(`document.querySelector('.texleaf-title-source').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
   assert.ok(await client.evaluate(`document.querySelector('.cm-content').textContent.includes('\\\\date{}')`),'empty title metadata can be exposed');
   assert.ok(await client.evaluate(`document.querySelector('.cm-content').textContent.includes('\\\\author{}')`),'title source also opens empty preamble metadata');await reset();
   const frameRecord=structures.find(r=>r.kind==='frame');await scroll(frameRecord.begin.sourceFrom);
   await client.evaluate(`document.querySelector('.texleaf-frame-begin .texleaf-environment-edit-chip').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));true`);
   assert.ok(await client.evaluate(`document.querySelector('.cm-content').textContent.includes('\\\\frametitle{Slide title}')&&document.querySelector('.cm-content').textContent.includes('\\\\framesubtitle{}')`),'frame source exposes title commands including empty subtitle');await reset();
   report.interactions.push({mode,check:'visible controls expose settings, empty styles, abstract boundaries and empty title metadata; abstract frame matches',commands:commands.length});
  }
  if(paper==='counters'){
   await scroll(0);
   const numbers=await waitFor(()=>client.evaluate(`({headings:[...document.querySelectorAll('.texleaf-heading-number')].map(e=>e.textContent),toc:[...document.querySelectorAll('.texleaf-table-of-contents-number')].map(e=>e.textContent),reference:document.querySelector('[data-reference-key="sec:seven"]')?.textContent})`),v=>v.headings.length===4&&v.toc.length===4,'manual counter presentation');
   assert.deepEqual(numbers.headings,['4','7','7.1','B']);
   assert.deepEqual(numbers.toc,['4','7','7.1','B']);assert.equal(numbers.reference,'7');
   report.interactions.push({mode,check:'manual counters across input, headings, ToC, reference and appendix',...numbers});
   await shot(`${mode}-manual-counters`);
  }
  if(full){
   await scroll(0);let top=0,previous=-1;
   for(let page=0;page<260;page++){
    await client.evaluate(`window.__paperView.scrollDOM.scrollTop=${top};true`);await delay(450);
    await collectSourceControls();
    const state=await client.evaluate(snapshotExpression);result.pages.push(state);
    await shot(`${mode}-page-${String(page+1).padStart(3,'0')}`);
    if(state.top+state.viewport>=state.height-3)break;
    assert.ok(state.top!==previous||page===0,'full scan must make progress');
    previous=state.top;top=state.top+state.viewport*0.75;
   }
   assert.ok(result.pages.at(-1).top+result.pages.at(-1).viewport>=result.pages.at(-1).height-3,'full scan reaches document end');
  }
  if(sourceAudit){
   for(const control of sourceControls.values()){
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});document.querySelector('.texleaf-preamble-header[aria-expanded="true"]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));window.__paperView.dispatch({effects:window.__paperView.constructor.scrollIntoView(${control.scrollFrom},{y:'start',yMargin:32})});true`);await delay(120);
    const selector=`[data-texleaf-source-from="${control.from}"][data-texleaf-source-to="${control.to}"]`;
    await waitFor(async()=>{
     const state=await client.evaluate(`({present:!!document.querySelector(${JSON.stringify(selector)}),top:window.__paperView.scrollDOM.scrollTop,near:window.__paperView.lineBlockAtHeight(window.__paperView.scrollDOM.scrollTop).from})`);
     if(!state.present)await scroll(control.scrollFrom);
     return state;
    },v=>v.present,`source entry scrolled into view: ${JSON.stringify(control)}`,10000);
    const clicked=await client.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.classList.contains(${JSON.stringify(control.kind.split(' ')[0])}));if(!e)return false;e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return true;})()`);
    assert.ok(clicked,`source entry remains reachable: ${JSON.stringify(control)}`);
    const from=control.from+1;
    await client.evaluate(`window.__paperView.dispatch({effects:window.__paperView.constructor.scrollIntoView(${from},{y:'start',yMargin:32})});true`);await delay(60);
    const raw=await client.evaluate(`(()=>{const v=window.__paperView,p=v.domAtPos(${from}),e=p.node.nodeType===1?p.node:p.node.parentElement;return {line:e.closest('.cm-line')?.textContent,text:p.node.nodeType===3,mapped:v.posAtDOM(p.node,p.offset)};})()`);
    assert.ok(raw.text&&raw.mapped===from,`source control reveals editable source text: ${JSON.stringify({control,raw})}`);
    const expected=source.slice(control.from,control.to).split('\n')[0].trim();
    if(expected)assert.ok(raw.line.includes(expected),`source command is fully exposed: ${JSON.stringify({control,raw,expected})}`);
   }
   report.interactions.push({mode,check:'all collected folded-source controls clicked and original text exposed',controls:[...sourceControls.values()]});
   await client.evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length-1}});true`);
  }
  if(boundaryAudit){
   const boundaryCases=new Map();
   for(const r of structures){
    const end=r.end??r.replacement;
    if(!end)continue;
    const endText=source.slice(end.sourceFrom,end.sourceTo);
    const matches=[...endText.matchAll(/\\end\{([^}]+)\}/g)];
    const match=matches.at(-1);
    if(match&&match[1]!=='document'){
     const at=end.sourceFrom+match.index+match[0].length;
     if(source[at]==='\n'&&!boundaryCases.has(match[1]))boundaryCases.set(match[1],at+1);
    }
   }
   for(const formula of preview.formulas){
    if(formula.mode!=='block'||!formula.closed)continue;
    const at=formula.outerRange.end;
    if(source[at]==='\n'&&!boundaryCases.has('display-math'))boundaryCases.set('display-math',at+1);
   }
   for(const r of structures){
    if(r.kind!=='accent'||r.text!==''||source[r.to]!=='\n')continue;
    const command=source.slice(r.from,r.to).match(/^\\[A-Za-z]+/)?.[0];
    const key='command:'+command;
    if(command&&!boundaryCases.has(key))boundaryCases.set(key,r.to+1);
   }
   const preamble=structures.find(r=>r.kind==='preamble');
   if(preamble)boundaryCases.set('preamble',preamble.to);
   const cases=[];
   for(const [environment,at] of [...boundaryCases].filter(([environment])=>!boundaryCase||environment===boundaryCase)){
    await dismissCompletion();
    assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source,'each boundary case starts from original source');
    // Add plain text immediately after an actual environment in the test copy.
    // This gives every class the same click/deletion oracle without rewriting it.
    const sentinel='\nBOUNDARY\n';
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${source.length+sentinel.length}},changes:{from:${at},insert:${JSON.stringify(sentinel)}}});true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length+sentinel.length,'boundary test copy insertion');
    await dismissCompletion();
    await scroll(at);
    const blankPoint=await visibleClickPoint(at);
    assert.ok(blankPoint,'blank line below environment has a clickable position');
    await client.request('Input.dispatchMouseEvent',{type:'mouseMoved',...blankPoint,button:'none',buttons:0});
    for(const [type,buttons] of [['mousePressed',1],['mouseReleased',0]])await client.request('Input.dispatchMouseEvent',{type,...blankPoint,button:'left',buttons,clickCount:1});
    await delay(80);
    const blankAnchor=await client.evaluate(`window.__paperView.state.selection.main.head`);
    const blankEvent=await client.evaluate(`window.__paperLastPointer`);
    assert.equal(blankAnchor,at,`click on blank line below ${environment} must not jump to its begin: ${JSON.stringify({blankPoint,blankEvent})}`);
    const point=await visibleClickPoint(at+4);
    assert.ok(point,'text below environment has a clickable position');
    await client.request('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0});
    for(const [type,buttons] of [['mousePressed',1],['mouseReleased',0]])await client.request('Input.dispatchMouseEvent',{type,...point,button:'left',buttons,clickCount:1});
    await delay(80);
    const anchor=await client.evaluate(`window.__paperView.state.selection.main.head`);
    const textEvent=await client.evaluate(`window.__paperLastPointer`);
    assert.ok(anchor>=at+1&&anchor<=at+9,`click below ${environment} must remain on its own line: ${JSON.stringify({anchor,at,point,textEvent,blankEvent})}`);
    await client.evaluate(`window.__paperView.dispatch({selection:{anchor:${at+9}}});window.__paperView.focus();true`);
    const deletions=[];
    for(let press=0;press<13;press++){
     const before=await client.evaluate(`({source:window.__paperView.state.doc.toString(),anchor:window.__paperView.state.selection.main.head,empty:window.__paperView.state.selection.main.empty})`);
     assert.ok(before.empty,'continuous Backspace starts with a caret');
     await client.request('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
     await client.request('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});
     const after=await client.evaluate(`window.__paperView.state.doc.toString()`);
     const removed=before.source.length-after.length;
     assert.ok(removed===0||removed===1,`Backspace must never remove a hidden line at ${environment}, press ${press}: removed ${removed}`);
     if(removed===1)assert.equal(after,before.source.slice(0,before.anchor-1)+before.source.slice(before.anchor),`Backspace removes only the character before the caret at ${environment}`);
     deletions.push(removed);
    }
    await delay(200);
    const transientErrors=await client.evaluate(`(${snapshotExpression}).errors`);
    const boundaryResult={environment,at,blankAnchor,clickedAnchor:anchor,deletions,transientErrors};
    cases.push(boundaryResult);
    await dismissCompletion();
    await client.evaluate(`window.__paperView.dispatch({changes:{from:0,to:window.__paperView.state.doc.length,insert:${JSON.stringify(source)}},selection:{anchor:${source.length-1}}});true`);
    await waitFor(()=>client.evaluate(`window.__paperView.state.doc.toString()`),v=>v===source,'boundary source restored exactly');
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).length,v=>v===source.length,'boundary host source restored');
    await waitForRestoredStructure();
    assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source,'restored source stays exact after asynchronous parsing');
    await scroll(Math.max(0,at-1));
    await waitFor(()=>client.evaluate(`(${snapshotExpression}).errors`),v=>v.length===0,'formula rendering recovers after restoring original boundary source');
    boundaryResult.restoredErrors=[];
   }
   if(cases.length){
    await client.evaluate(`document.querySelector('#top-save-document').click();true`);
    await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).dirty,v=>v===false,'save restored boundary test copy');
   }
   report.interactions.push({mode,check:'native click below real environment and 13 consecutive Backspaces',cases});
  }
  result.launchesAfter=count();report.modes.push(result);
  if(mode==='basic')assert.equal(count(),0,'standard mode must never launch local TeX');
  process.stdout.write(JSON.stringify({paper,mode,launches:count(),pages:result.pages.length,targets:result.targets.length,errors:result.targets.flatMap(t=>t.errors),missingGraphs:result.targets.flatMap(t=>t.graphs.filter(g=>g.svg===0).map(g=>({label:t.label,text:g.text.slice(0,100)})))})+'\n');
 }
 await delay(1500);
 const beforeToggle=count();
 await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-basic').click();true`);
 await waitFor(()=>client.evaluate(`document.querySelector('#visual-mode-button')?.textContent`),v=>v==='标准可视化','standard mode return');
 await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-maximum').click();true`);
 await waitFor(()=>client.evaluate(`document.querySelector('#visual-mode-button')?.textContent`),v=>v==='增强可视化','enhanced mode return');
 await delay(1200);assert.equal(count(),beforeToggle,'mode toggle reuses completed artwork');
 report.interactions.push({check:'mode toggle cache',launches:beforeToggle});
 const sourceButton=await client.evaluate(`document.querySelector('#top-open-source').textContent`);
 await client.evaluate(`document.querySelector('#top-open-source').click();true`);
 assert.notEqual(await client.evaluate(`document.querySelector('#top-open-source').textContent`),sourceButton);
 assert.equal(await client.evaluate(`window.__paperView.state.doc.toString()`),source);
 await client.evaluate(`document.querySelector('#top-open-source').click();true`);
 assert.equal(await client.evaluate(`document.querySelector('#top-open-source').textContent`),sourceButton);
 report.interactions.push({check:'source mode round trip'});
 if(exerciseCache){
  const nativeGraph=structures.find(r=>r.kind==='tikzpicture');assert.ok(nativeGraph);
  await scroll(nativeGraph.replacement.sourceFrom);
  const graphSvg=()=>client.evaluate(`document.querySelector('.texleaf-tikzpicture-card .texleaf-local-latex-preview svg')?.outerHTML`);
  await waitFor(graphSvg,v=>typeof v==='string'&&/#(?:ff0000|f00)\b/i.test(v),'initial red artwork');
  const initial=count(),colorAt=source.indexOf('FF0000');assert.ok(colorAt>=0);
  await client.evaluate(`window.__paperView.dispatch({changes:{from:${colorAt},to:${colorAt+6},insert:'0000FF'},selection:{anchor:${source.length-1}}});true`);
  await waitFor(graphSvg,v=>typeof v==='string'&&/#(?:0000ff|00f)\b/i.test(v),'relevant color edit regenerates artwork');
  assert.equal(count(),initial+1);
  await client.evaluate(`window.__paperView.dispatch({changes:{from:${colorAt},to:${colorAt+6},insert:'FF0000'}});true`);
  await waitFor(graphSvg,v=>typeof v==='string'&&/#(?:ff0000|f00)\b/i.test(v),'restoring color reuses artwork');
  assert.equal(count(),initial+1);
  await client.evaluate(`document.querySelector('#top-save-document').click();true`);
  await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')).dirty,v=>v===false,'restored graph saved');
  report.interactions.push({check:'color edit invalidates; restoring color reuses cache',launches:count()-initial});
  const beforeClear=count();
  await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#clear-graph-cache').click();true`);
  await delay(500);
  await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-basic').click();true`);
  await waitFor(()=>client.evaluate(`document.querySelector('#visual-mode-button').textContent`),v=>v==='标准可视化','clear cache standard mode');
  await client.evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-maximum').click();true`);
  await waitFor(graphSvg,v=>typeof v==='string'&&/#(?:ff0000|f00)\b/i.test(v),'cleared artwork regenerates');
  assert.equal(count(),beforeClear+1);
  report.interactions.push({check:'menu cache clear regenerates artwork',launches:count()-beforeClear});
 }
 if(paper==='compiled'){
  await scroll(source.indexOf('\\intertext'));
  const readReference=()=>client.evaluate(`document.querySelector('.texleaf-formula-references [data-reference-key="eq:shifted"]')?.textContent`);
  await waitFor(()=>client.evaluate(`document.querySelector('#build-pdflatex').disabled`),v=>v===false,'Workshop build button enabled');
  await client.evaluate(`document.querySelector('#build-pdflatex').click();true`);
  await waitFor(readReference,v=>v==='8','successful native build supplies equation number',60000);
  await shot('compiled-reference-eight');
  const at=source.indexOf('{7}')+1;
  await client.evaluate(`window.__paperView.dispatch({changes:{from:${at},to:${at+1},insert:'9'},selection:{anchor:${source.length-1}}});true`);
  const stale=await waitFor(readReference,v=>typeof v==='string'&&v!=='8','dirty source discards compiled equation number');
  await client.evaluate(`window.__paperView.dispatch({changes:{from:${at},to:${at+1},insert:'7'}});document.querySelector('#top-save-document').click();true`);
  report.interactions.push({check:'successful native build supplies 8; source edit discards stale number',stale});
 }
 const finalSource=await client.evaluate(`window.__paperView.state.doc.toString()`);assert.equal(finalSource,source,'native inspection preserves original paper source');
 if(renderAudit)report.renderFailures=await client.evaluate(`window.__paperRenderFailures`);
 await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(owned,'host.json'),'utf8')),host=>host.mode==='maximum'&&host.dirty===false,'final host mode and saved state');
 for(const mode of report.modes){
  assert.deepEqual([...mode.targets,...mode.pages].flatMap(state=>state.errors),[],`${mode.mode} has no formula rendering errors`);
  if(mode.mode==='maximum')assert.deepEqual(mode.targets.flatMap(state=>state.graphs.filter(graph=>graph.svg===0)),[],'all targeted enhanced graphs contain artwork');
 }
 report.launches=count();report.success=true;
}catch(error){report.success=false;report.error=String(error.stack||error);process.exitCode=1;
 fs.writeFileSync(path.join(owned,'cdp-errors.json'),JSON.stringify([...pool?.clients.values()??[]].map(c=>c.events),null,2));
 try{if(workbench){const shot=await workbench.client.request('Page.captureScreenshot',{format:'png'},2000);fs.writeFileSync(path.join(owned,'failure.png'),Buffer.from(shot.data,'base64'));}}catch{}
}finally{
 if(owned)fs.writeFileSync(path.join(owned,'done'),'done');
 try{await workbench?.client.request('Browser.close',{},2000)}catch{}
 pool?.close();workbench?.client.close();
 if(child?.pid){await delay(300);try{process.kill(-child.pid,'SIGTERM')}catch{}await delay(200);try{process.kill(-child.pid,'SIGKILL')}catch{}}
 if(log!==undefined)fs.closeSync(log);
 fs.writeFileSync(path.join(out,`${paper}${renderAudit?'-render-audit':''}-native-report.json`),JSON.stringify(report,null,2));
 console.log(JSON.stringify({paper,success:report.success,directory:owned,launches:report.launches,error:report.error}));
}})();
