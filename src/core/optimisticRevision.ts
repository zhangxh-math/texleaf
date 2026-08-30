/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export type OptimisticRevisionStatus = "committed" | "changed";

/**
 * A successful write operation is not enough to acknowledge a UI save: the
 * exact bytes read back afterwards must still be the bytes the UI requested.
 */
export function optimisticRevisionStatus(
  desiredRevision: string,
  observedRevision: string,
): OptimisticRevisionStatus {
  return desiredRevision === observedRevision ? "committed" : "changed";
}
