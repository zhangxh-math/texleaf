import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { renderSnippetManagerWebview } from "../src/snippetManagerWebview";

function manager() {
  const html = renderSnippetManagerWebview("modal-test");
  const handlers = new Map<string, (event: any) => void>();
  let active: Element | undefined;
  class Element {
    disabled = false; hidden = false; checked = false; value = ""; type = "";
    textContent = ""; dataset = {}; children: Element[] = [];
    listeners = new Map<string, () => void>();
    constructor(readonly id = "", readonly attributes = "") {
      this.hidden = /\bhidden\b/u.test(attributes);
      this.disabled = /\bdisabled\b/u.test(attributes);
    }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    focus() { active = this; }
    closest() { return null; }
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getAttribute(name: string) { return new RegExp(`${name}="([^"]*)"`, "u").exec(this.attributes)?.[1] ?? null; }
    querySelectorAll(selector: string): Element[] {
      if (this.id === "replace-scopes") return this.children.flatMap(c => c.children).filter(c => c.checked);
      const ids = this.id === "confirm-panel" ? ["confirm-accept", "confirm-cancel"]
        : this.id === "replace-panel" ? ["replace-find", "replace-with", "replace-case", "replace-regex", "replace-apply", "replace-close"] : [];
      return ids.map(element).filter(e => !selector.includes("disabled") || !e.disabled);
    }
    contains(target: Element) { return target === this || this.querySelectorAll("").includes(target); }
  }
  const elements = new Map<string, Element>();
  for (const m of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/gu)) elements.set(m[1]!, new Element(m[1]!, m[0]));
  const element = (id: string): Element => elements.get(id)!;
  const script = /<script nonce="modal-test">([\s\S]*?)<\/script>/u.exec(html)![1]!;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage() {} }),
    document: { getElementById: element, get activeElement() { return active; },
      querySelectorAll: () => [], addEventListener: (name: string, listener: (event: any) => void) => handlers.set(name, listener),
      createElement: () => new Element(), createTextNode: () => new Element() },
    window: { addEventListener() {} }, setInterval: () => 1, clearInterval() {}, TextEncoder,
  });
  const click = (id: string) => element(id).listeners.get("click")!();
  const key = (value: string, shiftKey = false) => {
    let prevented = false;
    handlers.get("keydown")!({ key: value, shiftKey, preventDefault() { prevented = true; }, stopPropagation() {} });
    return prevented;
  };
  element("find-replace").focus(); click("find-replace");
  return { element, click, key, active: () => active };
}

test("bulk-replace modal keeps forward and reverse Tab inside its enabled controls", () => {
  const h = manager();
  assert.equal(h.active(), h.element("replace-find"));
  h.element("replace-close").focus();
  assert.equal(h.key("Tab"), true);
  assert.equal(h.active(), h.element("replace-find"));
  assert.equal(h.key("Tab", true), true);
  assert.equal(h.active(), h.element("replace-close"));
  h.element("replace-with").focus();
  assert.equal(h.key("Tab"), false, "ordinary interior Tab retains the browser's normal order");
  h.element("confirm-panel").hidden = false;
  h.element("confirm-cancel").focus();
  assert.equal(h.key("Tab"), true);
  assert.equal(h.active(), h.element("confirm-accept"), "the top confirmation owns focus, not its parent");
});

test("Escape and Cancel restore focus to the bulk-replace trigger", () => {
  const h = manager();
  h.key("Escape");
  assert.equal(h.element("replace-panel").hidden, true);
  assert.equal(h.active(), h.element("find-replace"));
  h.click("find-replace"); h.click("replace-close");
  assert.equal(h.element("replace-panel").hidden, true);
  assert.equal(h.active(), h.element("find-replace"));
});

test("invalid replacement regex is announced and associated with the input while Apply is disabled", () => {
  const h = manager();
  h.element("replace-find").value = "[";
  h.element("replace-regex").checked = true;
  h.element("replace-find").listeners.get("input")!();
  assert.match(h.element("replace-summary").textContent, /正则表达式无效/u);
  assert.equal(h.element("replace-apply").disabled, true);
  assert.equal(h.element("replace-summary").getAttribute("role"), "status");
  assert.equal(h.element("replace-summary").getAttribute("aria-live"), "polite");
  assert.equal(h.element("replace-find").getAttribute("aria-describedby"), "replace-summary");
});
