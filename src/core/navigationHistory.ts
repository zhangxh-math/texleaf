/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export type NavigationHistoryDirection = "back" | "forward";

export interface NavigationHistorySnapshot {
  readonly back: number;
  readonly forward: number;
}

/**
 * A small two-stack browser-style history. The caller restores `peek()` first
 * and calls `commitRestored()` only after the target surface confirms success,
 * so failed PDF/visual restores never corrupt either stack.
 */
export class NavigationHistory<Location> {
  private readonly backLocations: Location[] = [];
  private readonly forwardLocations: Location[] = [];

  public constructor(
    private readonly equals: (left: Location, right: Location) => boolean,
    private readonly limit = 100,
  ) {}

  public recordOrigin(origin: Location): void {
    pushDistinct(this.backLocations, origin, this.equals, this.limit);
    this.forwardLocations.length = 0;
  }

  public peek(direction: NavigationHistoryDirection): Location | undefined {
    return (direction === "back" ? this.backLocations : this.forwardLocations).at(-1);
  }

  public commitRestored(
    direction: NavigationHistoryDirection,
    expectedTarget: Location,
    current: Location,
  ): boolean {
    const source = direction === "back" ? this.backLocations : this.forwardLocations;
    const destination = direction === "back" ? this.forwardLocations : this.backLocations;
    const target = source.at(-1);
    if (target === undefined || !this.equals(target, expectedTarget)) {
      return false;
    }
    source.pop();
    if (!this.equals(current, target)) {
      pushDistinct(destination, current, this.equals, this.limit);
    }
    return true;
  }

  public snapshot(): NavigationHistorySnapshot {
    return {
      back: this.backLocations.length,
      forward: this.forwardLocations.length,
    };
  }
}

interface NavigationHistoryLane<Location> {
  readonly history: NavigationHistory<Location>;
  generation: number;
  lastRestored: Location | undefined;
}

/**
 * Keeps independent browser-style histories for multiple navigation surfaces.
 *
 * In addition to isolating each lane's back/forward stacks, this class tracks a
 * lane-local generation and the most recently restored location. A caller may
 * capture `generation()` together with the visible location before queueing a
 * navigation command, then use `currentFor()` when the command executes. If an
 * earlier command in the same lane has completed meanwhile, `currentFor()`
 * returns that restored location instead of the now-stale visible observation.
 * Activity in any other lane cannot affect that decision.
 */
export class NavigationHistoryLanes<Lane, Location> {
  private readonly lanes = new Map<Lane, NavigationHistoryLane<Location>>();

  public constructor(
    private readonly equals: (left: Location, right: Location) => boolean,
    private readonly limit = 100,
  ) {}

  public recordOrigin(lane: Lane, origin: Location): void {
    const state = this.ensureLane(lane);
    state.history.recordOrigin(origin);
    state.generation += 1;
    state.lastRestored = undefined;
  }

  public peek(
    lane: Lane,
    direction: NavigationHistoryDirection,
  ): Location | undefined {
    return this.lanes.get(lane)?.history.peek(direction);
  }

  public generation(lane: Lane): number {
    return this.lanes.get(lane)?.generation ?? 0;
  }

  /**
   * Resolves the location a queued command should treat as current.
   *
   * `observedGeneration` and `observedCurrent` are captured when the command is
   * queued. Only a successful restore in this lane may replace a stale
   * observation; a fresh origin clears `lastRestored` so it cannot inherit an
   * unrelated traversal position.
   */
  public currentFor(
    lane: Lane,
    observedGeneration: number,
    observedCurrent: Location,
  ): Location {
    const state = this.lanes.get(lane);
    if (state === undefined || state.generation === observedGeneration) {
      return observedCurrent;
    }
    return state.lastRestored ?? observedCurrent;
  }

  public commitRestored(
    lane: Lane,
    direction: NavigationHistoryDirection,
    expectedTarget: Location,
    current: Location,
    restored: Location = expectedTarget,
  ): boolean {
    const state = this.lanes.get(lane);
    if (
      state === undefined ||
      !state.history.commitRestored(direction, expectedTarget, current)
    ) {
      return false;
    }
    state.generation += 1;
    state.lastRestored = restored;
    return true;
  }

  public snapshot(lane: Lane): NavigationHistorySnapshot {
    return this.lanes.get(lane)?.history.snapshot() ?? { back: 0, forward: 0 };
  }

  public aggregateSnapshot(): NavigationHistorySnapshot {
    let back = 0;
    let forward = 0;
    for (const state of this.lanes.values()) {
      const snapshot = state.history.snapshot();
      back += snapshot.back;
      forward += snapshot.forward;
    }
    return { back, forward };
  }

  public delete(lane: Lane): boolean {
    return this.lanes.delete(lane);
  }

  public clear(): void {
    this.lanes.clear();
  }

  private ensureLane(lane: Lane): NavigationHistoryLane<Location> {
    const existing = this.lanes.get(lane);
    if (existing !== undefined) {
      return existing;
    }
    const created: NavigationHistoryLane<Location> = {
      history: new NavigationHistory(this.equals, this.limit),
      generation: 0,
      lastRestored: undefined,
    };
    this.lanes.set(lane, created);
    return created;
  }
}

function pushDistinct<Location>(
  locations: Location[],
  location: Location,
  equals: (left: Location, right: Location) => boolean,
  limit: number,
): void {
  const previous = locations.at(-1);
  if (previous !== undefined && equals(previous, location)) {
    return;
  }
  locations.push(location);
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, limit) : 100;
  if (locations.length > safeLimit) {
    locations.splice(0, locations.length - safeLimit);
  }
}
