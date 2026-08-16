"use strict";

/**
 * Read-only renderer check for an already-running isolated visual host.
 *
 * The visual launcher opts into a loopback CDP port. This script never opens
 * a user profile or edits a document; it inspects Monaco's actual ::before
 * decoration box so static-position regressions cannot hide behind pure CSS
 * string tests.
 */

const assert = require("node:assert/strict");

const { port, scenario } = parseArguments(process.argv.slice(2));
const openingNeedle = scenario === "nested-display"
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
    return { previewCount: previews.length, ruleCss: "" };
  }
  preview.setAttribute("data-texleaf-cdp-preview", "active");
  const decorationClass = [...preview.classList].find((name) =>
    name.startsWith("ced-"),
  );
  const pseudo = getComputedStyle(preview, "::before");
  const ruleCss = findDecorationRuleCss(decorationClass);
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
      "Usage: node test/math-preview-cdp-check.cjs --port <port> --scenario nested-display|tall-display",
    );
  }
  const parsedPort = Number(argv[1]);
  const parsedScenario = argv[3];
  if (
    !Number.isSafeInteger(parsedPort) ||
    parsedPort < 1_024 ||
    parsedPort > 65_535 ||
    (parsedScenario !== "nested-display" && parsedScenario !== "tall-display")
  ) {
    throw new Error("Invalid renderer-check arguments");
  }
  return { port: parsedPort, scenario: parsedScenario };
}
