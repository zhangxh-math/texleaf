"use strict";

/**
 * Renderer check for an already-running isolated visual host.
 *
 * The visual launcher opts into a loopback CDP port. Geometry scenarios are
 * read-only. The dedicated typing-stability fixture edits only the launcher's
 * disposable temporary document so it can observe every real Monaco
 * ::before frame across debounce, worker rendering, and decoration swaps.
 */

const assert = require("node:assert/strict");

const { port, scenario } = parseArguments(process.argv.slice(2));
const openingNeedle = scenario === "nested-display" || scenario === "typing-stability"
    ? String.raw`\[`
    : String.raw`\begin{align}`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const target = await waitForWorkbenchTarget(port);
  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.request("Runtime.enable");
    await client.request("DOM.enable");
    if (scenario === "typing-stability") {
      await runTypingStabilityCheck(client);
      return;
    }
    const runtimeMetrics = await waitForPreview(client, openingNeedle);
    const document = await client.request("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const tagged = await client.request("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: '[data-texleaf-cdp-preview="active"]',
    });
    assert.notEqual(tagged.nodeId, 0, "tagged preview attachment disappeared");
    const described = await client.request("DOM.describeNode", {
      nodeId: tagged.nodeId,
      depth: 1,
      pierce: true,
    });
    const before = described.node.pseudoElements?.find(
      (node) => node.pseudoType === "before",
    );
    assert.ok(before?.nodeId, "Monaco preview attachment has no ::before node");
    const box = await client.request("DOM.getBoxModel", {
      nodeId: before.nodeId,
    });
    const quad = box.model.border;
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const cardLeft = Math.min(...xs);
    const cardRight = Math.max(...xs);
    const cardTop = Math.min(...ys);
    const cardBottom = Math.max(...ys);
    const metrics = {
      scenario,
      ...runtimeMetrics,
      cardLeft,
      cardRight,
      cardTop,
      cardBottom,
      cardWidth: cardRight - cardLeft,
      cardHeight: cardBottom - cardTop,
    };

    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);

    assert.equal(runtimeMetrics.previewCount, 1);
    assert.match(runtimeMetrics.ruleCss, /position:\s*absolute/iu);
    assert.match(
      runtimeMetrics.ruleCss,
      /transform:\s*translateX\((?:0(?:px)?|-?\d+(?:\.\d+)?ch)\)/iu,
    );
    assert.doesNotMatch(
      runtimeMetrics.ruleCss,
      /(?:^|;\s*)(?:left|right|inset(?:-inline(?:-(?:start|end))?)?)\s*:/iu,
    );
    assert.ok(Number.isFinite(runtimeMetrics.viewLineLeft));
    if (scenario === "nested-display") {
      assert.ok(Number.isFinite(runtimeMetrics.openingX));
      assert.ok(
        Math.abs(cardLeft - runtimeMetrics.openingX) <= 3,
        `preview left ${cardLeft} does not match the opening column ${runtimeMetrics.openingX}`,
      );
    } else {
      assert.ok(
        cardLeft >= runtimeMetrics.viewLineLeft - 3,
        "the off-screen opening-column correction crossed Monaco column zero",
      );
    }

    if (scenario === "nested-display") {
      assert.equal(runtimeMetrics.side, "below");
    } else {
      assert.equal(runtimeMetrics.side, "above");
      assert.ok(
        runtimeMetrics.rootHeightEm > 8,
        `tall SVG was compressed to ${runtimeMetrics.rootHeightEm}em`,
      );
      assert.ok(
        runtimeMetrics.cssHeightEm > 8,
        `tall pseudo box was declared as ${runtimeMetrics.cssHeightEm}em`,
      );
      assert.ok(
        Math.abs(runtimeMetrics.rootHeightEm - runtimeMetrics.cssHeightEm) <= 0.05,
        "SVG intrinsic height and Monaco CSS height disagree",
      );
    }

    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
    process.stdout.write("Math Preview CDP renderer check passed.\n");
  } finally {
    client.close();
  }
}

async function runTypingStabilityCheck(client) {
  const initial = await waitForPaintedPreview(client, openingNeedle);
  assert.equal(initial.previewCount, 1);
  assert.ok(initial.contentHash, "the initial preview must expose a content hash");
  await focusActiveMonacoInput(client, "x");

  // Type two characters faster than the deliberately enlarged debounce. The
  // last committed SVG must remain continuously visible until the final text
  // has rendered; the old eager-clear implementation reported zero here for
  // roughly the full 250 ms debounce on each edit.
  await client.request("Input.insertText", { text: "+" });
  await waitForVisibleEditorText(client, "x+", "the first typed character");
  const samples = [];
  for (let index = 0; index < 6; index += 1) {
    const sample = await evaluatePreview(client, openingNeedle);
    samples.push(sample);
    assertContinuousPreview(sample, `rapid typing sample ${index + 1}`);
    assert.equal(
      sample.contentHash,
      initial.contentHash,
      "the committed frame must remain in place while the replacement is debounced",
    );
    await delay(15);
  }
  await client.request("Input.insertText", { text: "y" });
  await waitForVisibleEditorText(client, "x+y", "the second typed character");
  const updated = await waitForAtomicPreviewChange(
    client,
    initial.contentHash,
    "the x+y replacement preview",
  );
  samples.push(...updated.samples);

  // Exercise the failed-render grace and its generation guard. A recursive
  // document macro fails in the real worker. Recover before the grace expires;
  // its stale failure timer must never clear the successful successor.
  await replaceCurrentLineBody(client, String.raw`\badloop`);
  const invalidStartedAt = Date.now();
  while (Date.now() - invalidStartedAt < 600) {
    const sample = await evaluatePreview(client, openingNeedle);
    samples.push(sample);
    assertContinuousPreview(sample, "temporary invalid-formula grace");
    await delay(20);
  }
  await replaceCurrentLineBody(client, "z");
  const recovered = await waitForAtomicPreviewChange(
    client,
    updated.metrics.contentHash,
    "the valid preview following a failed render",
  );
  samples.push(...recovered.samples);
  await assertPreviewRemainsVisible(
    client,
    1_000,
    "a stale failed-render timer must not clear its newer successful preview",
  );

  // Stopping on the same invalid recursive macro must eventually clear the
  // retained frame (the retry cache makes this second failure deterministic),
  // rather than leaving stale mathematics visible forever.
  await replaceCurrentLineBody(client, String.raw`\badloop`);
  await waitForPreviewCount(
    client,
    0,
    8_000,
    "a stopped invalid formula to clear after the editing grace",
  );

  // A blank body is a deterministic non-renderable state and must also clear.
  await replaceCurrentLineBody(client, "q");
  await waitForPaintedPreview(client, openingNeedle);
  await selectCurrentLineBody(client);
  await pressKey(client, "Backspace", "Backspace", 8);
  await waitForPreviewCount(client, 0, 3_000, "a blank formula to clear");

  // Restoring a formula proves the controller can recover after an explicit
  // clear; moving outside and Escape must remain true terminal clear paths.
  await client.request("Input.insertText", { text: "r" });
  await waitForPaintedPreview(client, openingNeedle);
  await clickAfterEditorText(
    client,
    "Outside the formula, the preview must disappear.",
  );
  await waitForPreviewCount(client, 0, 3_000, "leaving the formula to clear");
  await clickAfterEditorText(client, "r");
  await waitForPaintedPreview(client, openingNeedle);
  await pressKey(client, "Escape", "Escape", 27);
  await waitForPreviewCount(client, 0, 3_000, "Escape to dismiss the preview");

  process.stdout.write(
    `${JSON.stringify(
      {
        scenario,
        rapidTypingSamples: samples.length,
        initialContentHash: initial.contentHash,
        updatedContentHash: updated.metrics.contentHash,
        recoveredContentHash: recovered.metrics.contentHash,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    "Math Preview CDP typing-stability check passed: no blank frame appeared, successful updates swapped atomically, stale failures could not clear newer output, and terminal states cleared safely.\n",
  );
}

async function focusActiveMonacoInput(client, caretNeedle) {
  // Focus the first editor group through VS Code's own keybinding, then click
  // immediately after the fixture atom. Recent Monaco versions keep a
  // read-only `ime-text-area` in the DOM even when it is not the editor's real
  // input surface, so directly focusing the first textarea silently drops
  // Input.insertText.
  await pressKey(client, "1", "Digit1", 49, 2);
  await clickAfterEditorText(client, caretNeedle);
}

async function clickAfterEditorText(client, needle) {
  const response = await client.request("Runtime.evaluate", {
    expression: `(${findEditorClickPoint.toString()})(${JSON.stringify(needle)})`,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Unable to locate Monaco's fixture caret",
    );
  }
  const point = response.result.value;
  assert.equal(
    point?.found,
    true,
    "the isolated fixture must expose the formula line used for real input",
  );
  await client.request("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.request("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await delay(25);
}

function findEditorClickPoint(needle) {
  const normalizedNeedle = needle.replace(/\s/gu, " ");
  const lines = [...document.querySelectorAll(".monaco-editor .view-line")]
    .map((line) => ({
      line,
      lineText: line.textContent ?? "",
      normalized: (line.textContent ?? "").replace(/\s/gu, " "),
    }));
  const candidate =
    lines.find(({ normalized }) => normalized.trim() === normalizedNeedle) ??
    lines.find(({ normalized }) => normalized.includes(normalizedNeedle));
  if (candidate !== undefined) {
    const { line, lineText, normalized: normalizedLineText } = candidate;
    const targetOffset =
      normalizedLineText.indexOf(normalizedNeedle) + normalizedNeedle.length;
    let remaining = targetOffset;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.nodeValue?.length ?? 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(node, Math.min(remaining, length));
        range.collapse(true);
        const caretRect = range.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        return {
          found: true,
          x: caretRect.left + 1,
          y: lineRect.top + lineRect.height / 2,
        };
      }
      remaining -= length;
    }
  }
  return { found: false };
}

async function replaceCurrentLineBody(client, text) {
  await selectCurrentLineBody(client);
  await client.request("Input.insertText", { text });
}

async function selectCurrentLineBody(client) {
  await pressKey(client, "Home", "Home", 36, 8);
}

async function pressKey(client, key, code, windowsVirtualKeyCode, modifiers = 0) {
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  await client.request("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    ...event,
  });
  await client.request("Input.dispatchKeyEvent", {
    type: "keyUp",
    ...event,
  });
}

async function waitForAtomicPreviewChange(client, previousHash, label) {
  const deadline = Date.now() + 8_000;
  const samples = [];
  let stableChangedFrames = 0;
  let last;
  while (Date.now() < deadline) {
    last = await evaluatePreview(client, openingNeedle);
    samples.push(last);
    assertContinuousPreview(last, label);
    if (last.contentHash !== undefined && last.contentHash !== previousHash) {
      stableChangedFrames += 1;
      if (stableChangedFrames >= 3) {
        return { metrics: last, samples };
      }
    } else {
      stableChangedFrames = 0;
    }
    await delay(10);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${JSON.stringify(last)}`,
  );
}

function assertContinuousPreview(metrics, label) {
  assert.equal(
    metrics.previewCount,
    1,
    `${label} produced a blank or duplicate preview frame: ${JSON.stringify(metrics)}`,
  );
  assert.ok(metrics.contentHash, `${label} lost its SVG content`);
}

async function assertPreviewRemainsVisible(client, durationMs, message) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    assertContinuousPreview(await evaluatePreview(client, openingNeedle), message);
    await delay(20);
  }
}

async function waitForPreviewCount(client, expected, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluatePreview(client, openingNeedle);
    if (last?.previewCount === expected) {
      return last;
    }
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function waitForVisibleEditorText(client, expectedText, label) {
  const deadline = Date.now() + 2_000;
  let last;
  while (Date.now() < deadline) {
    last = await evaluatePreview(client, openingNeedle);
    if (
      normalizeVisibleEditorText(last?.visibleText).includes(
        normalizeVisibleEditorText(expectedText),
      )
    ) {
      return last;
    }
    await delay(10);
  }
  throw new Error(
    `Timed out waiting for ${label} to update the Monaco model: ${JSON.stringify(last)}`,
  );
}

function normalizeVisibleEditorText(value) {
  return typeof value === "string" ? value.replace(/\u00a0/gu, " ") : "";
}

async function waitForPaintedPreview(client, needle) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    last = await evaluatePreview(client, needle);
    if (last?.previewCount === 1 && last.contentHash !== undefined) {
      return last;
    }
    await delay(20);
  }
  throw new Error(
    `Timed out waiting for one painted Math Preview decoration: ${JSON.stringify(last)}`,
  );
}

async function waitForWorkbenchTarget(debugPort) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/list`;
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`CDP target endpoint returned HTTP ${response.status}`);
      }
      const targets = await response.json();
      const target = targets.find(
        (candidate) =>
          candidate.type === "page" &&
          typeof candidate.webSocketDebuggerUrl === "string" &&
          /workbench(?:-dev)?\.html/iu.test(candidate.url ?? ""),
      );
      if (target !== undefined) {
        return target;
      }
      lastError = new Error("VS Code workbench target is not ready");
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error("Timed out waiting for the isolated VS Code CDP target", {
    cause: lastError,
  });
}

async function waitForPreview(client, needle) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    last = await evaluatePreview(client, needle);
    if (last?.previewCount === 1 && last.ruleCss !== "") {
      return last;
    }
    await delay(200);
  }
  throw new Error(
    `Timed out waiting for one Math Preview decoration: ${JSON.stringify(last)}`,
  );
}

async function evaluatePreview(client, needle) {
  const expression = `(${collectPreviewMetrics.toString()})(${JSON.stringify(needle)})`;
  const response = await client.request("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Renderer evaluation failed",
    );
  }
  return response.result.value;
}

function collectPreviewMetrics(needle) {
  const allSpans = [...document.querySelectorAll(".monaco-editor .view-lines span")];
  const previews = allSpans.filter((element) => {
    const content = getComputedStyle(element, "::before").content ?? "";
    return content.includes("data:image/svg+xml;base64,");
  });
  for (const element of document.querySelectorAll("[data-texleaf-cdp-preview]")) {
    element.removeAttribute("data-texleaf-cdp-preview");
  }
  const preview = previews[0];
  if (preview === undefined) {
    return {
      previewCount: previews.length,
      ruleCss: "",
      contentHash: undefined,
    };
  }
  preview.setAttribute("data-texleaf-cdp-preview", "active");
  const pseudo = getComputedStyle(preview, "::before");
  const decorationRules = [...preview.classList]
    .filter((name) => name.startsWith("ced-"))
    .map((name) => ({
      decorationClass: name,
      ruleCss: findDecorationRuleCss(name),
    }));
  const dynamicRule = decorationRules.find(({ ruleCss }) =>
    /(?:^|;\s*)position\s*:\s*absolute/iu.test(ruleCss),
  ) ?? decorationRules.find(({ ruleCss }) => ruleCss !== "");
  const decorationClass = dynamicRule?.decorationClass;
  const ruleCss = dynamicRule?.ruleCss ?? "";
  const content = pseudo.content ?? "";
  const base64 = /base64,([^"')]+)/u.exec(content)?.[1];
  let rootHeightEm = Number.NaN;
  if (base64 !== undefined) {
    const svg = atob(base64);
    const heightEx = /\bheight="([0-9]+(?:\.[0-9]+)?)ex"/u.exec(svg)?.[1];
    rootHeightEm = heightEx === undefined
      ? Number.NaN
      : Number.parseFloat(heightEx) / 2;
  }
  const fontSizePx = Number.parseFloat(pseudo.fontSize);
  const cssHeightPx = Number.parseFloat(pseudo.height);
  const openingX = typeof needle === "string"
    ? findTextX(needle)
    : Number.NaN;
  const viewLine = preview.closest(".view-line");
  const viewLineRect = viewLine?.getBoundingClientRect();
  const anchorRect = preview.getBoundingClientRect();
  const parentRect = preview.parentElement?.getBoundingClientRect();
  return {
    previewCount: previews.length,
    contentHash: hashText(content),
    decorationClass,
    ruleCss,
    side: /(?:^|;\s*)bottom\s*:/iu.test(ruleCss) ? "above" : "below",
    computedTransform: pseudo.transform,
    computedLeft: pseudo.left,
    computedRight: pseudo.right,
    computedWidth: pseudo.width,
    computedHeight: pseudo.height,
    rootHeightEm,
    cssHeightEm: cssHeightPx / fontSizePx,
    fontSizePx,
    openingX,
    viewLineLeft: viewLineRect?.left ?? Number.NaN,
    viewLineRight: viewLineRect?.right ?? Number.NaN,
    anchorLeft: anchorRect.left,
    anchorRight: anchorRect.right,
    parentLeft: parentRect?.left ?? Number.NaN,
    parentRight: parentRect?.right ?? Number.NaN,
    computedLeft: pseudo.left,
    computedRight: pseudo.right,
    baseLeft: preview.getBoundingClientRect().left,
    visibleText:
      document.querySelector(".monaco-editor.focused .view-lines")?.textContent ??
      [...document.querySelectorAll(".monaco-editor .view-lines")]
        .map((viewLines) => viewLines.textContent ?? "")
        .join("\n"),
  };

  function findDecorationRuleCss(className) {
    if (className === undefined) {
      return "";
    }
    const selectorNeedle = `.${className}::before`;
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const found = findRule(rules, selectorNeedle);
      if (found !== undefined) {
        return found;
      }
    }
    return "";
  }

  function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function findRule(rules, selectorNeedle) {
    for (const rule of rules) {
      if (
        typeof rule.selectorText === "string" &&
        rule.selectorText.includes(selectorNeedle)
      ) {
        const declarations = ["content: [data-uri]"];
        for (let index = 0; index < rule.style.length; index += 1) {
          const property = rule.style.item(index);
          if (property.toLowerCase() === "content") {
            continue;
          }
          const value = rule.style.getPropertyValue(property);
          const priority = rule.style.getPropertyPriority(property);
          declarations.push(
            `${property}: ${value}${priority === "" ? "" : ` !${priority}`}`,
          );
        }
        return `${declarations.join("; ")};`;
      }
      if (rule.cssRules !== undefined) {
        const nested = findRule(rule.cssRules, selectorNeedle);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return undefined;
  }

  function findTextX(text) {
    for (const line of document.querySelectorAll(".monaco-editor .view-line")) {
      const lineText = line.textContent ?? "";
      const target = lineText.indexOf(text);
      if (target < 0) {
        continue;
      }
      let remaining = target;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const length = node.nodeValue?.length ?? 0;
        if (remaining <= length) {
          const range = document.createRange();
          range.setStart(node, Math.min(remaining, length));
          range.collapse(true);
          return range.getBoundingClientRect().left;
        }
        remaining -= length;
      }
    }
    return Number.NaN;
  }
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;
    const openingTimeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting to VS Code CDP"));
    }, 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(openingTimeout);
      resolve({
        request(method, params = {}) {
          const id = nextId++;
          return new Promise((requestResolve, requestReject) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              requestReject(new Error(`CDP ${method} timed out`));
            }, 10_000);
            pending.set(id, { resolve: requestResolve, reject: requestReject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter === undefined) {
        return;
      }
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error !== undefined) {
        waiter.reject(new Error(`CDP error ${message.error.code}: ${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(openingTimeout);
      reject(new Error("VS Code CDP WebSocket failed"));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--port" || argv[2] !== "--scenario") {
    throw new Error(
      "Usage: node test/math-preview-cdp-check.cjs --port <port> --scenario nested-display|tall-display|typing-stability",
    );
  }
  const parsedPort = Number(argv[1]);
  const parsedScenario = argv[3];
  if (
    !Number.isSafeInteger(parsedPort) ||
    parsedPort < 1_024 ||
    parsedPort > 65_535 ||
    parsedScenario !== "nested-display" &&
    parsedScenario !== "tall-display" &&
    parsedScenario !== "typing-stability"
  ) {
    throw new Error("Invalid renderer-check arguments");
  }
  return { port: parsedPort, scenario: parsedScenario };
}
