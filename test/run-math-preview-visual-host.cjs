"use strict";

/**
 * Launches an isolated Extension Development Host for manual Math Preview QA.
 *
 * The launcher stays alive while the window is open so that the isolated
 * profile and rendered assets remain available for screenshots. Closing the
 * window or pressing Ctrl+C removes only this run's validated mkdtemp root.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const extensionDevelopmentPath = path.resolve(__dirname, "..");
const options = parseArguments(process.argv.slice(2));
const vsixPath = options.vsixPath;
const debugPort = options.debugPort;
const visualFixture = createVisualFixture(options.scenario);
const colorTheme = options.theme === "light"
  ? "Default Light Modern"
  : "Default Dark Modern";
if (vsixPath === undefined) {
  const workerPath = path.join(
    extensionDevelopmentPath,
    "dist",
    "mathPreviewWorker.js",
  );
  if (!fs.existsSync(workerPath)) {
    throw new Error(
      `Missing ${workerPath}. Build the extension before launching visual QA.`,
    );
  }
}
const codeExecutable = resolveCodeExecutable();

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "texleaf-math-preview-visual-"),
);
const userDataDir = path.join(isolatedRoot, "user-data");
const extensionsDir = path.join(isolatedRoot, "extensions");
const workspaceRoot = path.join(isolatedRoot, "workspace");
const vscodeDirectory = path.join(workspaceRoot, ".vscode");
const texFile = path.join(workspaceRoot, "preview.tex");
let cleanupStarted = false;
let requestedSignal;

try {
  for (const directory of [userDataDir, extensionsDir, vscodeDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(
    path.join(vscodeDirectory, "settings.json"),
    `${JSON.stringify(
      {
        "window.title": "TeXLeaf Math Preview Visual Test",
        "workbench.colorTheme": colorTheme,
        "workbench.startupEditor": "none",
        "editor.fontSize": 18,
        "editor.lineHeight": 30,
        "editor.wordWrap": "off",
        "files.autoSave": "off",
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "texleaf.mathPreview.enabled": true,
        "texleaf.mathPreview.presentation": "cursor",
        "texleaf.mathPreview.placement": options.placement,
        // Make the stale-while-revalidate interval deliberately visible to
        // the CDP typing regression. The old eager-clear implementation left
        // the editor blank for this entire interval after every keystroke.
        "texleaf.mathPreview.debounceMs":
          options.scenario === "typing-stability" ? 250 : 50,
        "texleaf.mathPreview.scale": 1.25,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const texSource = visualFixture.texSource;
  fs.writeFileSync(texFile, texSource, "utf8");
  const sourceLines = texSource.split("\n");
  const visualCaretLine = sourceLines.findIndex((line) =>
    line.includes(visualFixture.caretAtom),
  );
  if (visualCaretLine < 0) {
    throw new Error("Visual fixture is missing its caret target.");
  }
  // VS Code's --goto column is one-based. Place the cursor immediately after
  // a complete TeX atom so the visual test never depends on an unsafe
  // control-sequence, delimiter, or argument-internal caret boundary.
  const visualCaretColumn =
    sourceLines[visualCaretLine].indexOf(visualFixture.caretAtom) +
    visualFixture.caretAtom.length +
    1;

  if (vsixPath !== undefined) {
    installVsix(vsixPath);
  }

  const args = [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    ...(vsixPath === undefined ? ["--disable-extensions"] : []),
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-telemetry",
    "--new-window",
    "--wait",
    ...(debugPort === undefined
      ? []
      : [
          "--remote-debugging-address=127.0.0.1",
          `--remote-debugging-port=${debugPort}`,
        ]),
    ...(vsixPath === undefined
      ? [`--extensionDevelopmentPath=${extensionDevelopmentPath}`]
      : []),
    workspaceRoot,
    "--goto",
    `${texFile}:${visualCaretLine + 1}:${visualCaretColumn}`,
  ];

  const child = spawn(codeExecutable, args, {
    cwd: extensionDevelopmentPath,
    detached: false,
    shell: false,
    stdio: "ignore",
    windowsHide: false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        title: "TeXLeaf Math Preview Visual Test",
        mode: vsixPath === undefined ? "source" : "vsix",
        theme: options.theme,
        scenario: options.scenario,
        placement: options.placement,
        debugPort,
        vsixPath,
        pid: child.pid,
        isolatedRoot,
        texFile,
        caret: {
          line: visualCaretLine + 1,
          column: visualCaretColumn,
          afterAtom: visualFixture.caretAtom,
        },
        codeExecutable,
        note: "Close the isolated window or press Ctrl+C to clean up isolatedRoot.",
      },
      null,
      2,
    )}\n`,
  );

  child.once("error", (error) => {
    cleanup();
    throw error;
  });

  child.once("exit", (code, signal) => {
    cleanup();
    if (requestedSignal !== undefined) {
      process.exitCode = 130;
    } else if (signal !== null) {
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      requestedSignal = signal;
      if (!child.killed) {
        child.kill();
      }
    });
  }
} catch (error) {
  cleanup();
  throw error;
}

function installVsix(absoluteVsixPath) {
  const cliScript = resolveCodeCliScript(codeExecutable);
  const cliEnvironment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    VSCODE_DEV: "",
  };
  const result = spawnSync(
    codeExecutable,
    [
      cliScript,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--disable-telemetry",
      "--install-extension",
      absoluteVsixPath,
      "--force",
    ],
    {
      cwd: extensionDevelopmentPath,
      encoding: "utf8",
      env: cliEnvironment,
      shell: false,
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error !== undefined) {
    throw new Error(`Unable to run the VS Code CLI: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0 || result.signal !== null) {
    const output = [result.stdout, result.stderr]
      .filter((value) => typeof value === "string" && value.trim() !== "")
      .join("\n")
      .trim();
    throw new Error(
      `VSIX installation failed${output === "" ? "." : `:\n${output}`}`,
    );
  }
  const installedDirectories = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(extensionsDir, entry.name, "package.json")),
    );
  if (installedDirectories.length === 0) {
    throw new Error(
      "VSIX installation reported success but the isolated extensions directory is empty.",
    );
  }
  process.stdout.write(
    `Installed ${absoluteVsixPath} into isolated extensions directory.\n`,
  );
}

function resolveCodeCliScript(executable) {
  const installRoot = path.resolve(path.dirname(executable));
  const commandPath = path.join(installRoot, "bin", "code.cmd");

  if (fs.existsSync(commandPath)) {
    const commandSource = fs.readFileSync(commandPath, "utf8");
    const match = /"%~dp0([^"\r\n]*?resources[\\/]app[\\/]out[\\/]cli\.js)"/iu.exec(
      commandSource,
    );
    if (match?.[1] !== undefined) {
      const candidate = path.resolve(
        path.dirname(commandPath),
        match[1].replaceAll("\\", path.sep),
      );
      if (isPathInside(installRoot, candidate) && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const directCandidate = path.join(
    installRoot,
    "resources",
    "app",
    "out",
    "cli.js",
  );
  if (fs.existsSync(directCandidate)) {
    return directCandidate;
  }

  const versionedCandidates = fs
    .readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      path.join(
        installRoot,
        entry.name,
        "resources",
        "app",
        "out",
        "cli.js",
      ),
    )
    .filter((candidate) => fs.existsSync(candidate));
  if (versionedCandidates.length === 1) {
    return versionedCandidates[0];
  }

  throw new Error(
    `Cannot resolve the VS Code CLI script associated with ${executable}.`,
  );
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function cleanup() {
  if (cleanupStarted) {
    return;
  }
  cleanupStarted = true;

  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedIsolatedRoot = path.resolve(isolatedRoot);
  if (
    path.dirname(resolvedIsolatedRoot) !== resolvedTemp ||
    !path.basename(resolvedIsolatedRoot).startsWith(
      "texleaf-math-preview-visual-",
    )
  ) {
    throw new Error(
      `Refusing to remove unexpected visual-test path: ${resolvedIsolatedRoot}`,
    );
  }
  fs.rmSync(resolvedIsolatedRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

function createVisualFixture(scenario) {
  if (scenario === "typing-stability") {
    return {
      caretAtom: "x",
      texSource: String.raw`\documentclass{article}
\newcommand{\badloop}{\badloop}
\begin{document}
The line above remains nonblank while the preview is replaced.
  \[
    x
  \]
Outside the formula, the preview must disappear.
\end{document}
`,
    };
  }

  if (scenario === "inline") {
    return {
      caretAtom: String.raw`\Phi_{1,2}`,
      texSource: String.raw`\documentclass{article}
\begin{document}
This deliberately nonblank line sits immediately above the inline formula preview.
    Since $\Phi_{1,2}+\frac{1}{1+z^2}$ is active, the text following it remains long enough to expose wrapping, shifting, or overlap after the floating preview appears.
      A second indented form, \(\Psi_{1,1}+\Psi_{2,2}\), verifies alignment with the opening backslash while preserving indentation.
This deliberately nonblank line sits immediately below the inline formula preview.
\end{document}
`,
    };
  }

  if (scenario === "multiline-inline") {
    return {
      caretAtom: String.raw`\Psi_{2,2}`,
      texSource: String.raw`\documentclass{article}
\begin{document}
This nonblank line sits immediately above the multiline inline preview.
    A multiline inline formula starts here \(
          \Phi_{1,1}(z_1;s)
        + \Psi_{2,2}(z_2;s)
        + \frac{1}{1+z_1z_2}
    \) and the card should follow the active source-line indentation.
This nonblank line sits immediately below the multiline inline preview.
\end{document}
`,
    };
  }

  if (scenario === "nested-display") {
    return {
      caretAtom: String.raw`\boldsymbol{d}_{\mathrm{preview}}`,
      texSource: String.raw`\documentclass{article}
\begin{document}
\begin{enumerate}
  \item A nested display keeps the opening delimiter indented inside the item.
    \[
      \boldsymbol{d}_{\mathrm{preview}}
        = (d_1,\ldots,d_{j-1},(d_j+1)^{1-j},g^{1-d_1}).
    \]
  \item The card must not jump to Monaco's content-column zero.
\end{enumerate}
\end{document}
`,
    };
  }

  if (scenario === "tall-display") {
    return {
      caretAtom: String.raw`\Omega_{\mathrm{tail}}`,
      texSource: String.raw`\documentclass{article}
\begin{document}
The tall fixture starts well above the visible formula tail.
        \begin{align}
          T_1 &= \frac{1}{1+x_1^2}+\Phi_{1,1}(x_1) \\
          T_2 &= \frac{2}{1+x_2^2}+\Phi_{1,2}(x_2) \\
          T_3 &= \frac{3}{1+x_3^2}+\Phi_{1,3}(x_3) \\
          T_4 &= \frac{4}{1+x_4^2}+\Phi_{1,4}(x_4) \\
          T_5 &= \frac{5}{1+x_5^2}+\Phi_{1,5}(x_5) \\
          T_6 &= \frac{6}{1+x_6^2}+\Phi_{1,6}(x_6) \\
          T_7 &= \frac{7}{1+x_7^2}+\Phi_{1,7}(x_7) \\
          T_8 &= \frac{8}{1+x_8^2}+\Phi_{1,8}(x_8) \\
          T_9 &= \frac{9}{1+x_9^2}+\Phi_{1,9}(x_9) \\
          T_{10} &= \frac{10}{1+x_{10}^2}+\Phi_{1,10}(x_{10}) \\
          T_{11} &= \frac{11}{1+x_{11}^2}+\Phi_{1,11}(x_{11}) \\
          T_{12} &= \frac{12}{1+x_{12}^2}+\Phi_{1,12}(x_{12}) \\
          T_{13} &= \frac{13}{1+x_{13}^2}+\Phi_{1,13}(x_{13}) \\
          T_{14} &= \frac{14}{1+x_{14}^2}+\Phi_{1,14}(x_{14}) \\
          T_{15} &= \frac{15}{1+x_{15}^2}+\Phi_{1,15}(x_{15}) \\
          T_{16} &= \frac{16}{1+x_{16}^2}+\Phi_{1,16}(x_{16}) \\
          T_{17} &= \frac{17}{1+x_{17}^2}+\Phi_{1,17}(x_{17}) \\
          T_{18} &= \frac{18}{1+x_{18}^2}+\Phi_{1,18}(x_{18}) \\
          T_{19} &= \frac{19}{1+x_{19}^2}+\Phi_{1,19}(x_{19}) \\
          T_{20} &= \frac{20}{1+x_{20}^2}+\Phi_{1,20}(x_{20}) \\
          T_{21} &= \frac{21}{1+x_{21}^2}+\Phi_{1,21}(x_{21}) \\
          T_{22} &= \frac{22}{1+x_{22}^2}+\Phi_{1,22}(x_{22}) \\
          T_{23} &= \frac{23}{1+x_{23}^2}+\Phi_{1,23}(x_{23}) \\
          T_{24} &= \frac{24}{1+x_{24}^2}+\Phi_{1,24}(x_{24}) \\
          T_{25} &= \frac{25}{1+x_{25}^2}+\Phi_{1,25}(x_{25}) \\
          T_{26} &= \frac{26}{1+x_{26}^2}+\Phi_{1,26}(x_{26}) \\
          T_{27} &= \frac{27}{1+x_{27}^2}+\Phi_{1,27}(x_{27}) \\
          T_{28} &= \Omega_{\mathrm{tail}}+\frac{z_1+z_2}{1+z_1z_2}.
        \end{align}
This nonblank line remains below the tall display.
\end{document}
`,
    };
  }

  return {
    caretAtom: String.raw`\Phi_{1,1}`,
    texSource: String.raw`\documentclass{article}
\begin{document}
This fixture gives each opening display delimiter a different indentation level.
    \[
      E_{\mathrm{bracket}}=mc^2+\frac{1}{1+x^2}.
    \]
      $$
        E_{\mathrm{dollar}}=\sum_{n=1}^{20}\frac{a_n}{1+n^2}.
      $$
        \begin{align}
          K_{\boldsymbol{\lambda}}(x,y)
            &= \sum_{\boldsymbol{\lambda}' \succ \boldsymbol{\lambda}}
               \Phi_{1,1}(z_1;s)\Phi_{2,2}(z_2;s)
               + \Phi_{1,2}(z_1;s)\Phi_{2,1}(z_2;s) \\
            &\quad + \frac{z_1}{z_2}\left(
              \Phi_{2,2}(z_1;s)+\Phi_{1,2}(z_2;s)\right).
        \end{align}
This nonblank line is adjacent below the indented displays.
\end{document}
`,
  };
}

function parseArguments(argv) {
  const usage =
    "Usage: node test/run-math-preview-visual-host.cjs " +
    "[--vsix <path>] [--theme dark|light] " +
    "[--scenario inline|multiline-inline|display|nested-display|tall-display|typing-stability] " +
    "[--placement autoBelow|autoAbove|above|below] [--debug-port <port>]";
  if (argv.includes("--help")) {
    process.stdout.write(
      `${usage}\n\n` +
        "Options:\n" +
        "  --vsix <path>                 Test an installed VSIX instead of source.\n" +
        "  --theme dark|light            Editor theme (default: dark).\n" +
        "  --scenario inline|multiline-inline|display|nested-display|tall-display|typing-stability\n" +
        "                                Fixture to open (default: display).\n" +
        "  --placement autoBelow|autoAbove|above|below\n" +
        "                                Math Preview placement (default: autoBelow).\n" +
        "  --debug-port <port>           Loopback CDP port for isolated renderer QA.\n",
    );
    process.exit(0);
  }
  let vsixPath;
  let theme = "dark";
  let scenario = "display";
  let placement = "autoBelow";
  let debugPort;
  const seenFlags = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      typeof flag !== "string" ||
      ![
        "--vsix",
        "--theme",
        "--scenario",
        "--placement",
        "--debug-port",
      ].includes(flag) ||
      seenFlags.has(flag) ||
      value === undefined ||
      value.trim() === ""
    ) {
      throw new Error(usage);
    }
    seenFlags.add(flag);
    if (flag === "--theme") {
      if (value !== "dark" && value !== "light") {
        throw new Error(usage);
      }
      theme = value;
      continue;
    }
    if (flag === "--scenario") {
      if (
        value !== "inline" &&
        value !== "multiline-inline" &&
        value !== "display" &&
        value !== "nested-display" &&
        value !== "tall-display" &&
        value !== "typing-stability"
      ) {
        throw new Error(usage);
      }
      scenario = value;
      continue;
    }
    if (flag === "--placement") {
      if (
        value !== "autoBelow" &&
        value !== "autoAbove" &&
        value !== "above" &&
        value !== "below"
      ) {
        throw new Error(usage);
      }
      placement = value;
      continue;
    }
    if (flag === "--debug-port") {
      if (!/^[0-9]+$/u.test(value)) {
        throw new Error(usage);
      }
      debugPort = Number(value);
      if (!Number.isSafeInteger(debugPort) || debugPort < 1_024 || debugPort > 65_535) {
        throw new Error(usage);
      }
      continue;
    }
    vsixPath = value;
  }
  if (vsixPath === undefined) {
    return { vsixPath: undefined, theme, scenario, placement, debugPort };
  }
  const absoluteVsixPath = path.resolve(process.cwd(), vsixPath);
  let stats;
  try {
    stats = fs.statSync(absoluteVsixPath);
  } catch {
    throw new Error(`VSIX does not exist: ${absoluteVsixPath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`VSIX path is not a file: ${absoluteVsixPath}`);
  }
  return {
    vsixPath: absoluteVsixPath,
    theme,
    scenario,
    placement,
    debugPort,
  };
}

function resolveCodeExecutable() {
  const configured = process.env.TEXLEAF_VSCODE_EXE;
  if (configured !== undefined && fs.existsSync(configured)) {
    return path.resolve(configured);
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== undefined) {
      const installed = path.join(
        localAppData,
        "Programs",
        "Microsoft VS Code",
        "Code.exe",
      );
      if (fs.existsSync(installed)) {
        return installed;
      }
    }
    const located = spawnSync("where.exe", ["code.cmd"], {
      encoding: "utf8",
      shell: false,
    });
    const command = located.stdout
      ?.split(/\r?\n/u)
      .find((line) => line.trim() !== "");
    if (command !== undefined) {
      const executable = path.resolve(
        path.dirname(command.trim()),
        "..",
        "Code.exe",
      );
      if (fs.existsSync(executable)) {
        return executable;
      }
    }
  }

  throw new Error(
    "Cannot find VS Code. Set TEXLEAF_VSCODE_EXE to the Code executable.",
  );
}
