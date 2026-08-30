/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

/** Browser-level geometry and interaction checks for an isolated VS Code host. */

const assert = require("node:assert/strict");
const fs = require("node:fs");

const { port } = parseArguments(process.argv.slice(2));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const target = await waitForVisualEditorTarget(port);
  const client = await connectCdp(target.webSocketDebuggerUrl);
  const contexts = new Map();
  client.on("Runtime.executionContextCreated", ({ context }) => {
    contexts.set(context.id, context);
  });
  client.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
    contexts.delete(executionContextId);
  });
  try {
    await normalizeTestWindow(client);
    await delay(250);
    await client.request("Runtime.enable");
    const contextId = await waitForVisualContext(client, contexts);
    if (process.env.TEXLEAF_CDP_RAPID_FORMULA_SCROLL_ONLY === "1") {
      const result = await runRapidFormulaScrollChecks(client, contextId);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_LOGICAL_LINE_NAVIGATION_ONLY === "1") {
      const result = await runLogicalLineNavigationChecks(client, contextId);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_REVERSE_SYNC_FOCUS_ONLY === "1") {
      const testFile = process.env.TEXLEAF_CDP_TEST_TEX_FILE;
      assert.ok(testFile, "TEXLEAF_CDP_TEST_TEX_FILE is required");
      const source = fs.readFileSync(testFile, "utf8");
      const needle = "The piecewise expression is";
      const offset = source.indexOf(needle);
      assert.ok(offset >= 0, `reverse SyncTeX target missing: ${needle}`);
      await evaluate(
        client,
        contextId,
        `(() => {
          window.dispatchEvent(new MessageEvent("message", {
            data: {
              protocol: 1,
              type: "focus",
              selection: { anchor: ${offset}, head: ${offset} },
              options: { center: true, flash: true },
            },
          }));
          return true;
        })()`,
      );
      const focused = await waitFor(
        client,
        contextId,
        reverseSyncFocusExpression(),
        (value) => value.flashCount === 1 && value.targetContainsNeedle,
        "centered reverse SyncTeX line flash",
      );
      assert.ok(
        focused.centerDelta <= Math.max(80, focused.scrollerHeight * 0.18),
        `reverse SyncTeX target was not centered: ${JSON.stringify(focused)}`,
      );
      await delay(1_400);
      const settled = await evaluate(
        client,
        contextId,
        reverseSyncFocusExpression(),
      );
      assert.equal(
        settled.flashCount,
        0,
        `reverse SyncTeX flash did not clear: ${JSON.stringify(settled)}`,
      );
      process.stdout.write(`${JSON.stringify({ focused, settled }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_SAVE_ONLY === "1") {
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      await delay(600);
      process.stdout.write(`${JSON.stringify(await evaluate(
        client,
        contextId,
        codeMirrorSyntaxDiagnosticsExpression(),
      ), null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_SYNTAX_ONLY === "1") {
      const before = await evaluate(
        client,
        contextId,
        codeMirrorSyntaxDiagnosticsExpression(),
      );
      const formula = await locate(
        client,
        contextId,
        formulaByLabelExpression("eq:flag"),
        "formula used for syntax-token diagnostics",
      );
      await dispatchClick(client, formula.point);
      const after = await waitFor(
        client,
        contextId,
        codeMirrorSyntaxDiagnosticsExpression(),
        (value) => value.lines.some((line) => line.text.includes(String.raw`\begin{equation}`)),
        "expanded formula source for syntax-token diagnostics",
      );
      const probe = "REF_COMPLETION_PROBE";
      const newFormula = String.raw`New syntax probe: \binom{N}{2}`;
      const colorProbe = await evaluate(
        client,
        contextId,
        installIncrementalSyntaxColorProbeExpression(newFormula),
      );
      assert.equal(colorProbe.installed, true, JSON.stringify(colorProbe));
      await selectLineSubstring(client, contextId, probe, 0, probe.length);
      await client.request("Input.insertText", { text: newFormula });
      const optimistic = await evaluate(
        client,
        contextId,
        incrementalSyntaxLineExpression(newFormula),
      );
      assert.equal(optimistic.present, true, JSON.stringify(optimistic));
      assert.ok(
        optimistic.optimisticTokenCount > 0,
        `new input did not receive synchronous optimistic syntax colour: ${JSON.stringify(optimistic)}`,
      );
      assert.equal(
        optimistic.hasLiveSyntaxColor,
        true,
        `newly typed LaTeX was white before the host token patch: ${JSON.stringify(optimistic)}`,
      );
      const incremental = await waitFor(
        client,
        contextId,
        incrementalSyntaxLineExpression(newFormula),
        (value) =>
          value.present && value.nativeTokenCount > 0 &&
          value.optimisticTokenCount === 0,
        "authoritative TextMate tokens after optimistic highlighting",
      );
      assert.equal(
        incremental.hasLiveSyntaxColor,
        true,
        `newly typed LaTeX remained plain white: ${JSON.stringify(incremental)}`,
      );
      const continuity = await evaluate(
        client,
        contextId,
        sampleIncrementalSyntaxColorProbeExpression(18),
      );
      assert.equal(
        continuity.unstyledFrames,
        0,
        `formula source flashed to the editor foreground: ${JSON.stringify(continuity)}`,
      );
      process.stdout.write(`${JSON.stringify({
        before,
        after,
        optimistic,
        incremental,
        continuity,
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_BIBLIOGRAPHY_SOURCE_ONLY === "1") {
      const sourceButton = await locate(
        client,
        contextId,
        structureActionContainingTextExpression(
          ".texleaf-bibliography-card",
          "References",
          "编辑引用命令",
        ),
        "bibliography source-edit button",
      );
      await dispatchClick(client, sourceButton.point);
      const revealed = await waitFor(
        client,
        contextId,
        bibliographySourceExpression(),
        (value) => value.styleVisible && value.resourceVisible && value.activeOnSourceLine,
        "expanded bibliography LaTeX source",
      );
      await clickLine(client, contextId, "Undo probe:");
      const restored = await locate(
        client,
        contextId,
        selectorExpression(".texleaf-bibliography-card", 0),
        "bibliography preview restored after leaving its source",
      );
      process.stdout.write(`${JSON.stringify({ revealed, restored: restored.text.trim() }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_PUNCTUATION_COMPLETION_ONLY === "1") {
      const probe = "CITE_COMMAND_PROBE";
      const ordinaryLine = "Comma completion probe: rho=(a,b)";
      await selectLineSubstring(client, contextId, probe, 0, probe.length);
      await client.request("Input.insertText", { text: ordinaryLine });
      await clickLine(client, contextId, ordinaryLine);
      await dispatchKey(client, "End", "End", 35);
      await client.request("Input.insertText", { text: "," });
      await delay(450);
      const ordinaryPopup = await evaluate(
        client,
        contextId,
        completionPopupExpression(),
      );
      assert.equal(
        ordinaryPopup.present,
        false,
        `an ordinary comma opened LaTeX completions: ${ordinaryPopup.text}`,
      );

      const completedOrdinaryLine = `${ordinaryLine},`;
      await selectLineSubstring(
        client,
        contextId,
        completedOrdinaryLine,
        0,
        completedOrdinaryLine.length,
      );
      const citeSource = String.raw`\cite{wangBKPAffineCoordinatesEmergent2025}`;
      await client.request("Input.insertText", { text: citeSource });
      await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
      await client.request("Input.insertText", { text: "," });
      const citationPopup = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) => value.present && /reference\.bib/u.test(value.text),
        "citation-key completion after a comma",
      );
      assert.doesNotMatch(citationPopup.text, /Subscript|Minus or plus/u);
      process.stdout.write(`${JSON.stringify({ ordinaryPopup, citationPopup }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_COMPLETION_CARET_ONLY === "1") {
      const testFile = process.env.TEXLEAF_CDP_TEST_TEX_FILE;
      if (testFile === undefined || testFile.length === 0) {
        throw new Error("TEXLEAF_CDP_TEST_TEX_FILE is required for completion-caret checks.");
      }
      await evaluate(
        client,
        contextId,
        `(() => {
          globalThis.__texleafCompletionTrace = [];
          globalThis.addEventListener("message", (event) => {
            const message = event.data;
            if (message?.protocol !== 1) return;
            if (!/completion/iu.test(message.type ?? "")) return;
            globalThis.__texleafCompletionTrace.push({
              type: message.type,
              requestId: message.requestId,
              revision: message.revision,
              from: message.from,
              key: message.key,
              itemCount: Array.isArray(message.items) ? message.items.length : undefined,
              itemKeys: Array.isArray(message.items)
                ? message.items.slice(0, 8).map((item) => item.referencePreviewKey ?? item.label)
                : undefined,
            });
          });
          return true;
        })()`,
      );
      const referenceProbe = "REF_COMPLETION_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        referenceProbe,
        0,
        referenceProbe.length,
      );
      await client.request("Input.insertText", { text: String.raw`\ref{}` });
      await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
      await client.request("Input.insertText", { text: "def:stable" });
      await delay(220);
      if (!(await evaluate(client, contextId, citationCompletionPopupExpression())).present) {
        await dispatchModifiedKey(client, " ", "Space", 32, 2);
      }
      const referenceCompletion = await waitFor(
        client,
        contextId,
        citationCompletionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("def:stable") &&
          value.infoTheorem &&
          value.info.includes("Definition") &&
          value.infoOnRight,
        "first-open theorem completion preview before caret regression",
      );
      await delay(100);
      await dispatchKey(client, "Enter", "Enter", 13);
      const completedReference = await waitFor(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-reference-chip-target", "def:stable"),
        (value) => value.text.includes("def:stable"),
        "completed reference collapsed after the closing brace",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const referenceAfterTab = await waitForFileText(
        testFile,
        (value) => value.split(/\r?\n/u)
          .some((line) => line.trim() === String.raw`\ref{def:stable}`),
        "saved reference after Tab",
      );
      const completedReferenceLine = referenceAfterTab.split(/\r?\n/u)
        .find((line) => line.trim().includes(String.raw`\ref{def:stable}`));
      assert.equal(
        completedReferenceLine?.match(/def:stable/gu)?.length,
        1,
        `Tab reaccepted the reference completion: ${completedReferenceLine}`,
      );

      // Tab is structural even while a completion list is visible. It closes
      // the list and crosses the local `}` without accepting the selected
      // `eq:flag` candidate. The formula preview must already be present on
      // this first opening; moving the caret out and back in is not allowed to
      // be the operation which makes the details pane appear.
      const formulaTabProbe = "LABEL_COMPLETION_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        formulaTabProbe,
        0,
        formulaTabProbe.length,
      );
      await client.request("Input.insertText", { text: String.raw`\eqref{}` });
      await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
      await client.request("Input.insertText", { text: "eq:fl" });
      await delay(220);
      if (!(await evaluate(client, contextId, citationCompletionPopupExpression())).present) {
        await dispatchModifiedKey(client, " ", "Space", 32, 2);
      }
      const formulaCompletion = await waitFor(
        client,
        contextId,
        citationCompletionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("eq:flag") &&
          value.info.includes("eq:flag") &&
          value.infoSvg &&
          value.infoOnRight,
        "first-open formula completion preview before Tab",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "X" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const formulaAfterTab = await waitForFileText(
        testFile,
        (value) => value.split(/\r?\n/u)
          .some((line) => line.trim() === String.raw`\eqref{eq:fl}X`),
        "Tab crossing a reference closer without accepting completion",
      );
      assert.doesNotMatch(
        formulaAfterTab,
        /\\eqref\{eq:flag\}X/u,
        "Tab accepted the visible formula-label completion",
      );

      const snippetProbe = "CITE_COMMAND_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        snippetProbe,
        0,
        snippetProbe.length,
      );
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        exactLineExpression(String.raw`\(\)`),
        (value) => value?.text.trim() === String.raw`\(\)`,
        "lm automatic snippet expansion",
      );
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      const restoredTrigger = await waitFor(
        client,
        contextId,
        exactLineExpression("lm"),
        (value) => value?.text.trim() === "lm",
        "snippet undo caret after the restored trigger",
      );
      await client.request("Input.insertText", { text: "x" });
      const typedAfterTrigger = await waitFor(
        client,
        contextId,
        exactLineExpression("lmx"),
        (value) => value?.text.trim() === "lmx",
        "typing after the restored trigger",
      );
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      await waitForFileText(
        testFile,
        (value) => value.split(/\r?\n/u).some((line) => line.trim() === "lmx"),
        "saved text after the restored trigger",
      );
      process.stdout.write(`${JSON.stringify({
        referenceCompletion: referenceCompletion.text.trim(),
        referenceInfo: referenceCompletion.info.trim(),
        completedReference: completedReference.text.trim(),
        completedReferenceLine,
        formulaCompletion: formulaCompletion.text.trim(),
        formulaInfo: formulaCompletion.info.trim(),
        formulaAfterTab: formulaAfterTab.split(/\r?\n/u)
          .find((line) => line.trim() === String.raw`\eqref{eq:fl}X`),
        restoredTrigger: restoredTrigger.text.trim(),
        typedAfterTrigger: typedAfterTrigger.text.trim(),
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_REFERENCE_SOURCE_ONLY === "1") {
      const equationChip = await locate(
        client,
        contextId,
        referenceTargetByKeyExpression("eq:flag"),
        "visual equation reference",
      );
      assert.equal(equationChip.text.trim(), "eq:flag", JSON.stringify(equationChip));
      await dispatchClick(client, equationChip.point);
      const equationSource = await waitFor(
        client,
        contextId,
        visualNavigationStateExpression(),
        (value) => value.activeLine.includes(String.raw`\eqref{eq:flag}`),
        "equation reference click revealing source",
      );
      await clickLine(client, contextId, "The piecewise expression is");
      await waitFor(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-reference-chip", "eq:flag"),
        (value) => value.text.includes("eq:flag"),
        "equation reference returning to visual form",
      );

      const theoremChip = await locate(
        client,
        contextId,
        referenceTargetByKeyExpression("def:stable"),
        "visual theorem reference",
      );
      assert.equal(theoremChip.text.trim(), "1.1", JSON.stringify(theoremChip));
      await dispatchClick(client, theoremChip.point);
      const theoremSource = await waitFor(
        client,
        contextId,
        visualNavigationStateExpression(),
        (value) => value.activeLine.includes(String.raw`\ref{def:stable}`),
        "theorem reference click revealing source",
      );
      await clickLine(client, contextId, "The piecewise expression is");
      await waitFor(
        client,
        contextId,
        referenceTargetByKeyExpression("def:stable"),
        (value) => value.text.trim() === "1.1",
        "theorem reference returning to visual form",
      );

      const headingChip = await locate(
        client,
        contextId,
        referenceTargetByKeyExpression("sec:introduction"),
        "visual section reference",
      );
      assert.equal(headingChip.text.trim(), "1", JSON.stringify(headingChip));
      await dispatchClick(client, headingChip.point);
      const headingSource = await waitFor(
        client,
        contextId,
        visualNavigationStateExpression(),
        (value) => value.activeLine.includes(String.raw`\ref{sec:introduction}`),
        "section reference click revealing source",
      );
      await clickLine(client, contextId, "The piecewise expression is");

      const citationChip = await locate(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-citation-chip", "Wang"),
        "visual bibliography citation",
      );
      await dispatchClick(client, citationChip.point);
      const citationSource = await waitFor(
        client,
        contextId,
        visualNavigationStateExpression(),
        (value) => value.activeLine.includes(String.raw`\citet{wang2025}`),
        "bibliography citation click revealing source",
      );
      process.stdout.write(`${JSON.stringify({
        equationSource: equationSource.activeLine,
        theoremSource: theoremSource.activeLine,
        headingSource: headingSource.activeLine,
        citationSource: citationSource.activeLine,
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_NESTED_SNIPPET_ONLY === "1") {
      const testFile = process.env.TEXLEAF_CDP_TEST_TEX_FILE;
      if (testFile === undefined || testFile.length === 0) {
        throw new Error("TEXLEAF_CDP_TEST_TEX_FILE is required for nested snippet checks.");
      }
      await clickLine(client, contextId, "Undo probe:");
      await dispatchKey(client, "End", "End", 35);
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => /Undo probe:\s*\\\(\\\)/u.test(value),
        "outer inline-math snippet",
      );
      await client.request("Input.insertText", { text: "//" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => /\\frac\{\}\{\}/u.test(value),
        "nested fraction snippet",
      );
      await client.request("Input.insertText", { text: "(" });
      await client.request("Input.insertText", { text: "2" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => /\\frac\{\(2\)\}\{\}/u.test(value),
        "tracked parenthesis inside fraction numerator",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "D" });
      const denominator = await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => /\\frac\{\(2\)\}\{D\}/u.test(value),
        "second Tab entering the fraction denominator",
      );
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      await client.request("Input.insertText", { text: "E" });
      const denominatorAfterUndo = await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => /\\frac\{\(2\)\}\{E\}/u.test(value),
        "denominator caret retained after undo",
      );

      await clickLine(client, contextId, "CITE_COMMAND_PROBE");
      await dispatchKey(client, "Home", "Home", 36);
      await dispatchModifiedKey(client, "End", "End", 35, 8);
      await client.request("Input.insertText", { text: "Nested probe: " });
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Nested probe:"),
        (value) => /Nested probe:\s*\\\(\\\)/u.test(value),
        "generic outer snippet",
      );
      await client.request("Input.insertText", { text: "//" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Nested probe:"),
        (value) => /\\frac\{\}\{\}/u.test(value),
        "generic parent snippet",
      );
      await client.request("Input.insertText", { text: "sq" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Nested probe:"),
        (value) => /\\frac\{\\sqrt\{/u.test(value),
        "child square-root snippet",
      );
      await client.request("Input.insertText", { text: "x" });
      await dispatchKey(client, "Tab", "Tab", 9);
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "d" });
      const genericNested = await waitFor(
        client,
        contextId,
        lineTextExpression("Nested probe:"),
        (value) => /\\frac\{\\sqrt\{\s*x\s*\}\}\{d\}/u.test(value),
        "child snippet returning to its parent denominator",
      );

      // Exercise a three-level automatic-snippet stack exactly as it is typed
      // in day-to-day mathematics: inline math -> gamma -> subscript -> power.
      // The first Tab after `mu` may leave only the exponent braces; it must not
      // skip the parent inline-math field and jump past `\\)`.
      await clickLine(client, contextId, "Nested probe:");
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: "Power probe: " });
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /Power probe:\s*\\\(\\\)/u.test(value),
        "outer inline-math snippet for nested power",
      );
      await client.request("Input.insertText", { text: ";g" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma\\\)/u.test(value),
        "automatic gamma snippet",
      );
      await client.request("Input.insertText", { text: "_" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma_\{\}\\\)/u.test(value),
        "automatic subscript snippet",
      );
      await client.request("Input.insertText", { text: "nu" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma_\{\\nu\}\\\)/u.test(value),
        "automatic nu snippet inside subscript",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "rd" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma_\{(?:\\nu|nu)\}\^\{\}\\\)/u.test(value),
        "automatic power nested after subscript",
      );
      await client.request("Input.insertText", { text: "mu" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma_\{\\nu\}\^\{\\mu\}\\\)/u.test(value),
        "automatic mu snippet inside power",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "AFTER_POWER" });
      const nestedPowerInside = await waitFor(
        client,
        contextId,
        lineTextExpression("Power probe:"),
        (value) => /\\gamma_\{\\nu\}\^\{\\mu\}AFTER_POWER\\\)/u.test(value),
        "power Tab leaving only the exponent braces",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "OUTSIDE_POWER" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const nestedPowerOutside = await waitForFileText(
        testFile,
        (value) =>
          /Power probe:\s*\\\(\\gamma_\{\\nu\}\^\{\\mu\}AFTER_POWER\\\)OUTSIDE_POWER/u.test(value),
        "later Tab leaving the parent inline-math snippet",
      );

      // Binomial arguments follow the same nested delimiter/placeholder order
      // as fractions: close the tracked parenthesis, enter the second argument,
      // leave the binomial, then finally leave the outer inline-math snippet.
      await clickLine(client, contextId, "Nested probe:");
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: "Binomial probe: " });
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Binomial probe:"),
        (value) => /Binomial probe:\s*\\\(\\\)/u.test(value),
        "outer inline-math snippet for binomial",
      );
      await client.request("Input.insertText", { text: "bino" });
      await waitFor(
        client,
        contextId,
        lineTextExpression("Binomial probe:"),
        (value) => /\\binom\{\}\{\}/u.test(value),
        "nested binomial snippet",
      );
      await client.request("Input.insertText", { text: "(" });
      await client.request("Input.insertText", { text: "2" });
      await dispatchKey(client, "Tab", "Tab", 9);
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "K" });
      const binomialDenominator = await waitFor(
        client,
        contextId,
        lineTextExpression("Binomial probe:"),
        (value) => /\\binom\{\(2\)\}\{K\}/u.test(value),
        "binomial second argument after two Tabs",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "R" });
      const binomialAfter = await waitFor(
        client,
        contextId,
        lineTextExpression("Binomial probe:"),
        (value) => /\\binom\{\(2\)\}\{K\}R\\\)/u.test(value),
        "binomial exit placeholder retaining outer math",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "AFTER_BINOM" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const binomialOutside = await waitForFileText(
        testFile,
        (value) => /Binomial probe:\s*\\\(\\binom\{\(2\)\}\{K\}R\\\)AFTER_BINOM/u.test(value),
        "outer inline-math exit after nested binomial",
      );

      // A visible environment completion must apply on the first Enter.  This
      // covers the user-facing `enu` path separately from automatic TeXLeaf
      // snippets such as `lm` and prevents an asynchronous project refresh
      // from turning the first Enter into a no-op.
      // Comments and folded source-only probe lines are deliberately omitted
      // from Visual mode. Create a fresh visible line instead of depending on
      // the old `% BEQ` marker, which made this regression stop after the
      // nesting assertions had already passed.
      await clickLine(client, contextId, "Binomial probe:");
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: "enu" });
      const enumerateCompletion = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes(String.raw`\begin{enumerate}`),
        "single-Enter enumerate completion",
      );
      assert.match(enumerateCompletion.text, /\\begin\{enumerate\}/u);
      await dispatchKey(client, "Enter", "Enter", 13);
      const enumerateApplied = await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) =>
          /\\begin\{enumerate\}[\s\S]*\\item[\s\S]*\\end\{enumerate\}/u.test(value),
        "enumerate completion accepted by the first Enter",
      );

      await clickLine(client, contextId, "Pairing probe:");
      // Insert the environment probe after the visible pairing line.  Using
      // Home here is ambiguous while the inline formula widget is expanded:
      // CodeMirror may resolve the visual-line start to the previous logical
      // source line.  End + Enter gives this regression a deterministic fresh
      // line without weakening the actual nested-environment assertion.
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: String.raw`\lem` });
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => /\\begin\{lemma\}[\s\S]*\\end\{lemma\}/u.test(value),
        "outer lemma snippet",
      );
      await client.request("Input.insertText", { text: "lm" });
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => /\\begin\{lemma\}[\s\S]*\\\(\\\)[\s\S]*\\end\{lemma\}/u.test(value),
        "inline-math snippet inside lemma",
      );
      await client.request("Input.insertText", { text: "x" });
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "inside" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const insideLemma = await waitForFileText(
        testFile,
        (value) => /\\begin\{lemma\}[\s\S]*\\\(x\\\)inside[\s\S]*\\end\{lemma\}/u.test(value),
        "first Tab remaining inside lemma",
      );
      await dispatchModifiedKey(client, "Enter", "Enter", 13, 8);
      await client.request("Input.insertText", { text: "OUT" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const afterLemma = await waitForFileText(
        testFile,
        (value) => /\\end\{lemma\}\r?\nOUT\r?\n/u.test(value),
        "Shift+Enter leaving the completed lemma on a new line",
      );

      // Exercise the exact LaTeX Workshop path reported by the user.  The
      // first Tab inside `T_{\rho}` must cross the local group closer.  Once
      // no local delimiter remains, every later Tab inserts one normalized
      // alignment point; only Shift+Enter may leave the true environment.
      await clickLine(client, contextId, "OUT");
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: "BSAL" });
      const bsalCompletion = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("BSAL") &&
          value.text.includes("align*"),
        "LaTeX Workshop BSAL completion",
      );
      assert.match(bsalCompletion.text, /align\*/u);
      await dispatchKey(client, "Enter", "Enter", 13);
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => /\\begin\{align\*\}[\s\S]*\\end\{align\*\}/u.test(value),
        "BSAL accepted by the first Enter",
      );
      await client.request("Input.insertText", { text: String.raw`T_{\rho}` });
      await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "Q" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const bsalInside = await waitForFileText(
        testFile,
        (value) =>
          /\\begin\{align\*\}[\s\S]*T_\{\\rho\}Q[\s\S]*\\end\{align\*\}/u.test(value),
        "first Tab remaining inside the BSAL align group",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "RIGHT" });
      const alignFirstPoint = await waitFor(
        client,
        contextId,
        lineTextExpression(String.raw`T_{\rho}Q`),
        (value) => /T_\{\\rho\}Q\s*&\s*RIGHT/u.test(value),
        "first normalized align point",
      );
      await dispatchKey(client, "Tab", "Tab", 9);
      await client.request("Input.insertText", { text: "SECOND" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const alignSecondPoint = await waitForFileText(
        testFile,
        (value) =>
          /T_\{\\rho\}Q\s*&\s*RIGHT\s*&\s*SECOND/u.test(value),
        "second normalized align point",
      );
      await dispatchModifiedKey(client, "Enter", "Enter", 13, 8);
      await client.request("Input.insertText", { text: "AFTER_BSAL" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const bsalAfter = await waitForFileText(
        testFile,
        (value) => /\\end\{align\*\}\r?\nAFTER_BSAL\r?\n/u.test(value),
        "Shift+Enter leaving the completed BSAL align snippet",
      );
      const alignSecondLine = alignSecondPoint
        .split(/\r?\n/u)
        .find((line) => line.includes(String.raw`T_{\rho}Q`)) ?? "";
      assert.equal((alignSecondLine.match(/&/gu) ?? []).length, 2);

      const pairingProbe = "Pairing probe: $x$";
      const pairingFormula = await locate(
        client,
        contextId,
        formulaWidgetInLineExpression("Pairing probe:"),
        "rendered math apostrophe probe",
      );
      await dispatchClick(client, pairingFormula.point);
      await waitFor(
        client,
        contextId,
        exactLineExpression(pairingProbe),
        (value) => value.text.trim() === pairingProbe,
        "editable math apostrophe source",
      );
      await evaluate(
        client,
        contextId,
        directLineSubstringSelectionExpression(
          pairingProbe,
          "Pairing probe: $x".length,
          0,
        ),
      );
      await dispatchPrintableKey(client, "'", "Quote", 222);
      await dispatchPrintableKey(client, "'", "Quote", 222);
      const mathApostrophes = await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => value.includes("Pairing probe: $x''$"),
        "literal math apostrophes",
      );
      assert.doesNotMatch(mathApostrophes, /x''''/u);
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => value.includes("Pairing probe: $x$"),
        "grouped apostrophe typing undo",
      );
      await dispatchModifiedKey(client, "y", "KeyY", 89, 2);
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => value.includes("Pairing probe: $x''$"),
        "grouped apostrophe typing redo",
      );

      await clickLine(client, contextId, "The second case follows from the theorem.");
      await dispatchKey(client, "End", "End", 35);
      await dispatchKey(client, "Enter", "Enter", 13);
      await client.request("Input.insertText", { text: "The third case is generated." });
      await waitFor(
        client,
        contextId,
        editorTextExpression(),
        (value) => /\\item The third case is generated\./u.test(value),
        "list Enter creating a third item",
      );
      await dispatchKey(client, "Enter", "Enter", 13);
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      await waitForFileText(
        testFile,
        (value) => /\\item The third case is generated\.\r?\n[ \t]*\\item /u.test(value),
        "list Enter creating an empty item",
      );
      await dispatchKey(client, "Enter", "Enter", 13);
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const listAfterEmptyExit = await waitForFileText(
        testFile,
        (value) => /\\item The third case is generated\.\r?\n[ \t]*\\end\{enumerate\}\r?\n/u.test(value),
        "empty list item removal",
      );
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      await waitForFileText(
        testFile,
        (value) => /\\item The third case is generated\.\r?\n[ \t]*\\item /u.test(value),
        "empty-item removal undo",
      );
      await dispatchModifiedKey(client, "y", "KeyY", 89, 2);
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      await waitForFileText(
        testFile,
        (value) => /\\item The third case is generated\.\r?\n[ \t]*\\end\{enumerate\}\r?\n/u.test(value),
        "empty-item removal redo",
      );
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const listFile = await waitForFileText(
        testFile,
        (value) => /\\item The third case is generated\.\r?\n[ \t]*\\end\{enumerate\}\r?\n/u.test(value),
        "saved list Enter result",
      );
      process.stdout.write(`${JSON.stringify({
        denominator,
        denominatorAfterUndo,
        genericNested,
        nestedPowerInside,
        nestedPowerOutside: /OUTSIDE_POWER/u.test(nestedPowerOutside),
        binomialDenominator,
        binomialAfter,
        binomialOutside: /AFTER_BINOM/u.test(binomialOutside),
        enumerateSingleEnter: /\\begin\{enumerate\}/u.test(enumerateApplied),
        insideLemma: insideLemma.match(/\\begin\{lemma\}[\s\S]*?\\end\{lemma\}/u)?.[0],
        afterLemma: afterLemma.match(/\\end\{lemma\}\r?\nOUT/u)?.[0],
        bsalInside: bsalInside.match(/\\begin\{align\*\}[\s\S]*?\\end\{align\*\}/u)?.[0],
        bsalAfter: /\\end\{align\*\}\r?\nAFTER_BSAL/u.test(bsalAfter),
        alignFirstPoint,
        alignSecondLine,
        mathApostrophes: mathApostrophes.match(/Pairing probe:[^\r\n]*/u)?.[0],
        listAfterEmptyExit: /\\item The third case is generated\./u.test(listAfterEmptyExit),
        listSaved: /\\item The third case is generated\./u.test(listFile),
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_COMPLETION_BRIDGE_ONLY === "1") {
      // This is deliberately a cross-category bridge check rather than a
      // per-command smoke test.  TeXLeaf owns the replacement range and
      // context classification, while LaTeX Workshop/VS Code still supply
      // their native macro, environment, package and file candidates.
      await evaluate(
        client,
        contextId,
        `(() => {
          globalThis.__texleafCompletionBridgeDiagnostics = [];
          globalThis.addEventListener("message", (event) => {
            const message = event.data;
            if (message?.type === "completionResult" || message?.type === "document") {
              globalThis.__texleafCompletionBridgeDiagnostics.push({
                type: message.type,
                revision: message.revision,
                requestId: message.requestId,
                from: message.from,
                itemCount: Array.isArray(message.items) ? message.items.length : undefined,
                labels: Array.isArray(message.items)
                  ? message.items.slice(0, 8).map((item) => item.label)
                  : undefined,
              });
            }
          });
          return true;
        })()`,
      );
      const labelProbe = "LABEL_COMPLETION_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        labelProbe,
        0,
        labelProbe.length,
      );
      await client.request("Input.insertText", { text: String.raw`\lab` });
      const labelCommand = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) => value.present && value.text.includes(String.raw`\label`),
        "label command completion through the shared bridge",
      );
      await dispatchKey(client, "Enter", "Enter", 13);
      const labelApplied = await waitFor(
        client,
        contextId,
        exactLineExpression(String.raw`\label{}`),
        (value) => value.text.trim() === String.raw`\label{}`,
        "label command accepted by the first Enter",
      );
      const labelPrefixes = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("eq:") &&
          value.text.includes("sec:") &&
          value.text.includes("thm:"),
        "project-aware label namespace completion",
      );
      assert.doesNotMatch(
        labelPrefixes.text,
        /\\(?:begin|sum|cite)|FNO\s+normal font/u,
        "label definitions must not be polluted by unrelated macro candidates",
      );
      await dispatchKey(client, "Escape", "Escape", 27);

      const macroProbe = "REF_COMPLETION_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        macroProbe,
        0,
        macroProbe.length,
      );
      await client.request("Input.insertText", { text: String.raw`\usepa` });
      let workshopMacro;
      try {
        workshopMacro = await waitFor(
          client,
          contextId,
          completionPopupExpression(),
          (value) => value.present && value.text.includes(String.raw`\usepackage`),
          "LaTeX Workshop macro completion through the shared bridge",
        );
      } catch (error) {
        const diagnostics = await evaluate(
          client,
          contextId,
          `({
            messages: globalThis.__texleafCompletionBridgeDiagnostics.slice(-24),
            activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
            completion: ${completionPopupExpression()},
          })`,
        );
        throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
      }
      await dispatchKey(client, "Escape", "Escape", 27);

      const packageLine = String.raw`\usepa`;
      await selectLineSubstring(
        client,
        contextId,
        packageLine,
        0,
        packageLine.length,
      );
      await client.request("Input.insertText", { text: String.raw`\usepackage{ams` });
      const packageCompletion = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("amsmath") &&
          value.text.includes("amssymb"),
        "LaTeX Workshop package completion through the shared bridge",
      );
      await dispatchKey(client, "Escape", "Escape", 27);

      const fileProbe = "CITE_COMMAND_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        fileProbe,
        0,
        fileProbe.length,
      );
      await client.request("Input.insertText", {
        text: String.raw`\includegraphics{pre`,
      });
      const fileCompletion = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) => value.present && value.text.includes("preview.png"),
        "LaTeX Workshop file completion through the shared bridge",
      );
      await dispatchKey(client, "Escape", "Escape", 27);

      const environmentProbe = "BEQ";
      await selectLineSubstring(
        client,
        contextId,
        environmentProbe,
        0,
        environmentProbe.length,
      );
      await client.request("Input.insertText", { text: String.raw`\begin{pro` });
      const environmentCompletion = await waitFor(
        client,
        contextId,
        completionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("proof") &&
          value.text.includes("proposition"),
        "environment completion through the shared bridge",
      );

      process.stdout.write(`${JSON.stringify({
        labelCommand: labelCommand.text.trim(),
        labelApplied: labelApplied.text.trim(),
        labelPrefixes: labelPrefixes.text.trim(),
        workshopMacro: workshopMacro.text.trim(),
        packageCompletion: packageCompletion.text.trim(),
        fileCompletion: fileCompletion.text.trim(),
        environmentCompletion: environmentCompletion.text.trim(),
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_ZOTERO_ONLY === "1") {
      const bibliographyFile = process.env.TEXLEAF_CDP_TEST_BIB_FILE;
      if (bibliographyFile === undefined || bibliographyFile.length === 0) {
        throw new Error("TEXLEAF_CDP_TEST_BIB_FILE is required for Zotero checks.");
      }
      await evaluate(
        client,
        contextId,
        `(() => {
          globalThis.__texleafCompletionDiagnostics = [];
          globalThis.addEventListener("message", (event) => {
            const message = event.data;
            if (message?.type === "completionResult" || message?.type === "document") {
              globalThis.__texleafCompletionDiagnostics.push({
                type: message.type,
                revision: message.revision,
                projectContextKey: message.projectContextKey,
                requestId: message.requestId,
                from: message.from,
                itemCount: Array.isArray(message.items) ? message.items.length : undefined,
                labels: Array.isArray(message.items)
                  ? message.items.slice(0, 3).map((item) => item.label)
                  : undefined,
                firstItem: Array.isArray(message.items) && message.items.length > 0
                  ? {
                      label: message.items[0].label,
                      detail: message.items[0].detail,
                      template: message.items[0].template,
                      insertedText: message.items[0].insertedText,
                      expectedText: message.items[0].expectedText,
                    }
                  : undefined,
              });
            }
          });
          return true;
        })()`,
      );
      const referenceProbe = "REF_COMPLETION_PROBE";
      await selectLineSubstring(
        client,
        contextId,
        referenceProbe,
        0,
        referenceProbe.length,
      );
      for (const character of ["\\", "e", "q", "r", "e"]) {
        await client.request("Input.insertText", { text: character });
        await delay(35);
      }
      const commandCompletion = await waitFor(
        client,
        contextId,
        citationCompletionPopupExpression(),
        (value) => value.present && value.text.includes(String.raw`\eqref`),
        "automatic eqref command completion after typing \\eqre",
      );
      const selectedEqrefBeforeAccept = await evaluate(
        client,
        contextId,
        selectedCompletionExpression(),
      );
      await dispatchKey(client, "Enter", "Enter", 13);
      let eqrefLine;
      try {
        eqrefLine = await waitFor(
          client,
          contextId,
          exactLineExpression(String.raw`\eqref{}`),
          (value) => value.text.trim() === String.raw`\eqref{}`,
          "accepted eqref command completion",
        );
      } catch (error) {
        const diagnostics = await evaluate(
          client,
          contextId,
          `({
            messages: globalThis.__texleafCompletionDiagnostics,
            activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
            completion: ${citationCompletionPopupExpression()},
            codeMirror: ${codeMirrorSyntaxDiagnosticsExpression()},
            selectedEqrefBeforeAccept: ${JSON.stringify(selectedEqrefBeforeAccept)},
          })`,
        );
        throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
      }
      const labelCompletion = await waitFor(
        client,
        contextId,
        citationCompletionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("eq:flag") &&
          value.text.includes("eq:row-r"),
        "automatic document-label completion inside empty eqref braces",
      );
      assert.doesNotMatch(
        labelCompletion.text,
        /\\(?:nocite|begin|sum)|FNO\s+normal font/u,
        "eqref completion must contain only real document labels",
      );
      await dispatchKey(client, "Escape", "Escape", 27);
      const probe = "CITE_COMMAND_PROBE";
      await selectLineSubstring(client, contextId, probe, 0, probe.length);
      await client.request("Input.insertText", { text: String.raw`\cite{}` });
      await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
      let emptyCompletion;
      try {
        emptyCompletion = await waitFor(
          client,
          contextId,
          citationCompletionPopupExpression(),
          (value) =>
            value.present &&
            value.text.includes("BKP-affine coordinates") &&
            value.text.includes("reference.bib"),
          "automatic collected bibliography completion inside empty citation braces",
        );
      } catch (error) {
        const diagnostics = await evaluate(
          client,
          contextId,
          `({
            messages: globalThis.__texleafCompletionDiagnostics,
            activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
            completion: ${citationCompletionPopupExpression()},
          })`,
        );
        throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
      }
      assert.doesNotMatch(
        emptyCompletion.text,
        /Zotero/u,
        "an empty citation segment must not list uncollected Zotero records",
      );
      await client.request("Input.insertText", { text: "Visual Zotero" });
      await dispatchModifiedKey(client, " ", "Space", 32, 2);
      const completion = await waitFor(
        client,
        contextId,
        citationCompletionPopupExpression(),
        (value) =>
          value.present &&
          value.text.includes("Visual Zotero Bridge Fixture") &&
          value.info.includes("VisualAuthor") &&
          value.info.includes("2027") &&
          value.info.includes("VisualZotero2027") &&
          value.infoOnRight,
        "first-request Zotero completion in the visual editor",
      );
      assert.match(completion.text, /Zotero/u);
      assert.doesNotMatch(
        completion.info,
        /&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/iu,
      );
      await delay(100);
      await dispatchKey(client, "Enter", "Enter", 13);
      const applied = await waitFor(
        client,
        contextId,
        exactLineExpression(String.raw`\cite{VisualZotero2027}`),
        (value) => value.text.trim() === String.raw`\cite{VisualZotero2027}`,
        "accepted Zotero citation in the visual editor",
      );
      const bibliography = await waitForFileText(
        bibliographyFile,
        (value) =>
          value.includes("@article{VisualZotero2027,") &&
          value.includes("Visual Zotero Bridge Fixture"),
        "Zotero export appended to the project bibliography",
      );
      process.stdout.write(`${JSON.stringify({
        commandCompletion: commandCompletion.text.trim(),
        eqrefLine: eqrefLine.text.trim(),
        labelCompletion: labelCompletion.text.trim(),
        emptyCompletion: emptyCompletion.text.trim(),
        completion: completion.text.trim(),
        info: completion.info.trim(),
        applied: applied.text.trim(),
        imported: bibliography.includes("@article{VisualZotero2027,"),
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_ENVIRONMENT_BOUNDARY_ONLY === "1") {
      const testFile = process.env.TEXLEAF_CDP_TEST_TEX_FILE;
      if (testFile === undefined || testFile.length === 0) {
        throw new Error(
          "TEXLEAF_CDP_TEST_TEX_FILE is required for environment-boundary checks.",
        );
      }
      const sourceBefore = fs.readFileSync(testFile, "utf8");
      const alignStarBeginLine = sourceLineNumberForNeedle(
        sourceBefore,
        String.raw`\begin{align*}`,
      );
      const lemmaBeginLine = sourceLineNumberForNeedle(
        sourceBefore,
        String.raw`\begin{lemma}\label{lem:cubic-absorption-K}`,
      );
      const paragraphAfterProofLine = sourceLineNumberForNeedle(
        sourceBefore,
        "To continue estimating, we use the following proposition.",
      );
      const collapsedTheoremBegin = await locate(
        client,
        contextId,
        collapsedEnvironmentBeginBoundaryPointExpression("Theorem 1.2"),
        "collapsed theorem begin logical line",
      );
      await dispatchClick(client, collapsedTheoremBegin.point);
      const revealedByPointer = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("theorem"),
        (value) => value.beginVisible && value.endVisible && value.activeBegin,
        "hidden theorem boundary revealed by a direct mouse click",
      );
      await clickLine(client, contextId, "For every");
      await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("theorem"),
        (value) => !value.beginVisible && !value.endVisible,
        "theorem source collapsed after leaving the pointer-revealed boundary",
      );
      const collapsedAlignStarBegin = await locate(
        client,
        contextId,
        collapsedLogicalLinePointExpression(alignStarBeginLine),
        "collapsed align* begin logical line",
      );
      await dispatchClick(client, collapsedAlignStarBegin.point);
      const revealedAlignStarByPointer = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("align*"),
        (value) => value.beginVisible && value.endVisible && value.activeBegin,
        "hidden align* boundary revealed by a direct mouse click",
      );
      await clickLine(client, contextId, "Compare the two displayed identities and apply induction:");
      await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("align*"),
        (value) => !value.beginVisible && !value.endVisible,
        "align* source collapsed after leaving the pointer-revealed boundary",
      );
      const collapsedLemmaBegin = await locate(
        client,
        contextId,
        collapsedLogicalLinePointExpression(lemmaBeginLine),
        "collapsed lemma begin logical line",
      );
      await dispatchClick(client, collapsedLemmaBegin.point);
      const revealedLemmaByPointer = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("lemma"),
        (value) => value.beginVisible && value.endVisible && value.activeBegin,
        "hidden lemma boundary revealed by a direct mouse click",
      );
      await clickLine(client, contextId, "The nested list keeps the surrounding Lemma border continuous.");
      await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("lemma"),
        (value) => !value.beginVisible && !value.endVisible,
        "lemma source collapsed after leaving the pointer-revealed boundary",
      );
      const paragraph = await locate(
        client,
        contextId,
        exactLineExpression("To continue estimating, we use the following proposition."),
        "paragraph immediately after a collapsed proof",
      );
      await dispatchClick(client, paragraph.point);
      await dispatchKey(client, "Home", "Home", 36);
      const retainedAfterEnvironment = await waitFor(
        client,
        contextId,
        activeLogicalLineStateExpression(),
        (value) =>
          value.activeGutter === String(paragraphAfterProofLine) &&
          value.activeText === "To continue estimating, we use the following proposition." &&
          !value.proofBeginVisible,
        "line start after an environment retained outside the preceding environment",
      );
      await dispatchKey(client, "Backspace", "Backspace", 8);
      await dispatchKey(client, "Backspace", "Backspace", 8);
      const revealedByBackspace = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("proof"),
        (value) => value.beginVisible && value.endVisible && value.activeEnd,
        "hidden proof boundary revealed without deletion",
      );
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const sourceAfter = await waitForFileText(
        testFile,
        (value) => value.includes(String.raw`\end{proof}`),
        "protected proof end after save",
      );
      assert.match(
        sourceAfter,
        /\\end\{proof\}\s*To continue estimating, we use the following proposition\./u,
      );
      assert.equal(
        (sourceAfter.match(/\\end\{proof\}/gu) ?? []).length,
        (sourceBefore.match(/\\end\{proof\}/gu) ?? []).length,
      );

      const beginLine = await locate(
        client,
        contextId,
        exactLineExpression(
          String.raw`\begin{proof}[Proof of Theorem \ref{def:stable}]`,
        ),
        "revealed proof begin boundary",
      );
      await dispatchClick(client, beginLine.point);
      const retainedOnBeginLine = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("proof"),
        (value) => value.beginVisible && value.endVisible && value.activeBegin,
        "paired proof source retained on the begin line",
      );
      await clickLine(
        client,
        contextId,
        "Compare the two displayed identities and apply induction:",
      );
      const collapsedAfterLeavingBoundary = await waitFor(
        client,
        contextId,
        pairedEnvironmentBoundaryStateExpression("proof"),
        (value) => !value.beginVisible && !value.endVisible && value.previewVisible,
        "proof source collapsed only after leaving its boundary lines",
      );

      // Exercise the state transition that originally corrupted hidden source:
      // reveal the paired commands, leave their lines so the DOM becomes atomic
      // again, then click the visual end widget's otherwise-empty line and type.
      // The text must be inserted next to the boundary, never between the
      // backslash and `end{proof}`.
      const collapsedEnd = await locate(
        client,
        contextId,
        proofEndBoundaryPointExpression(),
        "collapsed proof end boundary insertion point",
      );
      await dispatchClick(client, collapsedEnd.point);
      await client.request("Input.insertText", { text: "SAFE_BOUNDARY" });
      await dispatchModifiedKey(client, "s", "KeyS", 83, 2);
      const sourceAfterBoundaryInput = await waitForFileText(
        testFile,
        (value) => value.includes("SAFE_BOUNDARY") && value.includes(String.raw`\end{proof}`),
        "text adjacent to protected proof end after save",
      );
      assert.doesNotMatch(
        sourceAfterBoundaryInput,
        /\\SAFE_BOUNDARYend\{proof\}/u,
        "typing at a collapsed proof end must not enter the hidden command",
      );
      assert.equal(
        (sourceAfterBoundaryInput.match(/\\end\{proof\}/gu) ?? []).length,
        (sourceBefore.match(/\\end\{proof\}/gu) ?? []).length,
      );
      process.stdout.write(`${JSON.stringify({
        revealedByPointer,
        revealedAlignStarByPointer,
        revealedLemmaByPointer,
        retainedAfterEnvironment,
        revealedByBackspace,
        retainedOnBeginLine,
        collapsedAfterLeavingBoundary,
        hiddenEndInputPreserved: !/\\SAFE_BOUNDARYend\{proof\}/u.test(
          sourceAfterBoundaryInput,
        ),
        proofBoundaryPreserved:
          (sourceAfterBoundaryInput.match(/\\end\{proof\}/gu) ?? []).length ===
          (sourceBefore.match(/\\end\{proof\}/gu) ?? []).length,
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_THEOREM_BORDER_ONLY === "1") {
      const label = process.env.TEXLEAF_CDP_THEOREM_BORDER_LABEL ?? "Lemma";
      const borderNeedle = process.env.TEXLEAF_CDP_THEOREM_BORDER_NEEDLE ?? label;
      await locate(
        client,
        contextId,
        lineExpression(borderNeedle),
        `${label} theorem border fixture`,
      );
      await delay(120);
      const border = await waitFor(
        client,
        contextId,
        theoremContinuousBorderExpression(label),
        (value) => value.present && value.segments.length > 1,
        `continuous ${label} theorem border`,
      );
      assert.equal(
        border.gaps.length,
        0,
        `${label} frame contains vertical gaps: ${JSON.stringify(border)}`,
      );
      for (const segment of border.segments) {
        assert.equal(segment.borderLeftWidth, "3px");
        assert.equal(segment.borderRightWidth, "3px");
        assert.ok(
          Math.abs(segment.left - border.header.left) <= 1 &&
            Math.abs(segment.right - border.header.right) <= 1,
          `${label} frame segment drifted horizontally: ${JSON.stringify(segment)}`,
        );
      }
      assert.ok(
        border.unframedLines.every((line) =>
          line.borderLeftWidth === "3px" && line.borderRightWidth === "3px"
        ),
        `${label} contains an unframed split-line continuation: ${JSON.stringify(border.unframedLines)}`,
      );
      process.stdout.write(`${JSON.stringify(border, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_LAYOUT_WRAPPER_ONLY === "1") {
      await locate(
        client,
        contextId,
        lineExpression("Transparent layout wrappers"),
        "transparent layout wrapper fixture",
      );
      const initial = await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.smallChip && value.subequationsChip && value.formulaCount >= 2,
        "transparent wrapper previews",
      );
      assert.equal(initial.rawSmall, false, JSON.stringify(initial));
      assert.equal(initial.rawSubequationsBegin, false, JSON.stringify(initial));
      assert.equal(initial.rawSubequationsEnd, false, JSON.stringify(initial));
      assert.equal(initial.smallFormulaScaled, false, JSON.stringify(initial));

      const smallChip = await locate(
        client,
        contextId,
        selectorContainingTextExpression(
          ".texleaf-transparent-wrapper-edit-chip",
          "编辑 \\small",
        ),
        "small wrapper edit chip",
      );
      await dispatchClick(client, smallChip.point);
      const smallExposed = await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.rawSmall && value.rawSmallClose,
        "paired small wrapper source",
      );
      assert.equal(smallExposed.subequationsChip, true, JSON.stringify(smallExposed));

      await clickLine(client, contextId, "Transparent layout wrappers");
      await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.smallChip && !value.rawSmall,
        "collapsed small wrapper",
      );

      const subequationsChip = await locate(
        client,
        contextId,
        selectorContainingTextExpression(
          ".texleaf-transparent-wrapper-edit-chip",
          "编辑 subequations",
        ),
        "subequations edit chip",
      );
      await dispatchClick(client, subequationsChip.point);
      const subequationsExposed = await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.rawSubequationsBegin && value.rawSubequationsEnd,
        "paired subequations source",
      );

      await clickLine(client, contextId, "Transparent layout wrappers");
      const restored = await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.smallChip && value.subequationsChip &&
          !value.rawSubequationsBegin && !value.rawSubequationsEnd,
        "restored transparent wrappers",
      );
      const innerFormula = await locate(
        client,
        contextId,
        formulaAfterTransparentWrapperExpression("编辑 \\small"),
        "formula inside transparent wrapper",
      );
      await dispatchClick(client, innerFormula.point);
      const whileEditingFormula = await waitFor(
        client,
        contextId,
        transparentWrapperStateExpression(),
        (value) => value.smallChip && value.subequationsChip,
        "transparent wrappers while editing an inner formula",
      );
      process.stdout.write(`${JSON.stringify({
        initial,
        smallExposed,
        subequationsExposed,
        restored,
        whileEditingFormula,
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_FORMULA_COMMIT_ONLY === "1") {
      const probeNeedle = "Simple parenthesized probe:";
      await clickLine(client, contextId, "Visual text styles:");
      const formula = await locate(
        client,
        contextId,
        inlineFormulaInLineExpression(probeNeedle),
        "formula used for selection-leave commit rendering",
      );
      await dispatchClick(client, formula.point);
      const initial = await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) => value.present && value.svgPresent && value.caretPresent,
        "initial cursor Math Preview before commit",
      );
      const inserted = "z";
      await client.request("Input.insertText", { text: inserted });
      await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) =>
          value.present && value.svgPresent && value.caretPresent &&
          value.renderedCursorOffset === initial.cursorOffset + inserted.length,
        "latest cursor render before leaving the formula",
      );
      const started = Date.now();
      await clickLine(client, contextId, "Visual text styles:");
      const committed = await waitFor(
        client,
        contextId,
        visualCommittedFormulaStateExpression(probeNeedle, inserted),
        (value) => value.present && value.svgPresent && value.sourceIncludesExpected,
        "fresh static formula immediately after selection leave",
      );
      const elapsedMs = Date.now() - started;
      assert.ok(
        elapsedMs < 450,
        `selection-leave static formula waited behind viewport work (${elapsedMs} ms)`,
      );
      assert.equal(committed.tooltipPresent, false, JSON.stringify(committed));
      process.stdout.write(`${JSON.stringify({ elapsedMs, initial, committed }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_RENDER_ERROR_ONLY === "1") {
      const probeNeedle = "Simple parenthesized probe:";
      await clickLine(client, contextId, "Visual text styles:");
      const formula = await locate(
        client,
        contextId,
        inlineFormulaInLineExpression(probeNeedle),
        "formula used for render-error cards",
      );
      await dispatchClick(client, formula.point);
      await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) => value.present && value.svgPresent && value.caretPresent,
        "initial Math Preview before render-error injection",
      );
      const invalidCommand = String.raw`\texleafDefinitelyUnknown`;
      await client.request("Input.insertText", { text: invalidCommand });
      const tooltipError = await waitFor(
        client,
        contextId,
        visualRenderErrorStateExpression(probeNeedle),
        (value) =>
          value.tooltipError && value.tooltipSvgErrorMarker &&
          value.tooltipAria.includes("渲染失败") && value.redTokenPresent,
        "explicit Math Preview error card",
        8_000,
      );
      await clickLine(client, contextId, "Visual text styles:");
      const staticError = await waitFor(
        client,
        contextId,
        visualRenderErrorStateExpression(probeNeedle),
        (value) =>
          value.widgetError && value.widgetSvgErrorMarker &&
          value.widgetAria.includes("渲染失败") && value.redTokenPresent,
        "explicit visual formula error card",
        8_000,
      );
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      const restored = await waitFor(
        client,
        contextId,
        visualRenderErrorStateExpression(probeNeedle),
        (value) => !value.widgetError && value.formulaSource.includes(String.raw`\(g\)`),
        "formula restored after render-error card regression",
      );
      process.stdout.write(`${JSON.stringify({ tooltipError, staticError, restored }, null, 2)}\n`);
      return;
    }
    const complexCursorCoalesce =
      process.env.TEXLEAF_CDP_COMPLEX_CURSOR_COALESCE_ONLY === "1";
    if (
      process.env.TEXLEAF_CDP_CURSOR_COALESCE_ONLY === "1" ||
      complexCursorCoalesce
    ) {
      const customProbeNeedle = process.env.TEXLEAF_CDP_CURSOR_PROBE_NEEDLE;
      const sourceLine = customProbeNeedle ?? (complexCursorCoalesce
        ? String.raw`Complex cursor preview probe: \(\mathcal{F}(x_1,\ldots,x_{12})=\sum_{m=0}^{48}\binom{48}{m}\frac{(-1)^m\Gamma_{m+1}}{(m+1)(m+2)}\exp\!\left(\sum_{k=1}^{16}\frac{t_kz^k}{k}\right)\).`
        : String.raw`Simple parenthesized probe: \(g\).`);
      const probeNeedle = customProbeNeedle ?? (complexCursorCoalesce
        ? "Complex cursor preview probe:"
        : "Simple parenthesized probe:");
      // Make the probe repeatable against the same isolated host by first
      // leaving any formula source mode retained from an earlier run.
      await clickLine(
        client,
        contextId,
        customProbeNeedle ?? "This paragraph contain",
      );
      const formula = await locate(
        client,
        contextId,
        inlineFormulaInLineExpression(probeNeedle),
        "continuous-input Math Preview formula",
      );
      await dispatchClick(client, formula.point);
      const initial = await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) => value.present && value.svgPresent && value.caretPresent,
        "initial continuous-input Math Preview",
      );

      const inserted = complexCursorCoalesce
        ? "abcdefghijklmnopqr"
        : "abcdefghijk";
      const inputStarted = Date.now();
      for (const character of inserted) {
        await client.request("Input.insertText", { text: character });
      }
      const afterInput = await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) =>
          value.present && value.svgPresent && value.caretPresent &&
          value.renderedCursorOffset === initial.cursorOffset + inserted.length,
        "latest Math Preview after continuous input",
      );
      const inputElapsedMs = Date.now() - inputStarted;
      assert.ok(
        inputElapsedMs < 1_800,
        `continuous input accumulated obsolete Math Preview renders (${inputElapsedMs} ms)`,
      );

      const deleteStarted = Date.now();
      for (let index = 0; index < inserted.length; index += 1) {
        await dispatchKey(client, "Backspace", "Backspace", 8);
      }
      const afterDelete = await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) =>
          value.present && value.svgPresent && value.caretPresent &&
          value.renderedCursorOffset === initial.cursorOffset,
        "latest Math Preview after continuous deletion",
      );
      const deleteElapsedMs = Date.now() - deleteStarted;
      assert.ok(
        deleteElapsedMs < 1_800,
        `continuous deletion accumulated obsolete Math Preview renders (${deleteElapsedMs} ms)`,
      );

      // A real paper often alternates between a short burst and a pause long
      // enough for background document work to start. Exercise every key across
      // that boundary and record the individual preview latency; a fast total
      // alone can hide one random multi-second frame.
      const paced = "mnopqr";
      const pacedInputLatencies = [];
      let expectedOffset = initial.cursorOffset;
      for (const character of paced) {
        const started = Date.now();
        await client.request("Input.insertText", { text: character });
        expectedOffset += 1;
        await waitFor(
          client,
          contextId,
          visualMathPreviewStateExpression(),
          (value) =>
            value.present && value.svgPresent && value.caretPresent &&
            value.renderedCursorOffset === expectedOffset,
          `paced Math Preview input ${character}`,
        );
        pacedInputLatencies.push(Date.now() - started);
        await delay(360);
      }
      const pacedDeleteLatencies = [];
      for (let index = 0; index < paced.length; index += 1) {
        const started = Date.now();
        await dispatchKey(client, "Backspace", "Backspace", 8);
        expectedOffset -= 1;
        await waitFor(
          client,
          contextId,
          visualMathPreviewStateExpression(),
          (value) =>
            value.present && value.svgPresent && value.caretPresent &&
            value.renderedCursorOffset === expectedOffset,
          `paced Math Preview deletion ${index + 1}`,
        );
        pacedDeleteLatencies.push(Date.now() - started);
        await delay(360);
      }
      const worstPacedLatencyMs = Math.max(
        ...pacedInputLatencies,
        ...pacedDeleteLatencies,
      );
      assert.ok(
        worstPacedLatencyMs < 450,
        `a paced Math Preview frame stalled behind background work (${worstPacedLatencyMs} ms)`,
      );
      await delay(500);
      const stable = await evaluate(client, contextId, visualMathPreviewStateExpression());
      const restoredLine = await evaluate(client, contextId, lineExpression(sourceLine));
      const headingSpacing = await evaluate(
        client,
        contextId,
        `(() => [...document.querySelectorAll(".texleaf-heading-line")].map((line) => {
          const style = getComputedStyle(line);
          return {
            className: line.className,
            paddingTop: Number.parseFloat(style.paddingTop),
            paddingBottom: Number.parseFloat(style.paddingBottom),
          };
        }))()`,
      );
      assert.equal(stable.cursorOffset, initial.cursorOffset);
      assert.ok(restoredLine.text.includes(sourceLine));
      assert.ok(headingSpacing.length > 0, "visual heading spacing fixture is missing");
      assert.ok(
        headingSpacing.every((value) => value.paddingTop >= 10 && value.paddingBottom >= 10),
        `visual headings do not keep space on both sides: ${JSON.stringify(headingSpacing)}`,
      );
      process.stdout.write(`${JSON.stringify({
        inputElapsedMs,
        deleteElapsedMs,
        pacedInputLatencies,
        pacedDeleteLatencies,
        worstPacedLatencyMs,
        initialCursorOffset: initial.cursorOffset,
        inputCursorOffset: afterInput.cursorOffset,
        deletedCursorOffset: afterDelete.cursorOffset,
        stableCursorOffset: stable.cursorOffset,
        headingSpacing,
      }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_SOFT_WRAP_ONLY === "1") {
      const softWrapNeedle = process.env.TEXLEAF_CDP_SOFT_WRAP_TARGET ??
        "Soft-wrapped Math Preview probe:";
      const softWrapFormulaIndex = Number.parseInt(
        process.env.TEXLEAF_CDP_SOFT_WRAP_FORMULA_INDEX ?? "0",
        10,
      );
      const softWrapResetNeedle = process.env.TEXLEAF_CDP_SOFT_WRAP_RESET;
      if (softWrapResetNeedle !== undefined) {
        await clickLine(client, contextId, softWrapResetNeedle);
      }
      const wrappedFormula = await locate(
        client,
        contextId,
        inlineFormulaInLineExpression(softWrapNeedle, softWrapFormulaIndex),
        "formula on a soft-wrapped logical source line",
      );
      const editorLineHeight = await evaluate(
        client,
        contextId,
        `Number.parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).lineHeight)`,
      );
      assert.ok(
        wrappedFormula.lineRect.height >= editorLineHeight * 2,
        `soft-wrap fixture did not wrap: ${JSON.stringify(wrappedFormula)}`,
      );
      assert.ok(
        wrappedFormula.rect.top >= wrappedFormula.lineRect.top + editorLineHeight,
        `formula did not land below the first visual row: ${JSON.stringify(wrappedFormula)}`,
      );
      await dispatchClick(client, wrappedFormula.point);
      const wrappedPreview = await waitFor(
        client,
        contextId,
        visualMathPreviewStateExpression(),
        (value) => value.present && value.svgPresent && value.caretPresent &&
          value.caretVisible &&
          value.formulaFrom === wrappedFormula.from &&
          Number.isFinite(value.sourceCaretTop) &&
          Number.isFinite(value.editorCaretTop),
        "soft-wrapped-row Math Preview",
      );
      assert.ok(
        Math.abs(wrappedPreview.sourceCaretTop - wrappedPreview.editorCaretTop) <= 3,
        `preview anchor missed the active visual row: ${JSON.stringify(wrappedPreview)}`,
      );
      assert.ok(
        wrappedPreview.sourceCaretTop >= wrappedFormula.lineRect.top + editorLineHeight,
        `preview anchor fell back to the logical line's first row: ${JSON.stringify(wrappedPreview)}`,
      );
      assert.ok(
        Math.abs(wrappedPreview.tooltipLeft - wrappedFormula.rect.left) <= 4,
        `soft-wrapped preview missed the visible formula row horizontally: ${JSON.stringify(wrappedPreview)}`,
      );
      assert.ok(
        Math.abs(wrappedPreview.caretGap - wrappedPreview.configuredGap) <= 3,
        `soft-wrapped preview did not preserve its cursor gap: ${JSON.stringify(wrappedPreview)}`,
      );
      process.stdout.write(`${JSON.stringify({ wrappedFormula, wrappedPreview }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_RAW_MATH_SETTLE_ONLY === "1") {
      const targetText = process.env.TEXLEAF_CDP_RAW_MATH_TARGET ?? "本文第一章是引言";
      const settle = await evaluate(
        client,
        contextId,
        `(async () => {
          const scroller = document.querySelector(".cm-scroller");
          if (!(scroller instanceof HTMLElement)) return { error: "missing scroller" };
          const targetText = ${JSON.stringify(targetText)};
          const findTarget = () => [...document.querySelectorAll(".cm-line")].find(
            (line) => (line.textContent ?? "").includes(targetText),
          );
          let target = findTarget();
          const step = Math.max(300, Math.floor(scroller.clientHeight * 0.65));
          for (let top = 0; target === undefined && top <= scroller.scrollHeight; top += step) {
            scroller.scrollTop = top;
            scroller.dispatchEvent(new Event("scroll"));
            await new Promise((resolve) => setTimeout(resolve, 50));
            target = findTarget();
          }
          if (!(target instanceof HTMLElement)) return { error: "target line not found" };
          target.scrollIntoView({ block: "center", inline: "nearest" });
          scroller.dispatchEvent(new Event("scroll"));
          const samples = [];
          const capture = (afterMs) => {
            const current = findTarget();
            samples.push({
              afterMs,
              text: current?.textContent ?? "",
              inlineWidgets: current?.querySelectorAll(".texleaf-formula-widget-inline").length ?? -1,
              status: document.querySelector("#status")?.textContent ?? "",
            });
          };
          for (const wait of [100, 400]) {
            await new Promise((resolve) => setTimeout(resolve, wait - (samples.at(-1)?.afterMs ?? 0)));
            capture(wait);
          }
          target = findTarget();
          if (target instanceof HTMLElement) {
            const targetRect = target.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            scroller.scrollTop += Math.max(0, targetRect.bottom - scrollerRect.bottom + 48);
            scroller.dispatchEvent(new Event("scroll"));
          }
          for (const wait of [120, 500, 1_500, 3_000]) {
            await new Promise((resolve) => setTimeout(resolve, wait - (samples.at(-1)?.phaseMs ?? 0)));
            const current = findTarget();
            samples.push({
              afterMs: 400 + wait,
              phaseMs: wait,
              text: current?.textContent ?? "",
              inlineWidgets: current?.querySelectorAll(".texleaf-formula-widget-inline").length ?? -1,
              status: document.querySelector("#status")?.textContent ?? "",
            });
          }
          return { samples, scrollTop: scroller.scrollTop };
        })()`,
      );
      process.stdout.write(`${JSON.stringify(settle, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_RAW_MATH_AUDIT_ONLY === "1") {
      const audit = await evaluate(
        client,
        contextId,
        `(async () => {
          const scroller = document.querySelector(".cm-scroller");
          if (!(scroller instanceof HTMLElement)) return { error: "missing scroller" };
          const raw = new Map();
          const formulas = new Map();
          const lineNumberAt = (top) => {
            let closest;
            let distance = Number.POSITIVE_INFINITY;
            for (const gutter of document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")) {
              const rect = gutter.getBoundingClientRect();
              const current = Math.abs(rect.top - top);
              if (current < distance) {
                distance = current;
                closest = gutter.textContent?.trim() ?? "";
              }
            }
            return closest ?? "";
          };
          const capture = () => {
            for (const widget of document.querySelectorAll(".texleaf-formula-widget")) {
              const from = widget.getAttribute("data-formula-from") ?? "";
              formulas.set(from, {
                from,
                to: widget.getAttribute("data-formula-to") ?? "",
                display: widget.classList.contains("texleaf-formula-widget-block"),
              });
            }
            for (const line of document.querySelectorAll(".cm-line")) {
              const text = line.textContent ?? "";
              const slash = String.fromCharCode(92);
              if (
                !text.includes(slash + "(") &&
                !text.includes(slash + "[") &&
                !text.includes("$$")
              ) continue;
              const rect = line.getBoundingClientRect();
              const lineNumber = lineNumberAt(rect.top);
              raw.set(\`${'${lineNumber}'}:${'${text}'}\`, {
                lineNumber,
                text: text.slice(0, 500),
                inlineWidgets: line.querySelectorAll(".texleaf-formula-widget-inline").length,
                blockWidgets: line.querySelectorAll(".texleaf-formula-widget-block").length,
              });
            }
          };
          const original = scroller.scrollTop;
          const step = Math.max(360, Math.floor(scroller.clientHeight * 0.72));
          for (let top = 0; top <= scroller.scrollHeight; top += step) {
            scroller.scrollTop = top;
            scroller.dispatchEvent(new Event("scroll"));
            await new Promise((resolve) => setTimeout(resolve, 180));
            capture();
          }
          scroller.scrollTop = original;
          scroller.dispatchEvent(new Event("scroll"));
          const rawValues = [...raw.values()];
          const formulaValues = [...formulas.values()];
          return {
            rawCount: rawValues.length,
            raw: rawValues.slice(0, 40),
            formulaCount: formulaValues.length,
            formulas: formulaValues.slice(0, 24),
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          };
        })()`,
      );
      process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_REFERENCE_HOVER_ONLY === "1") {
      const label = process.env.TEXLEAF_CDP_REFERENCE_LABEL?.trim();
      if (label === undefined || label.length === 0) {
        throw new Error("TEXLEAF_CDP_REFERENCE_LABEL is required for reference hover checks.");
      }
      const expectedText = process.env.TEXLEAF_CDP_REFERENCE_EXPECTED?.trim();
      const target = await locate(
        client,
        contextId,
        referenceTargetByKeyExpression(label),
        `reference ${label}`,
      );
      await dispatchMouseMove(client, target.point);
      const hover = await waitFor(
        client,
        contextId,
        referenceHoverStateExpression(),
        (value) =>
          value.visible &&
          !value.text.includes("正在从项目中查找引用目标") &&
          !value.text.includes("正在生成对应公式的 Math Preview") &&
          !value.text.includes("未找到可唯一预览的引用目标"),
        `reference hover ${label}`,
      );
      assert.match(hover.text, new RegExp(escapeRegExp(label), "u"));
      if (expectedText !== undefined && expectedText.length > 0) {
        assert.match(hover.text, new RegExp(escapeRegExp(expectedText), "u"));
      }
      process.stdout.write(`${JSON.stringify({ label, target, hover }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_AI_APPLY_UNDO_ONLY === "1") {
      const originalNeedle = "This paragraph contain the inline identity";
      const appliedNeedle = "This paragraph contains the inline identity";
      await clickLine(client, contextId, originalNeedle);
      const marker = await locate(
        client,
        contextId,
        selectorExpression("[data-texleaf-ai-issue]", 0),
        "preloaded AI writing issue",
      );
      await dispatchMouseMove(client, marker.point);
      const card = await waitFor(
        client,
        contextId,
        issueCardExpression(),
        (value) => value.visible && value.kind === "ai" &&
          (value.proposal?.text ?? "").includes("contains"),
        "AI suggestion card",
      );
      const before = await evaluate(
        client,
        contextId,
        aiApplyUndoStateExpression(originalNeedle),
      );
      assert.equal(await evaluate(client, contextId, clickByIdExpression("ai-apply")), true);
      const applied = await waitFor(
        client,
        contextId,
        aiApplyUndoStateExpression(appliedNeedle),
        (value) => value.lineText.includes(appliedNeedle) &&
          value.activeLine.includes(appliedNeedle),
        "locally applied AI suggestion",
      );
      assert.equal(applied.markerCount, 0, JSON.stringify(applied));

      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      const undone = await waitFor(
        client,
        contextId,
        aiApplyUndoStateExpression(originalNeedle),
        (value) => value.lineText.includes(originalNeedle) &&
          !value.lineText.includes(appliedNeedle) &&
          value.activeLine.includes(originalNeedle),
        "AI suggestion undo at its original caret",
      );
      assert.equal(undone.lineVisible, true, JSON.stringify(undone));
      assert.ok(
        Math.abs(undone.scrollTop - before.scrollTop) <= Math.max(64, undone.lineHeight * 2.5),
        `AI undo changed the viewport unexpectedly: ${JSON.stringify({ before, undone })}`,
      );
      assert.ok(
        undone.maxScroll - undone.scrollTop > Math.max(120, undone.clientHeight * 0.2),
        `AI undo jumped to the document end: ${JSON.stringify(undone)}`,
      );
      process.stdout.write(`${JSON.stringify({ card, before, applied, undone }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_ISSUE_CARD_ONLY === "1") {
      await evaluate(
        client,
        contextId,
        `(() => {
          const scroller = document.querySelector(".cm-scroller");
          if (!(scroller instanceof HTMLElement)) return false;
          scroller.scrollTop = 0;
          scroller.dispatchEvent(new Event("scroll"));
          return true;
        })()`,
      );
      await delay(80);
      await evaluate(
        client,
        contextId,
        `(() => {
          const marker = document.querySelector("[data-texleaf-diagnostic]");
          if (!(marker instanceof HTMLElement)) return false;
          marker.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          return true;
        })()`,
      );
      await delay(50);
      const card = await evaluate(client, contextId, issueCardExpression());
      assert.equal(card.visible, true);
      assert.equal(card.kind, "diagnostic");
      assert.ok(card.itemCount >= 2, "same-line diagnostics should share one card");
      assert.match(card.title.text, /本行有 \d+ 个文档问题/u);
      assert.ok(card.height < 240, "grouped diagnostic card should fit its content");
      assert.ok(card.height > 80, "grouped diagnostic card should show every item");
      process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);
      return;
    }
    const initial = await evaluate(client, contextId, overviewExpression());
    if (process.env.TEXLEAF_CDP_OVERVIEW_ONLY === "1") {
      process.stdout.write(`${JSON.stringify(initial, null, 2)}\n`);
      return;
    }
    assert.match(initial.fontFamily, /Cascadia Code|Consolas|Courier New|monospace/iu);
    assert.doesNotMatch(initial.fontFamily, /Cambria|Times New Roman|Noto Serif/iu);
    assert.equal(initial.fontSize, "16px");
    assert.ok(Number.parseFloat(initial.lineHeight) >= 24);
    assert.equal(initial.bodyBackground, "rgba(0, 0, 0, 0)");
    assert.equal(initial.editorBackground, "rgba(0, 0, 0, 0)");
    assert.notEqual(initial.gutterBackground, "rgba(0, 0, 0, 0)");
    assert.ok(Number.parseInt(initial.gutterZIndex, 10) >= 1);
    assert.equal(initial.overflowX, "auto");
    assert.equal(initial.overflowY, "scroll");
    assert.equal(initial.scrollbarGutter, "auto");
    assert.ok(initial.verticalScrollbarWidth >= 8, JSON.stringify(initial));
    assert.doesNotMatch(initial.scrollbarThumbColor, /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/iu);
    assert.equal(initial.customScrollbarVisible, true, JSON.stringify(initial));
    assert.ok(initial.customScrollbarWidth >= 12, JSON.stringify(initial));
    assert.ok(initial.customScrollbarThumbHeight >= 52, JSON.stringify(initial));
    assert.doesNotMatch(
      initial.customScrollbarThumbColor,
      /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/iu,
      JSON.stringify(initial),
    );
    assert.ok(
      initial.customScrollbarRight >= initial.editorRight + 12 &&
        initial.customScrollbarRight <= initial.editorRight + 21,
      JSON.stringify(initial),
    );
    assert.ok(initial.scrollHeight > initial.clientHeight, JSON.stringify(initial));
    assert.ok(initial.scrollerRight <= initial.editorRight + 1, JSON.stringify(initial));
    const background = await waitFor(
      client,
      contextId,
      visualBackgroundExpression(),
      (value) => value.present && value.imageUrl !== "none" && value.imageUrl.length > 0,
      "visual-editor background bridge",
    );
    assert.equal(background.front, true);
    assert.equal(background.opacity, "0.2");
    assert.equal(background.position, "100% 100%");
    assert.equal(background.size, "contain");
    assert.equal(background.repeat, "no-repeat");

    if (process.env.TEXLEAF_CDP_LOCAL_STRUCTURE_AND_HEADING_ONLY === "1") {
      const sectionReferenceTarget = await locate(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-reference-chip-target", "sec:introduction"),
        "section-reference title hover target",
      );
      await dispatchMouseMove(client, sectionReferenceTarget.point);
      const sectionReferenceHover = await waitFor(
        client,
        contextId,
        referenceHoverStateExpression(),
        (value) =>
          value.visible &&
          value.text.includes("1 Introduction") &&
          value.text.includes("sec:introduction"),
        "section-reference title hover preview",
      );
      assert.equal(sectionReferenceHover.svgCount, 0);

      const localStructures = {};
      for (const [selector, label] of [
        [".texleaf-table-card .texleaf-table-scroll", "table"],
        [".texleaf-image-card .texleaf-image-scroll", "image"],
        [".texleaf-tikzcd-card .texleaf-local-latex-preview", "tikzcd"],
        [".texleaf-tikzpicture-card .texleaf-local-latex-preview", "tikzpicture"],
      ]) {
        await locate(
          client,
          contextId,
          selectorExpression(selector, 0),
          `${label} local horizontal scroll target`,
        );
        const state = await waitFor(
          client,
          contextId,
          localHorizontalScrollStateExpression(selector),
          (value) =>
            value.present &&
            value.localViewport &&
            value.overflowX === "auto" &&
            value.scrollWidth > value.clientWidth &&
            value.scrollLeft > 0,
          `${label} local horizontal scroll viewport`,
        );
        localStructures[label] = state;
      }
      const documentScroller = await evaluate(client, contextId, overviewExpression());
      assert.equal(documentScroller.overflowX, "hidden");
      assert.ok(
        documentScroller.horizontalScrollWidth <= documentScroller.horizontalClientWidth + 1,
        `local structure overflow leaked into the complete visual editor: ${JSON.stringify(documentScroller)}`,
      );
      assert.equal(documentScroller.horizontalScrollLeft, 0);
      process.stdout.write(`${JSON.stringify({
        sectionReferenceHover,
        localStructures,
        documentScroller: {
          overflowX: documentScroller.overflowX,
          scrollWidth: documentScroller.horizontalScrollWidth,
          clientWidth: documentScroller.horizontalClientWidth,
          scrollLeft: documentScroller.horizontalScrollLeft,
        },
      }, null, 2)}\n`);
      return;
    }

    if (process.env.TEXLEAF_CDP_FORMULA_OVERFLOW_ONLY === "1") {
      const longFormula = await locate(
        client,
        contextId,
        formulaByLabelExpression("eq:long-preview"),
        "locally scrollable rendered long formula",
      );
      assert.equal(longFormula.localOverflowX, "auto");
      assert.equal(longFormula.localOverflowY, "hidden");
      assert.ok(
        longFormula.localScrollWidth > longFormula.localClientWidth,
        `the long rendered formula did not overflow its local viewport: ${JSON.stringify(longFormula)}`,
      );
      assert.ok(
        longFormula.editorScrollWidth <= longFormula.editorClientWidth + 1,
        `the long rendered formula widened the complete visual document: ${JSON.stringify(longFormula)}`,
      );
      const moved = await evaluate(
        client,
        contextId,
        `(() => {
          const chip = [...document.querySelectorAll(".texleaf-formula-label-chip")]
            .find((item) => item.textContent?.includes("eq:long-preview"));
          const scroll = chip?.closest(".texleaf-formula-widget")
            ?.querySelector(".texleaf-formula-scroll");
          if (!(scroll instanceof HTMLElement)) return 0;
          scroll.scrollLeft = scroll.scrollWidth;
          return scroll.scrollLeft;
        })()`,
      );
      assert.ok(moved > 0, "the rendered formula's own horizontal scrollbar did not move");
      const ordinaryFormula = await locate(
        client,
        contextId,
        formulaByLabelExpression("eq:flag"),
        "ordinary rendered formula",
      );
      assert.ok(
        ordinaryFormula.localScrollWidth <= ordinaryFormula.localClientWidth + 1,
        `an ordinary formula received unnecessary overflow: ${JSON.stringify(ordinaryFormula)}`,
      );
      process.stdout.write(`${JSON.stringify({ longFormula, moved, ordinaryFormula }, null, 2)}\n`);
      return;
    }

    if (process.env.TEXLEAF_CDP_FORMULA_LABEL_LAYOUT_ONLY === "1") {
      await locate(
        client,
        contextId,
        theoremHeaderExpression("Theorem 1.2"),
        "theorem containing a multi-row labelled align",
      );
      const rows = await waitFor(
        client,
        contextId,
        formulaLabelRowsExpression(["eq:row-r", "eq:row-s"]),
        (value) => value.present && value.entries.length === 2,
        "independent align label column",
      );
      assert.deepEqual(rows.entries.map((entry) => entry.row), [1, 2]);
      assert.ok(rows.entries[1].centerY - rows.entries[0].centerY > 8);
      assert.ok(
        rows.entries.every((entry) => entry.chipLeft >= entry.formulaRight - 1),
        `formula labels covered rendered mathematics: ${JSON.stringify(rows)}`,
      );
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (process.env.TEXLEAF_CDP_STRUCTURE_ONLY === "1") {
      const abstract = await locate(
        client,
        contextId,
        selectorExpression(".texleaf-abstract-begin", 0),
        "abstract visual heading",
      );
      assert.match(abstract.text, /Abstract/u);
      const abstractBody = await locate(
        client,
        contextId,
        selectorContainingTextExpression(
          ".cm-line.texleaf-abstract-line",
          "concise visual abstract",
        ),
        "editable abstract body",
      );
      assert.match(abstractBody.text, /inline mathematics/u);
      const keywordsCard = await locate(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-keywords-card", "visual editing"),
        "keywords metadata preview",
      );
      assert.match(keywordsCard.text, /Keywords/u);
      assert.match(keywordsCard.text, /LaTeX/u);
      const classificationCard = await locate(
        client,
        contextId,
        selectorContainingTextExpression(".texleaf-keywords-card", "68N20"),
        "subject classification preview",
      );
      assert.match(classificationCard.text, /2020 Mathematics Subject Classification/u);
      const abstractLayout = await evaluate(
        client,
        contextId,
        `(() => {
          const embedded = [...document.querySelectorAll('.texleaf-keywords-card-embedded')];
          const visibleLayoutCommands = [...document.querySelectorAll('.cm-line.texleaf-abstract-line')]
            .filter((line) => /\\\\(?:smallskip|medskip|bigskip|noindent|par)\\b/u.test(line.textContent ?? ''));
          const layoutSpacers = [...document.querySelectorAll('.cm-line.texleaf-abstract-layout-line')];
          const adjacentBlanks = [...document.querySelectorAll('.cm-line.texleaf-abstract-adjacent-blank')];
          return {
            embeddedCount: embedded.length,
            embeddedBorderWidths: embedded.map((element) => getComputedStyle(element).borderTopWidth),
            visibleLayoutCommands: visibleLayoutCommands.map((element) => element.textContent ?? ''),
            layoutSpacerHeights: layoutSpacers.map((element) => element.getBoundingClientRect().height),
            adjacentBlankHeights: adjacentBlanks.map((element) => element.getBoundingClientRect().height),
          };
        })()`,
      );
      assert.equal(abstractLayout.embeddedCount, 2, JSON.stringify(abstractLayout));
      assert.deepEqual(abstractLayout.embeddedBorderWidths, ["0px", "0px"]);
      assert.deepEqual(abstractLayout.visibleLayoutCommands, []);
      assert.ok(
        abstractLayout.layoutSpacerHeights.length >= 2 &&
          abstractLayout.layoutSpacerHeights.every((height) => height < 10),
        `abstract layout commands still occupy full editor rows: ${JSON.stringify(abstractLayout)}`,
      );
      assert.ok(
        abstractLayout.adjacentBlankHeights.every((height) => height <= 1),
        `blank rows adjacent to abstract layout commands were not collapsed: ${JSON.stringify(abstractLayout)}`,
      );
      const abstractSourceButton = await locate(
        client,
        contextId,
        selectorExpression(".texleaf-abstract-begin .texleaf-environment-edit-chip", 0),
        "complete abstract source editor",
      );
      await dispatchClick(client, abstractSourceButton.point);
      const abstractSource = await waitFor(
        client,
        contextId,
        pairedAbstractSourceExpression(),
        (value) => value.beginVisible && value.endVisible && value.layoutCommands.length >= 2,
        "paired abstract boundaries and hidden layout source",
      );
      assert.equal(abstractSource.beginVisible, true);
      assert.equal(abstractSource.endVisible, true);
      assert.ok(abstractSource.layoutCommands.every((line) => line === "\\medskip"));
      await clickLine(client, contextId, "A concise visual abstract");
      await locate(
        client,
        contextId,
        selectorExpression(".texleaf-abstract-begin", 0),
        "abstract preview restored after source editing",
      );
      const expectedTables = [
        ["Explicit values of", "tabular", "table"],
        ["repeated-header long table", "longtable", ""],
        ["Standalone tabular", "tabular", ""],
        ["列一", "tabular", ""],
        ["Adaptive tabularx", "tabularx", ""],
      ];
      const tableStates = [];
      for (const [needle, environment, container] of expectedTables) {
        await locate(
          client,
          contextId,
          selectorContainingTextExpression(".texleaf-table-card", needle),
          `${environment} visual preview`,
        );
        const tableState = await evaluate(
          client,
          contextId,
          tableCardStateContainingTextExpression(needle),
        );
        assert.equal(tableState.environment, environment, JSON.stringify(tableState));
        assert.equal(tableState.container, container, JSON.stringify(tableState));
        assert.equal(tableState.editable, true, JSON.stringify(tableState));
        assert.equal(tableState.sourceEditable, true, JSON.stringify(tableState));
        assert.ok(tableState.rows >= 2, JSON.stringify(tableState));
        tableStates.push(tableState);
      }
      const tabularxButton = await locate(
        client,
        contextId,
        structureActionContainingTextExpression(
          ".texleaf-table-card",
          "Adaptive tabularx",
          "可视化编辑表格",
        ),
        "tabularx visual editor button",
      );
      assert.match(tabularxButton.text, /可视化编辑表格/u);
      const openedTabularxEditor = await evaluate(
        client,
        contextId,
        activateStructureActionContainingTextExpression(
          ".texleaf-table-card",
          "Adaptive tabularx",
          "可视化编辑表格",
        ),
      );
      assert.equal(openedTabularxEditor, true);
      const tabularxEditor = await waitFor(
        client,
        contextId,
        tableEditorStateExpression(),
        (value) =>
          value.present &&
          value.environmentValue === "tabularx" &&
          value.alignmentOptions.includes("flex") &&
          value.alignmentValues.includes("flex") &&
          value.width === String.raw`0.82\linewidth`,
        "tabularx environment-aware visual editor",
      );
      const bibliography = await locate(
        client,
        contextId,
        selectorExpression(".texleaf-bibliography-card", 0),
        "compact bibliography preview",
      );
      const bibliographyState = await evaluate(
        client,
        contextId,
        bibliographyStateExpression(),
      );
      assert.match(bibliography.text, /References/u);
      assert.match(bibliography.text, /3 entries/u);
      assert.match(bibliography.text, /reference\.bib/u);
      assert.deepEqual(
        bibliographyState.keys,
        ["wang2025", "lovelace1843", "noether1918"],
        JSON.stringify(bibliographyState),
      );
      assert.equal(bibliographyState.entryCount, 3);
      assert.equal(bibliographyState.openButton, true);
      assert.equal(bibliographyState.editButton, true);
      assert.equal(bibliographyState.settings.style, "plainnat");
      assert.equal(bibliographyState.settings.toc, "References");
      assert.equal(bibliographyState.settings.resource, "reference.bib");
      assert.equal(bibliographyState.actionsWithinViewport, true, JSON.stringify(bibliographyState));
      assert.equal(bibliographyState.cardWithinViewport, true, JSON.stringify(bibliographyState));
      const tableauPreview = await locate(
        client,
        contextId,
        selectorExpression('svg[aria-label="Young tableau preview"]', 0),
        "ytableau local-TeX SVG preview",
      );
      const tikzpicturePreview = await locate(
        client,
        contextId,
        selectorExpression('.texleaf-tikzpicture-card svg[aria-label="tikzpicture 的本地 TeX 精确预览"]', 0),
        "advanced tikzpicture local-TeX SVG preview",
      );
      const tikzcdPreview = await locate(
        client,
        contextId,
        selectorExpression('.texleaf-tikzcd-card svg[aria-label="tikz-cd 交换图的本地 TeX 精确预览"]', 0),
        "tikzcd local-TeX SVG preview",
      );
      assert.ok(tableauPreview.rect.width > 0 && tableauPreview.rect.height > 0);
      assert.ok(tikzpicturePreview.rect.width > 0 && tikzpicturePreview.rect.height > 0);
      assert.ok(tikzcdPreview.rect.width > 0 && tikzcdPreview.rect.height > 0);
      const openedTikzcdEditor = await evaluate(
        client,
        contextId,
        activateStructureActionContainingTextExpression(
          ".texleaf-tikzcd-card",
          "可视化编辑交换图",
          "可视化编辑交换图",
        ),
      );
      assert.equal(openedTikzcdEditor, true);
      const tikzcdEditor = await waitFor(
        client,
        contextId,
        tikzcdEditorStateExpression(),
        (value) => value.present && value.cells === 9 && value.nodes >= 5,
        "direct tikzcd editor retained beside the exact local preview",
      );
      process.stdout.write(`${JSON.stringify({
        abstract: {
          heading: abstract.text,
          body: abstractBody.text,
          keywords: keywordsCard.text,
          classification: classificationCard.text,
        },
        tables: tableStates,
        tabularxEditor,
        bibliography: bibliographyState,
        localLatex: {
          ytableau: tableauPreview.rect,
          tikzpicture: tikzpicturePreview.rect,
          tikzcd: tikzcdPreview.rect,
          directEditor: {
            cells: tikzcdEditor.cells,
            nodes: tikzcdEditor.nodes,
            arrows: tikzcdEditor.arrows,
          },
        },
      }, null, 2)}\n`);
      return;
    }

    if (process.env.TEXLEAF_CDP_MENU_ONLY === "1") {
      const surfaces = await locate(
        client,
        contextId,
        editingToolbarExpression(),
        "compact toolbar and editing menus",
      );
      assert.deepEqual(surfaces.topButtons, [
        "build-menu-button",
        "top-view-pdf",
        "top-open-source",
        "top-open-native-source",
        "top-save-document",
        "edit-undo",
        "edit-redo",
        "section",
        "bold",
        "italic",
        "underline",
        "strike",
        "text-color-button",
        "formula-menu-button",
        "environment-menu-button",
        "image-menu-button",
        "table-menu-button",
        "reference-menu-button",
        "snippet-menu-button",
        "template-menu-button",
        "ai-menu-button",
      ]);
      assert.equal(surfaces.buildInsideContextMenu, false);
      await evaluate(client, contextId, clickByIdExpression("build-menu-button"));
      const buildMenu = await waitFor(
        client,
        contextId,
        buildMenuStateExpression(),
        (value) => value.visible,
        "compile dropdown below the toolbar button",
      );
      assert.equal(buildMenu.expanded, "true");
      assert.equal(buildMenu.itemCount, 5);
      assert.ok(buildMenu.top >= buildMenu.anchorBottom - 1);
      assert.ok(Math.abs(buildMenu.left - Math.max(
        6,
        Math.min(buildMenu.anchorLeft, buildMenu.viewportWidth - buildMenu.width - 6),
      )) <= 2);
      assert.match(buildMenu.text, /pdfLaTeX/u);
      assert.match(buildMenu.text, /XeLaTeX/u);
      assert.match(buildMenu.text, /LuaLaTeX/u);
      assert.match(buildMenu.text, /BibTeX/u);
      assert.match(buildMenu.text, /BibLaTeX/u);
      assert.doesNotMatch(buildMenu.buttonText, /[▼▾]/u);
      await dispatchKey(client, "Escape", "Escape", 27);
      await waitFor(
        client,
        contextId,
        buildMenuStateExpression(),
        (value) => !value.visible && value.expanded === "false",
        "compile dropdown Escape dismissal",
      );
      for (const [buttonId, menuId, labelPattern] of [
        ["formula-menu-button", "formula-menu", /行内公式.*align.*矩阵/su],
        ["environment-menu-button", "environment-menu", /定理环境.*证明环境.*编号列表/su],
        ["image-menu-button", "image-menu", /figure.*tikzcd.*TikZ/su],
        ["table-menu-button", "table-menu", /table.*tabularx.*longtable/su],
        ["reference-menu-button", "reference-menu", /ref.*eqref.*cite/su],
        ["snippet-menu-button", "snippet-menu", /搜索并插入片段.*片段管理/su],
        [
          "template-menu-button",
          "template-menu",
          /中文论文模板.*English article template.*中文 Beamer 模板.*English Beamer template.*TeX 模板管理/su,
        ],
        ["ai-menu-button", "ai-menu", /AI 检查.*AI 改写.*AI 续写.*AI 检查全文/su],
      ]) {
        await evaluate(client, contextId, clickByIdExpression(buttonId));
        const popup = await waitFor(
          client,
          contextId,
          toolbarPopupStateExpression(buttonId, menuId),
          (value) => value.visible,
          `${menuId} dropdown below its toolbar button`,
        );
        assert.equal(popup.expanded, "true");
        assert.ok(popup.itemCount >= 2);
        assert.ok(popup.top >= popup.anchorBottom - 1);
        assert.ok(Math.abs(popup.left - Math.max(
          6,
          Math.min(popup.anchorLeft, popup.viewportWidth - popup.width - 6),
        )) <= 2);
        assert.match(popup.text, labelPattern);
        await dispatchKey(client, "Escape", "Escape", 27);
      }
      await evaluate(client, contextId, openContextMenuExpression());
      const contextMenu = await waitFor(
        client,
        contextId,
        editingToolbarExpression(),
        (value) => !value.contextHidden,
        "Chinese visual-editor context menu",
      );
      assert.equal(contextMenu.buildInsideContextMenu, false);
      assert.match(contextMenu.contextText, /剪切/u);
      assert.match(contextMenu.contextText, /复制/u);
      assert.match(contextMenu.contextText, /粘贴/u);
      assert.match(contextMenu.contextText, /查看 PDF/u);
      assert.match(contextMenu.contextText, /从光标定位到 PDF/u);
      assert.doesNotMatch(contextMenu.contextText, /行内公式|方程环境|定理环境/u);
      assert.doesNotMatch(contextMenu.contextText, /搜索并插入片段|搜索并插入引用|片段管理|模板管理/u);
      assert.match(contextMenu.contextText, /AI 检查/u);
      assert.doesNotMatch(contextMenu.contextText, /pdfLaTeX|XeLaTeX|LuaLaTeX/u);
      process.stdout.write(`${JSON.stringify({ surfaces, buildMenu, contextMenu }, null, 2)}\n`);
      return;
    }

    if (
      process.env.TEXLEAF_CDP_PDF_PROBE_ONLY !== "1" &&
      process.env.TEXLEAF_CDP_PDF_SAVE_FLICKER_ONLY !== "1"
    ) {
      const nativeSyntax = await waitFor(
        client,
        contextId,
        nativeSyntaxExpression(),
        (value) => value.count >= 4 && value.colors.length >= 3,
        "native TextMate syntax-token bridge",
      );
      assert.ok(nativeSyntax.colors.every((color) => /^rgba?\(/u.test(color)));
      assert.equal(nativeSyntax.hasInlineDeclarations, true);
      assert.deepEqual(
        nativeSyntax.nestedColorMismatches,
        [],
        `CodeMirror fallback spans repainted exact TextMate colors: ${JSON.stringify(nativeSyntax.nestedColorMismatches)}`,
      );
      assert.equal(
        nativeSyntax.plainTextColor,
        nativeSyntax.editorForeground,
        "ordinary LaTeX prose must inherit VS Code's resolved editor foreground",
      );
      assert.notEqual(
        nativeSyntax.plainTextColor,
        "rgb(0, 0, 0)",
        "Dark Modern prose must not fall back to vscode-textmate's black default",
      );
      if (process.env.TEXLEAF_CDP_NATIVE_THEME_ONLY === "1") {
        process.stdout.write(
          `Native TextMate theme bridge passed: ${nativeSyntax.count} tokens, ` +
            `${nativeSyntax.colors.length} scoped colors, ordinary prose ` +
            `${nativeSyntax.plainTextColor}.\n`,
        );
        return;
      }
    }
    if (process.env.TEXLEAF_CDP_PDF_PROBE_ONLY === "1") {
      const before = await evaluate(
        client,
        contextId,
        `(() => {
          const button = document.getElementById("view-pdf");
          const status = document.getElementById("status");
          return {
            disabled: button instanceof HTMLButtonElement ? button.disabled : null,
            status: status?.textContent ?? null,
            title: button?.getAttribute("title") ?? null,
          };
        })()`,
      );
      await evaluate(
        client,
        contextId,
        `(() => {
          const button = document.getElementById("view-pdf");
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        })()`,
      );
      const samples = [];
      for (const waitMs of [0, 25, 100, 500, 1_500]) {
        if (waitMs > 0) {
          await delay(waitMs);
        }
        samples.push({
          waitMs,
          value: await evaluate(
            client,
            contextId,
            `(() => {
              const button = document.getElementById("view-pdf");
              const status = document.getElementById("status");
              return {
                disabled: button instanceof HTMLButtonElement ? button.disabled : null,
                status: status?.textContent ?? null,
                level: status?.getAttribute("data-level") ?? null,
              };
            })()`,
          ),
        });
      }
      process.stdout.write(`${JSON.stringify({ before, samples }, null, 2)}\n`);
      return;
    }
    if (process.env.TEXLEAF_CDP_PDF_SAVE_FLICKER_ONLY === "1") {
      const initialMode = await evaluate(
        client,
        contextId,
        installModeContinuityProbeExpression(),
      );
      assert.equal(initialMode.mode, "visual");
      assert.equal(initialMode.buttonPressed, "false");

      await evaluate(
        client,
        contextId,
        `(() => {
          const content = document.querySelector(".cm-content");
          if (!(content instanceof HTMLElement)) return false;
          content.focus();
          return true;
        })()`,
      );
      await client.request("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "s",
        code: "KeyS",
        windowsVirtualKeyCode: 83,
        nativeVirtualKeyCode: 83,
        modifiers: 2,
      });
      await client.request("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "s",
        code: "KeyS",
        windowsVirtualKeyCode: 83,
        nativeVirtualKeyCode: 83,
        modifiers: 2,
      });
      await delay(700);
      const afterSave = await evaluate(
        client,
        contextId,
        modeContinuityProbeExpression("save"),
      );

      await evaluate(client, contextId, clickByIdExpression("view-pdf"));
      await delay(1_500);
      const afterPdf = await evaluate(
        client,
        contextId,
        modeContinuityProbeExpression("viewPdf"),
      );

      await evaluate(client, contextId, clickByIdExpression("synctex"));
      await delay(1_500);
      const afterSyncTeX = await evaluate(
        client,
        contextId,
        modeContinuityProbeExpression("synctex"),
      );

      for (const result of [afterSave, afterPdf, afterSyncTeX]) {
        assert.equal(result.mode, "visual", `${result.action} ended outside visual mode`);
        assert.equal(result.buttonPressed, "false");
        assert.equal(result.editorRemoved, false, `${result.action} removed the editor root`);
        assert.deepEqual(
          result.observedModes,
          ["visual"],
          `${result.action} transiently entered source mode`,
        );
      }
      process.stdout.write(
        `${JSON.stringify({ initialMode, afterSave, afterPdf, afterSyncTeX }, null, 2)}\n`,
      );
      return;
    }
    const editingToolbar = await locate(
      client,
      contextId,
      editingToolbarExpression(),
      "compact toolbar and editing menus",
    );
    assert.deepEqual(editingToolbar.topButtons, [
      "build-menu-button",
      "top-view-pdf",
      "top-open-source",
      "top-open-native-source",
      "top-save-document",
      "edit-undo",
      "edit-redo",
      "section",
      "bold",
      "italic",
      "underline",
      "strike",
      "text-color-button",
      "formula-menu-button",
      "environment-menu-button",
      "image-menu-button",
      "table-menu-button",
      "reference-menu-button",
      "snippet-menu-button",
      "template-menu-button",
      "ai-menu-button",
    ]);
    assert.equal(editingToolbar.addTable, true);
    assert.equal(editingToolbar.longtable, true);
    assert.equal(editingToolbar.tikzcd, true);
    assert.equal(editingToolbar.contextHidden, true);
    assert.equal(editingToolbar.buildMenuHidden, true);
    assert.equal(editingToolbar.buildInsideContextMenu, false);
    assert.match(editingToolbar.contextText, /剪切/u);
    assert.match(editingToolbar.contextText, /复制/u);
    assert.match(editingToolbar.contextText, /粘贴/u);
    assert.doesNotMatch(editingToolbar.contextText, /行内公式|方程环境|定理环境/u);
    assert.doesNotMatch(editingToolbar.contextText, /公式预览/u);
    assert.doesNotMatch(editingToolbar.contextText, /搜索并插入片段|搜索并插入引用|片段管理|模板管理/u);
    assert.match(editingToolbar.contextText, /AI 检查/u);
    assert.match(editingToolbar.buildMenuText, /pdfLaTeX/u);
    assert.match(editingToolbar.buildMenuText, /XeLaTeX/u);
    assert.match(editingToolbar.buildMenuText, /LuaLaTeX/u);
    assert.match(editingToolbar.buildMenuText, /BibTeX/u);
    assert.match(editingToolbar.buildMenuText, /BibLaTeX/u);

    const titleMetadata = await locate(
      client,
      contextId,
      titleMetadataExpression(),
      "title affiliation and email preview",
    );
    assert.deepEqual(titleMetadata.affiliations, [
      "Sun Yat-sen University",
      "Analytical Engine Institute",
    ]);
    assert.deepEqual(titleMetadata.emails, [
      "xuhui@example.edu",
      "ada@example.org",
    ]);

    const headingEdit = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-heading-edit-chip", 0),
      "inline section source editor",
    );
    await dispatchClick(client, headingEdit.point);
    const headingSource = await waitFor(
      client,
      contextId,
      lineExpression(String.raw`\section{Introduction}`),
      (value) => value.text.includes(String.raw`\section{Introduction}`),
      "full section command in visual tab",
    );
    assert.match(headingSource.text, /\\section\{Introduction\}/u);
    await clickLine(client, contextId, "This paragraph contain");
    await locate(
      client,
      contextId,
      selectorExpression(".texleaf-heading-edit-chip", 0),
      "section preview restored after source edit",
    );

    const simpleParenthesizedLine = String.raw`Simple parenthesized probe: \(g\).`;
    const simpleParenthesizedFormula = await locate(
      client,
      contextId,
      inlineFormulaInLineExpression("Simple parenthesized probe:"),
      "simple \\(g\\) visual formula",
    );
    await dispatchClick(client, simpleParenthesizedFormula.point);
    await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.svgPresent &&
        value.formulaFrom === simpleParenthesizedFormula.from,
     "simple \\(g\\) Math Preview",
   );
    const simplePreviewSvg = await evaluate(
      client,
      contextId,
      `document.querySelector(".texleaf-math-preview-tooltip svg")?.outerHTML ?? ""`,
    );
    const fastSource = simpleParenthesizedLine.replace("g", "zg");
    const fastRenderStarted = Date.now();
    await client.request("Input.insertText", { text: "z" });
    const fastPreview = await waitFor(
      client,
      contextId,
      `(() => ({
        svg: document.querySelector(".texleaf-math-preview-tooltip svg")?.outerHTML ?? "",
        line: [...document.querySelectorAll(".cm-line")]
          .find((item) => item.textContent?.includes("Simple parenthesized probe:"))
          ?.textContent ?? "",
      }))()`,
      (value) => value.svg.length > 0 && value.svg !== simplePreviewSvg &&
        value.line.includes(fastSource),
      "locally edited formula fast cursor render",
    );
    const fastRenderElapsedMs = Date.now() - fastRenderStarted;
    assert.ok(
      fastRenderElapsedMs < 1_500,
      `formula cursor preview waited for a full-document rebuild (${fastRenderElapsedMs} ms)`,
    );
    assert.ok(fastPreview.line.includes(fastSource));
    await dispatchKey(client, "Backspace", "Backspace", 8);
    await waitFor(
      client,
      contextId,
      lineExpression(simpleParenthesizedLine),
      (value) => value.text.includes(simpleParenthesizedLine),
      "simple formula restored after fast-render probe",
    );
    await clickLine(client, contextId, "This paragraph contain");

    const tupleSelectionLine = String.raw`Tuple selection probe: \((\Sigma,x_1,\dots,x_n)\).`;
    const tupleFormula = await locate(
      client,
      contextId,
      inlineFormulaInLineExpression("Tuple selection probe:"),
      "tuple visual formula",
    );
    await dispatchClick(client, tupleFormula.point);
    await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.svgPresent &&
        value.formulaFrom === tupleFormula.from,
      "tuple Math Preview before line selection",
    );
    await selectLineSubstring(
      client,
      contextId,
      tupleSelectionLine,
      0,
      tupleSelectionLine.length,
    );
    await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.svgPresent &&
        value.formulaFrom === tupleFormula.from,
     "tuple Math Preview while the surrounding prose selection crosses it",
   );
    await clickLine(client, contextId, "This paragraph contain");

    const wrappedFormula = await locate(
      client,
      contextId,
      inlineFormulaInLineExpression("Soft-wrapped Math Preview probe:"),
      "formula on a soft-wrapped logical source line",
    );
    const editorLineHeight = Number.parseFloat(initial.lineHeight);
    assert.ok(
      wrappedFormula.lineRect.height >= editorLineHeight * 2,
      `soft-wrap fixture did not wrap: ${JSON.stringify(wrappedFormula)}`,
    );
    assert.ok(
      wrappedFormula.rect.top >= wrappedFormula.lineRect.top + editorLineHeight,
      `formula did not land below the first visual row: ${JSON.stringify(wrappedFormula)}`,
    );
    await dispatchClick(client, wrappedFormula.point);
    const wrappedPreview = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.svgPresent &&
        value.formulaFrom === wrappedFormula.from &&
        Number.isFinite(value.sourceCaretTop) &&
        Number.isFinite(value.editorCaretTop),
      "soft-wrapped-row Math Preview",
    );
    assert.ok(
      Math.abs(wrappedPreview.sourceCaretTop - wrappedPreview.editorCaretTop) <= 3,
      `preview anchor missed the active visual row: ${JSON.stringify(wrappedPreview)}`,
    );
    assert.ok(
      wrappedPreview.sourceCaretTop >= wrappedFormula.lineRect.top + editorLineHeight,
      `preview anchor fell back to the logical line's first row: ${JSON.stringify(wrappedPreview)}`,
    );
    await clickLine(client, contextId, "This paragraph contain");

    await locate(client, contextId, exactLineExpression(String.raw`\beg`), "\\beg completion probe");
    const completionProbe = await evaluate(
      client,
      contextId,
      exactLineExpression(String.raw`\beg`),
    );
    await dispatchClick(client, completionProbe.point);
    await dispatchKey(client, "End", "End", 35);
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    const completion = await waitFor(
      client,
      contextId,
      completionPopupExpression(),
      (value) => value.present && value.text.includes("\\begin"),
      "visual \\beg fallback completion",
    );
    assert.match(completion.text, /\\begin/u);
    await dispatchKey(client, "Escape", "Escape", 27);

    // The command itself must complete without relying on a native editor
    // being focused. Once the snippet puts the caret inside braces, citation
    // keys must automatically switch to TeXLeaf's field-aware bibliography
    // search and show metadata in a details panel to the list's right.
    const citeProbe = "CITE_COMMAND_PROBE";
    await selectLineSubstring(
      client,
      contextId,
      citeProbe,
      0,
      citeProbe.length,
    );
    await client.request("Input.insertText", { text: String.raw`\cite` });
    const citeCommandCompletion = await waitFor(
      client,
      contextId,
      completionPopupExpression(),
      (value) => value.present && value.text.includes(String.raw`\cite`),
      "automatic visual citation-command completion",
    );
    assert.match(citeCommandCompletion.text, /\\cite/u);
    const selectedCiteCommand = await waitFor(
      client,
      contextId,
      selectedCompletionExpression(),
      (value) => value.present,
      "selected citation-command completion",
    );
    assert.match(
      selectedCiteCommand.text,
      /TeXLeaf 核心补全/u,
      `the structured TeXLeaf cite snippet must be selected instead of a bare command: ${JSON.stringify(selectedCiteCommand)}`,
    );
    // CodeMirror deliberately ignores acceptance keys for a few milliseconds
    // after opening the list so a human's trailing Enter cannot accidentally
    // accept a just-arrived asynchronous completion. Model an actual key press
    // instead of racing that interaction guard.
    await delay(100);
    await dispatchKey(client, "Enter", "Enter", 13);
    const citationCommandApplication = await waitFor(
      client,
      contextId,
      citationCommandApplicationExpression(),
      (value) => value.applied,
      "citation command snippet with caret inside braces",
    );
    assert.equal(
      citationCommandApplication.applied,
      true,
      `citation snippet application failed: ${JSON.stringify(citationCommandApplication)}`,
    );
    const unfilteredCitations = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) => value.present && value.text.includes("BKP-affine coordinates"),
      "automatic bibliography completion inside citation braces",
    );
    assert.match(unfilteredCitations.text, /BKP-affine coordinates/u);
    assert.doesNotMatch(
      unfilteredCitations.text,
      /\\nocite|FNO\s+normal font/u,
      "citation-key completion must not mix ordinary LaTeX commands or snippets",
    );

    // The visual picker must reuse the native source editor's normalized,
    // field-aware search rather than CodeMirror's label-only fuzzy matching.
    // "no" matches Noether through author/title metadata and the provider's
    // ranking/details must survive the Webview bridge unchanged.
    await client.request("Input.insertText", { text: "no" });
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    const noetherCitation = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) =>
        value.present &&
        value.text.includes("Invariant Variation Problems") &&
        value.info.includes("Noether") &&
        value.info.includes("1918") &&
        value.info.includes("noether1918") &&
        value.infoOnRight,
      "source-parity citation search by normalized metadata",
    );
    assert.doesNotMatch(noetherCitation.text, /\\nocite|FNO\s+normal font/u);
    assert.doesNotMatch(
      noetherCitation.info,
      /&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/iu,
      "citation metadata must display decoded text instead of Markdown entities",
    );
    await dispatchKey(client, "Backspace", "Backspace", 8);
    await dispatchKey(client, "Backspace", "Backspace", 8);
    await waitFor(
      client,
      contextId,
      exactLineExpression(String.raw`\cite{}`),
      (value) => value.text.trim() === String.raw`\cite{}`,
      "citation query cleared before author search",
    );
    await client.request("Input.insertText", { text: "Ada" });
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    const filteredCitation = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) =>
        value.present &&
        value.text.includes("Notes on the Analytical Engine") &&
        value.info.includes("Ada") &&
        value.info.includes("1843") &&
        value.info.includes("lovelace1843") &&
        value.infoOnRight,
      "field-filtered citation and right-side metadata preview",
    );
    assert.equal(filteredCitation.infoOnRight, true);
    await delay(100);
    await dispatchKey(client, "Enter", "Enter", 13);
    await waitFor(
      client,
      contextId,
      exactLineExpression(String.raw`\cite{lovelace1843}`),
      (value) => value.text.trim() === String.raw`\cite{lovelace1843}`,
      "accepted visual bibliography completion",
    );

    const refProbe = "REF_COMPLETION_PROBE";
    await selectLineSubstring(client, contextId, refProbe, 0, refProbe.length);
    await client.request("Input.insertText", { text: String.raw`\ref{}` });
    await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    const emptyReferenceCompletion = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) =>
        value.present &&
        value.text.includes("eq:row-r") &&
        value.text.includes("def:stable"),
      "document-label-only completion inside empty ref braces",
    );
    assert.doesNotMatch(
      emptyReferenceCompletion.text,
      /\\(?:nocite|begin|sum)|FNO\s+normal font/u,
      "ref completion must contain only real document labels",
    );
    await client.request("Input.insertText", { text: "eq:row-r" });
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) => value.present && value.text.includes("eq:row-r"),
      "formula label completion before keyboard navigation",
    );
    const formulaReferenceCompletion = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) =>
        value.present &&
        value.text.includes("eq:row-r") &&
        value.info.includes("公式 eq:row-r") &&
        value.infoSvg &&
        value.infoOnRight,
      "right-side Math Preview for formula label completion",
    );
    assert.equal(formulaReferenceCompletion.infoSvg, true);
    for (let index = 0; index < "eq:row-r".length; index += 1) {
      await dispatchKey(client, "Backspace", "Backspace", 8);
    }
    await client.request("Input.insertText", { text: "def:stable" });
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) => value.present && value.text.includes("def:stable"),
      "theorem label completion before keyboard navigation",
    );
    const theoremReferenceCompletion = await waitFor(
      client,
      contextId,
      citationCompletionPopupExpression(),
      (value) =>
        value.present &&
        value.text.includes("def:stable") &&
        value.info.includes("Definition 1.1") &&
        value.infoTheorem &&
        value.infoOnRight,
      "right-side theorem card for theorem label completion",
    );
    assert.equal(theoremReferenceCompletion.infoTheorem, true);
    await dispatchKey(client, "Escape", "Escape", 27);
    await selectLineSubstring(
      client,
      contextId,
      String.raw`\ref{def:stable}`,
      0,
      String.raw`\ref{def:stable}`.length,
    );
    await client.request("Input.insertText", { text: refProbe });

    // A blank source line immediately before a collapsed visual block is an
    // important caret boundary. Undoing text on that line must leave a visible
    // caret on the restored blank line instead of mapping the caret into the
    // following Definition/formula widget.
    const beqProbe = await locate(
      client,
      contextId,
      exactLineExpression("BEQ"),
      "blank-line undo boundary probe",
    );
    await dispatchClick(client, beqProbe.point);
    await dispatchKey(client, "End", "End", 35);
    await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
    await client.request("Input.insertText", { text: "ddddssss" });
    await waitFor(
      client,
      contextId,
      lineHistoryStateExpression("ddddssss", "ddddssss"),
      (value) => value.text.includes("ddddssss") && value.active,
      "text on blank line before Definition",
    );
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const blankUndo = await waitFor(
      client,
      contextId,
      blankLineBeforeStructureStateExpression("Definition"),
      (value) => value.textRemoved && value.activeBlankLine && value.caretBeforeStructure,
      "blank-line undo caret before Definition",
    );
    assert.equal(blankUndo.activeBlankLine, true);
    assert.equal(blankUndo.caretBeforeStructure, true);

    // Reproduce the real visual-boundary case: type the automatic command one
    // character at a time on the blank line immediately before a collapsed
    // theorem-style block.  The command must expand without Tab, and one undo
    // must restore the complete trigger instead of leaving stale structure or
    // formula decorations above the next Definition.
    for (const character of ["\\", "t", "h", "m"]) {
      await client.request("Input.insertText", { text: character });
      await delay(35);
    }
    const expandedTheoremTrigger = await waitFor(
      client,
      contextId,
      automaticTheoremProbeExpression(),
      (value) => value.expanded && value.bodyCaret && !value.rawTriggerVisible,
      "automatic \\thm expansion before a collapsed Definition",
    );
    assert.equal(expandedTheoremTrigger.rawTriggerVisible, false);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const restoredTheoremTrigger = await waitFor(
      client,
      contextId,
      exactLineExpression(String.raw`\thm`),
      (value) => value.text.trim() === String.raw`\thm`,
      "one-step automatic \\thm undo",
    );
    assert.equal(restoredTheoremTrigger.text.trim(), String.raw`\thm`);
    await selectLineSubstring(client, contextId, String.raw`\thm`, 0, 4);
    await client.request("Input.insertText", { text: "" });
    await waitFor(
      client,
      contextId,
      blankLineBeforeStructureStateExpression("Definition"),
      (value) => value.activeBlankLine && value.caretBeforeStructure,
      "clean blank line after \\thm regression",
    );

    const styleState = await locate(
      client,
      contextId,
      textStyleStateExpression(),
      "visual text styles",
    );
    assert.ok(Number.parseInt(styleState.boldWeight, 10) >= 600);
    assert.equal(styleState.italicStyle, "italic");
    assert.match(styleState.underlineDecoration, /underline/u);
    assert.match(styleState.strikeDecoration, /line-through/u);
    assert.match(styleState.redColor, /rgb\(255,\s*0,\s*0\)/u);

    await selectLineSubstring(
      client,
      contextId,
      "Toolbar probe: first case",
      "Toolbar probe: ".length,
      "first case".length,
    );
    const italicButton = await evaluate(
      client,
      contextId,
      selectorExpression('[data-texleaf-insert="italic"]', 0),
    );
    assert.ok(italicButton !== undefined, "toolbar italic toggle missing");
    await dispatchClick(client, italicButton.point);
    const italicApplied = await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => value.italic,
      "toolbar italic application",
    );
    assert.equal(italicApplied.italic, true);

    // The selected body is still the active selection. Clicking I again must
    // remove the surrounding command instead of nesting another \emph.
    const italicToggleButton = await evaluate(
      client,
      contextId,
      selectorExpression('[data-texleaf-insert="italic"]', 0),
    );
    assert.ok(italicToggleButton !== undefined, "toolbar italic toggle missing after application");
    await dispatchClick(client, italicToggleButton.point);
    await locate(
      client,
      contextId,
      exactLineExpression("Toolbar probe: first case"),
      "toolbar probe after italic toggle off",
    );
    const italicToggledOff = await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => !value.italic && value.text.trim() === "Toolbar probe: first case",
      "toolbar italic toggle off",
    );
    assert.equal(italicToggledOff.text.trim(), "Toolbar probe: first case");

    // Apply once more and undo. The complete command, both braces, and its
    // snippet field must disappear in a single history step.
    const italicReapplyButton = await evaluate(
      client,
      contextId,
      selectorExpression('[data-texleaf-insert="italic"]', 0),
    );
    assert.ok(italicReapplyButton !== undefined, "toolbar italic toggle missing before reapplication");
    await dispatchClick(client, italicReapplyButton.point);
    await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => value.italic,
      "toolbar italic reapplication before undo",
    );
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await locate(
      client,
      contextId,
      exactLineExpression("Toolbar probe: first case"),
      "toolbar probe after italic undo",
    );
    const italicUndo = await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => !value.italic && value.text.trim() === "Toolbar probe: first case",
      "atomic toolbar style undo",
    );
    assert.equal(italicUndo.hasLooseBrace, false, JSON.stringify(italicUndo));

    await selectLineSubstring(
      client,
      contextId,
      "Toolbar probe: first case",
      "Toolbar probe: ".length,
      "first case".length,
    );
    const colorButton = await evaluate(
      client,
      contextId,
      selectorExpression("#text-color-button", 0),
    );
    assert.ok(colorButton !== undefined, "toolbar text color button missing");
    await dispatchClick(client, colorButton.point);
    const colorPanel = await waitFor(
      client,
      contextId,
      textColorPopoverExpression(),
      (value) => value.present && value.applyLabel === "应用颜色" && value.cancelLabel === "取消",
      "explicit text color confirmation panel",
    );
    assert.equal(colorPanel.applyLabel, "应用颜色");
    assert.equal(await evaluate(client, contextId, setTextColorHexExpression("#2F81F7")), true);
    const applyColor = await evaluate(
      client,
      contextId,
      selectorExpression("#text-color-apply", 0),
    );
    assert.ok(applyColor !== undefined, "apply text color button missing");
    await dispatchClick(client, applyColor.point);
    const colorApplied = await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => /rgb\(47,\s*129,\s*247\)/u.test(value.color),
      "toolbar selected-text color application",
    );
    assert.match(colorApplied.color, /rgb\(47,\s*129,\s*247\)/u);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await locate(
      client,
      contextId,
      exactLineExpression("Toolbar probe: first case"),
      "toolbar probe after color undo",
    );
    const colorUndo = await waitFor(
      client,
      contextId,
      toolbarProbeStateExpression(),
      (value) => value.color === "" && value.text.trim() === "Toolbar probe: first case",
      "atomic toolbar color undo",
    );
    assert.equal(colorUndo.hasLooseBrace, false, JSON.stringify(colorUndo));

    const longFormula = await locate(
      client,
      contextId,
      formulaByLabelExpression("eq:long-preview"),
      "deliberately long formula preview",
    );
    assert.equal(longFormula.localOverflowX, "auto");
    assert.equal(longFormula.localOverflowY, "hidden");
    assert.ok(
      longFormula.localScrollWidth > longFormula.localClientWidth,
      `the long rendered formula did not receive its own horizontal viewport: ${JSON.stringify(longFormula)}`,
    );
    assert.ok(
      longFormula.editorScrollWidth <= longFormula.editorClientWidth + 1,
      `the long rendered formula still widened the complete visual document: ${JSON.stringify(longFormula)}`,
    );
    const renderedFormulaScroll = await evaluate(
      client,
      contextId,
      `(() => {
        const chip = [...document.querySelectorAll(".texleaf-formula-label-chip")]
          .find((item) => item.textContent?.includes("eq:long-preview"));
        const scroll = chip?.closest(".texleaf-formula-widget")
          ?.querySelector(".texleaf-formula-scroll");
        if (!(scroll instanceof HTMLElement)) return 0;
        scroll.scrollLeft = scroll.scrollWidth;
        return scroll.scrollLeft;
      })()`,
    );
    assert.ok(renderedFormulaScroll > 0, "rendered long formula could not scroll locally");
    await dispatchClick(client, longFormula.point);
    const longFormulaStart = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.caretPresent && value.scrollWidth > value.clientWidth,
      "scrollable long Math Preview",
    );
    assert.ok(
      longFormulaStart.sourceGap >= 10 && longFormulaStart.sourceGap <= 14,
      `ordinary Math Preview gap changed from its original size: ${JSON.stringify(longFormulaStart)}`,
    );
    assert.equal(longFormulaStart.configuredGap, 12);
    assert.ok(
      longFormulaStart.tooltipTop >= longFormulaStart.editorScrollTop - 2 &&
        longFormulaStart.tooltipBottom <= longFormulaStart.editorScrollBottom + 2,
      `Math Preview escaped into the TeXLeaf toolbars: ${JSON.stringify(longFormulaStart)}`,
    );
    assert.ok(
      Math.abs(longFormulaStart.tooltipLeft - longFormulaStart.activeTextStartLeft) <= 2,
      `ordinary Math Preview did not align with its active source indentation: ${JSON.stringify(longFormulaStart)}`,
    );
    // The widget intentionally opens at the outer \begin line. Move into the
    // actual one-line formula body before asking End to exercise horizontal
    // caret following inside the rendered equation rather than label metadata.
    await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
    await dispatchKey(client, "End", "End", 35);
    let longFormulaEnd = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.caretVisible && value.scrollWidth > value.clientWidth,
      "long Math Preview horizontal overflow",
    );
    assert.equal(longFormulaEnd.overflowX, "auto");
    assert.equal(longFormulaEnd.overflowY, "auto");
    assert.ok(longFormulaEnd.scrollWidth > longFormulaEnd.clientWidth);
    assert.equal(longFormulaEnd.customXVisible, true);
    assert.equal(longFormulaEnd.customYVisible, false);
    assert.ok(
      longFormulaEnd.customXHeight >= 5 && longFormulaEnd.customXHeight <= 7,
      `horizontal overlay scrollbar is not the intended compact size: ${JSON.stringify(longFormulaEnd)}`,
    );
    assert.ok(
      longFormulaEnd.horizontalScrollbar <= 1 && longFormulaEnd.verticalScrollbar <= 1,
      `hidden native scrollbar still consumes formula layout space: ${JSON.stringify(longFormulaEnd)}`,
    );
    const forcedLongScroll = await evaluate(
      client,
      contextId,
      `(() => {
        const scroll = document.querySelector(".texleaf-math-preview-scroll");
        if (!(scroll instanceof HTMLElement)) return 0;
        scroll.scrollLeft = scroll.scrollWidth;
        return scroll.scrollLeft;
      })()`,
    );
    assert.ok(forcedLongScroll > 0, "long Math Preview could not be scrolled horizontally");
    await dispatchKey(client, "ArrowLeft", "ArrowLeft", 35);
    longFormulaEnd = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.caretVisible && value.scrollLeft < forcedLongScroll - 1,
      "long Math Preview returning to its source caret",
    );
    assertBalancedMathPreviewInsets(longFormulaEnd, "horizontal Math Preview");
    assert.notEqual(longFormulaEnd.cursorOffset, longFormulaStart.cursorOffset);
    await clickLine(client, contextId, "Undo probe:");

    const tallFormula = await locate(
      client,
      contextId,
      formulaByLabelExpression("eq:tall-preview"),
      "deliberately tall formula preview",
    );
    assert.equal(tallFormula.svgMaxHeight, "none");
    assert.equal(tallFormula.widgetMaxHeight, "none");
    assert.equal(tallFormula.widgetOverflowX, "hidden");
    assert.equal(tallFormula.widgetOverflowY, "hidden");
    assert.equal(tallFormula.localOverflowX, "auto");
    assert.equal(tallFormula.localOverflowY, "hidden");
    assert.ok(
      tallFormula.localScrollHeight <= tallFormula.localClientHeight + 1,
      `36-line formula unexpectedly has an internal scroll viewport: ${JSON.stringify(tallFormula)}`,
    );
    assert.ok(
      tallFormula.svgHeight > 36 * tallFormula.editorFontSize,
      `36-line formula was unexpectedly scaled down: ${JSON.stringify(tallFormula)}`,
    );
    await dispatchClick(client, tallFormula.point);
    await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.caretPresent && value.scrollHeight > value.clientHeight,
      "vertically scrollable tall Math Preview",
    );
    let reachedTallProbeLine = false;
    for (let visualLine = 0; visualLine < 80; visualLine += 1) {
      await dispatchKey(client, "ArrowDown", "ArrowDown", 25);
      const position = await evaluate(
        client,
        contextId,
        visualMathPreviewStateExpression(),
      );
      if (position.activeLineText.includes("A_{34}")) {
        reachedTallProbeLine = true;
        break;
      }
    }
    assert.equal(
      reachedTallProbeLine,
      true,
      "could not reach the A_{34} source line",
    );
    await dispatchKey(client, "End", "End", 35);
    const tallFormulaEnd = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.caretVisible && value.scrollTop > 0 &&
        value.tooltipTop > -1_000 && value.activeLineText.includes("A_{34}"),
      "tall Math Preview caret auto-scroll",
    );
    assert.ok(tallFormulaEnd.scrollHeight > tallFormulaEnd.clientHeight);
    assert.ok(tallFormulaEnd.scrollTop > 0);
    assert.equal(tallFormulaEnd.customYVisible, true);
    assert.ok(
      tallFormulaEnd.customYWidth >= 5 && tallFormulaEnd.customYWidth <= 7,
      `vertical overlay scrollbar is not the intended compact size: ${JSON.stringify(tallFormulaEnd)}`,
    );
    assert.ok(
      tallFormulaEnd.horizontalScrollbar <= 1 && tallFormulaEnd.verticalScrollbar <= 1,
      `hidden native scrollbar still consumes tall formula layout space: ${JSON.stringify(tallFormulaEnd)}`,
    );
    assertBalancedMathPreviewInsets(tallFormulaEnd, "vertical Math Preview");
    assert.equal(
      tallFormulaEnd.configuredGap,
      50,
      `oversized Math Preview did not use 50px of internal clearance: ${JSON.stringify(tallFormulaEnd)}`,
    );
    assert.ok(
      tallFormulaEnd.tooltipTop >= tallFormulaEnd.editorScrollTop - 2 &&
        tallFormulaEnd.tooltipBottom <= tallFormulaEnd.editorScrollBottom + 2,
      `oversized Math Preview escaped the editor viewport: ${JSON.stringify(tallFormulaEnd)}`,
    );
    assert.ok(
      Math.abs(tallFormulaEnd.tooltipLeft - tallFormulaEnd.anchorLeft) <= 2 &&
        tallFormulaEnd.anchorLeft >= tallFormulaEnd.textViewportLeft - 2,
      `oversized Math Preview did not use its visible, gutter-safe outer anchor: ${JSON.stringify(tallFormulaEnd)}`,
    );

    // Switch straight from the 36-line preview to a two-row cases formula.
    // CodeMirror caches tooltip measurements by create-function identity; this
    // regression catches a stale tall measurement leaving hundreds of pixels
    // of blank space below a perfectly small formula.
    const piecewiseFormula = await locate(
      client,
      contextId,
      formulaAfterLineExpression("The piecewise expression is"),
      "piecewise formula after tall Math Preview",
    );
    await dispatchClick(client, piecewiseFormula.point);
    const piecewisePreview = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.caretPresent && value.tooltipHeight > 0 &&
        value.tooltipHeight < 220,
      "fresh compact cases Math Preview after tall formula",
    );
    assert.ok(
      piecewisePreview.tooltipHeight < tallFormulaEnd.clientHeight * 0.65,
      `small cases preview retained the tall formula height: ${JSON.stringify({
        tall: tallFormulaEnd,
        piecewise: piecewisePreview,
      })}`,
    );
    assert.ok(
      piecewisePreview.scrollHeight <= piecewisePreview.clientHeight + 2,
      `small cases preview unexpectedly inherited vertical scrolling: ${JSON.stringify(piecewisePreview)}`,
    );
    assert.equal(piecewisePreview.customYVisible, false);
    assertBalancedMathPreviewInsets(piecewisePreview, "compact cases Math Preview");
    await clickLine(client, contextId, "Undo probe:");

    const proposition = await locateTheorem(
      client,
      contextId,
      "Proposition",
      "To continue estimating",
      "For any partition",
    );
    assertNoOverlap(proposition, "Proposition");
    const lemma = await locateTheorem(
      client,
      contextId,
      "Lemma",
      "To prove this proposition",
      "For any partitions without zero parts",
    );
    assertNoOverlap(lemma, "Lemma");
    const lemmaListBorder = await waitFor(
      client,
      contextId,
      theoremNestedListBorderExpression("Lemma"),
      (value) => value.present && value.boundaries.length === 2,
      "continuous Lemma border around nested enumerate",
    );
    for (const boundary of lemmaListBorder.boundaries) {
      assert.equal(boundary.borderLeftWidth, "3px");
      assert.equal(boundary.borderRightWidth, "3px");
      assert.ok(
        Math.abs(boundary.left - lemmaListBorder.header.left) <= 1 &&
          Math.abs(boundary.right - lemmaListBorder.header.right) <= 1,
        `nested enumerate border drifted outside Lemma: ${JSON.stringify(lemmaListBorder)}`,
      );
    }

    const alignLabelRows = await waitFor(
      client,
      contextId,
      formulaLabelRowsExpression(["eq:row-r", "eq:row-s"]),
      (value) => value.present && value.entries.length === 2,
      "per-row align labels",
    );
    assert.deepEqual(
      alignLabelRows.entries.map((entry) => entry.row),
      [1, 2],
      `align labels were not assigned to their source rows: ${JSON.stringify(alignLabelRows)}`,
    );
    assert.ok(
      alignLabelRows.entries[1].centerY - alignLabelRows.entries[0].centerY > 8,
      `align labels still overlap on one visual row: ${JSON.stringify(alignLabelRows)}`,
    );
    assert.ok(
      alignLabelRows.entries.every((entry) => entry.chipLeft >= entry.formulaRight - 1),
      `align labels overlap rendered formula content: ${JSON.stringify(alignLabelRows)}`,
    );

    const proofVisual = await waitFor(
      client,
      contextId,
      proofVisualStateExpression(),
      (value) =>
        value.present &&
        value.heading === "Proof of Theorem 1.1." &&
        value.bodyVisible &&
        value.borderWidths.every((width) => width === 0),
      "resolved borderless proof preview",
    );
    assert.doesNotMatch(proofVisual.heading, /def:stable|\\ref/u);

    const proofSourceButton = await locate(
      client,
      contextId,
      theoremEditChipExpression("Proof of Theorem 1.1"),
      "paired proof source editor",
    );
    await dispatchClick(client, proofSourceButton.point);
    await waitFor(
      client,
      contextId,
      pairedEnvironmentSourceExpression("proof"),
      (value) => value.beginVisible && value.endVisible,
      "paired proof begin/end source",
    );
    await clickLine(client, contextId, "Compare the two displayed identities");
    await waitFor(
      client,
      contextId,
      proofVisualStateExpression(),
      (value) => value.present && value.heading === "Proof of Theorem 1.1." && value.bodyVisible,
      "proof preview restored immediately after entering its body",
    );

    const inlineFormula = await locate(
      client,
      contextId,
      inlineFormulaInLineExpression("For any partitions without zero parts"),
      "inline formula inside Lemma",
    );
    await dispatchClick(client, inlineFormula.point);
    const inlinePreview = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.caretPresent &&
        value.formulaFrom === inlineFormula.from,
      "inline formula Math Preview",
    );
    assert.equal(inlinePreview.configuredGap, 6);
    const inlineCaretGap = inlinePreview.placement === "above"
      ? inlinePreview.editorCaretTop - inlinePreview.tooltipBottom
      : inlinePreview.tooltipTop - inlinePreview.editorCaretBottom;
    assert.ok(
      inlineCaretGap >= 6 && inlineCaretGap <= 10,
      `inline Math Preview drifted away from its source line: ${JSON.stringify(inlinePreview)}`,
    );
    assert.ok(
      Math.abs(inlinePreview.tooltipLeft - inlinePreview.anchorLeft) <= 2,
      `inline Math Preview did not align with its visible opening delimiter: ${JSON.stringify(inlinePreview)}`,
    );
    await clickLine(client, contextId, "Undo probe:");
    // CodeMirror virtualizes distant blocks. Bring the theorem body back into
    // the rendered viewport before querying its inline environment editor.
    await clickLine(client, contextId, "For every");

    const theoremSourceButton = await locate(
      client,
      contextId,
      theoremEditChipExpression("Theorem 1.2"),
      "paired theorem source editor",
    );
    await dispatchClick(client, theoremSourceButton.point);
    const pairedTheoremSource = await waitFor(
      client,
      contextId,
      pairedEnvironmentSourceExpression("theorem"),
      (value) => value.beginVisible && value.endVisible,
      "paired theorem begin/end source",
    );
    assert.equal(pairedTheoremSource.beginVisible, true);
    assert.equal(pairedTheoremSource.endVisible, true);
    await clickLine(client, contextId, "To continue estimating");
    await locate(
      client,
      contextId,
      theoremEditChipExpression("Theorem 1.2"),
      "theorem preview restored after leaving paired source",
    );

    await clickLine(client, contextId, "To continue estimating");
    await dispatchKey(client, "End", "End", 35);
    await client.request("Input.insertText", { text: " xls" });
    await waitFor(
      client,
      contextId,
      lineHistoryStateExpression("To continue estimating", "xls"),
      (value) => value.text.includes("xls"),
      "ordinary text before local undo",
    );
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const lineAfterUndo = await waitFor(
      client,
      contextId,
      lineHistoryStateExpression("To continue estimating", "xls"),
      (value) => !value.text.includes("xls") && value.active,
      "local undo with caret retained on the edited line",
    );
    assert.ok(
      lineAfterUndo.caretTop >= lineAfterUndo.lineTop - 2 &&
        lineAfterUndo.caretTop <= lineAfterUndo.lineBottom + 2,
      `Ctrl+Z restored a stale caret: ${JSON.stringify(lineAfterUndo)}`,
    );

    const casesClick = await clickLine(
      client,
      contextId,
      "The piecewise expression is",
    );
    assertCaretNearClick(casesClick, "cases 后正文");

    const formula = await locate(
      client,
      contextId,
      formulaAfterTheoremExpression("Proposition"),
      "Proposition display formula",
    );
    assert.equal(formula.hitOwnsFormula, true);
    assert.equal(formula.marginTop, "0px");
    assert.equal(formula.marginBottom, "0px");
    assert.equal(formula.borderLeftWidth, "3px");
    assert.ok(
      Math.abs(formula.previousGap) <= 2 &&
        Math.abs(formula.nextGap) <= 2,
      `定理边框在公式处不连续：${JSON.stringify(formula)}`,
    );
    await dispatchClick(client, formula.point);
    const openedFormula = await waitFor(
      client,
      contextId,
      openedFormulaExpression(formula.from),
      (value) => !value.widgetVisible && /\\\[|Delta/u.test(value.activeLine),
      "formula source to open from an exact SVG click",
    );
    assert.equal(openedFormula.widgetVisible, false);
    const previewBeforeTyping = await waitFor(
      client,
      contextId,
      visualMathPreviewStateExpression(),
      (value) => value.present && value.svgPresent && value.caretPresent,
      "visual-editor Math Preview with exact caret",
    );
    assert.equal(previewBeforeTyping.overflowX, "auto");
    assert.equal(previewBeforeTyping.overflowY, "auto");
    assert.equal(previewBeforeTyping.scrollbarGutter, "auto");
    assert.ok(
      previewBeforeTyping.scrollWidth <= previewBeforeTyping.clientWidth + 1 &&
        previewBeforeTyping.scrollHeight <= previewBeforeTyping.clientHeight + 1,
      `short Math Preview should not reserve visible scrollbars: ${JSON.stringify(previewBeforeTyping)}`,
    );
    assert.ok(
      Math.max(
        previewBeforeTyping.paddingTop,
        previewBeforeTyping.paddingRight,
        previewBeforeTyping.paddingBottom,
        previewBeforeTyping.paddingLeft,
      ) - Math.min(
        previewBeforeTyping.paddingTop,
        previewBeforeTyping.paddingRight,
        previewBeforeTyping.paddingBottom,
        previewBeforeTyping.paddingLeft,
      ) <= 1,
      `short Math Preview padding is not balanced: ${JSON.stringify(previewBeforeTyping)}`,
    );
    assert.equal(previewBeforeTyping.customXVisible, false);
    assert.equal(previewBeforeTyping.customYVisible, false);
    assertBalancedMathPreviewInsets(previewBeforeTyping, "short Math Preview");
    assert.equal(previewBeforeTyping.caretVisible, true);
    assert.equal(previewBeforeTyping.aboveSource, true);
    const previewEnvironmentGap = previewBeforeTyping.placement === "above"
      ? previewBeforeTyping.anchorTop - previewBeforeTyping.tooltipBottom
      : previewBeforeTyping.tooltipTop - previewBeforeTyping.anchorBottom;
    assert.ok(
      previewEnvironmentGap >= 10 && previewEnvironmentGap <= 14,
      `ordinary Math Preview gap changed from its original size: ${JSON.stringify(previewBeforeTyping)}`,
    );
    assert.equal(previewBeforeTyping.configuredGap, 12);
    assert.ok(
      Math.abs(previewBeforeTyping.tooltipLeft - previewBeforeTyping.anchorLeft) <= 2,
      `ordinary display preview did not align with its visible environment delimiter: ${JSON.stringify(previewBeforeTyping)}`,
    );
    assert.ok(
      ["#ff2bd6", "#006dff"].includes(previewBeforeTyping.caretColorToken),
      `Math Preview 光标没有使用鲜艳的专用颜色：${JSON.stringify(previewBeforeTyping)}`,
    );
    assert.notEqual(previewBeforeTyping.caretFill, "none");
    assert.notEqual(previewBeforeTyping.caretStroke, "none");
    assert.ok(Number.parseFloat(previewBeforeTyping.caretStrokeWidth) > 0);

    // Completion is a separate tooltip. Opening its list must not feed back
    // into CodeMirror's collision resolver and push Math Preview away from the
    // formula/caret anchor.
    await dispatchModifiedKey(client, " ", "Space", 32, 2);
    await waitFor(
      client,
      contextId,
      completionPopupExpression(),
      (value) => value.present,
      "completion list while Math Preview is open",
    );
    const previewWithCompletion = await evaluate(
      client,
      contextId,
      visualMathPreviewStateExpression(),
    );
    assert.ok(
      Math.abs(previewWithCompletion.tooltipTop - previewBeforeTyping.tooltipTop) <= 2,
      `completion pushed Math Preview away from its anchor: ${JSON.stringify({
        before: previewBeforeTyping,
        withCompletion: previewWithCompletion,
      })}`,
    );
    await dispatchKey(client, "Escape", "Escape", 27);
    const previewProbe = await evaluate(
      client,
      contextId,
      installVisualMathPreviewProbeExpression(),
    );
    assert.equal(previewProbe.installed, true, JSON.stringify(previewProbe));
    await client.request("Input.insertText", { text: "s" });
    const previewWhileTyping = await evaluate(
      client,
      contextId,
      sampleVisualMathPreviewProbeExpression(42),
    );
    assert.equal(previewWhileTyping.disconnectedFrames, 0, JSON.stringify(previewWhileTyping));
    assert.equal(previewWhileTyping.identityChanges, 0, JSON.stringify(previewWhileTyping));
    assert.equal(previewWhileTyping.missingSvgFrames, 0, JSON.stringify(previewWhileTyping));
    assert.equal(previewWhileTyping.missingCaretFrames, 0, JSON.stringify(previewWhileTyping));
    assert.equal(previewWhileTyping.untouchedFormulaReplacements, 0, JSON.stringify(previewWhileTyping));
    assert.ok(
      previewWhileTyping.topJitter <= 2,
      `Math Preview 上边框在输入时发生跳动：${JSON.stringify(previewWhileTyping)}`,
    );
    assert.equal(previewWhileTyping.caretVisible, true, JSON.stringify(previewWhileTyping));
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await waitFor(
      client,
      contextId,
      openedFormulaExpression(formula.from),
      (value) => /\\Delta_2\^\*/u.test(value.activeLine) && !/s\\Delta_2\^\*/u.test(value.activeLine),
      "formula source undo after no-flicker probe",
    );

    // First click leaves formula source mode. Re-locate and click again after
    // CodeMirror has restored the widget and completed exact measurement.
    await clickLine(client, contextId, "The piecewise expression is");
    await delay(180);
    const restoredGeometryClick = await clickLine(
      client,
      contextId,
      "The piecewise expression is",
    );
    assertCaretNearClick(restoredGeometryClick, "恢复公式后的正文");

    const editable = await editAndRestoreLine(
      client,
      contextId,
      "The result remains editable in visual mode.",
      " QA",
    );
    assert.deepEqual(editable, { inserted: true, restored: true });

    const citationHoverTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-citation-chip", "Wang"),
      "citation hover preview chip",
    );
    await dispatchMouseMove(client, citationHoverTarget.point);
    const citationHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("BKP-affine coordinates and emergent geometry") &&
        value.text.includes("Wang, Xuhui、Yang, Chenglang") &&
        value.text.includes("Advances in Mathematics") &&
        value.text.includes("wang2025") &&
        value.text.includes("reference.bib · 已收录"),
      "citation metadata hover card",
    );
    assert.equal(citationHover.svgCount, 0);
    assert.doesNotMatch(citationHover.text, /&nbsp;|&amp;/u);

    const equationReferenceHoverTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-reference-chip", "eq:flag"),
      "equation-reference hover preview chip",
    );
    await dispatchMouseMove(client, equationReferenceHoverTarget.point);
    const equationReferenceHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("公式 eq:flag") &&
        value.svgCount === 1 &&
        value.svgWidth > 0 &&
        value.svgHeight > 0,
      "equation-reference Math Preview hover card",
    );
    assert.ok(equationReferenceHover.cardWidth > 0);
    assert.ok(equationReferenceHover.cardHeight > 0);

    const firstAlignedRowTarget = await locate(
      client,
      contextId,
      referenceTargetByKeyExpression("eq:row-r"),
      "first aligned-row reference hover target",
    );
    await dispatchMouseMove(client, firstAlignedRowTarget.point);
    const firstAlignedRowHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("公式 eq:row-r") &&
        value.highlightedRow === 0 &&
        value.rowCount === 2 &&
        value.highlightHeight > 0,
      "first aligned-row reference highlight",
    );

    const secondAlignedRowTarget = await locate(
      client,
      contextId,
      referenceTargetByKeyExpression("eq:row-s"),
      "second aligned-row reference hover target",
    );
    await dispatchMouseMove(client, secondAlignedRowTarget.point);
    const secondAlignedRowHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("公式 eq:row-s") &&
        value.highlightedRow === 1 &&
        value.rowCount === 2 &&
        value.highlightHeight > 0,
      "second aligned-row reference highlight",
    );
    assert.ok(
      secondAlignedRowHover.highlightTop > firstAlignedRowHover.highlightTop,
      `second aligned row should be highlighted below the first: ${JSON.stringify({
        firstAlignedRowHover,
        secondAlignedRowHover,
      })}`,
    );

    const theoremReferenceTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-reference-chip-target", "def:stable"),
      "theorem-reference hover preview target",
    );
    await dispatchMouseMove(client, theoremReferenceTarget.point);
    const theoremReferenceHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("Definition 1.1") &&
        value.text.includes("Stable flag") &&
        value.text.includes("A flag is stable") &&
        value.text.includes("def:stable") &&
        value.svgCount >= 1,
      "theorem-reference visual hover card",
    );
    assert.ok(theoremReferenceHover.cardWidth > 0);
    assert.ok(theoremReferenceHover.cardHeight > 0);

    const sectionReferenceTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-reference-chip-target", "sec:introduction"),
      "section-reference navigation target",
    );
    await dispatchMouseMove(client, sectionReferenceTarget.point);
    const sectionReferenceHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("1 Introduction") &&
        value.text.includes("sec:introduction"),
      "section-reference title hover preview",
    );
    assert.equal(sectionReferenceHover.svgCount, 0);
    await dispatchClick(client, sectionReferenceTarget.point, 2);
    await waitFor(
      client,
      contextId,
      visualNavigationStateExpression(),
      (value) => value.activeLine.includes("sec:introduction"),
      "Ctrl-click section-reference navigation",
    );
    await dispatchModifiedKey(client, "[", "BracketLeft", 219, 2);
    const sectionReturned = await waitFor(
      client,
      contextId,
      visualNavigationStateExpression(),
      (value) =>
        value.activeLine.includes("Section"),
      "Ctrl+[ return from section reference",
    );
    assert.match(sectionReturned.activeLine, /sec:introduction/u);

    const theoremNavigationTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-reference-chip-target", "def:stable"),
      "theorem-reference navigation target",
    );
    await dispatchClick(client, theoremNavigationTarget.point, 2);
    await waitFor(
      client,
      contextId,
      visualNavigationStateExpression(),
      (value) => value.activeLine.includes("def:stable"),
      "Ctrl-click theorem-reference navigation",
    );
    await dispatchModifiedKey(client, "[", "BracketLeft", 219, 2);
    await waitFor(
      client,
      contextId,
      visualNavigationStateExpression(),
      (value) =>
        value.activeLine.includes("definition"),
      "Ctrl+[ return from theorem reference",
    );

    const secondCitationTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-citation-chip-target", "Lovelace"),
      "second target in a multi-key citation",
    );
    await dispatchMouseMove(client, secondCitationTarget.point);
    const secondCitationHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("Notes on the Analytical Engine") &&
        value.text.includes("Lovelace, Ada") &&
        value.text.includes("lovelace1843"),
      "precise multi-key citation hover",
    );
    assert.equal(secondCitationHover.svgCount, 0);
    assert.doesNotMatch(secondCitationHover.text, /BKP-affine|wang2025/u);

    const secondEquationTarget = await locate(
      client,
      contextId,
      selectorContainingTextExpression(
        ".texleaf-reference-chip-target",
        "eq:long-preview",
      ),
      "second target in a multi-label formula reference",
    );
    await dispatchMouseMove(client, secondEquationTarget.point);
    const secondEquationHover = await waitFor(
      client,
      contextId,
      referenceHoverStateExpression(),
      (value) =>
        value.visible &&
        value.text.includes("公式 eq:long-preview") &&
        value.svgCount === 1,
      "precise multi-label formula hover",
    );
    assert.doesNotMatch(secondEquationHover.text, /公式 eq:flag/u);
    await dispatchMouseMove(client, { x: 4, y: 4 });

    const reference = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-reference-chip", "eq:flag"),
      "reference preview chip",
    );
    assert.match(reference.text, /def:stable|eq:flag/u);
    const label = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-theorem-begin-block .texleaf-label-chip", 0),
      "theorem label preview chip",
    );
    assert.doesNotMatch(label.text, /\\label/u);

    const table = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-table-card", 0),
      "table preview",
    );
    assert.match(table.text, /Explicit values of/u);
    assert.equal(table.shellMarginTop, "0px");
    assert.equal(table.shellMarginBottom, "0px");
    const tableMath = await evaluate(client, contextId, tableMathStateExpression(0));
    assert.ok(tableMath.present, "table math SVG must be rendered");
    assert.ok(
      tableMath.height <= tableMath.editorFontSize * 2.4,
      `table math is oversized: ${JSON.stringify(tableMath)}`,
    );
    const mixedTable = await evaluate(client, contextId, mixedTableContentStateExpression());
    assert.ok(mixedTable.captionMath >= 2, JSON.stringify(mixedTable));
    assert.ok(mixedTable.headerMath >= 3, JSON.stringify(mixedTable));
    assert.match(mixedTable.headerText, /Partition/u);
    assert.doesNotMatch(mixedTable.visibleText, /\\\(|\\\)/u);

    const tableEditorButton = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-table-card .texleaf-structure-action-primary", 0),
      "visual table editor button",
    );
    const tableViewportBeforeOpen = await evaluate(
      client,
      contextId,
      tableEditorViewportStateExpression(0),
    );
    await dispatchClick(client, tableEditorButton.point);
    const tableEditor = await waitFor(
      client,
      contextId,
      tableEditorStateExpression(),
      (value) => value.present && value.environmentOptions.includes("longtable"),
      "extended visual table editor",
    );
    assert.ok(tableEditor.virtualInputs >= 3);
    assert.ok(tableEditor.parameterInputs >= 6);
    await delay(420);
    const tableViewportAfterOpen = await evaluate(
      client,
      contextId,
      tableEditorViewportStateExpression(0),
    );
    assert.ok(
      Math.abs(tableViewportAfterOpen.cardTop - tableViewportBeforeOpen.cardTop) <= 4,
      `opening a table editor moved the clicked table out of place: ${JSON.stringify({
        before: tableViewportBeforeOpen,
        after: tableViewportAfterOpen,
      })}`,
    );
    assert.ok(
      tableViewportAfterOpen.panelTop < tableViewportAfterOpen.viewportBottom &&
        tableViewportAfterOpen.panelBottom > tableViewportAfterOpen.viewportTop,
      `opened table editor is not visible in the narrow editor viewport: ${JSON.stringify(tableViewportAfterOpen)}`,
    );
    assert.equal(tableViewportAfterOpen.actionPressed, "true");
    assert.equal(tableViewportAfterOpen.actionText, "关闭表格编辑");
    await dispatchClick(client, tableViewportAfterOpen.actionPoint);
    const tableViewportAfterClose = await waitFor(
      client,
      contextId,
      tableEditorViewportStateExpression(0),
      (value) => !value.panelPresent && value.actionPressed === "false",
      "table visual editor closes from the same button",
    );
    assert.ok(
      Math.abs(tableViewportAfterClose.cardTop - tableViewportBeforeOpen.cardTop) <= 4,
      `closing a table editor moved the clicked table out of place: ${JSON.stringify({
        before: tableViewportBeforeOpen,
        after: tableViewportAfterClose,
      })}`,
    );
    await dispatchClick(client, tableViewportAfterClose.actionPoint);
    await waitFor(
      client,
      contextId,
      tableEditorStateExpression(),
      (value) => value.present,
      "table visual editor reopens from the same button",
    );
    const tableInputBaseline = await evaluate(
      client,
      contextId,
      focusVirtualInputExpression(".texleaf-table-cell-input", 0),
    );
    assert.equal(tableInputBaseline.value, String.raw`Partition \(\mathbf{d}\)`);
    await client.request("Input.insertText", { text: String.raw`$\frac{7}{9}$` });
    const tableInputPreview = await waitFor(
      client,
      contextId,
      virtualMathPreviewStateExpression("table"),
      (value) => value.present && value.svg && value.tex.includes(String.raw`\frac{7}{9}`),
      "live formula preview in a visual table cell",
    );
    assert.equal(tableInputPreview.focused, true);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const tableInputUndo = await waitFor(
      client,
      contextId,
      virtualInputUndoStateExpression(
        ".texleaf-table-cell-input",
        String.raw`Partition \(\mathbf{d}\)`,
      ),
      (value) => value.value === String.raw`Partition \(\mathbf{d}\)` && value.panelPresent,
      "native Ctrl+Z in visual table input",
    );
    assert.ok(
      Math.abs(tableInputUndo.editorScrollTop - tableInputBaseline.editorScrollTop) <= 3,
      `table input Ctrl+Z moved the TeX document: ${JSON.stringify({ tableInputBaseline, tableInputUndo })}`,
    );

    // Table cells share the source editor's automatic-fraction behavior. Keep
    // the closing delimiter in place so this exercises the actual per-key
    // bridge instead of inserting a pre-expanded formula wholesale.
    const literalTableFraction = String.raw`\(1/\)`;
    await client.request("Input.insertText", { text: literalTableFraction });
    await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
    await dispatchKey(client, "ArrowLeft", "ArrowLeft", 37);
    await client.request("Input.insertText", { text: "6" });
    const expandedTableFraction = String.raw`\(\frac{1}{6}\)`;
    await waitFor(
      client,
      contextId,
      virtualInputUndoStateExpression(".texleaf-table-cell-input", expandedTableFraction),
      (value) => value.value === expandedTableFraction && value.focused && value.panelPresent,
      "automatic fraction expansion in a visual table cell",
    );
    await waitFor(
      client,
      contextId,
      virtualMathPreviewStateExpression("table"),
      (value) => value.present && value.svg && value.tex === expandedTableFraction,
      "automatic-fraction Math Preview in a visual table cell",
    );
    for (const expected of [
      String.raw`\(1/6\)`,
      literalTableFraction,
      String.raw`Partition \(\mathbf{d}\)`,
    ]) {
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      await waitFor(
        client,
        contextId,
        virtualInputUndoStateExpression(".texleaf-table-cell-input", expected),
        (value) => value.value === expected && value.focused && value.panelPresent,
        `exact visual-table undo to ${expected}`,
      );
    }

    // Applying the table model is a single source transaction as well.  One
    // document-level Ctrl+Z must restore the original table source/card.
    await evaluate(
      client,
      contextId,
      focusVirtualInputExpression(".texleaf-table-cell-input", 0),
    );
    await client.request("Input.insertText", { text: String.raw`$\frac{7}{9}$` });
    await waitFor(
      client,
      contextId,
      virtualMathPreviewStateExpression("table"),
      (value) => value.present && value.svg,
      "table formula preview before applying model",
    );
    await evaluate(client, contextId, clickStructureActionExpression("应用表格修改"));
    await waitFor(
      client,
      contextId,
      tableFirstCellStateExpression(),
      (value) => value.present && value.svg,
      "applied visual table formula",
    );
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const restoredTable = await waitFor(
      client,
      contextId,
      tableUndoStateExpression(),
      (value) => value.restored,
      "one-step visual table apply undo",
    );
    assert.equal(restoredTable.restored, true, JSON.stringify(restoredTable));

    const longtable = await locate(
      client,
      contextId,
      selectorContainingTextExpression(".texleaf-table-card", "repeated-header long table"),
      "longtable preview",
    );
    assert.match(longtable.text, /repeated-header long table/u);
    assert.match(longtable.text, /Object/u);
    const tableVariants = [];
    for (const [needle, description] of [
      ["Explicit values of", "captioned tabular preview"],
      ["repeated-header long table", "longtable variant preview"],
      ["Standalone tabular", "standalone positioned tabular preview"],
      ["列一", "standalone basic tabular preview"],
      ["Adaptive tabularx", "tabularx preview"],
    ]) {
      tableVariants.push(await locate(
        client,
        contextId,
        tableVariantContainingTextExpression(needle),
        description,
      ));
    }
    assert.deepEqual(
      tableVariants.map(({ environment, container }) => ({ environment, container })),
      [
        { environment: "tabular", container: "table" },
        { environment: "longtable", container: "" },
        { environment: "tabular", container: "" },
        { environment: "tabular", container: "" },
        { environment: "tabularx", container: "" },
      ],
      JSON.stringify(tableVariants),
    );
    assert.equal(
      tableVariants.every((variant) =>
        variant.editable && variant.sourceEditable && variant.rows >= 2
      ),
      true,
      JSON.stringify(tableVariants),
    );
    const bibliography = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-bibliography-card", 0),
      "compact bibliography preview",
    );
    const bibliographyState = await evaluate(
      client,
      contextId,
      bibliographyStateExpression(),
    );
    assert.match(bibliography.text, /References/u);
    assert.match(bibliography.text, /3 entries/u);
    assert.match(bibliography.text, /reference\.bib/u);
    assert.deepEqual(
      bibliographyState.keys,
      ["wang2025", "lovelace1843", "noether1918"],
      JSON.stringify(bibliographyState),
    );
    assert.equal(bibliographyState.entryCount, 3);
    assert.equal(bibliographyState.openButton, true);
    assert.equal(bibliographyState.editButton, true);
    assert.equal(bibliographyState.settings.style, "plainnat");
    assert.equal(bibliographyState.settings.toc, "References");
    assert.equal(bibliographyState.settings.resource, "reference.bib");
    assert.equal(bibliographyState.actionsWithinViewport, true, JSON.stringify(bibliographyState));
    assert.equal(bibliographyState.cardWithinViewport, true, JSON.stringify(bibliographyState));
    assert.match(bibliographyState.text, /BKP-affine coordinates and emergent geometry/u);
    assert.match(bibliographyState.text, /Wang, Xuhui and Yang, Chenglang/u);

    const tikzcd = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-tikzcd-card", 0),
      "tikzcd preview",
    );
    assert.ok(tikzcd.rect.width > 0 && tikzcd.rect.height > 0);
    const tikzcdState = await evaluate(client, contextId, `(() => ({
      nodes: document.querySelectorAll(".texleaf-tikzcd-card .texleaf-tikzcd-node:not(.texleaf-tikzcd-node-empty)").length,
      renderedMath: document.querySelectorAll(".texleaf-tikzcd-card .texleaf-tikzcd-node svg").length,
      exactLocalPreview: document.querySelector(
        '.texleaf-tikzcd-card svg[aria-label="tikz-cd 交换图的本地 TeX 精确预览"]'
      ) !== null,
    }))()`);
    assert.ok(
      tikzcdState.exactLocalPreview || tikzcdState.nodes >= 4,
      `tikzcd preview missing: ${JSON.stringify(tikzcdState)}`,
    );
    if (!tikzcdState.exactLocalPreview) {
      assert.ok(tikzcdState.renderedMath >= 4, `tikzcd math missing: ${JSON.stringify(tikzcdState)}`);
      const previewBends = await evaluate(
        client,
        contextId,
        tikzcdBendDirectionExpression("preview"),
      );
      assertTikzcdBendDirections(previewBends, "tikzcd preview");
      const previewResizeGeometry = await evaluate(
        client,
        contextId,
        tikzcdResizeStabilityExpression("preview"),
      );
      assertStableTikzcdGeometry(previewResizeGeometry, "tikzcd preview");
    }

    const tikzcdEditorButton = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-tikzcd-card .texleaf-structure-action-primary", 0),
      "direct tikzcd editor button",
    );
    const tikzcdViewportBeforeOpen = await evaluate(
      client,
      contextId,
      structureEditorViewportStateExpression(".texleaf-tikzcd-card", 0),
    );
    await dispatchClick(client, tikzcdEditorButton.point);
    const directEditor = await waitFor(
      client,
      contextId,
      tikzcdEditorStateExpression(),
      (value) => value.present && value.cells === 9 && value.arrows >= 7,
      "q.uiver-style tikzcd direct editor",
    );
    await delay(420);
    const tikzcdViewportAfterOpen = await evaluate(
      client,
      contextId,
      structureEditorViewportStateExpression(".texleaf-tikzcd-card", 0),
    );
    assert.ok(
      Math.abs(tikzcdViewportAfterOpen.cardTop - tikzcdViewportBeforeOpen.cardTop) <= 4,
      `opening a tikzcd editor moved the clicked diagram out of place: ${JSON.stringify({
        before: tikzcdViewportBeforeOpen,
        after: tikzcdViewportAfterOpen,
      })}`,
    );
    assert.ok(
      tikzcdViewportAfterOpen.panelTop < tikzcdViewportAfterOpen.viewportBottom &&
        tikzcdViewportAfterOpen.panelBottom > tikzcdViewportAfterOpen.viewportTop,
      `opened tikzcd editor is not visible in the narrow editor viewport: ${JSON.stringify(tikzcdViewportAfterOpen)}`,
    );
    assert.ok(directEditor.nodes >= 5, JSON.stringify(directEditor));
    assert.ok(directEditor.virtualInputs >= 9, JSON.stringify(directEditor));
    assert.equal(directEditor.undoDisabled, true);
    assert.ok(directEditor.connectorWidth >= 16, JSON.stringify(directEditor));
    assert.ok(directEditor.connectorHeight >= 16, JSON.stringify(directEditor));
    assert.equal(directEditor.arrowMode, true, JSON.stringify(directEditor));
    assert.ok(Math.abs(directEditor.cellWidth - 128) <= 1, JSON.stringify(directEditor));
    assert.ok(Math.abs(directEditor.cellHeight - 128) <= 1, JSON.stringify(directEditor));
    assert.ok(Math.abs(directEditor.nodeWidth - 64) <= 1, JSON.stringify(directEditor));
    assert.ok(Math.abs(directEditor.nodeHeight - 64) <= 1, JSON.stringify(directEditor));
    assert.equal(directEditor.columnGap, "0px", JSON.stringify(directEditor));
    assert.equal(directEditor.rowGap, "0px", JSON.stringify(directEditor));
    const editorBends = await evaluate(
      client,
      contextId,
      tikzcdBendDirectionExpression("editor"),
    );
    assertTikzcdBendDirections(editorBends, "tikzcd direct editor");
    const editorResizeGeometry = await evaluate(
      client,
      contextId,
      tikzcdResizeStabilityExpression("editor"),
    );
    assertStableTikzcdGeometry(editorResizeGeometry, "tikzcd direct editor");

    assert.equal(tikzcdViewportAfterOpen.actionPressed, "true");
    assert.equal(tikzcdViewportAfterOpen.actionText, "关闭交换图编辑");
    await dispatchClick(client, tikzcdViewportAfterOpen.actionPoint);
    const tikzcdViewportAfterClose = await waitFor(
      client,
      contextId,
      structureEditorViewportStateExpression(".texleaf-tikzcd-card", 0),
      (value) => !value.panelPresent && value.actionPressed === "false",
      "tikzcd visual editor closes from the same button",
    );
    assert.ok(
      Math.abs(tikzcdViewportAfterClose.cardTop - tikzcdViewportBeforeOpen.cardTop) <= 4,
      `closing a tikzcd editor moved the clicked diagram out of place: ${JSON.stringify({
        before: tikzcdViewportBeforeOpen,
        after: tikzcdViewportAfterClose,
      })}`,
    );
    await dispatchClick(client, tikzcdViewportAfterClose.actionPoint);
    await waitFor(
      client,
      contextId,
      tikzcdEditorStateExpression(),
      (value) => value.present && value.cells === 9,
      "tikzcd visual editor reopens from the same button",
    );

    const firstDiagramNode = await evaluate(
      client,
      contextId,
      selectorExpression('[data-tikzcd-editor-node="0:0"]', 0),
    );
    assert.ok(firstDiagramNode !== undefined, "first direct-editor diagram node missing");
    await dispatchClick(client, firstDiagramNode.point);
    await waitFor(
      client,
      contextId,
      tikzcdEditorStateExpression(),
      (value) => value.selection === "node" && value.nodeInput,
      "tikzcd node inspector",
    );
    const tikzInputBaseline = await evaluate(
      client,
      contextId,
      focusVirtualInputExpression(
        ".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input",
        0,
      ),
    );
    const editedTikzNode = String.raw`C\sum`;
    await client.request("Input.insertText", { text: editedTikzNode });
    const tikzInputPreview = await waitFor(
      client,
      contextId,
      virtualMathPreviewStateExpression("tikzcd"),
      (value) => value.present && value.svg && value.tex === editedTikzNode,
      "live formula preview in a tikzcd node label",
    );
    assert.equal(tikzInputPreview.focused, true);
    const tikzCanvasMath = await waitFor(
      client,
      contextId,
      tikzcdEditedNodeMathStateExpression(0, 0, editedTikzNode),
      (value) =>
        value.present &&
        value.svg &&
        !value.rawTex &&
        value.inputValue === editedTikzNode &&
        value.lastMathTex === editedTikzNode &&
        value.updatedNodes >= 1,
      "rendered formula propagated from a tikzcd input to the diagram canvas",
    );
    assert.equal(tikzCanvasMath.rawTex, false, JSON.stringify(tikzCanvasMath));
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const tikzInputUndo = await waitFor(
      client,
      contextId,
      virtualInputUndoStateExpression(
        ".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input",
        tikzInputBaseline.value,
      ),
      (value) => value.value === tikzInputBaseline.value && value.panelPresent,
      "native Ctrl+Z in tikzcd label input",
    );
    assert.ok(
      Math.abs(tikzInputUndo.editorScrollTop - tikzInputBaseline.editorScrollTop) <= 3,
      `tikzcd input Ctrl+Z moved the TeX document: ${JSON.stringify({ tikzInputBaseline, tikzInputUndo })}`,
    );
    await dispatchModifiedKey(client, "y", "KeyY", 89, 2);
    const tikzInputRedo = await waitFor(
      client,
      contextId,
      virtualInputUndoStateExpression(
        ".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input",
        editedTikzNode,
      ),
      (value) => value.value === editedTikzNode && value.focused && value.panelPresent,
      "exact Ctrl+Y redo in tikzcd label input",
    );
    assert.equal(tikzInputRedo.value, editedTikzNode);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const tikzInputSecondUndo = await waitFor(
      client,
      contextId,
      virtualInputUndoStateExpression(
        ".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input",
        tikzInputBaseline.value,
      ),
      (value) => value.value === tikzInputBaseline.value && value.focused && value.panelPresent,
      "second exact Ctrl+Z in tikzcd label input",
    );
    assert.equal(tikzInputSecondUndo.value, tikzInputBaseline.value);
    await evaluate(client, contextId, setTikzcdNodeInputExpression("A_0"));

    const shiftArrowDrag = await evaluate(
      client,
      contextId,
      tikzcdDomPointerDragExpression(0, 0, 1, 1, 71),
    );
    assert.equal(shiftArrowDrag.dispatched, true, JSON.stringify(shiftArrowDrag));
    assert.equal(shiftArrowDrag.previewHasMarker, true, JSON.stringify(shiftArrowDrag));
    assert.equal(shiftArrowDrag.previewMarkerVisible, true, JSON.stringify(shiftArrowDrag));
    await waitFor(
      client,
      contextId,
      tikzcdEditorStateExpression(),
      (value) => value.arrows >= 8 && value.selection === "arrow",
      "direct node-drag-created tikzcd arrow",
    );

    const arrowDrag = await evaluate(
      client,
      contextId,
      tikzcdDomPointerDragExpression(0, 0, 2, 2, 72),
    );
    assert.equal(arrowDrag.dispatched, true, JSON.stringify(arrowDrag));
    assert.equal(arrowDrag.previewHasMarker, true, JSON.stringify(arrowDrag));
    assert.equal(arrowDrag.previewMarkerVisible, true, JSON.stringify(arrowDrag));
    const afterArrowDrag = await waitFor(
      client,
      contextId,
      tikzcdEditorStateExpression(),
      (value) => value.arrows >= 9 && value.selection === "arrow" && value.endpoints === 2,
      "drag-created tikzcd arrow",
    );
    assert.equal(afterArrowDrag.undoDisabled, false);
    assert.equal(afterArrowDrag.selectedArrowHasMarker, true, JSON.stringify(afterArrowDrag));
    assert.equal(afterArrowDrag.transparentEndpoints, true, JSON.stringify(afterArrowDrag));
    await evaluate(client, contextId, setTikzcdArrowLabelExpression(String.raw`\alpha`));
    await evaluate(client, contextId, setTikzcdFieldExpression("线型", "dotted"));
    await evaluate(client, contextId, setTikzcdFieldExpression("弯曲", "right"));
    await evaluate(client, contextId, setTikzcdFieldExpression("弯曲角度", "15"));
    const rightBend15 = await waitFor(
      client,
      contextId,
      selectedTikzcdBendStateExpression(),
      (value) => value.present && value.bend === "right" && value.deviation > 0,
      "tikzcd right bend 15 degree geometry",
    );
    await evaluate(client, contextId, setTikzcdFieldExpression("弯曲角度", "45"));
    const rightBend45 = await waitFor(
      client,
      contextId,
      selectedTikzcdBendStateExpression(),
      (value) => value.present && value.bend === "right" &&
        value.deviation > rightBend15.deviation * 2.2,
      "tikzcd right bend 45 degree geometry",
    );
    assert.ok(
      rightBend45.cross > 1 && rightBend15.cross > 1,
      `right bend reversed direction: ${JSON.stringify({ rightBend15, rightBend45 })}`,
    );
    await evaluate(client, contextId, setTikzcdFieldExpression("弯曲", "left"));
    await evaluate(client, contextId, setTikzcdFieldExpression("弯曲角度", "45"));
    await evaluate(client, contextId, setTikzcdFieldExpression("箭头样式", "hook"));
    await evaluate(client, contextId, clickStructureActionExpression("应用交换图修改"));
    const roundTrippedDiagram = await waitFor(
      client,
      contextId,
      tikzcdPreviewStateExpression(),
      (value) => value.present && (
        value.exactLocalPreview ||
        (value.nodes >= 5 && value.arrows >= 9 && value.hasEditedNode)
      ),
      "round-tripped direct tikzcd edit",
    );
    if (!roundTrippedDiagram.exactLocalPreview) {
      assert.equal(roundTrippedDiagram.editedLineStyle, "1.5 4");
      assert.match(roundTrippedDiagram.editedPath, /Q/u);
    }
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await waitFor(
      client,
      contextId,
      tikzcdPreviewStateExpression(),
      (value) => (value.present || value.originalSourceVisible) && !value.hasEditedNode,
      "one-step visual tikzcd apply undo",
    );
    await dispatchModifiedKey(client, "y", "KeyY", 89, 2);
    await waitFor(
      client,
      contextId,
      tikzcdPreviewStateExpression(),
      (value) => value.hasEditedNode && (
        value.exactLocalPreview || !value.present || value.arrows >= 9
      ),
      "one-step visual tikzcd apply redo",
    );

    const image = await locate(
      client,
      contextId,
      selectorExpression(".texleaf-image-card", 0),
      "image preview",
    );
    assert.match(image.text, /A local raster-image preview/u);
    const imageState = await waitFor(
      client,
      contextId,
      imageStateExpression(),
      (value) => value.present && value.complete && value.naturalWidth > 0,
      "local raster image to load",
    );
    assert.equal(imageState.placeholder, false);

    for (const [selector, label] of [
      [".texleaf-table-card .texleaf-table-scroll", "table"],
      [".texleaf-image-card .texleaf-image-scroll", "image"],
      [".texleaf-tikzcd-card .texleaf-local-latex-preview", "tikzcd"],
      [".texleaf-tikzpicture-card .texleaf-local-latex-preview", "tikzpicture"],
    ]) {
      await locate(
        client,
        contextId,
        selectorExpression(selector, 0),
        `${label} local horizontal scroll target`,
      );
      const state = await evaluate(
        client,
        contextId,
        localHorizontalScrollStateExpression(selector),
      );
      assert.equal(state.present, true, `${label}: ${JSON.stringify(state)}`);
      assert.equal(state.localViewport, true, `${label}: ${JSON.stringify(state)}`);
      assert.equal(state.overflowX, "auto", `${label}: ${JSON.stringify(state)}`);
      assert.ok(state.scrollWidth > state.clientWidth, `${label}: ${JSON.stringify(state)}`);
      assert.ok(state.scrollLeft > 0, `${label}: ${JSON.stringify(state)}`);
    }

    const undoProbe = await locate(
      client,
      contextId,
      lineExpression("Undo probe:"),
      "undo probe",
    );
    await dispatchClick(client, undoProbe.point);
    await dispatchKey(client, "End", "End", 35);
    await client.request("Input.insertText", { text: "lm" });
    const expandedUndoProbe = await waitFor(
      client,
      contextId,
      lineTextExpression("Undo probe:"),
      (value) => /Undo probe:\s*\\\(/u.test(value),
      "lm automatic snippet expansion",
    );
    assert.match(expandedUndoProbe, /\\\(/u);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    const undoneProbe = await waitFor(
      client,
      contextId,
      lineTextExpression("Undo probe:"),
      (value) => value.includes("Undo probe:") && !value.includes("\\("),
      "one-step snippet undo",
    );
    assert.match(undoneProbe, /^Undo probe:\s*(?:lm)?$/u);
    await delay(450);
    const formulaAfterUndo = await locate(
      client,
      contextId,
      formulaAfterTheoremExpression("Proposition"),
      "formula preview retained after Ctrl+Z",
    );
    assert.equal(formulaAfterUndo.hitOwnsFormula, true);

    const undoBaseline = undoneProbe;
    await clickLine(client, contextId, "Undo probe:");
    await dispatchKey(client, "End", "End", 35);
    let typedSuffix = "";
    for (const character of ["x", "y", "z"]) {
      await client.request("Input.insertText", { text: character });
      typedSuffix += character;
      await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => value === `${undoBaseline}${typedSuffix}`,
        `ordinary edit ${character} before repeated undo`,
      );
      await delay(650);
    }
    const undoSuffixes = ["xy", "x", ""];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
      await waitFor(
        client,
        contextId,
        lineTextExpression("Undo probe:"),
        (value) => value === `${undoBaseline}${undoSuffixes[cycle]}`,
        `ordinary undo cycle ${cycle + 1}`,
      );
      await delay(260);
      const retained = await locate(
        client,
        contextId,
        formulaAfterTheoremExpression("Proposition"),
        `formula preview retained after undo cycle ${cycle + 1}`,
      );
      assert.equal(retained.hitOwnsFormula, true);
    }

    // LaTeX Workshop snippets are accepted inside this same CodeMirror, not
    // by opening the native editor.  Exercise Enter acceptance at the very end
    // of the document, where a stale selection used to scroll back to offset 0.
    await clickLine(client, contextId, "Undo probe:");
    await dispatchKey(client, "End", "End", 35);
    await dispatchKey(client, "Enter", "Enter", 13);
    await client.request("Input.insertText", { text: "BEQ" });
    const bottomBeqCompletion = await waitFor(
      client,
      contextId,
      completionPopupExpression(),
      (value) => value.present && value.text.includes("BEQ") && value.text.includes("LaTeX Workshop"),
      "LaTeX Workshop BEQ completion at document end",
    );
    assert.match(bottomBeqCompletion.text, /equation environment/u);
    const bottomCompletionBaseline = await evaluate(
      client,
      contextId,
      editorViewportAnchorExpression(),
    );
    await delay(100);
    await dispatchKey(client, "Enter", "Enter", 13);
    const bottomBeqApplied = await waitFor(
      client,
      contextId,
      bottomCompletionSnippetStateExpression(),
      (value) => value.applied && value.caretInBody && value.scrollTop > 0,
      "BEQ Enter acceptance without jumping to document start",
    );
    assert.ok(
      bottomBeqApplied.scrollTop >= bottomCompletionBaseline.scrollTop - 100,
      `accepting BEQ jumped away from the completion line: ${JSON.stringify({ bottomCompletionBaseline, bottomBeqApplied })}`,
    );
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await waitFor(
      client,
      contextId,
      exactLineExpression("BEQ"),
      (value) => value.text.trim() === "BEQ",
      "one-step BEQ completion undo",
    );
    await selectLineSubstring(client, contextId, "BEQ", 0, 3);
    await client.request("Input.insertText", { text: "" });
    await dispatchKey(client, "Backspace", "Backspace", 8);

    // Use the same-tab source mode for this low-level keyboard regression so
    // an unrelated completion tooltip cannot intercept the formula-widget
    // click that reveals the probe source. This is still the same CodeMirror,
    // keymap and provider post-input pipeline used by visual formula editing.
    const pairingModeButton = await locate(
      client,
      contextId,
      selectorExpression("#top-open-source", 0),
      "source-mode button for parenthesis regression",
    );
    await dispatchClick(client, pairingModeButton.point);
    await waitFor(
      client,
      contextId,
      sourceModeExpression(),
      (value) => value.mode === "source" && value.formulaWidgets === 0,
      "same-tab source mode for parenthesis regression",
    );
    const pairingProbe = "Pairing probe: $x$";
    await locate(
      client,
      contextId,
      exactLineExpression(pairingProbe),
      "pairing probe source line",
    );
    await selectLineSubstring(
      client,
      contextId,
      pairingProbe,
      pairingProbe.indexOf("x"),
      1,
    );
    await client.request("Input.insertText", { text: "" });
    await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $$",
      "empty inline-math pairing probe",
    );
    // Input.insertText is the stable CDP representation of one inserted `(`.
    // A later computer-use pass sends the physical Shift+9 chord as a second,
    // end-to-end check of the CodeMirror keymap/closeBrackets collision.
    await client.request("Input.insertText", { text: "(" });
    const pairedOnce = await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $()$",
      "single TeXLeaf parenthesis pair in visual math",
    );
    assert.doesNotMatch(pairedOnce.text, /\(\)\)/u);

    // Deleting content from inside an existing automatic pair must not make
    // the post-input matcher treat the old opening parenthesis as newly typed.
    // This used to turn `(q)` into `())` after Backspace.
    await client.request("Input.insertText", { text: "q" });
    await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $(q)$",
      "content typed inside the automatic parenthesis pair",
    );
    await dispatchKey(client, "Backspace", "Backspace", 8);
    const pairedAfterDelete = await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $()$",
      "deleting pair content without duplicating the closing parenthesis",
    );
    await delay(500);
    const stablePairAfterDelete = await evaluate(
      client,
      contextId,
      lineExpression("Pairing probe:"),
    );
    assert.equal(pairedAfterDelete.text.trim(), "Pairing probe: $()$");
    assert.equal(stablePairAfterDelete.text.trim(), "Pairing probe: $()$");
    assert.doesNotMatch(stablePairAfterDelete.text, /\(\)\)/u);

    await evaluate(
      client,
      contextId,
      directLineSubstringSelectionExpression(
        "Pairing probe: $()$",
        "Pairing probe: $(".length,
        0,
      ),
    );
    await delay(100);
    await dispatchModifiedKey(client, "z", "KeyZ", 90, 2);
    await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $(q)$",
      "undo restores content inside the automatic pair",
    );
    await evaluate(
      client,
      contextId,
      directLineSubstringSelectionExpression(
        "Pairing probe: $(q)$",
        "Pairing probe: $(q".length,
        0,
      ),
    );
    await delay(100);
    await dispatchModifiedKey(client, "y", "KeyY", 89, 2);
    await waitFor(
      client,
      contextId,
      lineExpression("Pairing probe:"),
      (value) => value.text.trim() === "Pairing probe: $()$",
      "redo removes pair content without duplicating the closing parenthesis",
    );

    const visualModeButton = await locate(
      client,
      contextId,
      selectorExpression("#top-open-source", 0),
      "visual-mode button after parenthesis regression",
    );
    await dispatchClick(client, visualModeButton.point);
    await waitFor(
      client,
      contextId,
      sourceModeExpression(),
      (value) => value.mode === "visual" && value.formulaWidgets > 0,
      "return to visual mode after parenthesis regression",
    );

    await locateTheorem(
      client,
      contextId,
      "Proposition",
      "To continue estimating",
      "For any partition",
    );
    const beforeFontResize = await evaluate(
      client,
      contextId,
      fontStateExpression("Proposition"),
    );
    await evaluate(client, contextId, setFontExpression("22px", "34px"));
    await delay(350);
    const afterFontResize = await evaluate(
      client,
      contextId,
      fontStateExpression("Proposition"),
    );
    assert.equal(afterFontResize.fontSize, "22px");
    assert.equal(afterFontResize.lineHeight, "34px");
    assert.ok(
      afterFontResize.headerHeight > beforeFontResize.headerHeight + 4,
      `字号变化后没有重新测量定理标题：${JSON.stringify({ beforeFontResize, afterFontResize })}`,
    );
    const largeFontClick = await clickLine(client, contextId, "For any partition");
    assertCaretNearClick(largeFontClick, "22px 定理正文");
    await evaluate(client, contextId, clearFontExpression());
    await delay(180);

    const hrefBeforeSourceMode = initial.href;
    const modeButton = await evaluate(
      client,
      contextId,
      selectorExpression("#top-open-source", 0),
    );
    await dispatchClick(client, modeButton.point);
    const sourceMode = await waitFor(
      client,
      contextId,
      sourceModeExpression(),
      (value) => value.mode === "source" && value.formulaWidgets === 0,
      "same-tab source mode",
    );
    assert.equal(sourceMode.href, hrefBeforeSourceMode);
    assert.equal(sourceMode.modeButtonText, "可视化模式");
    assert.equal(sourceMode.nativeButtonPresent, true);
    assert.equal(sourceMode.bodyBackground, "rgba(0, 0, 0, 0)");

    const rawProposition = await locate(
      client,
      contextId,
      lineExpression(String.raw`\begin{proposition}`),
      "raw proposition source in the same tab",
    );
    assert.match(rawProposition.text, /\\begin\{proposition\}/u);
    const bibliographySource = await locate(
      client,
      contextId,
      exactLineExpression(String.raw`\bibliography{reference}`),
      "unaltered bibliography after snippet undo",
    );
    assert.equal(bibliographySource.text.trim(), String.raw`\bibliography{reference}`);
    const themedSource = await evaluate(client, contextId, sourceThemeExpression());
    assert.ok(themedSource.tokenCount > 0, "source mode must retain LaTeX token classes");
    assert.ok(themedSource.colors.every((color) => color !== "rgba(0, 0, 0, 0)"));
    assert.ok(
      new Set(themedSource.colors).size >= 2,
      `source tokens did not resolve to distinct VS Code theme colors: ${JSON.stringify(themedSource.entries)}`,
    );
    assert.ok(
      themedSource.syntaxCommandColor.length > 0,
      `the host did not provide the active TextMate command color: ${JSON.stringify(themedSource)}`,
    );
    assert.equal(
      themedSource.commandColor,
      themedSource.syntaxCommandColor,
      `LaTeX command color did not resolve from the active TextMate theme: ${JSON.stringify(themedSource)}`,
    );

    await clickLine(client, contextId, String.raw`\Delta_2^*`);
    const sourceMathPreview = await waitFor(
      client,
      contextId,
      mathPreviewExpression(),
      (value) => value.present && value.svgPresent,
      "source-mode Math Preview",
    );
    assert.equal(sourceMathPreview.present, true);

    const returnButton = await evaluate(
      client,
      contextId,
      selectorExpression("#top-open-source", 0),
    );
    await dispatchClick(client, returnButton.point);
    await waitFor(
      client,
      contextId,
      sourceModeExpression(),
      (value) => value.mode === "visual",
      "return to same-tab visual mode",
    );
    const returnedProposition = await locate(
      client,
      contextId,
      theoremHeaderExpression("Proposition"),
      "restored proposition preview",
    );
    assert.match(returnedProposition.text, /^Proposition/u);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      initial,
      background,
      editingToolbar,
      completion,
      styleState,
      proposition,
      lemma,
      casesClick,
      formula,
      openedFormula,
      previewBeforeTyping,
      longFormulaStart,
      longFormulaEnd,
      tallFormulaEnd,
      previewWhileTyping,
      restoredGeometryClick,
      editable,
      table: { text: table.text, rect: table.rect },
      tableMath,
      tableEditor,
      longtable: { text: longtable.text, rect: longtable.rect },
      tikzcd: { text: tikzcd.text, rect: tikzcd.rect },
      image: imageState,
      undo: { expandedUndoProbe, undoneProbe, formulaAfterUndo, bibliographySource },
      fontResize: {
        before: beforeFontResize,
        after: afterFontResize,
        click: largeFontClick,
      },
      sameTabSourceMode: {
        sourceMode,
        rawProposition: rawProposition.text,
        themedSource,
        sourceMathPreview,
      },
    }, null, 2)}\n`);
  } finally {
    client.close();
  }
}

async function normalizeTestWindow(client) {
  try {
    const { windowId } = await client.request("Browser.getWindowForTarget");
    await client.request("Browser.setWindowBounds", {
      windowId,
      bounds: {
        windowState: "normal",
        width: 1_600,
        height: 1_000,
      },
    });
  } catch {
    // Older Electron builds may not expose Browser window control. The UI
    // checks below still provide useful coverage at the current window size.
  }
}

function reverseSyncFocusExpression() {
  return `(() => {
    const scroller = document.querySelector(".cm-scroller");
    const flashed = [...document.querySelectorAll(".cm-line.texleaf-reverse-sync-flash")];
    const line = flashed[0];
    if (!(scroller instanceof HTMLElement) || !(line instanceof HTMLElement)) {
      return {
        flashCount: flashed.length,
        targetContainsNeedle: false,
        centerDelta: Number.POSITIVE_INFINITY,
        scrollerHeight: 0,
        animationName: "",
      };
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return {
      flashCount: flashed.length,
      targetContainsNeedle: (line.textContent ?? "").includes("The piecewise expression is"),
      centerDelta: Math.abs(
        (lineRect.top + lineRect.height / 2) -
        (scrollerRect.top + scrollerRect.height / 2)
      ),
      scrollerHeight: scrollerRect.height,
      animationName: getComputedStyle(line).animationName,
    };
  })()`;
}

function installModeContinuityProbeExpression() {
  return `(() => {
    window.__texleafModeContinuityProbe?.observer?.disconnect?.();
    const readMode = () => document.querySelector("#editor")?.dataset.editorMode ?? "missing";
    const probe = {
      observedModes: [readMode()],
      editorRemoved: false,
      observer: undefined,
    };
    const record = () => {
      const editor = document.querySelector("#editor");
      if (!(editor instanceof HTMLElement)) {
        probe.editorRemoved = true;
        return;
      }
      const mode = editor.dataset.editorMode ?? "";
      if (mode.length > 0 && probe.observedModes.at(-1) !== mode) {
        probe.observedModes.push(mode);
      }
    };
    probe.observer = new MutationObserver(record);
    probe.observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-editor-mode", "aria-pressed"],
    });
    window.__texleafModeContinuityProbe = probe;
    return {
      mode: readMode(),
      buttonPressed: document.querySelector("#open-source")?.getAttribute("aria-pressed") ?? "",
    };
  })()`;
}

function modeContinuityProbeExpression(action) {
  return `(() => {
    const probe = window.__texleafModeContinuityProbe;
    return {
      action: ${JSON.stringify(action)},
      mode: document.querySelector("#editor")?.dataset.editorMode ?? "missing",
      buttonPressed: document.querySelector("#open-source")?.getAttribute("aria-pressed") ?? "",
      observedModes: [...(probe?.observedModes ?? [])],
      editorRemoved: probe?.editorRemoved ?? true,
      status: document.querySelector("#status")?.textContent ?? "",
      statusLevel: document.querySelector("#status")?.getAttribute("data-level") ?? "",
    };
  })()`;
}

function clickByIdExpression(id) {
  return `(() => {
    const button = document.getElementById(${JSON.stringify(id)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`;
}

function issueCardExpression() {
  return `(() => {
    const element = document.getElementById("ai-suggestion");
    if (!(element instanceof HTMLElement)) return null;
    const details = (id) => {
      const child = document.getElementById(id);
      if (!(child instanceof HTMLElement)) return null;
      const rect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      return {
        display: style.display,
        height: rect.height,
        computedHeight: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        position: style.position,
        flex: style.flex,
        alignSelf: style.alignSelf,
        styleAttribute: child.getAttribute("style"),
        paddingBlock: [style.paddingTop, style.paddingBottom],
        text: child.textContent,
      };
    };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      visible: element.classList.contains("visible"),
      kind: element.dataset.kind,
      hasInsight: element.dataset.hasInsight ?? null,
      height: rect.height,
      width: rect.width,
      minHeight: style.minHeight,
      maxHeight: style.maxHeight,
      overflow: style.overflow,
      styleAttribute: element.getAttribute("style"),
      title: details("ai-suggestion-title"),
      text: details("ai-suggestion-text"),
      message: details("ai-suggestion-message"),
      explanation: details("ai-suggestion-explanation"),
      proposal: details("ai-suggestion-proposal"),
      actions: details("ai-suggestion-actions"),
      note: details("ai-suggestion-note"),
      itemCount: element.querySelectorAll(".texleaf-diagnostic-card-item").length,
    };
  })()`;
}

function aiApplyUndoStateExpression(needle) {
  return `(() => {
    const scroller = document.querySelector(".cm-scroller");
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    const activeLine = document.querySelector(".cm-activeLine");
    const cursor = document.querySelector(".cm-cursor-primary");
    const lineBox = line?.getBoundingClientRect();
    const cursorBox = cursor?.getBoundingClientRect();
    const scrollerBox = scroller?.getBoundingClientRect();
    const lineHeight = line === undefined
      ? Number.parseFloat(getComputedStyle(document.querySelector(".cm-content") ?? document.body).lineHeight) || 0
      : Number.parseFloat(getComputedStyle(line).lineHeight) || lineBox?.height || 0;
    const scrollTop = scroller?.scrollTop ?? -1;
    const clientHeight = scroller?.clientHeight ?? 0;
    const maxScroll = Math.max(0, (scroller?.scrollHeight ?? 0) - clientHeight);
    return {
      lineText: line?.textContent ?? "",
      activeLine: activeLine?.textContent ?? "",
      lineVisible: lineBox !== undefined && scrollerBox !== undefined &&
        lineBox.bottom >= scrollerBox.top && lineBox.top <= scrollerBox.bottom,
      lineTop: lineBox?.top ?? -1,
      cursorTop: cursorBox?.top ?? -1,
      lineHeight,
      scrollTop,
      clientHeight,
      maxScroll,
      markerCount: document.querySelectorAll("[data-texleaf-ai-issue]").length,
      visibleLines: [...document.querySelectorAll(".cm-line")]
        .slice(0, 12)
        .map((item) => item.textContent ?? ""),
    };
  })()`;
}

function overviewExpression() {
  return `(() => {
    const content = document.querySelector(".cm-content");
    const scroller = document.querySelector(".cm-scroller");
    const editor = document.querySelector(".cm-editor");
    const customScrollbar = document.querySelector(".texleaf-editor-scrollbar");
    const customThumb = customScrollbar?.querySelector(".texleaf-editor-scrollbar-thumb");
    const contentStyle = getComputedStyle(content ?? document.documentElement);
    const scrollerStyle = getComputedStyle(scroller ?? document.documentElement);
    const gutterStyle = getComputedStyle(document.querySelector(".cm-gutters") ?? document.documentElement);
    return {
      ready: content !== null && scroller !== null,
      href: location.href,
      editorClassName: editor?.className ?? "",
      editorMode: document.querySelector("#editor-host")?.dataset.editorMode ?? "",
      fontFamily: contentStyle.fontFamily,
      fontSize: contentStyle.fontSize,
      lineHeight: scrollerStyle.lineHeight,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      editorBackground: getComputedStyle(editor ?? document.documentElement).backgroundColor,
      gutterBackground: gutterStyle.backgroundColor,
      gutterZIndex: gutterStyle.zIndex,
      overflowX: scrollerStyle.overflowX,
      overflowY: scrollerStyle.overflowY,
      scrollbarGutter: scrollerStyle.scrollbarGutter,
      verticalScrollbarWidth: scroller === null
        ? 0
        : Math.max(0, scroller.offsetWidth - scroller.clientWidth),
      scrollbarThumbColor: scroller === null
        ? ""
        : getComputedStyle(scroller, "::-webkit-scrollbar-thumb").backgroundColor,
      customScrollbarVisible: customScrollbar instanceof HTMLElement &&
        !customScrollbar.hidden && getComputedStyle(customScrollbar).display !== "none",
      customScrollbarWidth: customScrollbar?.getBoundingClientRect().width ?? 0,
      customScrollbarTop: customScrollbar?.getBoundingClientRect().top ?? 0,
      customScrollbarRight: customScrollbar?.getBoundingClientRect().right ?? 0,
      customScrollbarBottom: customScrollbar?.getBoundingClientRect().bottom ?? 0,
      customScrollbarThumbTop: customThumb?.getBoundingClientRect().top ?? 0,
      customScrollbarThumbHeight: customThumb?.getBoundingClientRect().height ?? 0,
      customScrollbarThumbRight: customThumb?.getBoundingClientRect().right ?? 0,
      customScrollbarThumbColor: customThumb === null || customThumb === undefined
        ? ""
        : getComputedStyle(customThumb).backgroundColor,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0,
      horizontalScrollWidth: scroller?.scrollWidth ?? 0,
      horizontalClientWidth: scroller?.clientWidth ?? 0,
      horizontalScrollLeft: scroller?.scrollLeft ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollerRight: scroller?.getBoundingClientRect().right ?? 0,
      editorRight: editor?.getBoundingClientRect().right ?? 0,
    };
  })()`;
}

function visualBackgroundExpression() {
  return `(() => {
    const background = document.querySelector("#editor-background");
    if (!(background instanceof HTMLElement)) return { present: false, imageUrl: "" };
    const style = getComputedStyle(background);
    return {
      present: true,
      imageUrl: style.backgroundImage,
      opacity: style.opacity,
      position: style.backgroundPosition,
      size: style.backgroundSize,
      repeat: style.backgroundRepeat,
      front: background.classList.contains("front"),
      pointerEvents: style.pointerEvents,
    };
  })()`;
}

function nativeSyntaxExpression() {
  return `(() => {
    const tokens = [...document.querySelectorAll(".texleaf-native-syntax-token")];
    const colors = [...new Set(tokens.map((token) => getComputedStyle(token).color))];
    const nestedColorMismatches = tokens.flatMap((token) => {
      const expected = getComputedStyle(token).color;
      return [...token.querySelectorAll('[class*="tok-"]')]
        .map((child) => ({
          token: token.textContent?.slice(0, 30) ?? "",
          child: child.textContent?.slice(0, 30) ?? "",
          expected,
          actual: getComputedStyle(child).color,
        }))
        .filter((entry) => entry.actual !== entry.expected);
    });
    const content = document.querySelector(".cm-content");
    const plainLine = [...document.querySelectorAll(".cm-line")]
      .find((line) => {
        const text = (line.textContent ?? "").trim();
        return text === "CITE_COMMAND_PROBE" || text.startsWith("This paragraph contain");
      });
    return {
      count: tokens.length,
      colors,
      editorForeground: content === null ? "" : getComputedStyle(content).color,
      plainTextColor: getComputedStyle(plainLine ?? content ?? document.documentElement).color,
      hasInlineDeclarations: tokens.some((token) =>
        token instanceof HTMLElement && /--texleaf-native-(?:foreground|font-style|font-weight|decoration)\\s*:/iu.test(token.getAttribute("style") ?? "")),
      nestedColorMismatches,
    };
  })()`;
}

function titleMetadataExpression() {
  return `(() => {
    const card = document.querySelector(".texleaf-title-card");
    if (!(card instanceof HTMLElement)) return { present: false };
    const box = card.getBoundingClientRect();
    return {
      present: box.width > 0 && box.height > 0,
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      affiliations: [...card.querySelectorAll(".texleaf-document-affiliation")]
        .map((item) => item.textContent?.trim() ?? ""),
      emails: [...card.querySelectorAll(".texleaf-document-email")]
        .map((item) => item.textContent?.trim() ?? ""),
    };
  })()`;
}

function visualMathPreviewStateExpression() {
  return `(() => {
    const tooltip = document.querySelector(".texleaf-math-preview-tooltip");
    const scroll = tooltip?.querySelector(".texleaf-math-preview-scroll");
    const canvas = tooltip?.querySelector(".texleaf-math-preview-canvas");
    const customX = tooltip?.querySelector(".texleaf-math-preview-scrollbar-x");
    const customY = tooltip?.querySelector(".texleaf-math-preview-scrollbar-y");
    const caret = tooltip?.querySelector('[data-texleaf-preview-caret="true"]');
    const editorCaret = document.querySelector(".cm-cursor-primary") ??
      document.querySelector(".cm-cursor");
    const activeLine = document.querySelector(".cm-activeLine");
    if (!(tooltip instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
      return { present: false, svgPresent: false, caretPresent: false };
    }
    const tooltipBox = tooltip.getBoundingClientRect();
    const scrollBox = scroll.getBoundingClientRect();
    const customXBox = customX?.getBoundingClientRect();
    const customYBox = customY?.getBoundingClientRect();
    const editorBox = document.querySelector(".cm-editor")?.getBoundingClientRect();
    const editorScrollBox = document.querySelector(".cm-scroller")?.getBoundingClientRect();
    const gutterBox = document.querySelector(".cm-gutters")?.getBoundingClientRect();
    const caretBox = caret?.getBoundingClientRect();
    const editorCaretBox = editorCaret?.getBoundingClientRect();
    const lineBox = activeLine?.getBoundingClientRect();
    const style = getComputedStyle(scroll);
    const caretStyle = caret === null ? undefined : getComputedStyle(caret);
    const activeLineText = activeLine?.textContent ?? "";
    const firstNonWhitespace = activeLineText.search(/\\S/u);
    const textCoordinate = (element, offset) => {
      if (!(element instanceof Element)) return Number.NaN;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let remaining = Math.max(0, offset);
      let node = walker.nextNode();
      while (node !== null) {
        const length = node.nodeValue?.length ?? 0;
        if (remaining <= length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          return range.getBoundingClientRect().left;
        }
        remaining -= length;
        node = walker.nextNode();
      }
      return element.getBoundingClientRect().right;
    };
    const activeLineStartLeft = textCoordinate(activeLine, 0);
    const activeTextStartLeft = textCoordinate(
      activeLine,
      firstNonWhitespace < 0 ? 0 : firstNonWhitespace,
    );
    const caretColorToken = getComputedStyle(document.body)
      .getPropertyValue("--texleaf-math-preview-caret")
      .trim()
      .toLowerCase();
    const caretVisible = caretBox !== undefined &&
      caretBox.right >= scrollBox.left && caretBox.left <= scrollBox.right &&
      caretBox.bottom >= scrollBox.top && caretBox.top <= scrollBox.bottom;
    return {
      present: true,
      svgPresent: tooltip.querySelector("svg") !== null,
      caretPresent: caret !== null,
      caretVisible,
      caretColorToken,
      caretFill: caretStyle?.fill ?? "",
      caretStroke: caretStyle?.stroke ?? "",
      caretStrokeWidth: caretStyle?.strokeWidth ?? "0px",
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollbarGutter: style.scrollbarGutter,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingRight: Number.parseFloat(style.paddingRight),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      horizontalScrollbar: Math.max(0, scroll.offsetHeight - scroll.clientHeight),
      verticalScrollbar: Math.max(0, scroll.offsetWidth - scroll.clientWidth),
      webkitScrollbarWidth: getComputedStyle(scroll, "::-webkit-scrollbar").width,
      webkitScrollbarHeight: getComputedStyle(scroll, "::-webkit-scrollbar").height,
      customXVisible: customX instanceof HTMLElement &&
        customX.classList.contains("visible") && (customXBox?.width ?? 0) > 0,
      customYVisible: customY instanceof HTMLElement &&
        customY.classList.contains("visible") && (customYBox?.height ?? 0) > 0,
      customXHeight: customXBox?.height ?? 0,
      customYWidth: customYBox?.width ?? 0,
      contentInsetTop: canvas instanceof HTMLElement ? canvas.offsetTop : Number.NaN,
      contentInsetLeft: canvas instanceof HTMLElement ? canvas.offsetLeft : Number.NaN,
      contentInsetRight: canvas instanceof HTMLElement
        ? scroll.scrollWidth - canvas.offsetLeft - canvas.offsetWidth
        : Number.NaN,
      contentInsetBottom: canvas instanceof HTMLElement
        ? scroll.scrollHeight - canvas.offsetTop - canvas.offsetHeight
        : Number.NaN,
      aboveSource: lineBox === undefined || tooltipBox.bottom <= lineBox.top + 2,
      placement: tooltip.classList.contains("cm-tooltip-above") ? "above" : "below",
      sourceGap: lineBox === undefined
        ? Number.NaN
        : tooltip.classList.contains("cm-tooltip-above")
          ? lineBox.top - tooltipBox.bottom
          : tooltipBox.top - lineBox.bottom,
      tooltipLeft: tooltipBox.left,
      tooltipTop: tooltipBox.top,
      tooltipBottom: tooltipBox.bottom,
      tooltipHeight: tooltipBox.height,
      tooltipWidth: tooltipBox.width,
      tooltipInlineMaxWidth: tooltip.style.maxWidth,
      scrollInlineMaxWidth: scroll.style.maxWidth,
      windowInnerWidth: window.innerWidth,
      editorLeft: editorBox?.left ?? Number.NaN,
      editorRight: editorBox?.right ?? Number.NaN,
      editorScrollLeft: editorScrollBox?.left ?? Number.NaN,
      editorScrollRight: editorScrollBox?.right ?? Number.NaN,
      editorScrollTop: editorScrollBox?.top ?? Number.NaN,
      editorScrollBottom: editorScrollBox?.bottom ?? Number.NaN,
      textViewportLeft: Math.max(
        editorScrollBox?.left ?? Number.NaN,
        gutterBox?.right ?? editorScrollBox?.left ?? Number.NaN,
      ),
      sourceLineHeight: lineBox?.height ?? Number.NaN,
      configuredGap: Number(tooltip.dataset.texleafGapPx),
      anchorLeft: Number(tooltip.dataset.texleafAnchorLeft),
      anchorRight: Number(tooltip.dataset.texleafAnchorRight),
      anchorTop: Number(tooltip.dataset.texleafAnchorTop),
      anchorBottom: Number(tooltip.dataset.texleafAnchorBottom),
      sourceCaretTop: Number(tooltip.dataset.texleafCaretTop),
      sourceCaretBottom: Number(tooltip.dataset.texleafCaretBottom),
      caretGap: tooltip.classList.contains("cm-tooltip-above")
        ? Number(tooltip.dataset.texleafCaretTop) - tooltipBox.bottom
        : tooltipBox.top - Number(tooltip.dataset.texleafCaretBottom),
      editorCaretTop: editorCaretBox?.top ?? Number.NaN,
      editorCaretBottom: editorCaretBox?.bottom ?? Number.NaN,
      activeLineText,
      activeLineStartLeft,
      activeTextStartLeft,
      characterWidth: Number.parseFloat(getComputedStyle(document.querySelector(".cm-content") ?? document.body).fontSize) * 0.6,
      cursorOffset: Number(tooltip.dataset.texleafCursorOffset),
      renderedCursorOffset: Number(tooltip.dataset.texleafRenderedCursorOffset),
      formulaFrom: Number(tooltip.dataset.texleafFormulaFrom),
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      scrollWidth: scroll.scrollWidth,
      scrollHeight: scroll.scrollHeight,
      clientWidth: scroll.clientWidth,
      clientHeight: scroll.clientHeight,
    };
  })()`;
}

function installVisualMathPreviewProbeExpression() {
  return `(() => {
    globalThis.__texleafVisualMathPreviewProbe?.observer?.disconnect?.();
    const root = document.querySelector(".texleaf-math-preview-tooltip");
    const untouched = document.querySelector(".texleaf-formula-widget");
    if (!(root instanceof HTMLElement) || root.querySelector("svg") === null) {
      return { installed: false };
    }
    const marker = "cdp-" + Date.now() + "-" + Math.random();
    root.dataset.cdpMathPreview = marker;
    if (untouched instanceof HTMLElement) {
      untouched.dataset.cdpUntouchedFormula = marker;
    }
    const probe = {
      root,
      untouched,
      marker,
      disconnectedFrames: 0,
      identityChanges: 0,
      missingSvgFrames: 0,
      missingCaretFrames: 0,
      untouchedFormulaReplacements: 0,
      minimumTop: root.getBoundingClientRect().top,
      maximumTop: root.getBoundingClientRect().top,
      inspect() {
        const current = document.querySelector(".texleaf-math-preview-tooltip");
        if (!root.isConnected) this.disconnectedFrames += 1;
        if (current !== root) this.identityChanges += 1;
        if (root.querySelector("svg") === null) this.missingSvgFrames += 1;
        if (root.querySelector('[data-texleaf-preview-caret="true"]') === null) {
          this.missingCaretFrames += 1;
        }
        const top = root.getBoundingClientRect().top;
        this.minimumTop = Math.min(this.minimumTop, top);
        this.maximumTop = Math.max(this.maximumTop, top);
        if (untouched instanceof HTMLElement &&
            (!untouched.isConnected || document.querySelector('[data-cdp-untouched-formula="' + marker + '"]') !== untouched)) {
          this.untouchedFormulaReplacements += 1;
        }
      },
    };
    probe.observer = new MutationObserver(() => probe.inspect());
    probe.observer.observe(document.body, { childList: true, subtree: true });
    globalThis.__texleafVisualMathPreviewProbe = probe;
    return { installed: true, marker, untouchedFormula: untouched instanceof HTMLElement };
  })()`;
}

function sampleVisualMathPreviewProbeExpression(frames) {
  return `(async () => {
    const probe = globalThis.__texleafVisualMathPreviewProbe;
    if (probe === undefined) return { installed: false };
    for (let frame = 0; frame < ${frames}; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      probe.inspect();
    }
    probe.observer.disconnect();
    const state = ${visualMathPreviewStateExpression()};
    const result = {
      installed: true,
      disconnectedFrames: probe.disconnectedFrames,
      identityChanges: probe.identityChanges,
      missingSvgFrames: probe.missingSvgFrames,
      missingCaretFrames: probe.missingCaretFrames,
      untouchedFormulaReplacements: probe.untouchedFormulaReplacements,
      minimumTop: probe.minimumTop,
      maximumTop: probe.maximumTop,
      topJitter: probe.maximumTop - probe.minimumTop,
      caretVisible: state.caretVisible,
      svgPresent: state.svgPresent,
      overflowX: state.overflowX,
      overflowY: state.overflowY,
    };
    delete globalThis.__texleafVisualMathPreviewProbe;
    return result;
  })()`;
}

function selectorExpression(selector, index) {
  return `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (element === undefined) return undefined;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const box = element.getBoundingClientRect();
    const target = element.querySelector("svg")?.getBoundingClientRect() ?? box;
    const shell = element.closest(".texleaf-measured-block-shell");
    const shellStyle = shell === null ? undefined : getComputedStyle(shell);
    return {
      text: element.textContent ?? "",
      point: { x: target.left + target.width / 2, y: target.top + target.height / 2 },
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      shellMarginTop: shellStyle?.marginTop,
      shellMarginBottom: shellStyle?.marginBottom,
    };
  })()`;
}

function selectorContainingTextExpression(selector, needle) {
  return `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(needle)}));
    if (element === undefined) return undefined;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const box = element.getBoundingClientRect();
    const target = element.querySelector("svg")?.getBoundingClientRect() ?? box;
    return {
      text: element.textContent ?? "",
      point: { x: target.left + target.width / 2, y: target.top + target.height / 2 },
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
    };
  })()`;
}

function referenceTargetByKeyExpression(key) {
  return `(() => {
    const element = [...document.querySelectorAll(".texleaf-reference-chip-target")]
      .find((candidate) => candidate instanceof HTMLElement &&
        candidate.dataset.referenceKey === ${JSON.stringify(key)});
    if (!(element instanceof HTMLElement)) return undefined;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const box = element.getBoundingClientRect();
    return {
      text: element.textContent ?? "",
      kind: element.dataset.referenceKind ?? "",
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
    };
  })()`;
}

function referenceHoverStateExpression() {
  return `(() => {
    const card = document.querySelector("#reference-hover");
    const svg = card?.querySelector("svg");
    if (!(card instanceof HTMLElement)) return { visible: false, text: "", svgCount: 0 };
    const box = card.getBoundingClientRect();
    const svgBox = svg?.getBoundingClientRect();
    const canvas = card.querySelector(".texleaf-reference-hover-math-canvas");
    const highlight = canvas?.querySelector(".texleaf-reference-hover-row-highlight");
    const highlightBox = highlight?.getBoundingClientRect();
    const canvasBox = canvas?.getBoundingClientRect();
    return {
      visible: card.classList.contains("visible") && card.getAttribute("aria-hidden") === "false",
      text: card.textContent ?? "",
      svgCount: card.querySelectorAll("svg").length,
      svgWidth: svgBox?.width ?? 0,
      svgHeight: svgBox?.height ?? 0,
      cardWidth: box.width,
      cardHeight: box.height,
      highlightedRow: Number(canvas?.dataset.highlightedRow ?? -1),
      rowCount: Number(canvas?.dataset.rowCount ?? -1),
      highlightTop: highlightBox !== undefined && canvasBox !== undefined
        ? highlightBox.top - canvasBox.top
        : -1,
      highlightHeight: highlightBox?.height ?? 0,
    };
  })()`;
}

function visualNavigationStateExpression() {
  return `(() => ({
    activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
    scrollTop: document.querySelector(".cm-scroller")?.scrollTop ?? -1,
  }))()`;
}

function editingToolbarExpression() {
  return `(() => {
    const toolbar = document.querySelector("#toolbar");
    const contextMenu = document.querySelector("#editing-context-menu");
    const buildMenu = document.querySelector("#build-menu");
    if (toolbar === null || contextMenu === null || buildMenu === null) return undefined;
    const commands = [...contextMenu.querySelectorAll("[data-texleaf-insert]")]
      .map((item) => item.getAttribute("data-texleaf-insert"));
    const topButtons = [...toolbar.querySelectorAll("button")].map((button) =>
      button.id || button.getAttribute("data-texleaf-insert") || "",
    );
    return {
      topButtons,
      contextText: contextMenu.textContent ?? "",
      buildMenuText: buildMenu.textContent ?? "",
      contextHidden: contextMenu.hasAttribute("hidden"),
      buildMenuHidden: buildMenu.hasAttribute("hidden"),
      buildInsideContextMenu: contextMenu.querySelector("#build-pdflatex, #build-xelatex, #build-lualatex") !== null,
      addTable: commands.includes("table"),
      longtable: commands.includes("longtable"),
      tikzcd: commands.includes("tikzcd"),
      point: { x: 8, y: 8 },
    };
  })()`;
}

function buildMenuStateExpression() {
  return `(() => {
    const button = document.querySelector("#build-menu-button");
    const menu = document.querySelector("#build-menu");
    if (!(button instanceof HTMLElement) || !(menu instanceof HTMLElement)) return undefined;
    const anchor = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    return {
      visible: !menu.hasAttribute("hidden") && box.width > 0 && box.height > 0,
      expanded: button.getAttribute("aria-expanded"),
      buttonText: button.textContent ?? "",
      text: menu.textContent ?? "",
      itemCount: menu.querySelectorAll("button").length,
      anchorLeft: anchor.left,
      anchorBottom: anchor.bottom,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      viewportWidth: window.innerWidth,
    };
  })()`;
}

function toolbarPopupStateExpression(buttonId, menuId) {
  return `(() => {
    const button = document.getElementById(${JSON.stringify(buttonId)});
    const menu = document.getElementById(${JSON.stringify(menuId)});
    if (!(button instanceof HTMLElement) || !(menu instanceof HTMLElement)) return undefined;
    const anchor = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    return {
      visible: !menu.hasAttribute("hidden") && box.width > 0 && box.height > 0,
      expanded: button.getAttribute("aria-expanded"),
      text: menu.textContent ?? "",
      itemCount: menu.querySelectorAll("button").length,
      anchorLeft: anchor.left,
      anchorBottom: anchor.bottom,
      left: box.left,
      top: box.top,
      width: box.width,
      viewportWidth: window.innerWidth,
    };
  })()`;
}

function openContextMenuExpression() {
  return `(() => {
    const content = document.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) return false;
    const box = content.getBoundingClientRect();
    content.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.min(box.right - 20, box.left + 180),
      clientY: Math.min(box.bottom - 20, box.top + 180),
      button: 2,
    }));
    return true;
  })()`;
}

function theoremEditChipExpression(label) {
  return `(() => {
    const theorem = [...document.querySelectorAll(".texleaf-theorem-begin")]
      .find((item) => item.querySelector(".texleaf-theorem-label")?.textContent?.replace(/\\.$/u, "") === ${JSON.stringify(label)});
    const chip = theorem?.querySelector(".texleaf-environment-edit-chip");
    if (chip === null || chip === undefined) return undefined;
    chip.scrollIntoView({ block: "center", inline: "nearest" });
    const box = chip.getBoundingClientRect();
    return {
      text: chip.textContent ?? "",
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    };
  })()`;
}

function pairedEnvironmentSourceExpression(environment) {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")].map((line) => line.textContent?.trim() ?? "");
    return {
      beginVisible: lines.some((line) => line.startsWith(${JSON.stringify(`\\begin{${environment}}`)})),
      endVisible: lines.some((line) => line === ${JSON.stringify(`\\end{${environment}}`)}),
    };
  })()`;
}

function pairedAbstractSourceExpression() {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent?.trim() ?? "");
    return {
      beginVisible: lines.some((line) => line.startsWith("\\\\begin{abstract}")),
      endVisible: lines.some((line) => line === "\\\\end{abstract}"),
      layoutCommands: lines.filter((line) => /^\\\\(?:smallskip|medskip|bigskip|vspace)/u.test(line)),
    };
  })()`;
}

function lineHistoryStateExpression(needle, inserted) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    if (line === undefined) return { text: "", active: false, caretTop: -10000, lineTop: 10000, lineBottom: 10000 };
    const caret = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    return {
      text: line.textContent ?? "",
      active: line.classList.contains("cm-activeLine") ||
        (caret !== undefined && caret.top >= box.top - 2 && caret.top <= box.bottom + 2),
      caretTop: caret?.top ?? -10000,
      lineTop: box.top,
      lineBottom: box.bottom,
      inserted: ${JSON.stringify(inserted)},
    };
  })()`;
}

function blankLineBeforeStructureStateExpression(label) {
  return `(() => {
    const structure = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    const caret = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    const lines = [...document.querySelectorAll(".cm-line")];
    const activeLines = [...document.querySelectorAll(".cm-activeLine")];
    const activeBlank = activeLines.find((line) => (line.textContent ?? "") === "");
    const structureBox = structure?.getBoundingClientRect();
    const blankBox = activeBlank?.getBoundingClientRect();
    return {
      textRemoved: !lines.some((line) => line.textContent?.includes("ddddssss")),
      activeBlankLine: activeBlank !== undefined,
      caretBeforeStructure: caret !== undefined && structureBox !== undefined && caret.top < structureBox.top,
      caretTop: caret?.top ?? -10000,
      blankTop: blankBox?.top ?? -10000,
      structureTop: structureBox?.top ?? -10000,
      activeLines: activeLines.map((line) => line.textContent ?? ""),
    };
  })()`;
}

function automaticTheoremProbeExpression() {
  return `(() => {
    const headers = [...document.querySelectorAll(".texleaf-theorem-begin-block")];
    const theoremHeaders = headers.filter((item) =>
      item.textContent?.trim().startsWith("Theorem")
    );
    const definitionHeaders = headers.filter((item) =>
      item.textContent?.trim().startsWith("Definition")
    );
    const activeLine = document.querySelector(".cm-activeLine");
    const caret = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    const activeBox = activeLine?.getBoundingClientRect();
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    return {
      expanded: theoremHeaders.length >= 2,
      theoremCount: theoremHeaders.length,
      definitionCount: definitionHeaders.length,
      snippetDebug: document.documentElement.dataset.texleafSnippetBridgeDebug ?? "",
      rawTriggerVisible: lines.some((line) => line.trim() === "\\\\thm"),
      bodyCaret: activeLine !== null &&
        (activeLine.textContent ?? "").trim() === "" &&
        caret !== undefined && activeBox !== undefined &&
        caret.top >= activeBox.top - 2 && caret.top <= activeBox.bottom + 2,
    };
  })()`;
}

function completionPopupExpression() {
  return `(() => {
    const popup = document.querySelector(".cm-tooltip-autocomplete");
    return { present: popup !== null, text: popup?.textContent ?? "" };
  })()`;
}

function editorViewportAnchorExpression() {
  return `(() => {
    const scroller = document.querySelector(".cm-scroller");
    const caret = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    return {
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      caretTop: caret?.top ?? -1,
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
    };
  })()`;
}

function bottomCompletionSnippetStateExpression() {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    const activeLine = document.querySelector(".cm-activeLine");
    const caret = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    const activeBox = activeLine?.getBoundingClientRect();
    const scroller = document.querySelector(".cm-scroller");
    const activeGutter = document.querySelector(".cm-activeLineGutter")?.textContent ?? "";
    return {
      applied: lines.some((line) => line.trim() === "\\\\begin{equation}") &&
        lines.some((line) => line.trim() === "\\\\end{equation}"),
      caretInBody: activeLine !== null &&
        (activeLine.textContent ?? "").trim() === "" &&
        caret !== undefined && activeBox !== undefined &&
        caret.top >= activeBox.top - 2 && caret.top <= activeBox.bottom + 2,
      activeGutter,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      activeLine: activeLine?.textContent ?? "",
    };
  })()`;
}

function selectedCompletionExpression() {
  return `(() => {
    const popup = document.querySelector(".cm-tooltip-autocomplete");
    const selected = popup?.querySelector('[aria-selected="true"]');
    return {
      present: selected !== null && selected !== undefined,
      text: selected?.textContent ?? "",
      html: selected?.outerHTML ?? "",
    };
  })()`;
}

function citationCommandApplicationExpression() {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    return {
      applied: lines.some((line) => line.trim() === "\\\\cite{}"),
      citeLines: lines.filter((line) => line.includes("\\\\cite")),
      status: document.querySelector("#status")?.textContent ?? "",
      popup: document.querySelector(".cm-tooltip-autocomplete")?.textContent ?? "",
    };
  })()`;
}

function citationCompletionPopupExpression() {
  return `(() => {
    const popup = document.querySelector(".cm-tooltip-autocomplete");
    const infos = [...document.querySelectorAll(".cm-completionInfo")];
    const info = infos.find((candidate) => {
      const box = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }) ?? infos.at(-1);
    const popupBox = popup?.getBoundingClientRect();
    const infoBox = info?.getBoundingClientRect();
    return {
      present: popup !== null,
      text: popup?.textContent ?? "",
      info: info?.textContent ?? "",
      infoSvg: info?.querySelector("svg") != null,
      infoTheorem: info?.querySelector(".texleaf-reference-hover-theorem") != null,
      infoCount: infos.length,
      infoOnRight: popupBox !== undefined && infoBox !== undefined &&
        infoBox.left >= popupBox.right - 2,
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
      trace: globalThis.__texleafCompletionTrace ?? [],
    };
  })()`;
}

function textStyleStateExpression() {
  return `(() => {
    const bold = document.querySelector(".texleaf-text-style-bold");
    const italic = document.querySelector(".texleaf-text-style-italic");
    const underline = document.querySelector(".texleaf-text-style-underline");
    const strike = document.querySelector(".texleaf-text-style-strike");
    const red = [...document.querySelectorAll(".texleaf-text-style")]
      .find((item) => item.textContent?.includes("red text"));
    if ([bold, italic, underline, strike, red].some((item) => item === null || item === undefined)) {
      return undefined;
    }
    bold.scrollIntoView({ block: "center", inline: "nearest" });
    const box = bold.getBoundingClientRect();
    return {
      boldWeight: getComputedStyle(bold).fontWeight,
      italicStyle: getComputedStyle(italic).fontStyle,
      underlineDecoration: getComputedStyle(underline).textDecorationLine,
      strikeDecoration: getComputedStyle(strike).textDecorationLine,
      redColor: getComputedStyle(red).color,
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    };
  })()`;
}

function toolbarProbeStateExpression() {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes("Toolbar probe:"));
    if (!(line instanceof HTMLElement)) {
      return { present: false, text: "", italic: false, color: "", hasLooseBrace: false };
    }
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const styled = [...line.querySelectorAll(".texleaf-text-style")]
      .find((item) => item.textContent?.includes("first case"));
    const text = line.textContent ?? "";
    const italic = styled?.classList.contains("texleaf-text-style-italic") === true ||
      ${JSON.stringify([
        String.raw`\emph{first case}`,
        String.raw`\textit{first case}`,
        String.raw`\textsl{first case}`,
      ])}.some((value) => text.includes(value));
    const rawColor = new RegExp(
      ${JSON.stringify(String.raw`\\textcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\{first case\}`)},
      "u",
    ).exec(text)?.[1];
    const color = styled instanceof HTMLElement
      ? getComputedStyle(styled).color
      : rawColor === undefined
        ? ""
        : "rgb(" + Number.parseInt(rawColor.slice(0, 2), 16) + ", " +
          Number.parseInt(rawColor.slice(2, 4), 16) + ", " +
          Number.parseInt(rawColor.slice(4, 6), 16) + ")";
    return {
      present: true,
      text,
      italic,
      color,
      hasLooseBrace: /[{}]/u.test(text),
    };
  })()`;
}

function textColorPopoverExpression() {
  return `(() => {
    const panel = document.querySelector("#text-color-popover");
    const apply = document.querySelector("#text-color-apply");
    const cancel = document.querySelector("#text-color-cancel");
    return {
      present: panel instanceof HTMLElement && !panel.hidden,
      applyLabel: apply?.textContent?.trim() ?? "",
      cancelLabel: cancel?.textContent?.trim() ?? "",
    };
  })()`;
}

function setTextColorHexExpression(value) {
  return `(() => {
    const input = document.querySelector("#text-color-hex");
    if (!(input instanceof HTMLInputElement)) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: ${JSON.stringify(value)},
    }));
    return true;
  })()`;
}

function tableMathStateExpression(index) {
  return `(() => {
    const card = [...document.querySelectorAll(".texleaf-table-card")][${index}];
    const svg = card?.querySelector(".texleaf-structure-math svg");
    const math = svg?.closest(".texleaf-structure-math");
    const content = document.querySelector(".cm-content");
    const box = math?.getBoundingClientRect();
    return {
      present: svg !== null && svg !== undefined,
      height: box?.height ?? 0,
      width: box?.width ?? 0,
      editorFontSize: Number.parseFloat(getComputedStyle(content ?? document.documentElement).fontSize),
    };
  })()`;
}

function mixedTableContentStateExpression() {
  return `(() => {
    const card = document.querySelector(".texleaf-table-card");
    const caption = card?.querySelector(".texleaf-table-caption");
    const header = card?.querySelector("thead tr");
    return {
      visibleText: card?.textContent ?? "",
      headerText: header?.textContent ?? "",
      captionMath: caption?.querySelectorAll(".texleaf-structure-math svg").length ?? 0,
      headerMath: header?.querySelectorAll(".texleaf-structure-math svg").length ?? 0,
    };
  })()`;
}

function tableEditorStateExpression() {
  return `(() => {
    const panel = document.querySelector(".texleaf-visual-structure-editor");
    if (panel === null) return { present: false, environmentOptions: [], virtualInputs: 0, parameterInputs: 0 };
    const environment = panel.querySelector('select[aria-label="数据环境"]');
    return {
      present: true,
      environmentOptions: [...(environment?.options ?? [])].map((option) => option.value),
      environmentValue: environment?.value ?? "",
      alignmentOptions: [...(panel.querySelector(".texleaf-table-align-select")?.options ?? [])]
        .map((option) => option.value),
      alignmentValues: [...panel.querySelectorAll(".texleaf-table-align-select")]
        .map((select) => select.value),
      width: panel.querySelector('input[aria-label="表格总宽度"]')?.value ?? "",
      virtualInputs: panel.querySelectorAll(".texleaf-virtual-latex-input").length,
      parameterInputs: panel.querySelectorAll(".texleaf-table-parameter-input").length,
    };
  })()`;
}

function tableCardStateContainingTextExpression(needle) {
  return `(() => {
    const card = [...document.querySelectorAll(".texleaf-table-card")]
      .find((candidate) => (candidate.textContent ?? "").includes(${JSON.stringify(needle)}));
    if (!(card instanceof HTMLElement)) return undefined;
    return {
      environment: card.dataset.texleafTableEnvironment ?? "",
      container: card.dataset.texleafTableContainer ?? "",
      editable: card.querySelector(".texleaf-structure-action-primary") !== null,
      sourceEditable: [...card.querySelectorAll(".texleaf-structure-action")]
        .some((button) => (button.textContent ?? "").includes("编辑环境源码")),
      rows: card.querySelectorAll("tr").length,
      text: (card.textContent ?? "").replace(/\\s+/gu, " ").trim(),
    };
  })()`;
}

function structureActionContainingTextExpression(cardSelector, needle, actionLabel) {
  return `(() => {
    const card = [...document.querySelectorAll(${JSON.stringify(cardSelector)})]
      .find((candidate) => (candidate.textContent ?? "").includes(${JSON.stringify(needle)}));
    const action = [...(card?.querySelectorAll("button") ?? [])]
      .find((button) => (button.textContent ?? "").includes(${JSON.stringify(actionLabel)}));
    if (!(action instanceof HTMLElement)) return undefined;
    const rect = action.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      text: action.textContent ?? "",
      point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  })()`;
}

function activateStructureActionContainingTextExpression(cardSelector, needle, actionLabel) {
  return `(() => {
    const card = [...document.querySelectorAll(${JSON.stringify(cardSelector)})]
      .find((candidate) => (candidate.textContent ?? "").includes(${JSON.stringify(needle)}));
    const action = [...(card?.querySelectorAll("button") ?? [])]
      .find((button) => (button.textContent ?? "").includes(${JSON.stringify(actionLabel)}));
    if (!(action instanceof HTMLElement)) return false;
    action.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
    return true;
  })()`;
}

function tableVariantStateExpression() {
  return `(() => [...document.querySelectorAll(".texleaf-table-card")].map((card) => ({
    environment: card.dataset.texleafTableEnvironment ?? "",
    container: card.dataset.texleafTableContainer ?? "",
    editable: card.querySelector(".texleaf-structure-action-primary") !== null,
    sourceEditable: [...card.querySelectorAll(".texleaf-structure-action")]
      .some((button) => (button.textContent ?? "").includes("编辑环境源码")),
    rows: card.querySelectorAll("tr").length,
    text: (card.textContent ?? "").replace(/\\s+/gu, " ").trim(),
  })))()`;
}

function tableVariantContainingTextExpression(needle) {
  return `(() => {
    const card = [...document.querySelectorAll(".texleaf-table-card")]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(needle)}));
    if (!(card instanceof HTMLElement)) return undefined;
    card.scrollIntoView({ block: "center", inline: "nearest" });
    return {
      environment: card.dataset.texleafTableEnvironment ?? "",
      container: card.dataset.texleafTableContainer ?? "",
      editable: card.querySelector(".texleaf-structure-action-primary") !== null,
      sourceEditable: [...card.querySelectorAll(".texleaf-structure-action")]
        .some((button) => (button.textContent ?? "").includes("编辑环境源码")),
      rows: card.querySelectorAll("tr").length,
      text: (card.textContent ?? "").replace(/\\s+/gu, " ").trim(),
    };
  })()`;
}

function bibliographyStateExpression() {
  return `(() => {
    const card = document.querySelector(".texleaf-bibliography-card");
    const actionElements = [...(card?.querySelectorAll("button") ?? [])];
    const actions = actionElements.map((button) => button.textContent?.trim() ?? "");
    const viewportRect = document.querySelector(".cm-scroller")?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const isInsideViewport = (rect) => viewportRect !== undefined &&
      rect.left >= viewportRect.left - 1 && rect.right <= viewportRect.right + 1;
    return {
      entryCount: card?.querySelectorAll(".texleaf-bibliography-entry").length ?? 0,
      keys: [...(card?.querySelectorAll(".texleaf-bibliography-entry") ?? [])]
        .map((entry) => entry.dataset.citationKey ?? ""),
      openButton: actions.some((label) => label.includes("Open .bib")),
      editButton: actions.some((label) => label.includes("编辑引用命令")),
      actionsWithinViewport: actionElements.length > 0 &&
        actionElements.every((button) => isInsideViewport(button.getBoundingClientRect())),
      cardWithinViewport: cardRect !== undefined && isInsideViewport(cardRect),
      cardWidth: cardRect?.width ?? 0,
      viewportWidth: viewportRect?.width ?? 0,
      settings: Object.fromEntries(
        [...(card?.querySelectorAll(".texleaf-bibliography-setting") ?? [])]
          .map((setting) => [
            setting.dataset.settingKind ?? setting.dataset.settingName ?? "",
            setting.querySelector(".texleaf-bibliography-setting-value")?.textContent?.trim() ?? "",
          ])
          .filter(([key]) => key.length > 0),
      ),
      text: (card?.textContent ?? "").replace(/\\s+/gu, " ").trim(),
    };
  })()`;
}

function tableEditorViewportStateExpression(index) {
  return structureEditorViewportStateExpression(".texleaf-table-card", index);
}

function structureEditorViewportStateExpression(cardSelector, index) {
  return `(() => {
    const card = [...document.querySelectorAll(${JSON.stringify(cardSelector)})][${Number(index)}];
    const panel = card?.querySelector(".texleaf-visual-structure-editor");
    const scroller = document.querySelector(".cm-scroller");
    const cardRect = card?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const viewportRect = scroller?.getBoundingClientRect();
    const action = card?.querySelector(".texleaf-structure-action-primary");
    const actionRect = action?.getBoundingClientRect();
    return {
      scrollTop: scroller?.scrollTop ?? -1,
      cardTop: cardRect?.top ?? -1,
      cardBottom: cardRect?.bottom ?? -1,
      panelTop: panelRect?.top ?? -1,
      panelBottom: panelRect?.bottom ?? -1,
      viewportTop: viewportRect?.top ?? -1,
      viewportBottom: viewportRect?.bottom ?? -1,
      panelPresent: panel instanceof HTMLElement,
      focusedInPanel: panel?.contains(document.activeElement) ?? false,
      actionText: action?.textContent ?? "",
      actionPressed: action?.getAttribute("aria-pressed") ?? "",
      actionPoint: {
        x: actionRect === undefined ? -1 : actionRect.left + actionRect.width / 2,
        y: actionRect === undefined ? -1 : actionRect.top + actionRect.height / 2,
      },
    };
  })()`;
}

function proofVisualStateExpression() {
  return `(() => {
    const header = [...document.querySelectorAll(".texleaf-theorem-begin.texleaf-theorem-proof")][0];
    const heading = header?.querySelector(".texleaf-theorem-label")?.textContent ?? "";
    const body = [...document.querySelectorAll(".cm-line.texleaf-theorem-proof")]
      .find((line) => line.textContent?.includes("Compare the two displayed identities"));
    const boundaries = [
      header,
      body,
      ...document.querySelectorAll(".texleaf-theorem-end.texleaf-theorem-proof"),
      ...document.querySelectorAll(".texleaf-theorem-formula-shell.texleaf-theorem-proof"),
    ].filter((item) => item instanceof HTMLElement);
    const borderWidths = boundaries.flatMap((item) => {
      const style = getComputedStyle(item);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .map((width) => Number.parseFloat(width));
    });
    return {
      present: header instanceof HTMLElement,
      heading,
      bodyVisible: body instanceof HTMLElement,
      borderWidths,
    };
  })()`;
}

function focusVirtualInputExpression(selector, index) {
  return `(() => {
    const input = [...document.querySelectorAll(${JSON.stringify(selector)})][${Number(index)}];
    const scroller = document.querySelector(".cm-scroller");
    if (!(input instanceof HTMLInputElement)) {
      return { present: false, value: "", editorScrollTop: -1 };
    }
    input.scrollIntoView({ block: "nearest", inline: "nearest" });
    input.focus({ preventScroll: true });
    input.select();
    return {
      present: true,
      value: input.value,
      editorScrollTop: scroller?.scrollTop ?? 0,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      panelPresent: input.closest(".texleaf-visual-structure-editor") !== null,
    };
  })()`;
}

function virtualInputUndoStateExpression(selector, expectedValue) {
  return `(() => {
    const input = [...document.querySelectorAll(${JSON.stringify(selector)})][0];
    const scroller = document.querySelector(".cm-scroller");
    return {
      value: input instanceof HTMLInputElement ? input.value : "<missing>",
      expectedValue: ${JSON.stringify(expectedValue)},
      focused: document.activeElement === input,
      editorScrollTop: scroller?.scrollTop ?? 0,
      panelPresent: input?.closest?.(".texleaf-visual-structure-editor") !== null,
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
    };
  })()`;
}

function virtualMathPreviewStateExpression(context) {
  return `(() => {
    const popup = document.querySelector(
      '.texleaf-virtual-math-preview[data-texleaf-virtual-math-context="${context}"]'
    );
    const focused = document.activeElement;
    const box = popup?.getBoundingClientRect();
    return {
      present: popup instanceof HTMLElement,
      svg: popup?.querySelector("svg") !== null,
      tex: focused instanceof HTMLInputElement ? focused.value : "",
      focused: focused instanceof HTMLInputElement &&
        focused.classList.contains("texleaf-virtual-latex-input"),
      width: box?.width ?? 0,
      height: box?.height ?? 0,
    };
  })()`;
}

function tikzcdEditedNodeMathStateExpression(row, column, expectedTex) {
  return `(() => {
    const panel = document.querySelector(".texleaf-tikzcd-visual-editor");
    const label = document.querySelector(
      '[data-tikzcd-editor-node-label="${Number(row)}:${Number(column)}"]'
    );
    const input = document.querySelector(
      '.texleaf-tikzcd-selection-panel [data-tikzcd-node-input="${Number(row)}:${Number(column)}"]'
    );
    return {
      present: label instanceof HTMLElement,
      svg: label?.querySelector("svg") !== null,
      rawTex: (label?.textContent ?? "").includes("\\\\"),
      text: label?.textContent ?? "",
      inputValue: input instanceof HTMLInputElement ? input.value : "",
      expectedTex: ${JSON.stringify(expectedTex)},
      lastMathTex: panel?.getAttribute("data-texleaf-tikzcd-last-math-tex") ?? "",
      updatedNodes: Number(
        panel?.getAttribute("data-texleaf-tikzcd-last-math-nodes") ?? "0"
      ),
    };
  })()`;
}

function tableFirstCellStateExpression() {
  return `(() => {
    const cell = document.querySelector(".texleaf-table-card thead th");
    return {
      present: cell !== null,
      text: cell?.textContent ?? "",
      svg: cell !== null && cell.querySelector("svg") !== null,
      tableCards: document.querySelectorAll(".texleaf-table-card").length,
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
      activeGutter: document.querySelector(".cm-activeLineGutter")?.textContent ?? "",
    };
  })()`;
}

function tableUndoStateExpression() {
  return `(() => {
    const visibleLines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    const firstCardCell = document.querySelector(".texleaf-table-card thead th")?.textContent?.trim() ?? "";
    const originalHeaderVisible = visibleLines.some((line) => line.includes("Partition \\\\("));
    const editedFormulaVisible = visibleLines.some((line) => line.includes("frac{7}{9}"));
    return {
      restored: (firstCardCell.includes("Partition") || originalHeaderVisible) && !editedFormulaVisible,
      firstCardCell,
      originalHeaderVisible,
      editedFormulaVisible,
      tableCards: document.querySelectorAll(".texleaf-table-card").length,
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
    };
  })()`;
}

function tikzcdEditorStateExpression() {
  return `(() => {
    const panel = document.querySelector(".texleaf-tikzcd-visual-editor");
    if (panel === null) return { present: false, cells: 0, nodes: 0, arrows: 0 };
    const undo = panel.querySelector('[data-texleaf-tikzcd-action="undo"]');
    const connector = panel.querySelector(".texleaf-tikzcd-connect-handle");
    const connectorBox = connector?.getBoundingClientRect();
    const grid = panel.querySelector(".texleaf-tikzcd-direct-grid");
    const cell = panel.querySelector(".texleaf-tikzcd-editor-cell");
    const node = panel.querySelector(".texleaf-tikzcd-editor-node");
    const cellBox = cell?.getBoundingClientRect();
    const nodeBox = node?.getBoundingClientRect();
    const gridStyle = getComputedStyle(grid ?? document.documentElement);
    const selectedArrow = panel.querySelector(".texleaf-tikzcd-editor-arrow-selected");
    const endpoints = [...panel.querySelectorAll("[data-tikzcd-editor-endpoint]")];
    return {
      present: true,
      cells: panel.querySelectorAll(".texleaf-tikzcd-editor-cell").length,
      nodes: panel.querySelectorAll(".texleaf-tikzcd-editor-node:not(.texleaf-tikzcd-editor-node-empty)").length,
      arrows: panel.querySelectorAll("[data-tikzcd-editor-arrow-hit]").length,
      endpoints: panel.querySelectorAll("[data-tikzcd-editor-endpoint]").length,
      virtualInputs: panel.querySelectorAll(".texleaf-virtual-latex-input").length,
      selection: panel.querySelector(".texleaf-tikzcd-editor-cell-selected") !== null
        ? "node"
        : panel.querySelector(".texleaf-tikzcd-editor-arrow-selected") !== null
          ? "arrow"
          : "none",
      nodeInput: panel.querySelector(".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input") !== null,
      undoDisabled: undo?.disabled === true,
      connectorWidth: connectorBox?.width ?? 0,
      connectorHeight: connectorBox?.height ?? 0,
      arrowMode: panel.querySelector('[data-texleaf-tikzcd-action="arrow-mode"]')?.getAttribute("aria-pressed") === "true",
      cellWidth: cellBox?.width ?? 0,
      cellHeight: cellBox?.height ?? 0,
      nodeWidth: nodeBox?.width ?? 0,
      nodeHeight: nodeBox?.height ?? 0,
      columnGap: gridStyle.columnGap,
      rowGap: gridStyle.rowGap,
      selectedArrowHasMarker: selectedArrow?.getAttribute("marker-end")?.startsWith("url(") === true,
      transparentEndpoints: endpoints.length === 2 && endpoints.every((endpoint) => {
        const fill = getComputedStyle(endpoint).fill;
        return fill === "transparent" || /rgba\\([^)]*,\\s*0\\)/u.test(fill);
      }),
    };
  })()`;
}

function tikzcdBendDirectionExpression(kind) {
  const attribute = kind === "preview"
    ? "data-tikzcd-bend"
    : "data-tikzcd-editor-bend";
  return `(() => {
    const measure = (bend) => {
      const path = document.querySelector('[' + ${JSON.stringify(attribute)} + '="' + bend + '"]');
      const source = path?.getAttribute("d") ?? "";
      const numbers = source.match(/[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?/giu)?.map(Number) ?? [];
      if (numbers.length < 6 || !source.includes("Q")) return undefined;
      const [startX, startY, controlX, controlY, endX, endY] = numbers;
      const middleX = (startX + endX) / 2;
      const middleY = (startY + endY) / 2;
      return {
        path: source,
        cross: (endX - startX) * (controlY - middleY) -
          (endY - startY) * (controlX - middleX),
      };
    };
    return { present: true, left: measure("left"), right: measure("right") };
  })()`;
}

function selectedTikzcdBendStateExpression() {
  return `(() => {
    const path = document.querySelector(".texleaf-tikzcd-editor-arrow-selected");
    const source = path?.getAttribute("d") ?? "";
    const numbers = source.match(/[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?/giu)?.map(Number) ?? [];
    if (numbers.length < 6 || !source.includes("Q")) {
      return { present: false, bend: path?.getAttribute("data-tikzcd-editor-bend") ?? "" };
    }
    const [startX, startY, controlX, controlY, endX, endY] = numbers;
    const middleX = (startX + endX) / 2;
    const middleY = (startY + endY) / 2;
    const distance = Math.hypot(endX - startX, endY - startY);
    const cross = (endX - startX) * (controlY - middleY) -
      (endY - startY) * (controlX - middleX);
    return {
      present: true,
      bend: path?.getAttribute("data-tikzcd-editor-bend") ?? "",
      path: source,
      cross,
      deviation: distance > 0 ? Math.abs(cross) / distance : 0,
    };
  })()`;
}

function tikzcdResizeStabilityExpression(kind) {
  return `(() => {
    const preview = ${JSON.stringify(kind)} === "preview";
    const container = document.querySelector(preview
      ? ".texleaf-tikzcd-card"
      : ".texleaf-tikzcd-direct-workspace");
    const grid = container?.querySelector(preview
      ? ".texleaf-tikzcd-grid"
      : ".texleaf-tikzcd-direct-grid");
    const cell = (row, column) => container?.querySelector(preview
      ? '[data-tikzcd-row="' + row + '"][data-tikzcd-column="' + column + '"]'
      : '[data-tikzcd-editor-row="' + row + '"][data-tikzcd-editor-column="' + column + '"]');
    if (!(container instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
      return { present: false };
    }
    const originalWidth = container.style.width;
    const measure = (width) => {
      container.style.width = width + "px";
      void container.offsetWidth;
      const origin = cell(0, 0)?.getBoundingClientRect();
      const horizontal = cell(0, 2)?.getBoundingClientRect();
      const vertical = cell(2, 0)?.getBoundingClientRect();
      if (origin === undefined || horizontal === undefined || vertical === undefined) {
        return undefined;
      }
      const center = (rectangle) => ({
        x: rectangle.left + rectangle.width / 2,
        y: rectangle.top + rectangle.height / 2,
      });
      const a = center(origin);
      const b = center(horizontal);
      const c = center(vertical);
      return {
        horizontal: Math.hypot(b.x - a.x, b.y - a.y),
        vertical: Math.hypot(c.x - a.x, c.y - a.y),
        gridWidth: grid.getBoundingClientRect().width,
        tracks: getComputedStyle(grid).gridTemplateColumns,
      };
    };
    const narrow = measure(720);
    const wide = measure(1680);
    container.style.width = originalWidth;
    void container.offsetWidth;
    return { present: true, narrow, wide };
  })()`;
}

function assertStableTikzcdGeometry(result, label) {
  assert.equal(result.present, true, `${label} missing: ${JSON.stringify(result)}`);
  assert.ok(result.narrow && result.wide, `${label} cells missing: ${JSON.stringify(result)}`);
  assert.doesNotMatch(result.narrow.tracks, /\bfr\b/u, `${label} still uses elastic fr tracks`);
  assert.ok(
    Math.abs(result.narrow.horizontal - result.wide.horizontal) <= 0.75,
    `${label} horizontal geometry stretched: ${JSON.stringify(result)}`,
  );
  assert.ok(
    Math.abs(result.narrow.vertical - result.wide.vertical) <= 0.75,
    `${label} vertical geometry stretched: ${JSON.stringify(result)}`,
  );
  assert.ok(
    Math.abs(result.narrow.gridWidth - result.wide.gridWidth) <= 0.75,
    `${label} intrinsic grid width changed with viewport: ${JSON.stringify(result)}`,
  );
}

function assertTikzcdBendDirections(result, label) {
  assert.equal(result.present, true, `${label} missing: ${JSON.stringify(result)}`);
  assert.ok(result.left && result.right, `${label} bend paths missing: ${JSON.stringify(result)}`);
  assert.ok(
    result.left.cross < -1,
    `${label} bend left must stay on the directed left side: ${JSON.stringify(result.left)}`,
  );
  assert.ok(
    result.right.cross > 1,
    `${label} bend right must stay on the directed right side: ${JSON.stringify(result.right)}`,
  );
}

function tikzcdArrowDragPointsExpression(fromRow, fromColumn, toRow, toColumn) {
  return `(() => {
    const panel = document.querySelector(".texleaf-tikzcd-visual-editor");
    const workspace = panel?.querySelector(".texleaf-tikzcd-direct-workspace");
    const source = panel?.querySelector(
      '[data-tikzcd-editor-row="${fromRow}"][data-tikzcd-editor-column="${fromColumn}"] .texleaf-tikzcd-connect-handle'
    );
    const target = panel?.querySelector(
      '[data-tikzcd-editor-row="${toRow}"][data-tikzcd-editor-column="${toColumn}"]'
    );
    if (workspace === null || workspace === undefined || source === null || source === undefined || target === null || target === undefined) {
      return undefined;
    }
    workspace.scrollIntoView({ block: "center", inline: "nearest" });
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    return {
      from: { x: sourceBox.left + sourceBox.width / 2, y: sourceBox.top + sourceBox.height / 2 },
      to: { x: targetBox.left + targetBox.width / 2, y: targetBox.top + targetBox.height / 2 },
    };
  })()`;
}

function tikzcdNodeDragPointsExpression(fromRow, fromColumn, toRow, toColumn) {
  return `(() => {
    const panel = document.querySelector(".texleaf-tikzcd-visual-editor");
    const source = panel?.querySelector('[data-tikzcd-editor-node="${fromRow}:${fromColumn}"]');
    const target = panel?.querySelector(
      '[data-tikzcd-editor-row="${toRow}"][data-tikzcd-editor-column="${toColumn}"]'
    );
    if (source === null || source === undefined || target === null || target === undefined) {
      return undefined;
    }
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    return {
      from: { x: sourceBox.left + sourceBox.width / 2, y: sourceBox.top + sourceBox.height / 2 },
      to: { x: targetBox.left + targetBox.width / 2, y: targetBox.top + targetBox.height / 2 },
    };
  })()`;
}

function tikzcdDomPointerDragExpression(fromRow, fromColumn, toRow, toColumn, pointerId) {
  return `(() => {
    const source = document.querySelector('[data-tikzcd-editor-node="${fromRow}:${fromColumn}"]');
    const target = document.querySelector(
      '[data-tikzcd-editor-row="${toRow}"][data-tikzcd-editor-column="${toColumn}"]'
    );
    if (!(source instanceof Element) || !(target instanceof Element)) {
      return { dispatched: false, previewHasMarker: false, previewMarkerVisible: false };
    }
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const from = {
      x: sourceBox.left + sourceBox.width / 2,
      y: sourceBox.top + sourceBox.height / 2,
    };
    const to = {
      x: targetBox.left + targetBox.width / 2,
      y: targetBox.top + targetBox.height / 2,
    };
    const init = (type, x, y, buttons) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons,
      pointerId: ${pointerId},
      pointerType: "mouse",
      isPrimary: true,
      clientX: x,
      clientY: y,
    });
    source.dispatchEvent(init("pointerdown", from.x, from.y, 1));
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8;
      window.dispatchEvent(init(
        "pointermove",
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        1,
      ));
    }
    const preview = document.querySelector(".texleaf-tikzcd-editor-drag-line");
    const markerPath = document.querySelector(
      '.texleaf-tikzcd-editor-arrows marker[id^="texleaf-tikzcd-drag-marker-"] path'
    );
    const markerStyle = markerPath === null ? undefined : getComputedStyle(markerPath);
    const previewHasMarker = preview?.getAttribute("marker-end")?.startsWith("url(") === true;
    const previewMarkerVisible = markerStyle !== undefined &&
      markerStyle.stroke !== "none" &&
      markerStyle.stroke !== "transparent" &&
      markerStyle.stroke !== "rgba(0, 0, 0, 0)";
    window.dispatchEvent(init("pointerup", to.x, to.y, 0));
    return { dispatched: true, previewHasMarker, previewMarkerVisible };
  })()`;
}

function setTikzcdNodeInputExpression(value) {
  return `(() => {
    const input = document.querySelector(".texleaf-tikzcd-selection-panel .texleaf-tikzcd-node-input");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
    return true;
  })()`;
}

function setTikzcdArrowLabelExpression(value) {
  return `(() => {
    const input = document.querySelector(".texleaf-tikzcd-selection-panel .texleaf-tikzcd-label-input");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
    return true;
  })()`;
}

function setTikzcdFieldExpression(label, value) {
  return `(() => {
    const field = [...document.querySelectorAll(".texleaf-tikzcd-selection-panel .texleaf-tikzcd-field")]
      .find((item) => item.childNodes[0]?.textContent === ${JSON.stringify(label)});
    const control = field?.querySelector("select, input");
    if (!(control instanceof HTMLSelectElement || control instanceof HTMLInputElement)) return false;
    control.value = ${JSON.stringify(value)};
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
}

function tikzcdPreviewStateExpression() {
  return `(() => {
    const card = document.querySelector(".texleaf-tikzcd-card");
    const visibleLines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    const originalSourceVisible = visibleLines.some((line) =>
      /(^|\\s)A\\s*&\\s*&\\s*B(?:\\s|$)/u.test(line) && !line.includes("A_0")
    );
    const editedSourceVisible = visibleLines.some((line) =>
      /(^|\\s)A_0(?:\\s|\\\\|&|$)/u.test(line)
    );
    if (card === null) return {
      present: false,
      exactLocalPreview: false,
      nodes: 0,
      arrows: 0,
      hasEditedNode: editedSourceVisible,
      originalSourceVisible,
      editedSourceVisible,
      visibleLines: visibleLines.filter((line) => /A_0|&&|tikzcd/u.test(line)).slice(0, 12),
      activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
    };
    card.scrollIntoView({ block: "center", inline: "nearest" });
    const paths = [...card.querySelectorAll("[data-tikzcd-arrow]")];
    const exactLocalPreview = card.querySelector(
      'svg[aria-label="tikz-cd 交换图的本地 TeX 精确预览"]'
    ) !== null;
    const modelSource = card.dataset.texleafTikzcdSource ?? "";
    const modelHasEditedNode = /(^|\\s|[{}&])A_0(?:\\s|\\\\|&|[{}]|$)/u.test(modelSource);
    const edited = paths.find((path) =>
      path.getAttribute("stroke-dasharray") === "1.5 4" && /Q/u.test(path.getAttribute("d") ?? "")
    );
    return {
      present: true,
      exactLocalPreview,
      nodes: card.querySelectorAll(".texleaf-tikzcd-node:not(.texleaf-tikzcd-node-empty)").length,
      arrows: paths.length,
      hasEditedNode: modelHasEditedNode ||
        card.querySelector('[data-tikzcd-source="A_0"]') !== null,
      originalSourceVisible,
      editedSourceVisible,
      editedLineStyle: edited?.getAttribute("stroke-dasharray") ?? "",
      editedPath: edited?.getAttribute("d") ?? "",
    };
  })()`;
}

function clickStructureActionExpression(label) {
  return `(() => {
    const button = [...document.querySelectorAll(".texleaf-visual-structure-editor button")]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    button?.click();
    return button !== undefined;
  })()`;
}

function lineExpression(needle) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")].find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    if (line === undefined) return undefined;
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const lineBox = line.getBoundingClientRect();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null && (node.textContent?.length ?? 0) === 0) node = walker.nextNode();
    let target = lineBox;
    if (node !== null) {
      const range = document.createRange();
      range.selectNodeContents(node);
      target = range.getClientRects()[0] ?? range.getBoundingClientRect();
    }
    return {
      text: line.textContent ?? "",
      point: {
        x: Math.max(target.left + 2, Math.min(target.right - 2, target.left + target.width * 0.55)),
        y: target.top + target.height / 2,
      },
      lineRect: { top: lineBox.top, bottom: lineBox.bottom, height: lineBox.height },
    };
  })()`;
}

function exactLineExpression(value) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(value)});
    if (line === undefined) return undefined;
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const box = line.getBoundingClientRect();
    return {
      text: line.textContent ?? "",
      point: { x: Math.max(box.left + 3, box.right - 3), y: box.top + box.height / 2 },
      lineRect: { top: box.top, bottom: box.bottom, height: box.height },
    };
  })()`;
}

function visualRenderErrorStateExpression(probeNeedle) {
  return `(() => {
    const tooltip = document.querySelector(".texleaf-math-preview-tooltip");
    const tooltipSvg = tooltip?.querySelector("svg");
    const lines = [...document.querySelectorAll(".cm-line")];
    const line = lines.find((candidate) =>
      (candidate.textContent ?? "").includes(${JSON.stringify(probeNeedle)})
    );
    const widget = line?.querySelector(".texleaf-formula-widget");
    const widgetSvg = widget?.querySelector("svg");
    const allSvgText = [tooltipSvg?.textContent ?? "", widgetSvg?.textContent ?? ""].join(" ");
    const svgHtml = ((tooltipSvg?.outerHTML ?? "") + " " +
      (widgetSvg?.outerHTML ?? "")).toLowerCase();
    return {
      tooltipError: tooltip?.classList.contains("texleaf-math-preview-tooltip-error") === true,
      tooltipSvgErrorMarker: tooltipSvg?.getAttribute("data-texleaf-preview-error") === "true",
      tooltipAria: tooltip?.getAttribute("aria-label") ?? "",
      widgetError: widget?.classList.contains("texleaf-formula-widget-error") === true,
      widgetSvgErrorMarker: widgetSvg?.getAttribute("data-texleaf-preview-error") === "true",
      widgetAria: widget?.getAttribute("aria-label") ?? "",
      formulaSource: line?.textContent ?? "",
      redTokenPresent: /texleafDefinitelyUnknown/u.test(allSvgText) && svgHtml.includes("#ff4d64"),
    };
  })()`;
}

function lineTextExpression(needle) {
  return `(() => [...document.querySelectorAll(".cm-line")]
    .find((item) => item.textContent?.includes(${JSON.stringify(needle)}))?.textContent ?? "")()`;
}

function bibliographySourceExpression() {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const lineTexts = lines.map((line) => line.textContent?.trim() ?? "");
    const active = document.querySelector(".cm-activeLine")?.textContent?.trim() ?? "";
    return {
      styleVisible: lineTexts.some((line) => line.startsWith("\\\\bibliographystyle{")),
      resourceVisible: lineTexts.some((line) =>
        line.startsWith("\\\\bibliography{") || line.startsWith("\\\\printbibliography")
      ),
      activeOnSourceLine: /^\\\\(?:addcontentsline|bibliographystyle|bibliography|printbibliography|nocite)/u.test(active),
      active,
      visibleSourceLines: lineTexts.filter((line) =>
        /^\\\\(?:addcontentsline|bibliographystyle|bibliography|printbibliography|nocite)/u.test(line)
      ),
    };
  })()`;
}

function formulaWidgetInLineExpression(needle) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    const formula = line?.querySelector(".texleaf-formula-widget-inline, .texleaf-formula-widget-block");
    if (!(formula instanceof HTMLElement)) return undefined;
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const box = formula.getBoundingClientRect();
    return {
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      text: line.textContent ?? "",
    };
  })()`;
}

function editorTextExpression() {
  return `(() => document.querySelector(".cm-content")?.textContent ?? "")()`;
}

function codeMirrorSyntaxDiagnosticsExpression() {
  return `(() => {
    const content = document.querySelector(".cm-content");
    const internal = content?.cmView;
    const state = internal?.view?.state ?? internal?.rootView?.view?.state;
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => ({
        text: line.textContent ?? "",
        className: line.className,
        color: getComputedStyle(line).color,
        spans: [...line.querySelectorAll("span")].map((span) => ({
          text: span.textContent ?? "",
          className: span.className,
          style: span.getAttribute("style") ?? "",
          color: getComputedStyle(span).color,
        })),
      }))
      .filter((line) =>
        line.text.includes("equation") ||
        line.text.includes("mathcal") ||
        line.text.includes("Completion probes") ||
        line.text.includes("eqref")
      );
    return {
      internalKeys: internal === undefined ? [] : Object.keys(internal),
      stateText: state?.doc?.toString?.() ?? "",
      lines,
    };
  })()`;
}

function incrementalSyntaxLineExpression(value) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => (item.textContent ?? "").includes(${JSON.stringify(value)}));
    if (!(line instanceof HTMLElement)) return { present: false, spans: [] };
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const lineColor = getComputedStyle(line).color;
    const spans = [...line.querySelectorAll(
      '.texleaf-native-syntax-token, [class*="tok-"]'
    )].map((span) => ({
      text: span.textContent ?? "",
      className: span.className,
      color: getComputedStyle(span).color,
    }));
    return {
      present: true,
      text: line.textContent ?? "",
      lineColor,
      spans,
      nativeTokenCount: line.querySelectorAll(".texleaf-native-syntax-token").length,
      optimisticTokenCount: line.querySelectorAll(".texleaf-native-syntax-optimistic").length,
      hasLiveSyntaxColor: spans.some((span) => span.color !== lineColor),
    };
  })()`;
}

function installIncrementalSyntaxColorProbeExpression(value) {
  return `(() => {
    globalThis.__texleafSyntaxColorProbe?.observer?.disconnect?.();
    globalThis.__texleafSyntaxColorProbe?.stop?.();
    const expected = ${JSON.stringify(value)};
    const samples = [];
    let active = true;
    const sample = () => {
      const line = [...document.querySelectorAll(".cm-line")]
        .find((item) => (item.textContent ?? "").includes(expected));
      if (!(line instanceof HTMLElement)) return;
      const lineColor = getComputedStyle(line).color;
      const tokens = [...line.querySelectorAll(
        '.texleaf-native-syntax-token, [class*="tok-"]'
      )];
      const tokenColors = [...new Set(tokens.map((token) => getComputedStyle(token).color))];
      samples.push({
        tokenCount: tokens.length,
        optimisticTokenCount: line.querySelectorAll(".texleaf-native-syntax-optimistic").length,
        styled: tokenColors.some((color) => color !== lineColor),
        lineColor,
        tokenColors,
      });
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const frame = () => {
      if (!active) return;
      sample();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    globalThis.__texleafSyntaxColorProbe = {
      observer,
      samples,
      stop() {
        active = false;
        observer.disconnect();
      },
    };
    return { installed: true };
  })()`;
}

function sampleIncrementalSyntaxColorProbeExpression(frames) {
  return `(async () => {
    const probe = globalThis.__texleafSyntaxColorProbe;
    if (probe === undefined) return { installed: false, unstyledFrames: -1 };
    for (let frame = 0; frame < ${Number(frames)}; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    probe.stop();
    const samples = probe.samples;
    return {
      installed: true,
      sampleCount: samples.length,
      optimisticFrames: samples.filter((sample) => sample.optimisticTokenCount > 0).length,
      authoritativeFrames: samples.filter((sample) =>
        sample.tokenCount > 0 && sample.optimisticTokenCount === 0).length,
      unstyledFrames: samples.filter((sample) => !sample.styled).length,
      samples: samples.slice(0, 24),
    };
  })()`;
}

function visualCommittedFormulaStateExpression(needle, expectedSourcePart) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => (item.textContent ?? "").includes(${JSON.stringify(needle)}));
    const widget = line?.querySelector(".texleaf-formula-widget");
    const source = widget instanceof HTMLElement ? widget.dataset.formulaSource ?? "" : "";
    return {
      present: widget instanceof HTMLElement,
      svgPresent: widget?.querySelector("svg") !== null && widget?.querySelector("svg") !== undefined,
      source,
      sourceIncludesExpected: source.includes(${JSON.stringify(expectedSourcePart)}),
      tooltipPresent: document.querySelector(".texleaf-math-preview-tooltip") !== null,
    };
  })()`;
}

function pairedEnvironmentBoundaryStateExpression(environment) {
  const beginPrefix = `\\begin{${environment}}`;
  const endText = `\\end{${environment}}`;
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const begin = lines.find((line) =>
      (line.textContent ?? "").trim().startsWith(${JSON.stringify(beginPrefix)}));
    const end = lines.find((line) =>
      (line.textContent ?? "").trim() === ${JSON.stringify(endText)});
    const active = document.querySelector(".cm-line.cm-activeLine");
    const selection = window.getSelection();
    const anchorElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const caretLine = anchorElement?.closest(".cm-line") ?? active;
    const preview = [...document.querySelectorAll(".texleaf-proof-begin, .texleaf-theorem-proof")]
      .find((element) => (element.textContent ?? "").includes("Proof"));
    return {
      beginVisible: begin instanceof HTMLElement && begin.getClientRects().length > 0,
      endVisible: end instanceof HTMLElement && end.getClientRects().length > 0,
      activeBegin: caretLine === begin,
      activeEnd: caretLine === end,
      activeText: caretLine?.textContent ?? "",
      previewVisible: preview instanceof HTMLElement && preview.getClientRects().length > 0,
    };
  })()`;
}

function proofEndBoundaryPointExpression() {
  return `(() => {
    const end = document.querySelector(".texleaf-theorem-end.texleaf-theorem-proof");
    if (!(end instanceof HTMLElement)) return undefined;
    end.scrollIntoView({ block: "center", inline: "nearest" });
    const line = end.closest(".cm-line") ?? end.parentElement;
    const box = (line instanceof HTMLElement ? line : end).getBoundingClientRect();
    return {
      point: {
        x: Math.max(box.left + 8, Math.min(box.right - 8, box.left + box.width * 0.62)),
        y: box.top + box.height / 2,
      },
    };
  })()`;
}

function collapsedEnvironmentBeginBoundaryPointExpression(label) {
  return `(() => {
    const header = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => (item.textContent ?? "").trim().startsWith(${JSON.stringify(label)}));
    if (!(header instanceof HTMLElement)) return undefined;
    header.scrollIntoView({ block: "center", inline: "nearest" });
    const headerBox = header.getBoundingClientRect();
    const lines = [...document.querySelectorAll(".cm-line")]
      .filter((line) => line instanceof HTMLElement)
      .map((line) => ({ line, box: line.getBoundingClientRect() }))
      .filter(({ box }) => box.bottom <= headerBox.top + 1)
      .sort((left, right) => right.box.bottom - left.box.bottom);
    const boundary = lines[0];
    if (boundary === undefined) return undefined;
    return {
      text: boundary.line.textContent ?? "",
      point: {
        x: Math.max(boundary.box.left + 8, Math.min(boundary.box.right - 8, boundary.box.left + 24)),
        y: boundary.box.top + boundary.box.height / 2,
      },
    };
  })()`;
}

function collapsedLogicalLinePointExpression(lineNumber) {
  return `(() => {
    const gutter = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
      .find((item) => (item.textContent ?? "").trim() === ${JSON.stringify(String(lineNumber))});
    const content = document.querySelector(".cm-content");
    if (!(gutter instanceof HTMLElement) || !(content instanceof HTMLElement)) return undefined;
    gutter.scrollIntoView({ block: "center", inline: "nearest" });
    const gutterBox = gutter.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    return {
      text: gutter.textContent ?? "",
      point: {
        x: Math.max(contentBox.left + 8, Math.min(contentBox.right - 8, contentBox.left + 24)),
        y: gutterBox.top + gutterBox.height / 2,
      },
    };
  })()`;
}

function activeLogicalLineStateExpression() {
  return `(() => {
    const activeLine = document.querySelector(".cm-line.cm-activeLine");
    const activeGutter = document.querySelector(".cm-lineNumbers .cm-gutterElement.cm-activeLineGutter");
    const visibleLineStartsWith = (prefix) => [...document.querySelectorAll(".cm-line")]
      .some((line) =>
        (line.textContent ?? "").trim().startsWith(prefix) &&
        line.getClientRects().length > 0);
    return {
      activeText: activeLine?.textContent ?? "",
      activeGutter: activeGutter?.textContent?.trim() ?? "",
      alignStarBeginVisible: visibleLineStartsWith("\\\\begin{align*}"),
      lemmaBeginVisible: visibleLineStartsWith("\\\\begin{lemma}"),
      proofBeginVisible: visibleLineStartsWith("\\\\begin{proof}"),
    };
  })()`;
}

function sourceLineNumberForNeedle(source, needle) {
  const offset = source.indexOf(needle);
  assert.ok(offset >= 0, `source needle missing: ${needle}`);
  return 1 + (source.slice(0, offset).match(/\n/gu) ?? []).length;
}

function theoremLayoutExpression(label, previousText, bodyText) {
  return `(() => {
    const headers = [...document.querySelectorAll(".texleaf-theorem-begin-block")];
    const header = headers.find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    const lines = [...document.querySelectorAll(".cm-line")];
    const previous = lines.find((item) => item.textContent?.includes(${JSON.stringify(previousText)}));
    const body = lines.find((item) => item.textContent?.includes(${JSON.stringify(bodyText)}));
    if (header === undefined || previous === undefined || body === undefined) return undefined;
    const box = (element) => {
      const value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, height: value.height };
    };
    header.scrollIntoView({ block: "center", inline: "nearest" });
    return { header: box(header), previous: box(previous), body: box(body), text: header.textContent ?? "" };
  })()`;
}

function theoremNestedListBorderExpression(label) {
  return `(() => {
    const header = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    if (!(header instanceof HTMLElement)) return { present: false, boundaries: [] };
    header.scrollIntoView({ block: "center", inline: "nearest" });
    const headerBox = header.getBoundingClientRect();
    const boundaries = [...document.querySelectorAll(".texleaf-theorem-list-boundary")]
      .filter((item) => header.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)
      .slice(0, 2)
      .map((item) => {
        const box = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
        };
      });
    return {
      present: true,
      header: { left: headerBox.left, right: headerBox.right },
      boundaries,
    };
  })()`;
}

function transparentWrapperStateExpression() {
  return `(() => {
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "");
    const sourceLines = [...document.querySelectorAll(".cm-line")]
      .map((line) => {
        const clone = line.cloneNode(true);
        clone.querySelectorAll(".texleaf-transparent-wrapper-edit-chip")
          .forEach((chip) => chip.remove());
        return clone.textContent ?? "";
      });
    const chips = [...document.querySelectorAll(".texleaf-transparent-wrapper-edit-chip")];
    const smallChip = chips.find((chip) => chip.textContent?.includes("编辑 \\\\small"));
    const subequationsChip = chips.find((chip) => chip.textContent?.includes("编辑 subequations"));
    const formulas = [...document.querySelectorAll(".texleaf-formula-widget-block")];
    const smallFormula = smallChip === undefined
      ? undefined
      : formulas.find((formula) =>
          (smallChip.compareDocumentPosition(formula) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
          (subequationsChip === undefined ||
            (formula.compareDocumentPosition(subequationsChip) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
        );
    const editor = document.querySelector(".cm-content");
    const editorFontSize = editor === null ? "" : getComputedStyle(editor).fontSize;
    const formulaFontSize = smallFormula === undefined ? "" : getComputedStyle(smallFormula).fontSize;
    return {
      smallChip: smallChip !== undefined,
      subequationsChip: subequationsChip !== undefined,
      rawSmall: sourceLines.some((line) => line.includes("\\\\small")),
      rawSmallClose: sourceLines.some((line) => line.trim() === "}"),
      rawSubequationsBegin: sourceLines.some((line) => line.includes("\\\\begin{subequations}")),
      rawSubequationsEnd: sourceLines.some((line) => line.includes("\\\\end{subequations}")),
      formulaCount: formulas.length,
      editorFontSize,
      formulaFontSize,
      smallFormulaScaled: smallFormula instanceof HTMLElement &&
        (smallFormula.style.transform.includes("scale") ||
          (editorFontSize.length > 0 && formulaFontSize !== editorFontSize)),
      lines,
    };
  })()`;
}

function formulaAfterTransparentWrapperExpression(label) {
  return `(() => {
    const chip = [...document.querySelectorAll(".texleaf-transparent-wrapper-edit-chip")]
      .find((item) => item.textContent?.includes(${JSON.stringify(label)}));
    if (!(chip instanceof HTMLElement)) return undefined;
    const formula = [...document.querySelectorAll(".texleaf-formula-widget-block")]
      .find((item) =>
        (chip.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    if (!(formula instanceof HTMLElement)) return undefined;
    formula.scrollIntoView({ block: "center", inline: "nearest" });
    const box = formula.getBoundingClientRect();
    return {
      text: formula.textContent ?? "",
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
    };
  })()`;
}

function theoremContinuousBorderExpression(label) {
  return `(() => {
    const header = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    if (!(header instanceof HTMLElement)) {
      const scroller = document.querySelector(".cm-scroller");
      if (scroller instanceof HTMLElement) {
        const root = document.documentElement;
        const scanTop = Number(root.dataset.texleafTheoremBorderScanTop ?? "0");
        scroller.scrollTop = Math.min(scroller.scrollHeight, scanTop);
        const nextTop = scanTop + Math.max(240, scroller.clientHeight * 0.75);
        root.dataset.texleafTheoremBorderScanTop = String(
          nextTop > scroller.scrollHeight ? 0 : nextTop,
        );
        scroller.dispatchEvent(new Event("scroll"));
      }
      return { present: false, segments: [], gaps: [], unframedLines: [] };
    }
    header.scrollIntoView({ block: "center", inline: "nearest" });
    const followsHeader = (item) =>
      item === header || Boolean(header.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
    const end = [...document.querySelectorAll(".texleaf-theorem-end")]
      .filter((item) => followsHeader(item))
      .sort((left, right) =>
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )[0];
    if (!(end instanceof HTMLElement)) {
      return { present: false, segments: [], gaps: [], unframedLines: [] };
    }
    const beforeEnd = (item) =>
      item === end || Boolean(item.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING);
    const box = (item) => {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return {
        className: item.className,
        text: (item.textContent ?? "").trim().slice(0, 120),
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
      };
    };
    const segmentSelector = [
      ".texleaf-theorem-begin-block",
      ".cm-line.texleaf-theorem-line",
      ".texleaf-theorem-formula-shell",
      ".texleaf-theorem-list-boundary",
      ".texleaf-theorem-formula-shell:not(.texleaf-theorem-proof) + .cm-line:not(.texleaf-theorem-line)",
      ".texleaf-list-boundary.texleaf-theorem-list-boundary:not(.texleaf-theorem-proof) + .cm-line:not(.texleaf-theorem-line)",
      ".texleaf-theorem-end",
    ].join(",");
    const segments = [...document.querySelectorAll(segmentSelector)]
      .filter((item) => followsHeader(item) && beforeEnd(item))
      .map(box)
      .filter((item) => item.bottom > item.top)
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const gaps = [];
    let coveredBottom = segments[0]?.bottom ?? 0;
    for (let index = 1; index < segments.length; index += 1) {
      const current = segments[index];
      if (current.top > coveredBottom + 0.75) {
        gaps.push({ top: coveredBottom, bottom: current.top, height: current.top - coveredBottom });
      }
      coveredBottom = Math.max(coveredBottom, current.bottom);
    }
    const unframedLines = [...document.querySelectorAll(".cm-line:not(.texleaf-theorem-line)")]
      .filter((item) => followsHeader(item) && beforeEnd(item))
      .map((item) => ({
        ...box(item),
        parentClassName: item.parentElement?.className ?? "",
        previousClassName: item.previousElementSibling?.className ?? "",
        nextClassName: item.nextElementSibling?.className ?? "",
        parentChildren: [...(item.parentElement?.children ?? [])].map((child) => child.className),
      }))
      .filter((item) => item.bottom > segments[0].top && item.top < segments.at(-1).bottom);
    return {
      present: true,
      segments,
      gaps,
      unframedLines,
      header: box(header),
      end: box(end),
    };
  })()`;
}

function formulaLabelRowsExpression(keys) {
  return `(() => {
    const keys = ${JSON.stringify(keys)};
    const chips = keys.map((key) => [...document.querySelectorAll(".texleaf-formula-label-chip")]
      .find((item) => item.textContent?.includes(key)));
    if (chips.some((chip) => !(chip instanceof HTMLElement))) {
      return { present: false, entries: [] };
    }
    chips[0].scrollIntoView({ block: "center", inline: "nearest" });
    return {
      present: true,
      entries: chips.map((chip, index) => {
        const box = chip.getBoundingClientRect();
        const formula = chip.closest(".texleaf-formula-layout")
          ?.querySelector(".texleaf-formula-scroll");
        const formulaBox = formula?.getBoundingClientRect();
        return {
          key: keys[index],
          row: Number(chip.closest(".texleaf-formula-label-row")?.dataset.texleafFormulaRow),
          centerY: box.top + box.height / 2,
          chipLeft: box.left,
          formulaRight: formulaBox?.right ?? Number.NaN,
        };
      }),
    };
  })()`;
}

function theoremHeaderExpression(label) {
  return `(() => {
    const element = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    if (element === undefined) return undefined;
    element.scrollIntoView({ block: "center" });
    const box = element.getBoundingClientRect();
    return { text: element.textContent ?? "", point: { x: box.left + box.width / 2, y: box.top + box.height / 2 } };
  })()`;
}

function inlineFormulaInLineExpression(needle, formulaIndex = 0) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    const widget = line?.querySelectorAll(".texleaf-formula-widget-inline")
      [${Number(formulaIndex)}];
    const svg = widget?.querySelector("svg");
    if (!(line instanceof HTMLElement) ||
        !(widget instanceof HTMLElement) ||
        !(svg instanceof SVGElement)) {
      return undefined;
    }
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const widgetBox = widget.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    return {
      point: { x: svgBox.left + svgBox.width / 2, y: svgBox.top + svgBox.height / 2 },
      from: Number(widget.dataset.formulaFrom),
      rect: {
        left: widgetBox.left,
        top: widgetBox.top,
        right: widgetBox.right,
        bottom: widgetBox.bottom,
        width: widgetBox.width,
        height: widgetBox.height,
      },
      lineRect: {
        left: lineBox.left,
        top: lineBox.top,
        right: lineBox.right,
        bottom: lineBox.bottom,
        width: lineBox.width,
        height: lineBox.height,
      },
    };
  })()`;
}

function formulaAfterTheoremExpression(label) {
  return `(() => {
    const header = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    if (header === undefined) return undefined;
    const headerBox = header.getBoundingClientRect();
    const roots = [...document.querySelectorAll(".texleaf-theorem-formula-shell .texleaf-formula-widget")]
      .map((root) => ({ root, box: root.getBoundingClientRect() }))
      .filter((entry) => entry.box.top >= headerBox.bottom - 1)
      .sort((left, right) => left.box.top - right.box.top);
    const entry = roots[0];
    if (entry === undefined) return undefined;
    const root = entry.root;
    const shell = root.closest(".texleaf-theorem-formula-shell");
    if (shell === null) return undefined;
    shell.scrollIntoView({ block: "center", inline: "nearest" });
    const shellBox = shell.getBoundingClientRect();
    const svgBox = root.querySelector("svg")?.getBoundingClientRect() ?? entry.box;
    const point = { x: svgBox.left + svgBox.width / 2, y: svgBox.top + svgBox.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    const lines = [...document.querySelectorAll(".cm-line.texleaf-theorem-line, .texleaf-theorem-end, .texleaf-theorem-begin-block")]
      .map((element) => ({ element, box: element.getBoundingClientRect() }));
    const previous = lines.filter((item) => item.box.bottom <= shellBox.top + 1)
      .sort((left, right) => right.box.bottom - left.box.bottom)[0];
    const next = lines.filter((item) => item.box.top >= shellBox.bottom - 1)
      .sort((left, right) => left.box.top - right.box.top)[0];
    const style = getComputedStyle(shell);
    return {
      from: Number(root.dataset.formulaFrom), point,
      hitOwnsFormula: hit?.closest?.(".texleaf-formula-widget") === root,
      marginTop: style.marginTop, marginBottom: style.marginBottom,
      borderLeftWidth: style.borderLeftWidth,
      previousGap: previous === undefined ? 9999 : shellBox.top - previous.box.bottom,
      nextGap: next === undefined ? 9999 : next.box.top - shellBox.bottom,
      rect: { top: shellBox.top, bottom: shellBox.bottom, height: shellBox.height },
    };
  })()`;
}

function formulaAfterLineExpression(needle) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.includes(${JSON.stringify(needle)}));
    if (!(line instanceof HTMLElement)) return undefined;
    const scroller = document.querySelector(".cm-scroller");
    if (scroller instanceof HTMLElement) {
      scroller.scrollLeft = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const lineBox = line.getBoundingClientRect();
    const entry = [...document.querySelectorAll(".texleaf-formula-widget")]
      .map((widget) => ({ widget, box: widget.getBoundingClientRect() }))
      .filter(({ box }) => box.top >= lineBox.bottom - 1 && box.height > 0)
      .sort((left, right) => left.box.top - right.box.top)[0];
    if (entry === undefined || !(entry.widget instanceof HTMLElement)) {
      return undefined;
    }
    entry.widget.scrollIntoView({ block: "center", inline: "nearest" });
    const box = entry.widget.getBoundingClientRect();
    const svgBox = entry.widget.querySelector("svg")?.getBoundingClientRect() ?? box;
    const visibleLeft = Math.max(0, svgBox.left);
    const visibleRight = Math.min(window.innerWidth, svgBox.right);
    const visibleTop = Math.max(0, svgBox.top);
    const visibleBottom = Math.min(window.innerHeight, svgBox.bottom);
    return {
      point: {
        x: visibleRight > visibleLeft
          ? visibleLeft + (visibleRight - visibleLeft) / 2
          : Math.max(4, Math.min(window.innerWidth - 4, svgBox.left + 4)),
        y: visibleBottom > visibleTop
          ? visibleTop + (visibleBottom - visibleTop) / 2
          : Math.max(4, Math.min(window.innerHeight - 4, svgBox.top + 4)),
      },
      rect: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
    };
  })()`;
}

function formulaByLabelExpression(key) {
  return `(() => {
    const chip = [...document.querySelectorAll(".texleaf-formula-label-chip")]
      .find((item) => item.textContent?.includes(${JSON.stringify(key)}));
    const widget = chip?.closest(".texleaf-formula-widget");
    const svg = widget?.querySelector("svg");
    if (!(widget instanceof HTMLElement) || !(svg instanceof SVGElement)) {
      return undefined;
    }
    widget.scrollIntoView({ block: "center", inline: "nearest" });
    const box = widget.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const widgetStyle = getComputedStyle(widget);
    const localScroll = widget.querySelector(".texleaf-formula-scroll");
    const localScrollStyle = localScroll instanceof HTMLElement
      ? getComputedStyle(localScroll)
      : undefined;
    const editorScroll = document.querySelector(".cm-scroller");
    const visibleTop = Math.max(0, box.top);
    const visibleBottom = Math.min(window.innerHeight, box.bottom);
    const content = document.querySelector(".cm-content");
    return {
      text: widget.textContent ?? "",
      from: Number(widget.dataset.formulaFrom),
      point: {
        x: box.left + box.width / 2,
        y: visibleBottom > visibleTop
          ? visibleTop + (visibleBottom - visibleTop) / 2
          : Math.max(4, Math.min(window.innerHeight - 4, box.top + 12)),
      },
      svgHeight: svgBox.height,
      svgMaxHeight: getComputedStyle(svg).maxHeight,
      widgetMaxHeight: widgetStyle.maxHeight,
      widgetOverflowX: widgetStyle.overflowX,
      widgetOverflowY: widgetStyle.overflowY,
      widgetScrollHeight: widget.scrollHeight,
      widgetClientHeight: widget.clientHeight,
      localOverflowX: localScrollStyle?.overflowX ?? "",
      localOverflowY: localScrollStyle?.overflowY ?? "",
      localScrollWidth: localScroll instanceof HTMLElement ? localScroll.scrollWidth : -1,
      localClientWidth: localScroll instanceof HTMLElement ? localScroll.clientWidth : -1,
      localScrollHeight: localScroll instanceof HTMLElement ? localScroll.scrollHeight : -1,
      localClientHeight: localScroll instanceof HTMLElement ? localScroll.clientHeight : -1,
      editorScrollWidth: editorScroll instanceof HTMLElement ? editorScroll.scrollWidth : -1,
      editorClientWidth: editorScroll instanceof HTMLElement ? editorScroll.clientWidth : -1,
      editorFontSize: Number.parseFloat(getComputedStyle(content ?? document.documentElement).fontSize),
    };
  })()`;
}

function openedFormulaExpression(from) {
  return `(() => ({
    widgetVisible: document.querySelector('[data-formula-from="${from}"]') !== null,
    activeLine: document.querySelector(".cm-activeLine")?.textContent ?? "",
  }))()`;
}

function caretExpression() {
  return `(() => {
    const cursor = document.querySelector(".cm-cursor-primary")?.getBoundingClientRect();
    const scroller = document.querySelector(".cm-scroller");
    const cursorCenter = cursor === undefined ? Number.NaN : cursor.top + cursor.height / 2;
    const lines = [...document.querySelectorAll(".cm-line")]
      .map((line) => ({ text: line.textContent ?? "", box: line.getBoundingClientRect() }));
    const nearest = lines.sort((left, right) =>
      Math.abs((left.box.top + left.box.bottom) / 2 - cursorCenter) -
      Math.abs((right.box.top + right.box.bottom) / 2 - cursorCenter))[0];
    return {
      cursor: cursor === undefined ? undefined : { top: cursor.top, height: cursor.height },
      activeLine: [...document.querySelectorAll(".cm-activeLine")]
        .map((line) => line.textContent ?? "").find((text) => text.length > 0) ?? "",
      nearestLine: nearest?.text ?? "",
      lineHeight: Number.parseFloat(getComputedStyle(scroller ?? document.documentElement).lineHeight),
    };
  })()`;
}

function visibleLineTextExpression(needle) {
  return `(() => [...document.querySelectorAll(".cm-line")]
    .find((item) => item.textContent?.includes(${JSON.stringify(needle)}))?.textContent ?? "")()`;
}

function imageStateExpression() {
  return `(() => {
    const card = document.querySelector(".texleaf-image-card");
    const image = card?.querySelector("img");
    return {
      present: card !== null,
      placeholder: card?.querySelector(".texleaf-image-placeholder") !== null,
      complete: image?.complete === true,
      naturalWidth: image?.naturalWidth ?? 0,
      naturalHeight: image?.naturalHeight ?? 0,
      src: image?.src ?? "",
    };
  })()`;
}

function localHorizontalScrollStateExpression(selector) {
  return `(() => {
    const viewport = document.querySelector(${JSON.stringify(selector)});
    if (!(viewport instanceof HTMLElement)) {
      return { present: false, localViewport: false, overflowX: "", scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
    }
    const previousWidth = viewport.style.width;
    const previousMaxWidth = viewport.style.maxWidth;
    viewport.style.width = "150px";
    viewport.style.maxWidth = "150px";
    void viewport.offsetWidth;
    viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const result = {
      present: true,
      localViewport: viewport.classList.contains("texleaf-structure-horizontal-scroll"),
      overflowX: getComputedStyle(viewport).overflowX,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
    };
    viewport.style.width = previousWidth;
    viewport.style.maxWidth = previousMaxWidth;
    return result;
  })()`;
}

function fontStateExpression(label) {
  return `(() => {
    const content = document.querySelector(".cm-content");
    const scroller = document.querySelector(".cm-scroller");
    const header = [...document.querySelectorAll(".texleaf-theorem-begin-block")]
      .find((item) => item.textContent?.trim().startsWith(${JSON.stringify(label)}));
    return {
      fontSize: getComputedStyle(content ?? document.documentElement).fontSize,
      lineHeight: getComputedStyle(scroller ?? document.documentElement).lineHeight,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
    };
  })()`;
}

function setFontExpression(fontSize, lineHeight) {
  return `(() => {
    document.body.style.setProperty("--vscode-editor-font-size", ${JSON.stringify(fontSize)});
    document.body.style.setProperty("--vscode-editor-line-height", ${JSON.stringify(lineHeight)});
    window.dispatchEvent(new Event("resize"));
    return true;
  })()`;
}

function clearFontExpression() {
  return `(() => {
    document.body.style.removeProperty("--vscode-editor-font-size");
    document.body.style.removeProperty("--vscode-editor-line-height");
    window.dispatchEvent(new Event("resize"));
    return true;
  })()`;
}

function sourceModeExpression() {
  return `(() => ({
    mode: document.querySelector("#editor")?.dataset.editorMode ?? "",
    href: location.href,
    formulaWidgets: document.querySelectorAll(".texleaf-formula-widget").length,
    structureWidgets: document.querySelectorAll(".texleaf-theorem-begin, .texleaf-table-card, .texleaf-image-card").length,
    modeButtonText: document.querySelector("#open-source .context-menu-label")?.textContent ?? "",
    nativeButtonPresent: document.querySelector("#open-native-source") !== null,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }))()`;
}

function sourceThemeExpression() {
  return `(() => {
    const tokens = [...document.querySelectorAll('[class*="tok-"]')].slice(0, 200);
    const allEntries = tokens.map((token) => ({
      className: token.className,
      text: token.textContent?.slice(0, 40) ?? "",
      color: getComputedStyle(token).color,
    }));
    const colors = [...new Set(allEntries.map((entry) => entry.color))];
    const entries = allEntries.filter((entry, index) =>
      allEntries.findIndex((candidate) => candidate.className === entry.className && candidate.color === entry.color) === index
    ).slice(0, 24);
    const rawSyntaxCommandColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--texleaf-syntax-command").trim();
    let syntaxCommandColor = "";
    if (rawSyntaxCommandColor.length > 0) {
      const probe = document.createElement("span");
      probe.style.color = rawSyntaxCommandColor;
      document.body.append(probe);
      syntaxCommandColor = getComputedStyle(probe).color;
      probe.remove();
    }
    return {
      tokenCount: tokens.length,
      colors,
      entries,
      commandColor: allEntries.find((entry) => entry.className.split(/\\s+/u).includes("tok-typeName"))?.color ?? "",
      syntaxCommandColor,
    };
  })()`;
}

function mathPreviewExpression() {
  return `(() => {
    const tooltip = document.querySelector(".texleaf-math-preview-tooltip");
    return { present: tooltip !== null, svgPresent: tooltip?.querySelector("svg") !== null };
  })()`;
}

async function locateTheorem(client, contextId, label, previous, body) {
  const expression = theoremLayoutExpression(label, previous, body);
  await locate(client, contextId, expression, `${label} layout`);
  await delay(100);
  return evaluate(client, contextId, expression);
}

async function clickLine(client, contextId, needle) {
  // A previous long-formula probe may leave the source scroller far to the
  // right. Restore the source text column before clicking an unrelated prose
  // line; Math Preview's off-screen-\begin fallback is asserted separately.
  await evaluate(
    client,
    contextId,
    `(() => {
      const scroller = document.querySelector(".cm-scroller");
      if (scroller === null) return false;
      scroller.scrollLeft = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      return true;
    })()`,
  );
  const located = await locate(
    client,
    contextId,
    lineExpression(needle),
    `line containing ${needle}`,
  );
  await delay(80);
  const refreshed = await evaluate(client, contextId, lineExpression(needle));
  await dispatchClick(client, refreshed.point);
  const caret = await waitFor(
    client,
    contextId,
    caretExpression(),
    (value) => value.cursor !== undefined &&
      (value.activeLine.includes(needle) || value.nearestLine.includes(needle)),
    `caret on ${needle}`,
  );
  return { ...located, ...refreshed, caret };
}

async function editAndRestoreLine(client, contextId, needle, insertion) {
  await clickLine(client, contextId, needle);
  await dispatchKey(client, "End", "End", 35);
  await client.request("Input.insertText", { text: insertion });
  const insertedText = await waitFor(
    client,
    contextId,
    visibleLineTextExpression(insertion),
    (value) => value.includes(insertion),
    "theorem-body insertion",
  );
  for (let index = 0; index < insertion.length; index += 1) {
    await dispatchKey(client, "Backspace", "Backspace", 8);
  }
  const restoredText = await waitFor(
    client,
    contextId,
    visibleLineTextExpression(needle),
    (value) => value.includes(needle) && !value.includes(insertion),
    "theorem-body restoration",
  );
  return {
    inserted: insertedText.includes(insertion),
    restored: restoredText.includes(needle) && !restoredText.includes(insertion),
  };
}

async function locate(client, contextId, expression, description) {
  await setScroll(client, contextId, 0);
  await delay(100);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const value = await evaluate(client, contextId, expression);
    if (value !== undefined) {
      return value;
    }
    const scroll = await evaluate(client, contextId, scrollStateExpression());
    const step = Math.max(80, scroll.height * 0.6);
    const next = Math.min(Math.max(0, scroll.scrollHeight - scroll.height), scroll.top + step);
    if (next <= scroll.top + 0.5) {
      break;
    }
    await setScroll(client, contextId, next);
    await delay(70);
  }
  const diagnostics = await evaluate(
    client,
    contextId,
    `(() => ({
      scroll: ${scrollStateExpression()},
      lines: [...document.querySelectorAll(".cm-line")].slice(0, 80).map((line) => line.textContent ?? ""),
    }))()`,
  );
  throw new Error(`Timed out locating ${description}: ${JSON.stringify(diagnostics)}`);
}

function scrollStateExpression() {
  return `(() => {
    const scroller = document.querySelector(".cm-scroller");
    return scroller === null ? { top: 0, height: 0, scrollHeight: 0 } : {
      top: scroller.scrollTop, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
    };
  })()`;
}

async function setScroll(client, contextId, top) {
  await evaluate(
    client,
    contextId,
    `(() => {
      const scroller = document.querySelector(".cm-scroller");
      if (scroller === null) return false;
      scroller.scrollTop = ${Number(top)};
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      return true;
    })()`,
  );
}

function assertNoOverlap(layout, label) {
  assert.ok(layout.previous.bottom <= layout.header.top + 1,
    `${label} 标题与上方正文重叠：${JSON.stringify(layout)}`);
  assert.ok(layout.header.bottom <= layout.body.top + 1,
    `${label} 标题与环境正文重叠：${JSON.stringify(layout)}`);
}

function assertBalancedMathPreviewInsets(state, label) {
  const padding = [
    state.paddingTop,
    state.paddingRight,
    state.paddingBottom,
    state.paddingLeft,
  ];
  const contentInsets = [
    state.contentInsetTop,
    state.contentInsetRight,
    state.contentInsetBottom,
    state.contentInsetLeft,
  ];
  assert.ok(
    padding.every(Number.isFinite) && Math.max(...padding) - Math.min(...padding) <= 1,
    `${label} CSS padding is not balanced: ${JSON.stringify(state)}`,
  );
  assert.ok(
    contentInsets.every(Number.isFinite) &&
      Math.max(...contentInsets) - Math.min(...contentInsets) <= 2 &&
      Math.min(...contentInsets) >= 7,
    `${label} rendered formula is not equally inset from all four edges: ${JSON.stringify(state)}`,
  );
}

function assertCaretNearClick(result, description) {
  const center = result.caret.cursor.top + result.caret.cursor.height / 2;
  const error = Math.abs(center - result.point.y);
  const tolerance = Math.max(12, result.caret.lineHeight * 0.72);
  assert.ok(error <= tolerance,
    `${description} 点击到光标误差 ${error.toFixed(2)}px，容许值 ${tolerance.toFixed(2)}px：${JSON.stringify(result)}`);
}

async function dispatchClick(client, point, modifiers = 0) {
  for (const event of [
    { type: "mouseMoved", buttons: 0 },
    { type: "mousePressed", button: "left", buttons: 1, clickCount: 1 },
    { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1 },
  ]) {
    await client.request("Input.dispatchMouseEvent", {
      ...event,
      x: point.x,
      y: point.y,
      modifiers,
    });
  }
}

async function dispatchMouseMove(client, point) {
  await client.request("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    buttons: 0,
  });
}

async function selectLineSubstring(client, contextId, lineText, prefixLength, selectionLength) {
  const target = await locate(
    client,
    contextId,
    lineSubstringDragExpression(lineText, prefixLength, selectionLength),
    `selection line ${lineText}`,
  );
  await dispatchDrag(client, target.from, target.to);
  await delay(80);
  const expected = lineText.slice(prefixLength, prefixLength + selectionLength);
  let selected = await evaluate(
    client,
    contextId,
    `document.getSelection()?.toString() ?? ""`,
  );
  if (selected !== expected) {
    // Chromium's synthetic pointer drag can land one glyph inside a token on
    // fractional-DPI hosts.  Set the same exact DOM range as a deterministic
    // CDP fallback; CodeMirror's DOM observer imports it into EditorState.
    selected = await evaluate(
      client,
      contextId,
      directLineSubstringSelectionExpression(lineText, prefixLength, selectionLength),
    );
    await delay(100);
  }
  assert.equal(selected, expected, `failed to select exact toolbar probe text: ${selected}`);
}

function directLineSubstringSelectionExpression(lineText, prefixLength, selectionLength) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(lineText)});
    const content = line?.closest(".cm-content");
    if (!(line instanceof HTMLElement) || !(content instanceof HTMLElement)) return "";
    const startOffset = ${Number(prefixLength)};
    const endOffset = startOffset + ${Number(selectionLength)};
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let startNode;
    let startInNode = 0;
    let endNode;
    let endInNode = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (startNode === undefined && startOffset >= consumed && startOffset <= consumed + length) {
        startNode = node;
        startInNode = startOffset - consumed;
      }
      if (endNode === undefined && endOffset >= consumed && endOffset <= consumed + length) {
        endNode = node;
        endInNode = endOffset - consumed;
        break;
      }
      consumed += length;
    }
    if (startNode === undefined || endNode === undefined) return "";
    const range = document.createRange();
    range.setStart(startNode, startInNode);
    range.setEnd(endNode, endInNode);
    content.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    return selection?.toString() ?? "";
  })()`;
}

function lineSubstringDragExpression(lineText, prefixLength, selectionLength) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(lineText)});
    if (!(line instanceof HTMLElement)) return undefined;
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const startOffset = ${Number(prefixLength)};
    const endOffset = startOffset + ${Number(selectionLength)};
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let startNode;
    let startInNode = 0;
    let endNode;
    let endInNode = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (startNode === undefined && startOffset >= consumed && startOffset <= consumed + length) {
        startNode = node;
        startInNode = startOffset - consumed;
      }
      if (endNode === undefined && endOffset >= consumed && endOffset <= consumed + length) {
        endNode = node;
        endInNode = endOffset - consumed;
        break;
      }
      consumed += length;
    }
    if (startNode === undefined || endNode === undefined) return undefined;
    const range = document.createRange();
    range.setStart(startNode, startInNode);
    range.setEnd(endNode, endInNode);
    const box = range.getBoundingClientRect();
    if (!(box.width > 2) || !(box.height > 0)) return undefined;
    return {
      from: { x: box.left + 1, y: box.top + box.height / 2 },
      to: { x: box.right - 1, y: box.top + box.height / 2 },
      text: range.toString(),
    };
  })()`;
}

async function dispatchDrag(client, from, to, modifiers = 0) {
  await client.request("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: from.x, y: from.y, buttons: 0, modifiers,
  });
  await client.request("Input.dispatchMouseEvent", {
    type: "mousePressed", x: from.x, y: from.y,
    button: "left", buttons: 1, clickCount: 1, modifiers,
  });
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await client.request("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      button: "left",
      buttons: 1,
      modifiers,
    });
  }
  await client.request("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: to.x, y: to.y,
    button: "left", buttons: 0, clickCount: 1, modifiers,
  });
}

async function dispatchKey(client, key, code, virtualKeyCode) {
  await client.request("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key, code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await client.request("Input.dispatchKeyEvent", {
    type: "keyUp", key, code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function dispatchModifiedKey(client, key, code, virtualKeyCode, modifiers) {
  await client.request("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key, code, modifiers,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await client.request("Input.dispatchKeyEvent", {
    type: "keyUp", key, code, modifiers: 0,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function waitFor(client, contextId, expression, predicate, description) {
  const deadline = Date.now() + 10_000;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(client, contextId, expression);
    if (last !== undefined && predicate(last)) {
      return last;
    }
    await delay(60);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

async function runRapidFormulaScrollChecks(client, contextId) {
  await waitFor(
    client,
    contextId,
    rapidFormulaViewportSnapshotExpression(),
    (value) => value?.ready === true && value.maxScroll > 1_000,
    "long visual-editor formula document",
  );
  const targets = [0.9, 0.55, 0.82, 0.68];
  const results = [];
  for (const target of targets) {
    const movement = await evaluate(
      client,
      contextId,
      `(async () => {
        const scroller = document.querySelector(".cm-scroller");
        if (!(scroller instanceof HTMLElement)) return { error: "missing scroller" };
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const start = scroller.scrollTop;
        const finish = maximum * ${target};
        for (let step = 1; step <= 18; step += 1) {
          const progress = step / 18;
          scroller.scrollTop = start + (finish - start) * progress;
          scroller.dispatchEvent(new Event("scroll"));
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return { start, finish, actual: scroller.scrollTop, maximum };
      })()`,
    );
    assert.equal(movement?.error, undefined, JSON.stringify(movement));
    const settled = await waitFor(
      client,
      contextId,
      rapidFormulaViewportSnapshotExpression(),
      (value) =>
        value?.visibleStressLines > 0 &&
        value.visibleStressFormulaWidgets > 0 &&
        value.rawStressFormulaLines === 0,
      `rapid-scroll formula settlement at ${Math.round(target * 100)}%`,
    );
    results.push({ target, movement, settled });
  }
  return { targets, results };
}

function rapidFormulaViewportSnapshotExpression() {
  return `(() => {
    const scroller = document.querySelector(".cm-scroller");
    const content = document.querySelector(".cm-content");
    if (!(scroller instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return { ready: false };
    }
    const viewport = scroller.getBoundingClientRect();
    const intersects = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
    };
    const visibleLines = [...content.querySelectorAll(".cm-line")].filter(intersects);
    const stressLines = visibleLines.filter((line) =>
      /(?:Stress paragraph|mathematics)/u.test(line.textContent ?? "")
    );
    const rawStressLines = stressLines.filter((line) =>
      (line.textContent ?? "").includes(String.raw\`\\(x_{\`)
    );
    const stressWidgets = [...content.querySelectorAll(".texleaf-formula-widget-inline")]
      .filter((widget) =>
        intersects(widget) &&
        (widget.dataset.formulaSource ?? "").includes(String.raw\`\\(x_{\`)
      );
    return {
      ready: true,
      scrollTop: scroller.scrollTop,
      maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      visibleStressLines: stressLines.length,
      visibleStressFormulaWidgets: stressWidgets.length,
      rawStressFormulaLines: rawStressLines.length,
      rawSamples: rawStressLines.slice(0, 4).map((line) => line.textContent ?? ""),
    };
  })()`;
}

async function runLogicalLineNavigationChecks(client, contextId) {
  const softWrapNeedle = "Soft-wrapped Math Preview probe:";
  await waitFor(
    client,
    contextId,
    `(() => [...document.querySelectorAll(".cm-line")].some((line) =>
      (line.textContent ?? "").includes(${JSON.stringify(softWrapNeedle)})
    ))()`,
    Boolean,
    "visual editor source lines",
  );
  const initial = await evaluate(
    client,
    contextId,
    setLogicalCaretExpression(softWrapNeedle, 140),
  );
  assert.equal(initial.installed, true, JSON.stringify(initial));
  const wrapped = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) => value.lineNumber === initial.lineNumber && value.lineHeight > value.baseLineHeight * 1.5,
    "soft-wrapped logical source line",
  );

  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  const blankBelow = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) => value.lineNumber === initial.lineNumber + 1,
    "one logical line below a wrapped source line",
  );
  assert.equal(blankBelow.lineText, "");

  await dispatchKey(client, "ArrowUp", "ArrowUp", 38);
  const wrappedAgain = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) => value.lineNumber === initial.lineNumber && value.sourceColumn === 140,
    "sticky source column after traversing a short line",
  );
  assert.equal(wrappedAgain.sourceColumn, 140);

  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  const inlineFormula = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) => value.lineNumber === initial.lineNumber + 2 && value.activeFormulaSegments > 0,
    "complete inline formula at the sticky target column",
  );
  assert.match(inlineFormula.lineText, /Complex cursor preview probe/u);
  assert.ok(inlineFormula.activeFormulaFrom < inlineFormula.head);
  assert.ok(inlineFormula.head < inlineFormula.activeFormulaTo);

  const beforeDefinition = await evaluate(
    client,
    contextId,
    setLogicalCaretExpression("BEQ", 3),
  );
  assert.equal(beforeDefinition.installed, true, JSON.stringify(beforeDefinition));
  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  const definitionBoundary = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) =>
      value.lineNumber === beforeDefinition.lineNumber + 2 &&
      value.visibleSourceLines.some((line) => line.includes(String.raw`\begin{definition}[Stable flag]`)) &&
      value.visibleSourceLines.some((line) => line.includes(String.raw`\end{definition}`)),
    "paired environment source boundaries",
  );

  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  await dispatchKey(client, "ArrowDown", "ArrowDown", 40);
  const displayBody = await waitFor(
    client,
    contextId,
    logicalLineNavigationStateExpression(),
    (value) =>
      value.lineNumber === definitionBoundary.lineNumber + 3 &&
      value.activeFormulaLines.some((line) => line.includes(String.raw`\begin{equation}`)) &&
      value.activeFormulaLines.some((line) => line.includes(String.raw`F^1 \subset F^2`)) &&
      value.activeFormulaLines.some((line) => line.includes(String.raw`\end{equation}`)),
    "whole multiline display formula while moving by its source lines",
  );

  return {
    wrapped,
    blankBelow,
    wrappedAgain,
    inlineFormula,
    displayBody,
    definitionBoundary,
  };
}

function setLogicalCaretExpression(needle, sourceColumn) {
  return `(() => {
    const line = [...document.querySelectorAll(".cm-line")].find((candidate) =>
      (candidate.textContent ?? "").includes(${JSON.stringify(needle)})
    );
    const content = line?.closest(".cm-content");
    if (!(line instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return { installed: false, reason: "visible source line missing" };
    }
    line.scrollIntoView({ block: "center", inline: "nearest" });
    const requested = Math.max(0, Math.min(${Number(sourceColumn)}, line.textContent?.length ?? 0));
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let targetNode;
    let targetOffset = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (requested <= consumed + length) {
        targetNode = node;
        targetOffset = requested - consumed;
        break;
      }
      consumed += length;
    }
    if (targetNode === undefined) {
      return { installed: false, reason: "source column missing" };
    }
    const range = document.createRange();
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    content.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    const lineNumber = logicalLineNumberForElement(line);
    return { installed: true, lineNumber, sourceColumn: requested };

    function logicalLineNumberForElement(element) {
      const box = element.getBoundingClientRect();
      const centerY = box.top + box.height / 2;
      const gutters = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")];
      const nearest = gutters.reduce((best, candidate) => {
        const candidateBox = candidate.getBoundingClientRect();
        const distance = Math.abs(candidateBox.top + candidateBox.height / 2 - centerY);
        return best === undefined || distance < best.distance
          ? { candidate, distance }
          : best;
      }, undefined);
      return Number.parseInt(nearest?.candidate.textContent ?? "", 10);
    }
  })()`;
}

function logicalLineNavigationStateExpression() {
  return `(() => {
    const content = document.querySelector(".cm-content");
    const activeLine = document.querySelector(".cm-activeLine");
    const activeGutter = document.querySelector(".cm-activeLineGutter");
    if (!(content instanceof HTMLElement) || !(activeLine instanceof HTMLElement)) {
      return { present: false };
    }
    const selection = document.getSelection();
    const focusNode = selection?.focusNode;
    let sourceColumn = -1;
    if (focusNode !== null && focusNode !== undefined && activeLine.contains(focusNode)) {
      const prefix = document.createRange();
      prefix.setStart(activeLine, 0);
      prefix.setEnd(focusNode, selection?.focusOffset ?? 0);
      sourceColumn = prefix.toString().length;
    }
    const activeFormulaSegments = [...document.querySelectorAll(".texleaf-formula-source-active")];
    const activeFormulaLines = [...new Set(activeFormulaSegments.map((segment) =>
      segment.closest(".cm-line")?.textContent ?? ""
    ))];
    const formulaFrom = activeFormulaSegments
      .map((segment) => Number(segment.getAttribute("data-texleaf-formula-from")))
      .find(Number.isFinite);
    const formulaTo = activeFormulaSegments
      .map((segment) => Number(segment.getAttribute("data-texleaf-formula-to")))
      .find(Number.isFinite);
    const lineStyle = getComputedStyle(activeLine ?? content ?? document.body);
    return {
      present: true,
      lineNumber: Number.parseInt(activeGutter?.textContent ?? "", 10),
      lineText: activeLine.textContent ?? "",
      sourceColumn,
      lineHeight: activeLine?.getBoundingClientRect().height ?? 0,
      baseLineHeight: Number.parseFloat(lineStyle.lineHeight) || Number.parseFloat(lineStyle.fontSize) || 1,
      activeFormulaSegments: activeFormulaSegments.length,
      activeFormulaLines,
      activeFormulaFrom: formulaFrom ?? -1,
      activeFormulaTo: formulaTo ?? -1,
      head: sourceColumn,
      visibleSourceLines: [...document.querySelectorAll(".cm-line")]
        .map((candidate) => candidate.textContent ?? "")
        .filter((text) => /\\\\(?:begin|end)\{/u.test(text)),
    };
  })()`;
}

async function dispatchPrintableKey(client, key, code, virtualKeyCode) {
  await client.request("Input.dispatchKeyEvent", {
    type: "keyDown", key, code, text: key, unmodifiedText: key,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
  await client.request("Input.dispatchKeyEvent", {
    type: "keyUp", key, code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  });
}

async function waitForFileText(file, predicate, description) {
  const deadline = Date.now() + 10_000;
  let last = "";
  while (Date.now() < deadline) {
    last = fs.readFileSync(file, "utf8");
    if (predicate(last)) {
      return last;
    }
    await delay(60);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

async function waitForVisualContext(client, contexts) {
  const deadline = Date.now() + 30_000;
  let last = [];
  while (Date.now() < deadline) {
    last = [];
    for (const context of contexts.values()) {
      try {
        const value = await evaluate(client, context.id, overviewExpression());
        last.push({ id: context.id, value });
        if (value.ready) {
          return context.id;
        }
      } catch (error) {
        last.push({ id: context.id, error: String(error) });
      }
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for visual context: ${JSON.stringify(last)}`);
}

async function evaluate(client, contextId, expression) {
  const response = await client.request("Runtime.evaluate", {
    contextId,
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text}`);
  }
  return response.result?.value;
}

async function waitForVisualEditorTarget(debugPort) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/list`;
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      const targets = response.ok ? await response.json() : [];
      const target = targets.find((candidate) =>
        candidate.type === "iframe" &&
        typeof candidate.webSocketDebuggerUrl === "string" &&
        /extensionId=zhangxh-math\.texleaf(?:&|$)/iu.test(candidate.url ?? ""));
      if (target !== undefined) {
        return target;
      }
      lastError = new Error("TeXLeaf visual-editor target is not ready");
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error("Timed out waiting for VS Code CDP target");
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    const requestTimeoutMs = Number.parseInt(
      process.env.TEXLEAF_CDP_REQUEST_TIMEOUT_MS ?? "10000",
      10,
    );
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1_000 ||
      requestTimeoutMs > 120_000
    ) {
      reject(new Error("Invalid TEXLEAF_CDP_REQUEST_TIMEOUT_MS"));
      return;
    }
    const openingTimeout = setTimeout(() => reject(new Error("CDP connect timeout")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(openingTimeout);
      resolve({
        request(method, params = {}) {
          const id = nextId++;
          return new Promise((requestResolve, requestReject) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              requestReject(new Error(`CDP ${method} timed out`));
            }, requestTimeoutMs);
            pending.set(id, { resolve: requestResolve, reject: requestReject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, listener) {
          const values = listeners.get(method) ?? new Set();
          values.add(listener);
          listeners.set(method, values);
        },
        close() { socket.close(); },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        for (const listener of listeners.get(message.method) ?? []) {
          listener(message.params ?? {});
        }
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error !== undefined) {
        waiter.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
    });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")));
  });
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--port" || !/^[0-9]+$/u.test(argv[1] ?? "")) {
    throw new Error("Usage: node test/visual-editor-cdp-check.cjs --port <port>");
  }
  const parsedPort = Number(argv[1]);
  if (!Number.isSafeInteger(parsedPort) || parsedPort < 1_024 || parsedPort > 65_535) {
    throw new Error("Invalid CDP port");
  }
  return { port: parsedPort };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
