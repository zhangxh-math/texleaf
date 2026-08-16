"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  LEGACY_PUBLISHER_EXTENSION_ID,
  LEGACY_PUBLISHER_LIBRARY_TEXT,
} = require("./storageMigrationFixture.cjs");

const extensionDevelopmentPath = path.resolve(__dirname, "..");
const extensionTestsPath = path.resolve(__dirname, "extensionHost.cjs");
const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "texleaf-extension-host-profile-"),
);
const userDataDir = path.join(isolatedRoot, "user-data");
const extensionsDir = path.join(isolatedRoot, "extensions");
const workspaceRootA = path.join(isolatedRoot, "paper-a");
const workspaceRootB = path.join(isolatedRoot, "library-b");
const workspaceFile = path.join(isolatedRoot, "texleaf-tests.code-workspace");
const codeCommand = resolveCodeCommand();
const legacyPublisherSnippetPath = path.join(
  userDataDir,
  "User",
  "globalStorage",
  LEGACY_PUBLISHER_EXTENSION_ID,
  "texleaf-snippets.jsonc",
);

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.mkdirSync(path.join(workspaceRootA, ".vscode"), { recursive: true });
fs.mkdirSync(workspaceRootB, { recursive: true });
fs.mkdirSync(path.dirname(legacyPublisherSnippetPath), { recursive: true });
fs.writeFileSync(
  legacyPublisherSnippetPath,
  LEGACY_PUBLISHER_LIBRARY_TEXT,
  "utf8",
);
fs.writeFileSync(
  path.join(workspaceRootA, ".vscode", "texleaf-snippets.jsonc"),
  `${JSON.stringify(
    {
      version: 1,
      snippets: [
        {
          id: "extension-host-legacy-workspace",
          trigger: "told",
          replacement: "\\operatorname{LegacyWorkspace}",
          options: "tA",
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
fs.writeFileSync(
  workspaceFile,
  `${JSON.stringify(
    {
      folders: [{ path: workspaceRootA }, { path: workspaceRootB }],
      settings: {},
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const args = [
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  "--disable-extensions",
  "--disable-workspace-trust",
  "--wait",
  "--skip-welcome",
  "--skip-release-notes",
  "--disable-telemetry",
  `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
  `--extensionTestsPath=${extensionTestsPath}`,
  workspaceFile,
];

try {
  const result = spawnSync(codeCommand, args, {
    cwd: extensionDevelopmentPath,
    encoding: "utf8",
    env: {
      ...process.env,
      TEXLEAF_TEST_LEGACY_PUBLISHER_SNIPPET_PATH: legacyPublisherSnippetPath,
    },
    shell: false,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  // Only remove the uniquely generated mkdtemp directory owned by this run.
  try {
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedIsolatedRoot = path.resolve(isolatedRoot);
    if (
      path.dirname(resolvedIsolatedRoot) !== resolvedTemp ||
      !path.basename(resolvedIsolatedRoot).startsWith(
        "texleaf-extension-host-profile-",
      )
    ) {
      throw new Error(
        `Refusing to remove unexpected test profile path: ${resolvedIsolatedRoot}`,
      );
    }
    fs.rmSync(isolatedRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn(`Unable to remove isolated VS Code profile ${isolatedRoot}:`, error);
  }
}

function resolveCodeCommand() {
  const configured = process.env.TEXLEAF_VSCODE_CLI;
  if (process.platform !== "win32") {
    return configured ?? "code";
  }

  let candidate = configured;
  if (candidate === undefined) {
    const located = spawnSync("where.exe", ["code.cmd"], {
      encoding: "utf8",
      shell: false,
    });
    if (located.status !== 0) {
      throw new Error(
        "Cannot find VS Code. Set TEXLEAF_VSCODE_CLI to Code.exe or code.cmd.",
      );
    }
    candidate = located.stdout.split(/\r?\n/u).find((line) => line.trim() !== "");
  }

  if (candidate === undefined) {
    throw new Error("Cannot resolve the VS Code executable.");
  }
  const resolved = path.resolve(candidate.trim());
  if (/\.(?:cmd|bat)$/iu.test(resolved)) {
    const executable = path.resolve(path.dirname(resolved), "..", "Code.exe");
    if (!fs.existsSync(executable)) {
      throw new Error(`Cannot derive Code.exe from ${resolved}.`);
    }
    return executable;
  }
  return resolved;
}
