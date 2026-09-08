'use strict';
// Native Linux acceptance against read-only corpus originals. Run serially under
// systemd-run MemoryMax=1G, MemorySwapMax=0. Artifacts live in .tmp/max-compat.
// Usage: node test/run-visual-compatibility-qa.cjs arXiv-2609.04378v1 [--full]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {WebviewProbePool, connectWorkbench, findAvailablePort, delay} = require('./helpers/nativeWebview.cjs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.tmp/max-compat');
const paper = process.argv[2] || 'arXiv-2609.04378v1';
const full = process.argv.includes('--full');
const frontMatterOnly = process.argv.includes('--front-matter');
const boundaryCase = process.argv.find(value=>value.startsWith('--boundary-case='))?.slice('--boundary-case='.length);
const boundaryAudit = process.argv.includes('--boundary-audit');
const sourceAudit = process.argv.includes('--source-audit');
const renderAudit = process.argv.includes('--render-audit');
const exerciseCache = process.argv.includes('--exercise-cache');
const corpus = process.env.LATEX_TEST_ROOT || '/home/zhangxh/下载/Latex Test';
const guide = process.env.TEXLEAF_GUIDE || path.resolve(root, '../../output/pdf/texleaf-compatibility-guide.tex');
const fixture = ['performance', 'counters', 'compiled', 'source-access', 'title-citation'].includes(paper);
const folder = paper === 'guide' ? path.dirname(guide) : fixture ? path.join(root, 'test/fixtures/visual-compatibility', paper) : path.join(corpus, paper);
const filename = paper === 'guide' ? path.basename(guide) : fs.readdirSync(folder).find(name => name.endsWith('.tex') && /\\documentclass\b/u.test(fs.readFileSync(path.join(folder, name), 'utf8')));
assert.ok(filename, 'paper entry point');
const source = fs.readFileSync(path.join(folder, filename), 'utf8').replace(/\r\n?/g, '\n');
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
 if(paper==='compiled'){assert.ok(process.env.TEXLEAF_WORKSHOP_PATH,'Set TEXLEAF_WORKSHOP_PATH to an installed LaTeX Workshop directory.');fs.cpSync(path.resolve(process.env.TEXLEAF_WORKSHOP_PATH),path.join(extensions,'james-yu.latex-workshop'),{recursive:true});}
 if(paper==='guide')fs.copyFileSync(guide,path.join(workspace,filename));else fs.cpSync(folder,workspace,{recursive:true});
 for(const engine of ['latex','pdflatex','xelatex']){
  const executable=spawnSync('which',[engine],{encoding:'utf8'}).stdout.trim();assert.ok(executable,engine);
  fs.writeFileSync(path.join(bin,engine),`#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(path.join(owned,'launches.jsonl'))},JSON.stringify({engine:${JSON.stringify(engine)},time:Date.now(),cwd:process.cwd()})+'\\n');const start=()=>{if(fs.existsSync(${JSON.stringify(path.join(owned,'hold-tex'))})){setTimeout(start,25);return;}const child=require('node:child_process').spawn(${JSON.stringify(executable)},process.argv.slice(2),{stdio:'inherit'});child.on('exit',(code)=>process.exit(code??1));child.on('error',()=>process.exit(1));};start();`,{mode:0o755});
 }
 fs.writeFileSync(path.join(user,'User/settings.json'),JSON.stringify({
  'workbench.startupEditor':'none','extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,
  'telemetry.telemetryLevel':'off','update.mode':'none','security.workspace.trust.enabled':false,
  'files.autoSave':'off','latex-workshop.latex.autoBuild.run':'never','texleaf.visualEditor.texBinPath':bin,
  'texleaf.visualEditor.compatibilityMode':'basic','window.zoomLevel':0,
 }));
 const testFile=path.join(owned,'extension.cjs'),done=path.join(owned,'done');
 fs.writeFileSync(testFile,`const vscode=require('vscode'),fs=require('node:fs');exports.run=async()=>{
 const ext=vscode.extensions.getExtension('zhangxh-math.texleaf');if(!ext)throw Error('extension missing');await ext.activate();
 const uri=vscode.Uri.file(${JSON.stringify(path.join(workspace,filename))});await vscode.workspace.getConfiguration('texleaf',uri).update('visualEditor.compatibilityMode','basic',vscode.ConfigurationTarget.WorkspaceFolder);const doc=await vscode.workspace.openTextDocument(uri);
 await vscode.commands.executeCommand('vscode.openWith',uri,'texleaf.visualEditor');
 const end=Date.now()+480000;while(Date.now()<end&&!fs.existsSync(${JSON.stringify(done)})){
 fs.writeFileSync(${JSON.stringify(path.join(owned,'host.next'))},JSON.stringify({mode:vscode.workspace.getConfiguration('texleaf',uri).get('visualEditor.compatibilityMode'),dirty:doc.isDirty,length:doc.getText().replace(/\\r\\n?/g,"\\n").length}));fs.renameSync(${JSON.stringify(path.join(owned,'host.next'))},${JSON.stringify(path.join(owned,'host.json'))});await new Promise(r=>setTimeout(r,150));}};`);
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
