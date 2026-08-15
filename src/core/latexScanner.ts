import {
  LatexContext,
  LatexDelimiterFrame,
  LatexEnvironmentFrame,
  LatexMathRegion,
  LatexMathMode,
  LatexScanState,
} from './types';

const BLOCK_MATH_ENVIRONMENTS = new Set([
  'displaymath',
  'equation',
  'align',
  'alignat',
  'aligned',
  'alignedat',
  'gather',
  'gathered',
  'multline',
  'flalign',
  'split',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
]);

const INLINE_MATH_ENVIRONMENTS = new Set(['math']);

const MATRIX_ENVIRONMENTS = new Set([
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
  'align',
  'alignat',
  'aligned',
  'alignedat',
  'cases',
]);

const VERBATIM_ENVIRONMENTS = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted']);

interface MutableLatexScanState {
  environments: LatexEnvironmentFrame[];
  delimiter: LatexDelimiterFrame | undefined;
  inComment: boolean;
  verbatimDelimiter: string | undefined;
  verbatimEnvironment: string | undefined;
}

export function createLatexScanState(): LatexScanState {
  return {
    environments: [],
    delimiter: undefined,
    inComment: false,
    verbatimDelimiter: undefined,
    verbatimEnvironment: undefined,
  };
}

function mutableCopy(state: LatexScanState | undefined): MutableLatexScanState {
  const source = state ?? createLatexScanState();
  return {
    environments: source.environments.map((frame) => ({ ...frame })),
    delimiter: source.delimiter === undefined ? undefined : { ...source.delimiter },
    inComment: source.inComment,
    verbatimDelimiter: source.verbatimDelimiter,
    verbatimEnvironment: source.verbatimEnvironment,
  };
}

function freezeState(state: MutableLatexScanState): LatexScanState {
  return {
    environments: state.environments.map((frame) => ({ ...frame })),
    delimiter: state.delimiter === undefined ? undefined : { ...state.delimiter },
    inComment: state.inComment,
    verbatimDelimiter: state.verbatimDelimiter,
    verbatimEnvironment: state.verbatimEnvironment,
  };
}

function normalizeEnvironmentName(name: string): string {
  return name.endsWith('*') ? name.slice(0, -1) : name;
}

function environmentIs(name: string, set: ReadonlySet<string>): boolean {
  return set.has(name) || set.has(normalizeEnvironmentName(name));
}

function readCommand(text: string, slashOffset: number): { command: string; end: number } {
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { command: '', end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/.test(first)) {
    return { command: first, end: slashOffset + 2 };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/.test(text[end]!)) {
    end += 1;
  }
  return { command: text.slice(slashOffset + 1, end), end };
}

function readBracedValue(text: string, from: number): { value: string; end: number } | undefined {
  let open = from;
  while (open < text.length && /[ \t]/.test(text[open]!)) {
    open += 1;
  }
  if (text[open] !== '{') {
    return undefined;
  }
  const close = text.indexOf('}', open + 1);
  if (close < 0) {
    return undefined;
  }
  return { value: text.slice(open + 1, close).trim(), end: close + 1 };
}

function closeEnvironment(state: MutableLatexScanState, name: string): void {
  for (let index = state.environments.length - 1; index >= 0; index -= 1) {
    const frame = state.environments[index];
    if (frame?.name === name) {
      state.environments.splice(index, state.environments.length - index);
      return;
    }
  }
}

function openDelimiter(
  state: MutableLatexScanState,
  kind: LatexDelimiterFrame['kind'],
  startOffset: number,
): void {
  if (state.delimiter === undefined) {
    state.delimiter = { kind, startOffset };
  }
}

function closeDelimiter(state: MutableLatexScanState, kind: LatexDelimiterFrame['kind']): void {
  if (state.delimiter?.kind === kind) {
    state.delimiter = undefined;
  }
}

/**
 * Scan one segment while carrying state from a previous segment. This is the
 * primitive adapters can use for incremental, line-oriented caching.
 */
export function scanLatexSegment(
  text: string,
  initialState: LatexScanState = createLatexScanState(),
  baseOffset = 0,
): LatexScanState {
  const state = mutableCopy(initialState);
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (state.verbatimEnvironment !== undefined) {
      const endToken = `\\end{${state.verbatimEnvironment}}`;
      if (text.startsWith(endToken, index)) {
        closeEnvironment(state, state.verbatimEnvironment);
        state.verbatimEnvironment = undefined;
        index += endToken.length;
      } else {
        index += 1;
      }
      continue;
    }

    if (state.verbatimDelimiter !== undefined) {
      if (char === state.verbatimDelimiter || char === '\n' || char === '\r') {
        state.verbatimDelimiter = undefined;
      }
      index += 1;
      continue;
    }

    if (state.inComment) {
      if (char === '\n' || char === '\r') {
        state.inComment = false;
      }
      index += 1;
      continue;
    }

    if (char === '%') {
      state.inComment = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const { command, end } = readCommand(text, index);
      const absoluteOffset = baseOffset + index;

      if (command === '(') {
        openDelimiter(state, 'paren', absoluteOffset);
        index = end;
        continue;
      }
      if (command === ')') {
        closeDelimiter(state, 'paren');
        index = end;
        continue;
      }
      if (command === '[') {
        openDelimiter(state, 'bracket', absoluteOffset);
        index = end;
        continue;
      }
      if (command === ']') {
        closeDelimiter(state, 'bracket');
        index = end;
        continue;
      }

      if (command === 'verb') {
        let delimiterOffset = end;
        if (text[delimiterOffset] === '*') {
          delimiterOffset += 1;
        }
        const delimiter = text[delimiterOffset];
        if (delimiter !== undefined && delimiter !== '\n' && delimiter !== '\r') {
          state.verbatimDelimiter = delimiter;
          index = delimiterOffset + 1;
        } else {
          index = end;
        }
        continue;
      }

      if (command === 'begin' || command === 'end') {
        const braced = readBracedValue(text, end);
        if (braced !== undefined && braced.value.length > 0) {
          if (command === 'begin') {
            state.environments.push({ name: braced.value, startOffset: absoluteOffset });
            if (environmentIs(braced.value, VERBATIM_ENVIRONMENTS)) {
              state.verbatimEnvironment = braced.value;
            }
          } else {
            closeEnvironment(state, braced.value);
          }
          index = braced.end;
          continue;
        }
      }

      // Non-letter commands such as \$, \%, and \\ consume the escaped
      // character here, so it cannot be mistaken for syntax on the next loop.
      index = Math.max(index + 1, end);
      continue;
    }

    if (char === '$') {
      const isDouble = text[index + 1] === '$';
      const absoluteOffset = baseOffset + index;
      if (isDouble) {
        if (state.delimiter?.kind === 'dollar-block') {
          state.delimiter = undefined;
        } else if (state.delimiter === undefined) {
          openDelimiter(state, 'dollar-block', absoluteOffset);
        }
        index += 2;
      } else {
        if (state.delimiter?.kind === 'dollar-inline') {
          state.delimiter = undefined;
        } else if (state.delimiter === undefined) {
          openDelimiter(state, 'dollar-inline', absoluteOffset);
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return freezeState(state);
}

export function latexContextFromState(state: LatexScanState): LatexContext {
  let mathMode: LatexMathMode = 'text';
  if (state.delimiter?.kind === 'dollar-inline' || state.delimiter?.kind === 'paren') {
    mathMode = 'inline';
  } else if (state.delimiter !== undefined) {
    mathMode = 'block';
  } else if (state.environments.some((frame) => environmentIs(frame.name, BLOCK_MATH_ENVIRONMENTS))) {
    mathMode = 'block';
  } else if (state.environments.some((frame) => environmentIs(frame.name, INLINE_MATH_ENVIRONMENTS))) {
    mathMode = 'inline';
  }

  let matrixEnvironment: string | undefined;
  for (let index = state.environments.length - 1; index >= 0; index -= 1) {
    const frame = state.environments[index];
    if (frame !== undefined && environmentIs(frame.name, MATRIX_ENVIRONMENTS)) {
      matrixEnvironment = frame.name;
      break;
    }
  }

  return {
    mathMode,
    inComment: state.inComment,
    inVerbatim: state.verbatimDelimiter !== undefined || state.verbatimEnvironment !== undefined,
    environments: state.environments.map((frame) => frame.name),
    matrixEnvironment,
  };
}

/** Scan text from the beginning and return context at a UTF-16 offset. */
export function scanLatexContext(text: string, offset = text.length): LatexContext {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  return latexContextFromState(scanLatexSegment(text.slice(0, boundedOffset)));
}

export function isMathEnvironment(name: string): boolean {
  return environmentIs(name, BLOCK_MATH_ENVIRONMENTS) || environmentIs(name, INLINE_MATH_ENVIRONMENTS);
}

export function isMatrixEnvironment(name: string): boolean {
  return environmentIs(name, MATRIX_ENVIRONMENTS);
}

interface RegionEnvironmentFrame {
  readonly name: string;
  readonly outerStart: number;
  readonly innerStart: number;
  readonly mode: 'inline' | 'block' | undefined;
}

interface RegionDelimiterFrame {
  readonly kind: LatexDelimiterFrame['kind'];
  readonly outerStart: number;
  readonly innerStart: number;
  readonly mode: 'inline' | 'block';
}

function mathEnvironmentMode(name: string): 'inline' | 'block' | undefined {
  if (environmentIs(name, BLOCK_MATH_ENVIRONMENTS)) {
    return 'block';
  }
  if (environmentIs(name, INLINE_MATH_ENVIRONMENTS)) {
    return 'inline';
  }
  return undefined;
}

/**
 * Find every LaTeX math region in one O(n) pass. The result contains closed
 * regions as well as regions whose opening syntax remains open at EOF. This is
 * intended for adapters that need to decorate all math spans without rescanning
 * the document once per bracket.
 */
export function scanLatexRegions(text: string): readonly LatexMathRegion[] {
  const regions: LatexMathRegion[] = [];
  const environments: RegionEnvironmentFrame[] = [];
  let delimiter: RegionDelimiterFrame | undefined;
  let inComment = false;
  let verbatimDelimiter: string | undefined;
  let verbatimEnvironment: string | undefined;
  let index = 0;

  const closeDelimiterRegion = (closeStart: number, closeEnd: number): void => {
    if (delimiter === undefined) {
      return;
    }
    regions.push({
      outerStart: delimiter.outerStart,
      innerStart: delimiter.innerStart,
      innerEnd: closeStart,
      outerEnd: closeEnd,
      mode: delimiter.mode,
      closed: true,
    });
    delimiter = undefined;
  };

  while (index < text.length) {
    const char = text[index];

    if (verbatimEnvironment !== undefined) {
      const endToken = `\\end{${verbatimEnvironment}}`;
      if (text.startsWith(endToken, index)) {
        for (let frameIndex = environments.length - 1; frameIndex >= 0; frameIndex -= 1) {
          if (environments[frameIndex]?.name === verbatimEnvironment) {
            environments.splice(frameIndex, 1);
            break;
          }
        }
        verbatimEnvironment = undefined;
        index += endToken.length;
      } else {
        index += 1;
      }
      continue;
    }

    if (verbatimDelimiter !== undefined) {
      if (char === verbatimDelimiter || char === '\n' || char === '\r') {
        verbatimDelimiter = undefined;
      }
      index += 1;
      continue;
    }

    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (char === '%') {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const { command, end } = readCommand(text, index);

      if (command === '(') {
        if (delimiter === undefined) {
          delimiter = {
            kind: 'paren',
            outerStart: index,
            innerStart: end,
            mode: 'inline',
          };
        }
        index = end;
        continue;
      }
      if (command === ')') {
        if (delimiter?.kind === 'paren') {
          closeDelimiterRegion(index, end);
        }
        index = end;
        continue;
      }
      if (command === '[') {
        if (delimiter === undefined) {
          delimiter = {
            kind: 'bracket',
            outerStart: index,
            innerStart: end,
            mode: 'block',
          };
        }
        index = end;
        continue;
      }
      if (command === ']') {
        if (delimiter?.kind === 'bracket') {
          closeDelimiterRegion(index, end);
        }
        index = end;
        continue;
      }

      if (command === 'verb') {
        let delimiterOffset = end;
        if (text[delimiterOffset] === '*') {
          delimiterOffset += 1;
        }
        const verbDelimiter = text[delimiterOffset];
        if (verbDelimiter !== undefined && verbDelimiter !== '\n' && verbDelimiter !== '\r') {
          verbatimDelimiter = verbDelimiter;
          index = delimiterOffset + 1;
        } else {
          index = end;
        }
        continue;
      }

      if (command === 'begin' || command === 'end') {
        const braced = readBracedValue(text, end);
        if (braced !== undefined && braced.value.length > 0) {
          if (command === 'begin') {
            const frame: RegionEnvironmentFrame = {
              name: braced.value,
              outerStart: index,
              innerStart: braced.end,
              mode: mathEnvironmentMode(braced.value),
            };
            environments.push(frame);
            if (environmentIs(braced.value, VERBATIM_ENVIRONMENTS)) {
              verbatimEnvironment = braced.value;
            }
          } else {
            for (let frameIndex = environments.length - 1; frameIndex >= 0; frameIndex -= 1) {
              const frame = environments[frameIndex];
              if (frame === undefined || frame.name !== braced.value) {
                continue;
              }
              environments.splice(frameIndex, 1);
              if (frame.mode !== undefined) {
                regions.push({
                  outerStart: frame.outerStart,
                  innerStart: frame.innerStart,
                  innerEnd: index,
                  outerEnd: braced.end,
                  mode: frame.mode,
                  environmentName: frame.name,
                  closed: true,
                });
              }
              break;
            }
          }
          index = braced.end;
          continue;
        }
      }

      // Escaped punctuation is consumed with the command so it cannot open a
      // dollar/comment region on the next iteration.
      index = Math.max(index + 1, end);
      continue;
    }

    if (char === '$') {
      const isDouble = text[index + 1] === '$';
      if (isDouble) {
        if (delimiter?.kind === 'dollar-block') {
          closeDelimiterRegion(index, index + 2);
        } else if (delimiter === undefined) {
          delimiter = {
            kind: 'dollar-block',
            outerStart: index,
            innerStart: index + 2,
            mode: 'block',
          };
        }
        index += 2;
      } else {
        if (delimiter?.kind === 'dollar-inline') {
          closeDelimiterRegion(index, index + 1);
        } else if (delimiter === undefined) {
          delimiter = {
            kind: 'dollar-inline',
            outerStart: index,
            innerStart: index + 1,
            mode: 'inline',
          };
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  if (delimiter !== undefined) {
    regions.push({
      outerStart: delimiter.outerStart,
      innerStart: delimiter.innerStart,
      innerEnd: text.length,
      outerEnd: text.length,
      mode: delimiter.mode,
      closed: false,
    });
  }

  for (const frame of environments) {
    if (frame.mode === undefined) {
      continue;
    }
    regions.push({
      outerStart: frame.outerStart,
      innerStart: frame.innerStart,
      innerEnd: text.length,
      outerEnd: text.length,
      mode: frame.mode,
      environmentName: frame.name,
      closed: false,
    });
  }

  regions.sort((left, right) =>
    left.outerStart - right.outerStart || right.outerEnd - left.outerEnd,
  );
  return regions;
}
