/**
 * TeXLeaf's factory-default, declarative snippet library.
 *
 * Adapted from the default snippets in Snippetleaf and Obsidian LaTeX Suite:
 * https://github.com/superle3/snippet-leaf
 * Copyright (c) artisticat1 and contributors, used under the MIT License.
 *
 * This adaptation is data-only: regex triggers are strings, replacements are
 * never executable, and the omitted syntaxVersion defaults to version 2.
 */

type DefaultSnippetDefinition = Readonly<{
  id: string;
  trigger: string;
  replacement: string;
  options: string;
  priority?: number;
  description?: string;
  category?: string;
  flags?: string;
  syntaxVersion?: 1 | 2;
}>;

export const DEFAULT_SNIPPETS: readonly DefaultSnippetDefinition[] = [
  // Math mode
  { id: 'mode.inline', trigger: 'mk', replacement: '\\(@0\\)', options: 'tA', description: 'Inline math', category: 'Math mode' },
  { id: 'mode.display', trigger: 'dm', replacement: '\\[\n@0\n\\]', options: 'tAw', description: 'Display math', category: 'Math mode' },
  { id: 'mode.environment', trigger: 'beg', replacement: '\\begin{@0}\n@1\n\\end{@0}', options: 'mA', description: 'LaTeX environment', category: 'Math mode' },

  // Greek letters
  { id: 'greek.alpha', trigger: ';a', replacement: '\\alpha', options: 'mA', description: 'alpha', category: 'Greek letters' },
  { id: 'greek.beta', trigger: ';b', replacement: '\\beta', options: 'mA', description: 'beta', category: 'Greek letters' },
  { id: 'greek.gamma', trigger: ';g', replacement: '\\gamma', options: 'mA', description: 'gamma', category: 'Greek letters' },
  { id: 'greek.capital-gamma', trigger: ';G', replacement: '\\Gamma', options: 'mA', description: 'capital Gamma', category: 'Greek letters' },
  { id: 'greek.delta', trigger: ';d', replacement: '\\delta', options: 'mA', description: 'delta', category: 'Greek letters' },
  { id: 'greek.capital-delta', trigger: ';D', replacement: '\\Delta', options: 'mA', description: 'capital Delta', category: 'Greek letters' },
  { id: 'greek.epsilon', trigger: ';e', replacement: '\\epsilon', options: 'mA', description: 'epsilon', category: 'Greek letters' },
  { id: 'greek.varepsilon', trigger: ':e', replacement: '\\varepsilon', options: 'mA', description: 'variant epsilon', category: 'Greek letters' },
  { id: 'greek.zeta', trigger: ';z', replacement: '\\zeta', options: 'mA', description: 'zeta', category: 'Greek letters' },
  { id: 'greek.theta', trigger: ';t', replacement: '\\theta', options: 'mA', description: 'theta', category: 'Greek letters' },
  { id: 'greek.capital-theta', trigger: ';T', replacement: '\\Theta', options: 'mA', description: 'capital Theta', category: 'Greek letters' },
  { id: 'greek.vartheta', trigger: ':t', replacement: '\\vartheta', options: 'mA', description: 'variant theta', category: 'Greek letters' },
  { id: 'greek.iota', trigger: ';i', replacement: '\\iota', options: 'mA', description: 'iota', category: 'Greek letters' },
  { id: 'greek.kappa', trigger: ';k', replacement: '\\kappa', options: 'mA', description: 'kappa', category: 'Greek letters' },
  { id: 'greek.lambda', trigger: ';l', replacement: '\\lambda', options: 'mA', description: 'lambda', category: 'Greek letters' },
  { id: 'greek.capital-lambda', trigger: ';L', replacement: '\\Lambda', options: 'mA', description: 'capital Lambda', category: 'Greek letters' },
  { id: 'greek.sigma', trigger: ';s', replacement: '\\sigma', options: 'mA', description: 'sigma', category: 'Greek letters' },
  { id: 'greek.capital-sigma', trigger: ';S', replacement: '\\Sigma', options: 'mA', description: 'capital Sigma', category: 'Greek letters' },
  { id: 'greek.upsilon', trigger: ';u', replacement: '\\upsilon', options: 'mA', description: 'upsilon', category: 'Greek letters' },
  { id: 'greek.capital-upsilon', trigger: ';U', replacement: '\\Upsilon', options: 'mA', description: 'capital Upsilon', category: 'Greek letters' },
  { id: 'greek.omega', trigger: ';o', replacement: '\\omega', options: 'mA', description: 'omega', category: 'Greek letters' },
  { id: 'greek.capital-omega', trigger: ';O', replacement: '\\Omega', options: 'mA', description: 'capital Omega', category: 'Greek letters' },
  { id: 'greek.omega-word', trigger: 'ome', replacement: '\\omega', options: 'mA', description: 'omega', category: 'Greek letters' },
  { id: 'greek.capital-omega-word', trigger: 'Ome', replacement: '\\Omega', options: 'mA', description: 'capital Omega', category: 'Greek letters' },

  // Text and basic operations
  { id: 'text.command', trigger: 'text', replacement: '\\text{@0}@1', options: 'mA', description: 'Text in math', category: 'Text' },
  { id: 'text.quote', trigger: '"', replacement: '\\text{@0}@1', options: 'mA', description: 'Text in math', category: 'Text' },
  { id: 'basic.square', trigger: 'sr', replacement: '^{2}', options: 'mA', description: 'Square', category: 'Basic operations' },
  { id: 'basic.cube', trigger: 'cb', replacement: '^{3}', options: 'mA', description: 'Cube', category: 'Basic operations' },
  { id: 'basic.power', trigger: 'rd', replacement: '^{@0}@1', options: 'mA', description: 'Power', category: 'Basic operations' },
  { id: 'basic.subscript', trigger: '_', replacement: '_{@0}@1', options: 'mA', description: 'Subscript', category: 'Basic operations' },
  { id: 'basic.text-subscript', trigger: 'sts', replacement: '_\\text{@0}', options: 'mA', description: 'Text subscript', category: 'Basic operations' },
  { id: 'basic.sqrt', trigger: 'sq', replacement: '\\sqrt{ @0 }@1', options: 'mA', description: 'Square root', category: 'Basic operations' },
  { id: 'basic.fraction', trigger: '//', replacement: '\\frac{@0}{@1}@2', options: 'mA', description: 'Fraction', category: 'Basic operations' },
  { id: 'basic.exponential', trigger: 'ee', replacement: 'e^{ @0 }@1', options: 'mA', description: 'Exponential', category: 'Basic operations' },
  { id: 'basic.inverse', trigger: 'invs', replacement: '^{-1}', options: 'mA', description: 'Inverse', category: 'Basic operations' },
  { id: 'basic.letter-digit', trigger: '([A-Za-z])(\\d)', replacement: '@[0]_{@[1]}', options: 'rmA', priority: -1, description: 'Single-digit letter subscript', category: 'Basic operations' },
  { id: 'basic.named-function', trigger: '([^\\\\])(exp|log|ln)', replacement: '@[0]\\@[1]', options: 'rmA', description: 'Prefix exp, log, or ln with a backslash', category: 'Basic operations' },
  { id: 'basic.conjugate', trigger: 'conj', replacement: '^{*}', options: 'mA', description: 'Complex conjugate', category: 'Basic operations' },
  { id: 'basic.real-part', trigger: 'Re', replacement: '\\mathrm{Re}', options: 'mA', description: 'Real part', category: 'Basic operations' },
  { id: 'basic.imaginary-part', trigger: 'Im', replacement: '\\mathrm{Im}', options: 'mA', description: 'Imaginary part', category: 'Basic operations' },
  { id: 'basic.bold', trigger: 'bf', replacement: '\\mathbf{@0}', options: 'mA', description: 'Bold math text', category: 'Basic operations' },
  { id: 'basic.roman', trigger: 'rm', replacement: '\\mathrm{@0}@1', options: 'mA', description: 'Roman math text', category: 'Basic operations' },
  { id: 'linear.det-prefix', trigger: '([^\\\\])(det)', replacement: '@[0]\\@[1]', options: 'rmA', description: 'Prefix det with a backslash', category: 'Linear algebra' },
  { id: 'linear.trace', trigger: 'trace', replacement: '\\mathrm{Tr}', options: 'mA', description: 'Matrix trace', category: 'Linear algebra' },

  // Accents and vectors
  { id: 'accent.auto-hat', trigger: '([A-Za-z])hat', replacement: '\\hat{@[0]}', options: 'rmA', priority: 1, description: 'Hat preceding letter', category: 'Accents' },
  { id: 'accent.auto-bar', trigger: '([A-Za-z])bar', replacement: '\\bar{@[0]}', options: 'rmA', priority: 1, description: 'Bar preceding letter', category: 'Accents' },
  { id: 'accent.auto-dot', trigger: '([A-Za-z])dot', replacement: '\\dot{@[0]}', options: 'rmA', priority: 0, description: 'Dot preceding letter', category: 'Accents' },
  { id: 'accent.auto-ddot', trigger: '([A-Za-z])ddot', replacement: '\\ddot{@[0]}', options: 'rmA', priority: 1, description: 'Double dot preceding letter', category: 'Accents' },
  { id: 'accent.auto-tilde', trigger: '([A-Za-z])tilde', replacement: '\\tilde{@[0]}', options: 'rmA', priority: 1, description: 'Tilde preceding letter', category: 'Accents' },
  { id: 'accent.auto-underline', trigger: '([A-Za-z])und', replacement: '\\underline{@[0]}', options: 'rmA', priority: 1, description: 'Underline preceding letter', category: 'Accents' },
  { id: 'accent.auto-vector', trigger: '([A-Za-z])vec', replacement: '\\vec{@[0]}', options: 'rmA', priority: 1, description: 'Vector preceding letter', category: 'Accents' },
  { id: 'accent.auto-bold-after', trigger: '([A-Za-z]),\\.', replacement: '\\mathbf{@[0]}', options: 'rmA', description: 'Bold preceding letter', category: 'Accents' },
  { id: 'accent.auto-bold-before', trigger: '([A-Za-z])\\.,', replacement: '\\mathbf{@[0]}', options: 'rmA', description: 'Bold preceding letter', category: 'Accents' },
  { id: 'accent.auto-bold-greek-after', trigger: '\\\\(${GREEK}),\\.', replacement: '\\boldsymbol{\\@[0]}', options: 'rmA', description: 'Bold Greek letter', category: 'Accents' },
  { id: 'accent.auto-bold-greek-before', trigger: '\\\\(${GREEK})\\.,', replacement: '\\boldsymbol{\\@[0]}', options: 'rmA', description: 'Bold Greek letter', category: 'Accents' },
  { id: 'accent.hat', trigger: 'hat', replacement: '\\hat{@0}@1', options: 'mA', description: 'Hat', category: 'Accents' },
  { id: 'accent.bar', trigger: 'bar', replacement: '\\bar{@0}@1', options: 'mA', description: 'Bar', category: 'Accents' },
  { id: 'accent.dot', trigger: 'dot', replacement: '\\dot{@0}@1', options: 'mA', priority: -1, description: 'Dot', category: 'Accents' },
  { id: 'accent.ddot', trigger: 'ddot', replacement: '\\ddot{@0}@1', options: 'mA', description: 'Double dot', category: 'Accents' },
  { id: 'accent.cdot', trigger: 'cdot', replacement: '\\cdot', options: 'mA', description: 'Centered dot', category: 'Accents' },
  { id: 'accent.tilde', trigger: 'tilde', replacement: '\\tilde{@0}@1', options: 'mA', description: 'Tilde', category: 'Accents' },
  { id: 'accent.underline', trigger: 'und', replacement: '\\underline{@0}@1', options: 'mA', description: 'Underline', category: 'Accents' },
  { id: 'accent.vector', trigger: 'vec', replacement: '\\vec{@0}@1', options: 'mA', description: 'Vector', category: 'Accents' },

  // Subscripts
  { id: 'subscript.letter-two-digits', trigger: '([A-Za-z])_(\\d\\d)', replacement: '@[0]_{@[1]}', options: 'rmA', description: 'Two-digit letter subscript', category: 'Subscripts' },
  { id: 'subscript.hat-digit', trigger: '\\\\hat\\{([A-Za-z])\\}(\\d)', replacement: '\\hat{@[0]}_{@[1]}', options: 'rmA', description: 'Subscript a hatted letter', category: 'Subscripts' },
  { id: 'subscript.vector-digit', trigger: '\\\\vec\\{([A-Za-z])\\}(\\d)', replacement: '\\vec{@[0]}_{@[1]}', options: 'rmA', description: 'Subscript a vector', category: 'Subscripts' },
  { id: 'subscript.bold-digit', trigger: '\\\\mathbf\\{([A-Za-z])\\}(\\d)', replacement: '\\mathbf{@[0]}_{@[1]}', options: 'rmA', description: 'Subscript a bold letter', category: 'Subscripts' },
  { id: 'subscript.x-n', trigger: 'xnn', replacement: 'x_{n}', options: 'mA', description: 'x sub n', category: 'Subscripts' },
  { id: 'subscript.x-n-plus-one', trigger: 'xp1', replacement: 'x_{n+1}', options: 'mA', description: 'x sub n plus one', category: 'Subscripts' },
  { id: 'subscript.y-n', trigger: 'ynn', replacement: 'y_{n}', options: 'mA', description: 'y sub n', category: 'Subscripts' },
  { id: 'subscript.y-j', trigger: 'yjj', replacement: 'y_{j}', options: 'mA', description: 'y sub j', category: 'Subscripts' },

  // Symbols and operators
  { id: 'symbol.infinity', trigger: 'ooo', replacement: '\\infty', options: 'mA', description: 'Infinity', category: 'Symbols' },
  { id: 'symbol.sum', trigger: 'sum', replacement: '\\sum', options: 'mA', description: 'Summation', category: 'Symbols' },
  { id: 'symbol.product', trigger: 'prod', replacement: '\\prod', options: 'mA', description: 'Product', category: 'Symbols' },
  { id: 'symbol.sum-limits', trigger: '\\sum', replacement: '\\sum_{@{0:i}=@{1:1}}^{@{2:N}} @3', options: 'm', description: 'Summation with limits', category: 'Symbols' },
  { id: 'symbol.product-limits', trigger: '\\prod', replacement: '\\prod_{@{0:i}=@{1:1}}^{@{2:N}} @3', options: 'm', description: 'Product with limits', category: 'Symbols' },
  { id: 'symbol.limit', trigger: 'lim', replacement: '\\lim_{ @{0:n} \\to @{1:\\infty} } @2', options: 'mA', description: 'Limit', category: 'Symbols' },
  { id: 'symbol.plus-minus', trigger: '+-', replacement: '\\pm', options: 'mA', description: 'Plus or minus', category: 'Symbols' },
  { id: 'symbol.minus-plus', trigger: '-+', replacement: '\\mp', options: 'mA', description: 'Minus or plus', category: 'Symbols' },
  { id: 'symbol.dots', trigger: '...', replacement: '\\dots', options: 'mA', description: 'Ellipsis', category: 'Symbols' },
  { id: 'symbol.nabla', trigger: 'nabl', replacement: '\\nabla', options: 'mA', description: 'Nabla', category: 'Symbols' },
  { id: 'symbol.times', trigger: 'xx', replacement: '\\times', options: 'mA', description: 'Multiplication sign', category: 'Symbols' },
  { id: 'symbol.centered-dot', trigger: '**', replacement: '\\cdot', options: 'mA', description: 'Centered dot', category: 'Symbols' },
  { id: 'symbol.parallel', trigger: 'para', replacement: '\\parallel', options: 'mA', description: 'Parallel', category: 'Symbols' },
  { id: 'relation.equivalent', trigger: '===', replacement: '\\equiv', options: 'mA', description: 'Equivalent', category: 'Relations' },
  { id: 'relation.not-equal', trigger: '!=', replacement: '\\neq', options: 'mA', description: 'Not equal', category: 'Relations' },
  { id: 'relation.greater-equal', trigger: '>=', replacement: '\\geq', options: 'mA', description: 'Greater than or equal', category: 'Relations' },
  { id: 'relation.less-equal', trigger: '<=', replacement: '\\leq', options: 'mA', description: 'Less than or equal', category: 'Relations' },
  { id: 'relation.much-greater', trigger: '>>', replacement: '\\gg', options: 'mA', description: 'Much greater than', category: 'Relations' },
  { id: 'relation.much-less', trigger: '<<', replacement: '\\ll', options: 'mA', description: 'Much less than', category: 'Relations' },
  { id: 'relation.similar', trigger: 'simm', replacement: '\\sim', options: 'mA', description: 'Similar', category: 'Relations' },
  { id: 'relation.simeq', trigger: 'sim=', replacement: '\\simeq', options: 'mA', description: 'Similar or equal', category: 'Relations' },
  { id: 'relation.proportional', trigger: 'prop', replacement: '\\propto', options: 'mA', description: 'Proportional to', category: 'Relations' },
  { id: 'arrow.left-right', trigger: '<->', replacement: '\\leftrightarrow ', options: 'mA', description: 'Left-right arrow', category: 'Arrows' },
  { id: 'arrow.right', trigger: '->', replacement: '\\to', options: 'mA', description: 'Right arrow', category: 'Arrows' },
  { id: 'arrow.maps-to', trigger: '!>', replacement: '\\mapsto', options: 'mA', description: 'Maps to', category: 'Arrows' },
  { id: 'arrow.implies', trigger: '=>', replacement: '\\implies', options: 'mA', description: 'Implies', category: 'Arrows' },
  { id: 'arrow.implied-by', trigger: '=<', replacement: '\\impliedby', options: 'mA', description: 'Implied by', category: 'Arrows' },
  { id: 'set.intersection', trigger: 'and', replacement: '\\cap', options: 'mA', description: 'Set intersection', category: 'Sets' },
  { id: 'set.union', trigger: 'orr', replacement: '\\cup', options: 'mA', description: 'Set union', category: 'Sets' },
  { id: 'set.member', trigger: 'inn', replacement: '\\in', options: 'mA', description: 'Set membership', category: 'Sets' },
  { id: 'set.not-member', trigger: 'notin', replacement: '\\not\\in', options: 'mA', description: 'Not a member', category: 'Sets' },
  { id: 'set.difference', trigger: '\\\\\\', replacement: '\\setminus', options: 'mA', description: 'Set difference', category: 'Sets' },
  { id: 'set.subset-equal', trigger: 'sub=', replacement: '\\subseteq', options: 'mA', description: 'Subset or equal', category: 'Sets' },
  { id: 'set.superset-equal', trigger: 'sup=', replacement: '\\supseteq', options: 'mA', description: 'Superset or equal', category: 'Sets' },
  { id: 'set.empty', trigger: 'eset', replacement: '\\emptyset', options: 'mA', description: 'Empty set', category: 'Sets' },
  { id: 'set.builder', trigger: 'set', replacement: '\\{ @0 \\}@1', options: 'mA', description: 'Set braces', category: 'Sets' },
  { id: 'set.exists', trigger: 'exists', replacement: '\\exists', options: 'mA', description: 'Exists', category: 'Sets' },
  { id: 'font.calligraphic-l', trigger: 'LL', replacement: '\\mathcal{L}', options: 'mA', description: 'Calligraphic L', category: 'Math fonts' },
  { id: 'font.calligraphic-h', trigger: 'HH', replacement: '\\mathcal{H}', options: 'mA', description: 'Calligraphic H', category: 'Math fonts' },
  { id: 'font.complex', trigger: 'CC', replacement: '\\mathbb{C}', options: 'mA', description: 'Complex numbers', category: 'Math fonts' },
  { id: 'font.real', trigger: 'RR', replacement: '\\mathbb{R}', options: 'mA', description: 'Real numbers', category: 'Math fonts' },
  { id: 'font.integer', trigger: 'ZZ', replacement: '\\mathbb{Z}', options: 'mA', description: 'Integers', category: 'Math fonts' },
  { id: 'font.natural', trigger: 'NN', replacement: '\\mathbb{N}', options: 'mA', description: 'Natural numbers', category: 'Math fonts' },

  // Command normalization and postfix operations
  { id: 'normalize.greek-command', trigger: '([^\\\\])(${GREEK})', replacement: '@[0]\\@[1]', options: 'rmA', description: 'Prefix a Greek command with a backslash', category: 'Normalization' },
  { id: 'normalize.symbol-command', trigger: '([^\\\\])(${SYMBOL})', replacement: '@[0]\\@[1]', options: 'rmA', description: 'Prefix a symbol command with a backslash', category: 'Normalization' },
  { id: 'normalize.command-space', trigger: '\\\\(${GREEK}|${SYMBOL}|${MORE_SYMBOLS})([A-Za-z])', replacement: '\\@[0] @[1]', options: 'rmA', description: 'Insert a space after a command', category: 'Normalization' },
  { id: 'postfix.command-square', trigger: '\\\\(${GREEK}|${SYMBOL}) sr', replacement: '\\@[0]^{2}', options: 'rmA', description: 'Square a command', category: 'Postfix operations' },
  { id: 'postfix.command-cube', trigger: '\\\\(${GREEK}|${SYMBOL}) cb', replacement: '\\@[0]^{3}', options: 'rmA', description: 'Cube a command', category: 'Postfix operations' },
  { id: 'postfix.command-power', trigger: '\\\\(${GREEK}|${SYMBOL}) rd', replacement: '\\@[0]^{@0}@1', options: 'rmA', description: 'Raise a command to a power', category: 'Postfix operations' },
  { id: 'postfix.command-hat', trigger: '\\\\(${GREEK}|${SYMBOL}) hat', replacement: '\\hat{\\@[0]}', options: 'rmA', priority: 1, description: 'Hat a command', category: 'Postfix operations' },
  { id: 'postfix.command-dot', trigger: '\\\\(${GREEK}|${SYMBOL}) dot', replacement: '\\dot{\\@[0]}', options: 'rmA', description: 'Dot a command', category: 'Postfix operations' },
  { id: 'postfix.command-bar', trigger: '\\\\(${GREEK}|${SYMBOL}) bar', replacement: '\\bar{\\@[0]}', options: 'rmA', priority: 1, description: 'Bar a command', category: 'Postfix operations' },
  { id: 'postfix.command-vector', trigger: '\\\\(${GREEK}|${SYMBOL}) vec', replacement: '\\vec{\\@[0]}', options: 'rmA', priority: 1, description: 'Vectorize a command', category: 'Postfix operations' },
  { id: 'postfix.command-tilde', trigger: '\\\\(${GREEK}|${SYMBOL}) tilde', replacement: '\\tilde{\\@[0]}', options: 'rmA', priority: 1, description: 'Tilde a command', category: 'Postfix operations' },
  { id: 'postfix.command-underline', trigger: '\\\\(${GREEK}|${SYMBOL}) und', replacement: '\\underline{\\@[0]}', options: 'rmA', priority: 1, description: 'Underline a command', category: 'Postfix operations' },

  // Derivatives, integrals, and trigonometry
  { id: 'calculus.partial', trigger: 'par', replacement: '\\frac{ \\partial @{0:y} }{ \\partial @{1:x} } @2', options: 'm', description: 'Partial derivative', category: 'Calculus' },
  { id: 'calculus.partial-compact', trigger: 'pa([A-Za-z])([A-Za-z])', replacement: '\\frac{ \\partial @[0] }{ \\partial @[1] } ', options: 'rm', description: 'Compact partial derivative', category: 'Calculus' },
  { id: 'calculus.ddt', trigger: 'ddt', replacement: '\\frac{d}{dt} ', options: 'mA', description: 'Time derivative', category: 'Calculus' },
  { id: 'calculus.integral-command', trigger: '([^\\\\])int', replacement: '@[0]\\int', options: 'rmA', priority: -1, description: 'Prefix int with a backslash', category: 'Calculus' },
  { id: 'calculus.integral-template', trigger: '\\int', replacement: '\\int @0 \\, d@{1:x} @2', options: 'm', description: 'Integral with differential', category: 'Calculus' },
  { id: 'calculus.definite-integral', trigger: 'dint', replacement: '\\int_{@{0:0}}^{@{1:1}} @2 \\, d@{3:x} @4', options: 'mA', description: 'Definite integral', category: 'Calculus' },
  { id: 'calculus.contour-integral', trigger: 'oint', replacement: '\\oint', options: 'mA', description: 'Contour integral', category: 'Calculus' },
  { id: 'calculus.double-integral', trigger: 'iint', replacement: '\\iint', options: 'mA', description: 'Double integral', category: 'Calculus' },
  { id: 'calculus.triple-integral', trigger: 'iiint', replacement: '\\iiint', options: 'mA', description: 'Triple integral', category: 'Calculus' },
  { id: 'calculus.zero-infinity', trigger: 'oinf', replacement: '\\int_{0}^{\\infty} @0 \\, d@{1:x} @2', options: 'mA', description: 'Integral from zero to infinity', category: 'Calculus' },
  { id: 'calculus.all-real', trigger: 'infi', replacement: '\\int_{-\\infty}^{\\infty} @0 \\, d@{1:x} @2', options: 'mA', description: 'Integral over the real line', category: 'Calculus' },
  { id: 'trig.command', trigger: '([^\\\\])(arcsin|sin|arccos|cos|arctan|tan|csc|sec|cot)', replacement: '@[0]\\@[1]', options: 'rmA', description: 'Prefix a trigonometric function with a backslash', category: 'Trigonometry' },
  { id: 'trig.command-space', trigger: '\\\\(arcsin|sin|arccos|cos|arctan|tan|csc|sec|cot)([A-Za-gi-z])', replacement: '\\@[0] @[1]', options: 'rmA', description: 'Insert a space after a trigonometric function', category: 'Trigonometry' },
  { id: 'trig.hyperbolic-space', trigger: '\\\\(sinh|cosh|tanh|coth)([A-Za-z])', replacement: '\\@[0] @[1]', options: 'rmA', description: 'Insert a space after a hyperbolic function', category: 'Trigonometry' },

  // Visual operations (selection required)
  { id: 'visual.underbrace', trigger: 'U', replacement: '\\underbrace{ @{VISUAL} }_{ @0 }@1', options: 'mAv', description: 'Wrap selection in an underbrace', category: 'Visual operations' },
  { id: 'visual.overbrace', trigger: 'O', replacement: '\\overbrace{ @{VISUAL} }^{ @0 }@1', options: 'mAv', description: 'Wrap selection in an overbrace', category: 'Visual operations' },
  { id: 'visual.underset', trigger: 'B', replacement: '\\underset{ @0 }{ @{VISUAL} }@1', options: 'mAv', description: 'Place content under selection', category: 'Visual operations' },
  { id: 'visual.cancel', trigger: 'C', replacement: '\\cancel{ @{VISUAL} }', options: 'mAv', description: 'Cancel selection', category: 'Visual operations' },
  { id: 'visual.cancel-to', trigger: 'K', replacement: '\\cancelto{ @0 }{ @{VISUAL} }@1', options: 'mAv', description: 'Cancel selection to a value', category: 'Visual operations' },
  { id: 'visual.sqrt', trigger: 'S', replacement: '\\sqrt{ @{VISUAL} }', options: 'mAv', description: 'Put selection under a square root', category: 'Visual operations' },
  { id: 'visual.parentheses', trigger: '(', replacement: '(@{VISUAL})', options: 'mAv', description: 'Wrap selection in parentheses', category: 'Visual operations' },
  { id: 'visual.brackets', trigger: '[', replacement: '[@{VISUAL}]', options: 'mAv', description: 'Wrap selection in brackets', category: 'Visual operations' },
  { id: 'visual.braces', trigger: '{', replacement: '{@{VISUAL}}', options: 'mAv', description: 'Wrap selection in braces', category: 'Visual operations' },

  // Physics, quantum mechanics, and chemistry
  { id: 'physics.boltzmann-temperature', trigger: 'kbt', replacement: 'k_{B}T', options: 'mA', description: 'Boltzmann constant times temperature', category: 'Physics' },
  { id: 'physics.solar-mass', trigger: 'msun', replacement: 'M_{\\odot}', options: 'mA', description: 'Solar mass', category: 'Physics' },
  { id: 'quantum.dagger', trigger: 'dag', replacement: '^{\\dagger}', options: 'mA', description: 'Hermitian adjoint', category: 'Quantum mechanics' },
  { id: 'quantum.direct-sum', trigger: 'o+', replacement: '\\oplus ', options: 'mA', description: 'Direct sum', category: 'Quantum mechanics' },
  { id: 'quantum.tensor-product', trigger: 'ox', replacement: '\\otimes ', options: 'mA', description: 'Tensor product', category: 'Quantum mechanics' },
  { id: 'quantum.bra', trigger: 'bra', replacement: '\\bra{@0} @1', options: 'mA', description: 'Bra', category: 'Quantum mechanics' },
  { id: 'quantum.ket', trigger: 'ket', replacement: '\\ket{@0} @1', options: 'mA', description: 'Ket', category: 'Quantum mechanics' },
  { id: 'quantum.braket', trigger: 'brk', replacement: '\\braket{ @0 | @1 } @2', options: 'mA', description: 'Bra-ket', category: 'Quantum mechanics' },
  { id: 'quantum.outer-product', trigger: 'outer', replacement: '\\ket{@{0:\\psi}} \\bra{@{0:\\psi}} @1', options: 'mA', description: 'Outer product', category: 'Quantum mechanics' },
  { id: 'chemistry.unit', trigger: 'pu', replacement: '\\pu{ @0 }', options: 'mA', description: 'Physical unit (mhchem)', category: 'Chemistry' },
  { id: 'chemistry.formula', trigger: 'cee', replacement: '\\ce{ @0 }', options: 'mA', description: 'Chemical formula (mhchem)', category: 'Chemistry' },
  { id: 'chemistry.helium-four', trigger: 'he4', replacement: '{}^{4}_{2}He ', options: 'mA', description: 'Helium-4 isotope', category: 'Chemistry' },
  { id: 'chemistry.helium-three', trigger: 'he3', replacement: '{}^{3}_{2}He ', options: 'mA', description: 'Helium-3 isotope', category: 'Chemistry' },
  { id: 'chemistry.isotope', trigger: 'iso', replacement: '{}^{@{0:4}}_{@{1:2}}@{2:He}', options: 'mA', description: 'Isotope notation', category: 'Chemistry' },

  // Environments
  { id: 'environment.pmatrix-block', trigger: 'pmat', replacement: '\\begin{pmatrix}\n@0\n\\end{pmatrix}', options: 'MA', description: 'Display pmatrix', category: 'Environments' },
  { id: 'environment.bmatrix-block', trigger: 'bmat', replacement: '\\begin{bmatrix}\n@0\n\\end{bmatrix}', options: 'MA', description: 'Display bmatrix', category: 'Environments' },
  { id: 'environment.capital-bmatrix-block', trigger: 'Bmat', replacement: '\\begin{Bmatrix}\n@0\n\\end{Bmatrix}', options: 'MA', description: 'Display Bmatrix', category: 'Environments' },
  { id: 'environment.vmatrix-block', trigger: 'vmat', replacement: '\\begin{vmatrix}\n@0\n\\end{vmatrix}', options: 'MA', description: 'Display vmatrix', category: 'Environments' },
  { id: 'environment.capital-vmatrix-block', trigger: 'Vmat', replacement: '\\begin{Vmatrix}\n@0\n\\end{Vmatrix}', options: 'MA', description: 'Display Vmatrix', category: 'Environments' },
  { id: 'environment.matrix-block', trigger: 'matrix', replacement: '\\begin{matrix}\n@0\n\\end{matrix}', options: 'MA', description: 'Display matrix', category: 'Environments' },
  { id: 'environment.pmatrix-inline', trigger: 'pmat', replacement: '\\begin{pmatrix}@0\\end{pmatrix}', options: 'nA', description: 'Inline pmatrix', category: 'Environments' },
  { id: 'environment.bmatrix-inline', trigger: 'bmat', replacement: '\\begin{bmatrix}@0\\end{bmatrix}', options: 'nA', description: 'Inline bmatrix', category: 'Environments' },
  { id: 'environment.capital-bmatrix-inline', trigger: 'Bmat', replacement: '\\begin{Bmatrix}@0\\end{Bmatrix}', options: 'nA', description: 'Inline Bmatrix', category: 'Environments' },
  { id: 'environment.vmatrix-inline', trigger: 'vmat', replacement: '\\begin{vmatrix}@0\\end{vmatrix}', options: 'nA', description: 'Inline vmatrix', category: 'Environments' },
  { id: 'environment.capital-vmatrix-inline', trigger: 'Vmat', replacement: '\\begin{Vmatrix}@0\\end{Vmatrix}', options: 'nA', description: 'Inline Vmatrix', category: 'Environments' },
  { id: 'environment.matrix-inline', trigger: 'matrix', replacement: '\\begin{matrix}@0\\end{matrix}', options: 'nA', description: 'Inline matrix', category: 'Environments' },
  { id: 'environment.cases', trigger: 'cases', replacement: '\\begin{cases}\n@0\n\\end{cases}', options: 'mA', description: 'Cases environment', category: 'Environments' },
  { id: 'environment.align', trigger: 'align', replacement: '\\begin{align}\n@0\n\\end{align}', options: 'mA', description: 'Align environment', category: 'Environments' },
  { id: 'environment.array', trigger: 'array', replacement: '\\begin{array}\n@0\n\\end{array}', options: 'mA', description: 'Array environment', category: 'Environments' },

  // Brackets
  { id: 'bracket.average', trigger: 'avg', replacement: '\\langle @0 \\rangle @1', options: 'mA', description: 'Angle brackets', category: 'Brackets' },
  { id: 'bracket.absolute', trigger: 'norm', replacement: '\\lvert @0 \\rvert @1', options: 'mA', priority: 1, description: 'Absolute value', category: 'Brackets' },
  { id: 'bracket.norm', trigger: 'Norm', replacement: '\\lVert @0 \\rVert @1', options: 'mA', priority: 1, description: 'Norm', category: 'Brackets' },
  { id: 'bracket.ceiling', trigger: 'ceil', replacement: '\\lceil @0 \\rceil @1', options: 'mA', description: 'Ceiling', category: 'Brackets' },
  { id: 'bracket.floor', trigger: 'floor', replacement: '\\lfloor @0 \\rfloor @1', options: 'mA', description: 'Floor', category: 'Brackets' },
  { id: 'bracket.modulus', trigger: 'mod', replacement: '|@0|@1', options: 'mA', description: 'Modulus', category: 'Brackets' },
  { id: 'bracket.parentheses', trigger: '(', replacement: '(@0)@1', options: 'mA', description: 'Parentheses', category: 'Brackets' },
  { id: 'bracket.braces', trigger: '{', replacement: '{@0}@1', options: 'mA', description: 'Braces', category: 'Brackets' },
  { id: 'bracket.square', trigger: '[', replacement: '[@0]@1', options: 'mA', description: 'Square brackets', category: 'Brackets' },
  { id: 'bracket.left-right-parentheses', trigger: 'lr(', replacement: '\\left( @0 \\right) @1', options: 'mA', description: 'Scalable parentheses', category: 'Brackets' },
  { id: 'bracket.left-right-braces', trigger: 'lr{', replacement: '\\left\\{ @0 \\right\\} @1', options: 'mA', description: 'Scalable braces', category: 'Brackets' },
  { id: 'bracket.left-right-square', trigger: 'lr[', replacement: '\\left[ @0 \\right] @1', options: 'mA', description: 'Scalable square brackets', category: 'Brackets' },
  { id: 'bracket.left-right-bars', trigger: 'lr|', replacement: '\\left| @0 \\right| @1', options: 'mA', description: 'Scalable bars', category: 'Brackets' },
  { id: 'bracket.left-right-angle', trigger: 'lra', replacement: '\\left< @0 \\right> @1', options: 'mA', description: 'Scalable angle brackets', category: 'Brackets' },

  // Declarative replacements for the upstream dynamic identity-matrix snippet
  { id: 'misc.taylor', trigger: 'tayl', replacement: "@{0:f}(@{1:x} + @{2:h}) = @{0:f}(@{1:x}) + @{0:f}'(@{1:x})@{2:h} + @{0:f}''(@{1:x}) \\frac{@{2:h}^{2}}{2!} + \\dots@3", options: 'mA', description: 'Taylor expansion', category: 'Miscellaneous' },
  { id: 'matrix.identity-2', trigger: 'iden2', replacement: '\\begin{pmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{pmatrix}', options: 'mA', description: '2 by 2 identity matrix', category: 'Linear algebra' },
  { id: 'matrix.identity-3', trigger: 'iden3', replacement: '\\begin{pmatrix}\n1 & 0 & 0 \\\\\n0 & 1 & 0 \\\\\n0 & 0 & 1\n\\end{pmatrix}', options: 'mA', description: '3 by 3 identity matrix', category: 'Linear algebra' },
  { id: 'matrix.identity-4', trigger: 'iden4', replacement: '\\begin{pmatrix}\n1 & 0 & 0 & 0 \\\\\n0 & 1 & 0 & 0 \\\\\n0 & 0 & 1 & 0 \\\\\n0 & 0 & 0 & 1\n\\end{pmatrix}', options: 'mA', description: '4 by 4 identity matrix', category: 'Linear algebra' },
];
