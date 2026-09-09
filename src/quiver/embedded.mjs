import '../../vendor/quiver/ui.mjs';
import { QuiverImportExport } from '../../vendor/quiver/quiver.mjs';

const token = document.documentElement.dataset.token;
const send = (type, values = {}) => parent.postMessage({ protocol: 'texleaf-quiver-v1', token, type, ...values }, '*');
const dictionary = {
  'double arrows or higher with hook tails': '双线或多线箭头的弯钩尾端',
  'double arrows or higher with coil tails': '双线或多线箭头的卷曲尾端',
  'double arrows or higher with multiple heads': '双线或多线箭头的多个尖端',
  'double arrows or higher with harpoon heads': '双线或多线箭头的半箭头尖端',
  'double arrows or higher with multimap heads': '双线或多线箭头的多值映射尖端',
  'Select': '选择', 'Transform': '变换', 'All': '全选', 'None': '全不选', 'Invert': '反选',
  'Reset zoom': '重置缩放', 'Hide grid': '隐藏网格', 'Show grid': '显示网格', 'About': '关于',
  'Flip hor.': '水平翻转', 'Flip ver.': '垂直翻转', 'Flip diag.': '对角翻转', 'Rotate': '旋转',
  'Reverse arrows': '反向箭头', 'Flip arrows': '翻转箭头', 'Flip labels': '翻转标签',
  'Left align label': '标签置于左侧', 'Centre align label (clear)': '居中并遮盖箭头',
  'Centre align label (over)': '标签覆盖箭头', 'Right align label': '标签置于右侧',
  'Mono': '单态射', 'No tail': '无尾端', 'Maps to': '映射尾端', 'Top hook': '上弯钩',
  'Bottom hook': '下弯钩', 'Arrowhead': '箭头', 'Top coil': '上卷曲', 'Bottom coil': '下卷曲',
  'Solid': '实线', 'No body': '无线身', 'Dashed': '虚线', 'Dotted': '点线', 'Squiggly': '波浪线',
  'Barred': '单横杠', 'Double barred': '双横杠', 'Solid bullet': '实心圆点', 'Hollow bullet': '空心圆点',
  'No arrowhead': '无箭头', 'Arrow colour': '箭头颜色', 'Arrow level': '箭头层数', 'No head': '无箭头', 'Epi': '满态射', 'Top harpoon': '上半箭头', 'Bottom harpoon': '下半箭头',
  'Multimap': '多值映射', 'Arrow': '普通箭头', 'Adjunction': '伴随', 'Pullback / pushout': '拉回／推出',
  'Preset': '预设', 'Diagram': '当前图形', 'Fixed size': '固定尺寸', 'Width': '宽度', 'Height': '高度',
  'Theme': '主题', 'Light': '浅色', 'Dark': '深色', 'Keyboard shortcuts': '键盘快捷键',
  'General': '通用', 'Navigation': '导航', 'Modification': '编辑', 'Styling': '样式',
  'Import from LaTeX': '导入 LaTeX', 'Export to LaTeX or Typst': '导出 LaTeX 或 Typst',
  'Pan view': '平移视图', 'Scroll': '滚轮', 'Long press': '长按', 'Enable mouse panning': '启用鼠标平移',
  'Enable touch panning': '启用触摸平移', 'Enable mouse zooming': '启用鼠标缩放', 'Move focus point': '移动焦点',
  'Select next queued cell': '选择下一个排队元素', 'Select previous queued cell': '选择上一个排队元素',
  'Select / deselect object': '选择／取消选择对象', 'Select cells': '选择元素', 'Toggle cell selection': '切换选择',
  'Focus / defocus label input': '聚焦／离开标签输入', 'Create object, and connect to selection': '创建对象并连接所选元素',
  'Move selected objects': '移动所选对象', 'Change source': '更改起点', 'Change target': '更改终点',
  'Create arrows from selection': '从所选元素创建箭头', 'Copy': '复制', 'Cut': '剪切', 'Paste': '粘贴',
  'Left-align labels': '标签左对齐', 'Centre-align labels': '标签居中', 'Over-align labels': '标签覆盖',
  'Modify label position': '调整标签位置', 'Modify offset': '调整偏移', 'Modify curve': '调整弯曲',
  'Modify radius': '调整半径', 'Modify length': '调整长度', 'Modify level': '调整层数', 'Modify style': '调整样式',
  'Display as arrow': '显示为箭头', 'Display as adjunction': '显示为伴随', 'Display as pullback/pushout': '显示为拉回／推出',
  'Modify label colour': '调整标签颜色', 'Modify arrow colour': '调整箭头颜色',
  'Reverse': '反向', 'Flip': '翻转', 'Position': '标签位置', 'Offset': '偏移', 'Curve': '弯曲',
  'Radius': '半径', 'Angle': '角度', 'Length': '长度', 'Level': '层数', 'Label': '标签',
  'Left': '左侧', 'Centre': '居中', 'Right': '右侧', 'Over': '覆盖', 'Colour': '颜色',
  'Color': '颜色', 'Style': '样式', 'Align': '对齐', 'source:': '起点：', 'target:': '终点：',
  'to edge': '到边缘', 'Import:': '导入：', 'Export:': '导出：', 'Import': '导入',
  'Export': '导出', 'Macros': '宏定义', 'Undo': '撤销', 'Redo': '重做', 'Save': '应用修改',
  'Select all': '全选', 'Delete': '删除', 'Duplicate': '复制', 'Centre view': '居中视图',
  'Zoom in': '放大', 'Zoom out': '缩小', 'Reset view': '重置视图', 'Grid': '网格',
  'Shortcuts': '快捷键', 'Help': '帮助', 'Settings': '设置', 'Close': '关闭',
  'Label position': '标签沿箭头的位置', 'Arrow offset': '箭头偏移', 'Arrow curve': '箭头弯曲',
  'Loop radius': '自环半径', 'Loop orientation': '自环角度', 'Arrow length': '箭头长度',
  'Centre diagram': '图形居中', 'Ampersand replacement': '转义列分隔符', 'Cramped': '紧凑间距',
  'Standalone': '独立文档', 'Column sep.': '列间距', 'Row sep.': '行间距',
  'Lightness': '亮度', 'Sync label/edge colours:': '同步标签和箭头颜色：', '(None)': '（无）',
};
function translate(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    // Only translate UI chrome: a user's node/arrow label must never be rewritten.
    if (root.parentElement?.closest('.cell, .katex, .code, [contenteditable]')) return;
    const word = root.textContent.trim().replace(/:$/, '');
    if (dictionary[word]) root.textContent = root.textContent.replace(word, dictionary[word]);
  } else if (root.nodeType === Node.ELEMENT_NODE) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const word = root.getAttribute(attribute);
      if (dictionary[word]) root.setAttribute(attribute, dictionary[word]);
    }
    for (const child of root.childNodes) translate(child);
  }
}
new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') translate(record.target);
    for (const node of record.addedNodes) translate(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

const marker = /\n% texleaf-quiver-v1: ([a-f0-9]{64}) ([A-Za-z0-9+/=]+)\n/;
async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
window.addEventListener('texleaf-quiver-ready', ({detail: ui}) => {
  for (const [key, value] of Object.entries({ 'export.centre_diagram': false, 'export.standalone': false, 'quiver.renderer': 'katex', 'quiver.autosave': false })) ui.settings.set(key, value);
  // The document owns import/export. Disable the upstream buttons as well as
  // hiding them: their registered keyboard shortcuts check the disabled state.
  for (const button of ui.panel.global.element.querySelectorAll('button')) button.disabled = true;
  for (const row of document.querySelectorAll('tr')) {
    if (/Import from LaTeX|Export to LaTeX or Typst|导入 LaTeX|导出 LaTeX 或 Typst/.test(row.textContent)) row.hidden = true;
  }
  ui.autosave_diagram = () => {};
  ui.save_diagram = () => send('apply-request');
  ui.load_macros_from_url = () => send('error', {message: '请在 TeX 文档中管理宏定义，交换图编辑器不加载远程宏。'});
  let original = '', initial = '', warnings = [], busy = false;
  const state = () => JSON.stringify({ q: QuiverImportExport.base64.export_selection(ui.quiver, new Set(ui.quiver.all_cells())), sep: ui.panel.sep, ampersand: ui.settings.get('export.ampersand_replacement'), cramped: ui.settings.get('export.cramped') });
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== parent || data?.protocol !== 'texleaf-quiver-v1' || data.token !== token || busy) return;
    busy = true;
    try {
      if (data.type === 'load' && typeof data.tex === 'string' && data.tex.length <= 1_000_000) {
        original = data.tex;
        ui.reset();
        const match = original.match(marker), clean = original.replace(marker, '\n');
        if (match && await digest(clean) === match[1]) {
          const cached = JSON.parse(atob(match[2]));
          QuiverImportExport.base64.import(ui, cached.q);
          ui.panel.sep = cached.sep;
          ui.settings.set('export.ampersand_replacement', cached.ampersand);
          ui.settings.set('export.cramped', cached.cramped);
          warnings = [];
        } else {
          ui.settings.set('export.ampersand_replacement', /ampersand replacement/.test(original));
          ui.panel.sep = { column: 1.8, row: 1.8 };
          ui.settings.set('export.cramped', false);
          const result = ui.quiver.import(ui, 'tikz-cd', clean, ui.settings);
          warnings = result.diagnostics.map(d => (Array.isArray(d.message) ? d.message.map(p => typeof p === 'string' ? p : p.element?.textContent ?? '').join('') : String(d.message)).replace(/Unknown (diagram|node|edge|arrow) option: /g, (_, kind) => `未识别的${{diagram:'图形',node:'节点',edge:'箭头',arrow:'箭头'}[kind]}选项：`));
        }
        // The importer completes panel synchronisation in a queued task.
        await new Promise(resolve => setTimeout(resolve, 0));
        initial = state();
        document.querySelector('.loading-screen')?.classList.add('hidden');
        translate(document.body);
        send('loaded', {warnings});
      } else if (data.type === 'export' && original) {
        if (state() === initial) { send('result', {tex: original, changed: false}); return; }
        if (warnings.length && data.allowConversion !== true) { send('error', {message: '原图包含未识别的选项；请先勾选转换确认，或取消编辑。'}); return; }
        const result = ui.quiver.export('tikz-cd', ui.settings, ui.options(), ui.definitions());
        const incompatible = [...result.metadata.tikz_incompatibilities];
        if (incompatible.length) {
          send('error', {message: `TikZ 无法准确表示当前样式，请调整后再应用：\n${incompatible.map(item => dictionary[item] ?? item).join('\n')}`});
          return;
        }
        let tex = result.data.slice(result.data.indexOf('\\begin{tikzcd}'));
        tex = tex.slice(0, tex.lastIndexOf('\\end{tikzcd}') + '\\end{tikzcd}'.length);
        if (!tex.startsWith('\\begin{tikzcd}')) throw new Error('无法导出 tikzcd 图形。');
        const hash = await digest(tex);
        tex = tex.replace('\\end{tikzcd}', `% texleaf-quiver-v1: ${hash} ${btoa(state())}\n\\end{tikzcd}`);
        if (tex.length > 1_000_000) throw new Error('图形超过 1 MB，请缩小后重试。');
        send('result', {tex, changed: true});
      }
    } catch (error) { send('error', {message: String(error.message ?? error)}); }
    finally { busy = false; }
  });
  send('ready');
});
