'use strict';

/**
 * Condition Evaluator — recursive descent parser.
 *
 * Grammar (simplified, left-to-right, no implicit precedence):
 *
 *   expr      ::= or_expr
 *   or_expr   ::= and_expr ( 'or' and_expr )*
 *   and_expr  ::= primary ( 'and' primary )*
 *   primary   ::= '(' expr ')' | comparison
 *   comparison::= path operator value
 *   operator  ::= '==' | '>=' | '<=' | '>' | '<' | 'contains'
 *   value     ::= quoted_string | number
 *   path      ::= SEGMENT ('.' SEGMENT)*      (segments may contain '-')
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const TOKEN = {
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  AND: 'AND',
  OR: 'OR',
  CONTAINS: 'CONTAINS',
  OP: 'OP',           // ==  >=  <=  >  <
  STRING: 'STRING',   // single-quoted string
  NUMBER: 'NUMBER',
  PATH: 'PATH',       // dotted identifier (may include hyphens)
  EOF: 'EOF',
};

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  const src = expression.trim();

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    // Parentheses
    if (src[i] === '(') { tokens.push({ type: TOKEN.LPAREN }); i++; continue; }
    if (src[i] === ')') { tokens.push({ type: TOKEN.RPAREN }); i++; continue; }

    // Two-char operators
    if (i + 1 < src.length) {
      const two = src.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '==') {
        tokens.push({ type: TOKEN.OP, value: two });
        i += 2;
        continue;
      }
      // Catch != and !== early to give a helpful error
      if (two === '!=' ) {
        throw new Error(
          `Invalid operator at position ${i}: "${src.slice(i, i + 3)}". ` +
          `Supported operators are: ==, >=, <=, >, <, contains`
        );
      }
    }

    // Single-char operators
    if (src[i] === '>' || src[i] === '<') {
      tokens.push({ type: TOKEN.OP, value: src[i] });
      i++;
      continue;
    }

    // Single-quoted string
    if (src[i] === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      if (j >= src.length) {
        throw new Error(`Unterminated string literal starting at position ${i}`);
      }
      tokens.push({ type: TOKEN.STRING, value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Number (integer or decimal)
    if (/[0-9]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: TOKEN.NUMBER, value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }

    // Keyword or path: starts with a letter or underscore, may contain hyphens and dots
    if (/[a-zA-Z_]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.\\-]/.test(src[j])) {
        // Allow hyphens that are not followed by end of word boundary issues
        if (src[j] === '-') {
          // Allow hyphen inside a segment (e.g. prd-writing, ux-directions)
          j++;
        } else {
          j++;
        }
      }
      const word = src.slice(i, j);

      if (word === 'and') { tokens.push({ type: TOKEN.AND }); }
      else if (word === 'or') { tokens.push({ type: TOKEN.OR }); }
      else if (word === 'contains') { tokens.push({ type: TOKEN.CONTAINS }); }
      else { tokens.push({ type: TOKEN.PATH, value: word }); }

      i = j;
      continue;
    }

    throw new Error(
      `Unexpected character '${src[i]}' at position ${i} in expression: "${expression}"`
    );
  }

  tokens.push({ type: TOKEN.EOF });
  return tokens;
}

// ---------------------------------------------------------------------------
// Context value resolver — no eval
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path like "user_feedback.ux-directions.action" against ctx.
 * Returns undefined if any segment is missing.
 */
function resolvePath(pathStr, ctx) {
  // Split on dots, but be careful: segment names may contain hyphens, not dots.
  const segments = pathStr.split('.');
  let current = ctx;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[seg];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function makeParser(tokens) {
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function expect(type) {
    const tok = consume();
    if (tok.type !== type) {
      throw new Error(`Expected token ${type} but got ${tok.type}`);
    }
    return tok;
  }

  function parseExpr() {
    return parseOrExpr();
  }

  function parseOrExpr() {
    let left = parseAndExpr();
    while (peek().type === TOKEN.OR) {
      consume(); // eat 'or'
      const right = parseAndExpr();
      left = left || right;
    }
    return left;
  }

  function parseAndExpr() {
    let left = parsePrimary();
    while (peek().type === TOKEN.AND) {
      consume(); // eat 'and'
      const right = parsePrimary();
      left = left && right;
    }
    return left;
  }

  function parsePrimary() {
    if (peek().type === TOKEN.LPAREN) {
      consume(); // eat '('
      const val = parseExpr();
      expect(TOKEN.RPAREN);
      return val;
    }
    return parseComparison();
  }

  function parseComparison() {
    const pathTok = consume();
    if (pathTok.type !== TOKEN.PATH) {
      throw new Error(
        `Expected a path (e.g. "flow.input") but got ${pathTok.type}` +
        (pathTok.value !== undefined ? ` ("${pathTok.value}")` : '')
      );
    }

    const opTok = consume();
    if (opTok.type !== TOKEN.OP && opTok.type !== TOKEN.CONTAINS) {
      throw new Error(
        `Expected an operator (==, >=, <=, >, <, contains) but got ${opTok.type}` +
        (opTok.value !== undefined ? ` ("${opTok.value}")` : '')
      );
    }

    const valTok = consume();
    if (valTok.type !== TOKEN.STRING && valTok.type !== TOKEN.NUMBER) {
      throw new Error(
        `Expected a value (quoted string or number) but got ${valTok.type}`
      );
    }

    return evalComparison(pathTok.value, opTok, valTok);
  }

  return { parseExpr, peek, consume };
}

// ---------------------------------------------------------------------------
// Comparison evaluation — no eval
// ---------------------------------------------------------------------------

function evalComparison(pathStr, opTok, valTok) {
  // Will be called with a closure over ctx — we return a thunk and call it later.
  // Actually we need ctx here. We'll restructure: pass ctx into makeParser.
  // (See the restructuring below.)
  throw new Error('Internal: evalComparison called without ctx');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition expression string against a runtime context object.
 *
 * @param {string} expression
 * @param {object} context
 * @returns {boolean}
 */
function evaluateCondition(expression, context) {
  if (!expression || expression.trim() === '') {
    throw new Error('Expression must not be empty');
  }

  const tokens = tokenize(expression);
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function expect(type) {
    const tok = consume();
    if (tok.type !== type) {
      throw new Error(
        `Parse error: expected token type ${type} but got ${tok.type} ` +
        `(near token ${pos} in "${expression}")`
      );
    }
    return tok;
  }

  function parseExpr() {
    return parseOrExpr();
  }

  function parseOrExpr() {
    let left = parseAndExpr();
    while (peek().type === TOKEN.OR) {
      consume();
      const right = parseAndExpr();
      left = left || right;
    }
    return left;
  }

  function parseAndExpr() {
    let left = parsePrimary();
    while (peek().type === TOKEN.AND) {
      consume();
      const right = parsePrimary();
      left = left && right;
    }
    return left;
  }

  function parsePrimary() {
    if (peek().type === TOKEN.LPAREN) {
      consume(); // eat '('
      const val = parseExpr();
      expect(TOKEN.RPAREN);
      return val;
    }
    return parseComparison();
  }

  function parseComparison() {
    const pathTok = consume();
    if (pathTok.type !== TOKEN.PATH) {
      throw new Error(
        `Parse error: expected a path identifier but got token type ${pathTok.type}` +
        (pathTok.value !== undefined ? ` ("${pathTok.value}")` : '') +
        ` in expression: "${expression}"`
      );
    }

    const opTok = consume();
    if (opTok.type !== TOKEN.OP && opTok.type !== TOKEN.CONTAINS) {
      throw new Error(
        `Parse error: expected an operator (==, >=, <=, >, <, contains) ` +
        `but got token type ${opTok.type}` +
        (opTok.value !== undefined ? ` ("${opTok.value}")` : '') +
        ` in expression: "${expression}"`
      );
    }

    const valTok = consume();
    if (valTok.type !== TOKEN.STRING && valTok.type !== TOKEN.NUMBER) {
      throw new Error(
        `Parse error: expected a quoted string or number value ` +
        `but got token type ${valTok.type} in expression: "${expression}"`
      );
    }

    // Resolve the left-hand side from context
    const lhsRaw = resolvePath(pathTok.value, context);

    // Missing context key → false (not an error)
    if (lhsRaw === undefined || lhsRaw === null) {
      return false;
    }

    const rhsValue = valTok.value; // already typed: string or number

    const op = opTok.type === TOKEN.CONTAINS ? 'contains' : opTok.value;

    switch (op) {
      case 'contains': {
        if (typeof lhsRaw !== 'string') return false;
        if (typeof rhsValue !== 'string') {
          throw new Error(`"contains" requires a string value on the right-hand side`);
        }
        return lhsRaw.includes(rhsValue);
      }
      case '==': {
        // Compare with type coercion for numeric paths vs numeric literals
        // eslint-disable-next-line eqeqeq
        return lhsRaw == rhsValue;
      }
      case '>=': return Number(lhsRaw) >= Number(rhsValue);
      case '<=': return Number(lhsRaw) <= Number(rhsValue);
      case '>':  return Number(lhsRaw) > Number(rhsValue);
      case '<':  return Number(lhsRaw) < Number(rhsValue);
      default:
        throw new Error(`Unknown operator: "${op}"`);
    }
  }

  const result = parseExpr();

  // Ensure we consumed all tokens (ignoring trailing EOF)
  if (peek().type !== TOKEN.EOF) {
    throw new Error(
      `Parse error: unexpected token "${peek().type}" after end of expression: "${expression}"`
    );
  }

  return Boolean(result);
}

module.exports = { evaluateCondition };
