/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

const POSIX_TERMINATION_GRACE_MS = 1_500;
const POSIX_TERMINATION_POLL_MS = 50;
const POSIX_KILL_SETTLE_MS = 500;

/**
 * Terminate a TeX process and, on every desktop OS, its spawned tool tree.
 *
 * The returned promise is a bounded cleanup barrier: it resolves after the
 * process group exits or after the final kill signal's settle window.
 */
export function terminateTexProcessTree(
  child: ChildProcess,
): Promise<void> {
  if (child.pid === undefined) {
    child.kill();
    return Promise.resolve();
  }

  if (process.platform !== "win32") {
    return terminatePosixProcessGroup(child, child.pid);
  }

  const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR;
  if (windowsDirectory === undefined || !path.isAbsolute(windowsDirectory)) {
    child.kill();
    return Promise.resolve();
  }
  return terminateWindowsProcessTree(child, child.pid, windowsDirectory);
}

function terminatePosixProcessGroup(
  child: ChildProcess,
  processGroupId: number,
): Promise<void> {
  const initialSignal = signalPosixProcessGroup(processGroupId, "SIGTERM");
  if (initialSignal !== "sent") {
    return terminatePosixDirectChild(child);
  }

  const graceDeadline = Date.now() + POSIX_TERMINATION_GRACE_MS;
  return new Promise<void>((resolve) => {
    const pollGrace = (): void => {
      if (!posixProcessGroupExists(processGroupId)) {
        resolve();
        return;
      }
      if (Date.now() < graceDeadline) {
        setTimeout(pollGrace, POSIX_TERMINATION_POLL_MS);
        return;
      }
      const killSignal = signalPosixProcessGroup(processGroupId, "SIGKILL");
      if (
        killSignal !== "sent" &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill("SIGKILL");
      }
      const settleDeadline = Date.now() + POSIX_KILL_SETTLE_MS;
      const pollKilled = (): void => {
        if (
          !posixProcessGroupExists(processGroupId) ||
          Date.now() >= settleDeadline
        ) {
          resolve();
          return;
        }
        setTimeout(pollKilled, POSIX_TERMINATION_POLL_MS);
      };
      pollKilled();
    };
    pollGrace();
  });
}

type PosixGroupSignalResult = "sent" | "missing" | "failed";

function signalPosixProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): PosixGroupSignalResult {
  try {
    process.kill(-processGroupId, signal);
    return "sent";
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "missing"
      : "failed";
  }
}

function terminatePosixDirectChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  child.kill("SIGTERM");
  const graceDeadline = Date.now() + POSIX_TERMINATION_GRACE_MS;
  return new Promise<void>((resolve) => {
    const pollGrace = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      if (Date.now() < graceDeadline) {
        setTimeout(pollGrace, POSIX_TERMINATION_POLL_MS);
        return;
      }
      child.kill("SIGKILL");
      const settleDeadline = Date.now() + POSIX_KILL_SETTLE_MS;
      const pollKilled = (): void => {
        if (
          child.exitCode !== null ||
          child.signalCode !== null ||
          Date.now() >= settleDeadline
        ) {
          resolve();
          return;
        }
        setTimeout(pollKilled, POSIX_TERMINATION_POLL_MS);
      };
      pollKilled();
    };
    pollGrace();
  });
}

function posixProcessGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function terminateWindowsProcessTree(
  child: ChildProcess,
  processId: number,
  windowsDirectory: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      finish();
    }, 2_000);
    try {
      const taskkill = spawn(
        path.join(windowsDirectory, "System32", "taskkill.exe"),
        ["/PID", String(processId), "/T", "/F"],
        {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        },
      );
      taskkill.once("error", () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
        finish();
      });
      taskkill.once("close", (exitCode: number | null) => {
        if (
          exitCode !== 0 &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          child.kill();
        }
        finish();
      });
    } catch {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      finish();
    }
  });
}
