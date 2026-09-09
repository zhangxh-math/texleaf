// node test/run-visual-compatibility-qa.cjs quiver-edit --confirmed-fixes
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { delay } = require('./nativeWebview.cjs');

module.exports = async ({ client, pool, workbench, owned, report, waitFor, source }) => {
  const context = client.preferredContextId;
  const evaluate = expression => client.evaluate(expression, 15000, context);
  const host = () => JSON.parse(fs.readFileSync(path.join(owned, 'host.json'), 'utf8'));
  const mode = async value => {
    await evaluate(`(()=>{const source=document.querySelector('#editor').dataset.editorMode==='source';if(source!==${value === 'source'})document.querySelector('#top-open-source').click();return true;})()`);
    if(value!=='source'){
      await evaluate(`document.querySelector('#visual-mode-button').click();document.querySelector('#visual-mode-${value}').click();true`);
      await waitFor(() => host().mode, current => current === value, 'host mode ' + value);
    }
    await waitFor(() => evaluate(`document.querySelector('#editor').dataset.editorMode`), current => current === (value==='source'?'source':'visual'), 'webview mode ' + value);
  };
  const replace = async text => {
    await evaluate(`window.__paperView.dispatch({changes:{from:0,to:window.__paperView.state.doc.length,insert:${JSON.stringify(text)}},selection:{anchor:${text.length}}});true`);
    await waitFor(() => host().text, current => current === text, 'host document');
  };
  const shot = async name => {
    const result = await workbench.client.request('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(owned, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  const fixture = '\\documentclass{article}\n% PREAMBLE target\n\\begin{document}\nTARGET word.\n'
    + Array.from({ length: 100 }, (_, i) => `Row ${i} \\emph{} body.\n`).join('') + '\\end{document}\n';
  await replace(fixture);
  report.selections = [];
  for (const currentMode of ['source', 'basic', 'maximum']) {
    await mode(currentMode);
    for (const marker of ['TARGET', 'PREAMBLE']) {
      const from = fixture.indexOf(marker), to = from + marker.length;
      await evaluate(`(()=>{const v=window.__paperView;v.dispatch({selection:{anchor:${from}},effects:v.constructor.scrollIntoView(${from},{y:'center'})});const h=document.querySelector('.texleaf-preamble-header[aria-expanded="false"]');if(${marker === 'PREAMBLE'})h?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));v.focus();return true;})()`);
      await delay(250);
      const points = await evaluate(`(()=>{const v=window.__paperView,a=v.coordsAtPos(${from}),b=v.coordsAtPos(${to});return {a:{x:a.left,y:(a.top+a.bottom)/2},b:{x:b.left,y:(b.top+b.bottom)/2}};})()`);
      await client.request('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.a, button: 'left', buttons: 1, clickCount: 1 });
      for (let n = 1; n <= 6; n++) await client.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.a.x + (points.b.x - points.a.x) * n / 6, y: points.a.y, button: 'left', buttons: 1 });
      await client.request('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.b, button: 'left', buttons: 0, clickCount: 1 });
      await delay(150);
      const state = await evaluate(`(()=>{const v=window.__paperView,s=v.state.selection.main;return {selected:v.state.sliceDoc(s.from,s.to),active:[...document.querySelectorAll('.cm-activeLine')].map(e=>getComputedStyle(e).backgroundColor),preamble:[...document.querySelectorAll('.cm-line.texleaf-preamble-line')].map(e=>getComputedStyle(e).backgroundColor),rects:[...document.querySelectorAll('.cm-selectionBackground')].map(e=>({color:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()}))};})()`);
      assert.equal(state.selected, marker);
      assert.ok(state.rects.length > 0);
      assert.ok(state.active.every(color => color === 'rgba(0, 0, 0, 0)'), JSON.stringify(state));
      if (marker === 'PREAMBLE' && currentMode !== 'source') {
        assert.ok(state.preamble.length > 0);
        assert.ok(state.preamble.every(color => color === 'rgba(0, 0, 0, 0)'), JSON.stringify(state));
      }
      await shot(`${currentMode}-${marker}-selection`);
      report.selections.push({ mode: currentMode, marker, ...state });
    }
  }
  await mode('basic');
  await evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length}});true`);
  report.wrappers = [];
  for (const insert of ['', '% shifted source ranges\n']) {
    if (insert) {
      await evaluate(`window.__paperView.dispatch({changes:{from:0,insert:${JSON.stringify(insert)}},selection:{anchor:window.__paperView.state.doc.length+${insert.length}}});true`);
      await waitFor(() => host().text, current => current === insert + fixture, 'shifted wrapper host');
    }
    for (const row of [0, 45, 95, 0]) {
      const from = (insert + fixture).indexOf(`Row ${row} `);
      await evaluate(`window.__paperView.dispatch({effects:window.__paperView.constructor.scrollIntoView(${from},{y:'center'})});true`);
      const controls = await waitFor(() => evaluate(`(()=>{const v=window.__paperView;return [...document.querySelectorAll('.texleaf-transparent-wrapper-edit-chip')].map(e=>({from:Number(e.dataset.texleafSourceFrom),actual:v.posAtDOM(e),to:Number(e.dataset.texleafSourceTo)}));})()`), value => value.length > 0, 'visible wrappers');
      for (const control of controls) {
        assert.equal(control.from, control.actual, JSON.stringify(control));
        assert.equal((insert + fixture).slice(control.from, control.to), '\\emph{}');
      }
      report.wrappers.push({ shifted: !!insert, row, count: controls.length });
    }
  }
  await replace(source);
  const from = source.indexOf('\\begin{tikzcd}');
  await evaluate(`window.__paperView.dispatch({selection:{anchor:window.__paperView.state.doc.length},effects:window.__paperView.constructor.scrollIntoView(${from},{y:'center'})});true`);
  await waitFor(() => evaluate(`(()=>{const c=document.querySelector('.texleaf-tikzcd-card'),v=window.__paperView;return !!c&&v.state.sliceDoc(Number(c.dataset.texleafSourceFrom),Number(c.dataset.texleafSourceTo)).includes(c.dataset.texleafTikzcdSource);})()`), Boolean, 'mapped diagram card');
  await evaluate(`document.querySelector('.texleaf-tikzcd-card .texleaf-structure-action-primary').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));true`);
  await waitFor(() => evaluate(`!!document.querySelector('.texleaf-quiver-editor button:not(:disabled) + button:not(:disabled)')`), Boolean, 'quiver import');
  const probe = await pool.waitFor(`document.querySelectorAll('.arrow.cell').length===4`, value => value === true, 'quiver canvas', 15000);
  const childContext = probe.client.preferredContextId;
  const childEval = expression => probe.client.evaluate(expression, 15000, childContext);
  await childEval(`(()=>{const e=document.querySelector('.arrow.cell');for(const type of ['pointerdown','pointerup'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));const i=document.querySelector('.label-input');i.value='retainedDraft';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await evaluate(`document.querySelector('#top-open-source').click();true`);
  await waitFor(() => evaluate(`document.querySelector('#status').textContent`), value => value.includes('应用或取消'), 'draft protection message');
  assert.equal(host().mode, 'basic');
  assert.equal(await evaluate(`document.querySelector('#editor').dataset.editorMode`), 'visual');
  assert.equal(await childEval(`document.querySelector('.label-input').value`), 'retainedDraft');
  assert.equal(await evaluate('window.__paperView.state.doc.toString()'), source);
  for (const value of ['maximum', 'basic']) {
    await mode(value);
    assert.equal(await childEval(`document.querySelector('.label-input').value`), 'retainedDraft');
  }
  for (const value of ['maximum', 'basic']) {
    fs.writeFileSync(path.join(owned, 'mode-request'), value);
    await waitFor(() => host().mode, current => current === value, 'external host mode ' + value);
    await waitFor(() => evaluate(`document.querySelector('#visual-mode-${value}').getAttribute('aria-checked')`), current => current === 'true', 'external webview mode ' + value);
    assert.equal(await childEval(`document.querySelector('.label-input').value`), 'retainedDraft');
  }
  await shot('retained-quiver-draft');
  await evaluate(`[...document.querySelectorAll('.texleaf-quiver-editor button')].find(b=>b.textContent==='应用修改').click();true`);
  await waitFor(() => host().text, text => text.includes('retainedDraft'), 'applied graph draft');
  await evaluate(`document.querySelector('#edit-undo').click();true`);
  await waitFor(() => host().text, text => text === source, 'one undo restores original');
  await mode('source');
  report.interactions.push({ check: 'retained graph draft, apply, one undo, then source mode', success: true });
};
