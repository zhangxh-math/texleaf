import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPathDirectories,
  normalizeConfiguredTexBinPath,
  prependPathDirectories,
  texLiveBinDirectoryCandidates,
} from "../src/texLivePlatform";

test("macOS candidates include the stable MacTeX symlink before versioned fallbacks", () => {
  const candidates = texLiveBinDirectoryCandidates({
    platform: "darwin",
    architecture: "arm64",
    releaseNames: ["2026"],
    currentYear: 2026,
  });
  assert.equal(candidates[0], "/Library/TeX/texbin");
  assert.ok(candidates.includes("/opt/homebrew/bin"));
  assert.ok(candidates.includes("/usr/local/texlive/2026/bin/universal-darwin"));
});

test("configured bin directory accepts a quoted path without retaining quotes", () => {
  const normalized = normalizeConfiguredTexBinPath('"./TeX Live/bin"');
  assert.ok(normalized !== undefined);
  assert.equal(normalized.includes('"'), false);
  assert.equal(normalized.endsWith("TeX Live\\bin") || normalized.endsWith("TeX Live/bin"), true);
});

test("Linux candidates cover distro paths and stock TeX Live architectures", () => {
  const x64 = texLiveBinDirectoryCandidates({
    platform: "linux",
    architecture: "x64",
    releaseNames: ["current", "2026"],
    currentYear: 2026,
  });
  assert.deepEqual(x64.slice(0, 2), ["/usr/local/bin", "/usr/bin"]);
  assert.ok(x64.includes("/usr/local/texlive/2026/bin/x86_64-linux"));
  assert.ok(x64.includes("/usr/local/texlive/2026/bin/x86_64-linuxmusl"));

  const arm64 = texLiveBinDirectoryCandidates({
    platform: "linux",
    architecture: "arm64",
    releaseNames: ["2026"],
    currentYear: 2026,
  });
  assert.ok(arm64.includes("/usr/local/texlive/2026/bin/aarch64-linux"));
});

test("POSIX PATH fallbacks append without overriding the user's selected TeX", () => {
  const environment = appendPathDirectories({
    PATH: "/custom/tex/bin:/usr/bin",
    Path: "case-sensitive-separate-value",
  }, ["/Library/TeX/texbin", "/usr/bin"], "darwin");
  assert.equal(
    environment.PATH,
    "/custom/tex/bin:/usr/bin:/Library/TeX/texbin",
  );
  assert.equal(environment.Path, "case-sensitive-separate-value");
});

test("resolved tool directory is prepended and Windows PATH keys are deduplicated", () => {
  const environment = prependPathDirectories({
    Path: String.raw`C:\Windows\System32;C:\texlive\bin`,
    PATH: String.raw`C:\duplicate`,
  }, [String.raw`C:\preferred tex\bin`], "win32");
  assert.equal(
    environment.Path,
    String.raw`C:\preferred tex\bin;C:\Windows\System32;C:\texlive\bin;C:\duplicate`,
  );
  assert.equal(environment.PATH, undefined);
});
