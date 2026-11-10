/**
 * A small spreadsheet engine: tokenizer, recursive-descent parser and
 * dependency-resolving evaluator with cycle detection.
 */

export type CellMap = Record<string, string>;

export interface SheetInput {
  name: string;
  cells: CellMap;
}

export interface CellResult {
  raw: string;
  value: string | number | boolean;
  error?: string;
  isFormula: boolean;
}

export type WorkbookResult = Record<string, Record<string, CellResult>>;

export type CellValue = string | number | boolean;

interface RangeValue {
  kind: 'range';
  values: CellValue[][];
}

type Value = CellValue | RangeValue;

class FormulaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const isRange = (value: Value): value is RangeValue =>
  typeof value === 'object' && value !== null && (value as RangeValue).kind === 'range';

export function columnLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function columnIndex(label: string): number {
  let index = 0;
  for (const char of label.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export function cellId(col: number, row: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

export function nextCell(current: string, direction: 'down' | 'right' | 'left' | 'up'): string {
  const match = current.match(/^([A-Z]+)(\d+)$/);
  if (!match) return current;
  const col = columnIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (direction === 'down') return cellId(col, row + 1);
  if (direction === 'up') return cellId(col, Math.max(0, row - 1));
  if (direction === 'right') return cellId(col + 1, row);
  return cellId(Math.max(0, col - 1), row);
}

function refParts(ref: string): { col: number; row: number } {
  const match = ref.match(/^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/);
  if (!match) throw new FormulaError('#REF!');
  return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

type TokenType = 'num' | 'str' | 'ref' | 'name' | 'op' | 'lparen' | 'rparen' | 'comma' | 'colon' | 'eof';

interface Token {
  type: TokenType;
  value?: string | number;
  sheet?: string;
  ref?: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '"') {
      let j = i + 1;
      let value = '';
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += input[j++];
      }
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }

    const twoChar = input.slice(i, i + 2);
    if (['>=', '<=', '<>'].includes(twoChar)) {
      tokens.push({ type: 'op', value: twoChar });
      i += 2;
      continue;
    }

    if ('+-*/^%&<>='.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i++;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }
    if (char === ':') {
      tokens.push({ type: 'colon' });
      i++;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = input.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (match) {
        tokens.push({ type: 'num', value: Number(match[0]) });
        i += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_$\u0900-\u097F']/.test(char)) {
      let sheet: string | undefined;
      let consumed = 0;
      const sheetMatch = input.slice(i).match(/^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_. ]*))!/);
      if (sheetMatch) {
        sheet = (sheetMatch[1] ?? sheetMatch[2]).trim();
        consumed = sheetMatch[0].length;
      }
      const rest = input.slice(i + consumed);
      const refMatch = rest.match(/^\$?([A-Za-z]{1,3})\$?(\d{1,7})(?![\w(])/);
      if (refMatch) {
        tokens.push({ type: 'ref', sheet, ref: `${refMatch[1].toUpperCase()}${refMatch[2]}` });
        i += consumed + refMatch[0].length;
        continue;
      }
      if (consumed === 0) {
        const identMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
        if (identMatch) {
          tokens.push({ type: 'name', value: identMatch[0].toUpperCase() });
          i += identMatch[0].length;
          continue;
        }
      }
    }

    throw new FormulaError('#SYNTAX!');
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

function toNumber(value: Value): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    if (trimmed.startsWith('#')) throw new FormulaError(trimmed);
    const parsed = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) throw new FormulaError('#VALUE!');
    return parsed;
  }
  throw new FormulaError('#VALUE!');
}

function toText(value: Value): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FormulaError('#NUM!');
    return String(Math.round(value * 1e10) / 1e10);
  }
  throw new FormulaError('#VALUE!');
}

function truthy(value: Value): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  throw new FormulaError('#VALUE!');
}

function compareValues(left: Value, right: Value, operator: string): boolean {
  if (isRange(left) || isRange(right)) throw new FormulaError('#VALUE!');
  const asNumber = (value: CellValue): number | null => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };
  const a = asNumber(left);
  const b = asNumber(right);
  let comparison: number;
  if (a !== null && b !== null) {
    comparison = a === b ? 0 : a < b ? -1 : 1;
  } else {
    const aText = toText(left).toLowerCase();
    const bText = toText(right).toLowerCase();
    comparison = aText === bText ? 0 : aText < bText ? -1 : 1;
  }
  switch (operator) {
    case '=':
      return comparison === 0;
    case '<>':
      return comparison !== 0;
    case '>':
      return comparison > 0;
    case '<':
      return comparison < 0;
    case '>=':
      return comparison >= 0;
    case '<=':
      return comparison <= 0;
    default:
      throw new FormulaError('#SYNTAX!');
  }
}

function numOp(left: Value, right: Value, operation: (a: number, b: number) => number): number {
  const a = toNumber(left);
  const b = toNumber(right);
  const result = operation(a, b);
  if (!Number.isFinite(result)) throw new FormulaError('#NUM!');
  return Math.round(result * 1e10) / 1e10;
}

function flatten(args: Value[]): CellValue[] {
  const flat: CellValue[] = [];
  for (const arg of args) {
    if (isRange(arg)) {
      for (const row of arg.values) for (const cell of row) flat.push(cell);
    } else {
      flat.push(arg);
    }
  }
  return flat;
}

function numbers(args: Value[]): number[] {
  return flatten(args)
    .filter((value) => value !== '' && value !== null && value !== undefined)
    .map((value) => toNumber(value as Value))
    .filter((value) => Number.isFinite(value));
}

function criteriaMatcher(criteria: CellValue): (value: CellValue) => boolean {
  const text = toText(criteria as Value);
  const match = text.match(/^(>=|<=|<>|>|<|=)?(.*)$/);
  const operator = match?.[1] ?? '=';
  const operandRaw = (match?.[2] ?? text).trim();
  const operand = Number(operandRaw);
  const numeric = operandRaw !== '' && Number.isFinite(operand);
  return (value) => {
    const asNumber = typeof value === 'number' ? value : Number(value);
    const numericComparable = numeric && Number.isFinite(asNumber);
    switch (operator) {
      case '>':
        return numericComparable && asNumber > operand;
      case '<':
        return numericComparable && asNumber < operand;
      case '>=':
        return numericComparable && asNumber >= operand;
      case '<=':
        return numericComparable && asNumber <= operand;
      case '<>':
        return toText(value as Value).toLowerCase() !== operandRaw.toLowerCase();
      default:
        return numericComparable
          ? asNumber === operand
          : toText(value as Value).toLowerCase() === operandRaw.toLowerCase();
    }
  };
}

type Fn = (args: Value[]) => Value;

const FUNCTIONS: Record<string, Fn> = {
  SUM: (args) => numbers(args).reduce((a, b) => a + b, 0),
  PRODUCT: (args) => numbers(args).reduce((a, b) => a * b, 1),
  AVERAGE: (args) => {
    const list = numbers(args);
    if (!list.length) throw new FormulaError('#DIV/0!');
    return list.reduce((a, b) => a + b, 0) / list.length;
  },
  MIN: (args) => (numbers(args).length ? Math.min(...numbers(args)) : 0),
  MAX: (args) => (numbers(args).length ? Math.max(...numbers(args)) : 0),
  MEDIAN: (args) => {
    const list = numbers(args).sort((a, b) => a - b);
    if (!list.length) throw new FormulaError('#NUM!');
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  },
  STDEV: (args) => {
    const list = numbers(args);
    if (list.length < 2) throw new FormulaError('#DIV/0!');
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return Math.sqrt(list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (list.length - 1));
  },
  COUNT: (args) => numbers(args).length,
  COUNTA: (args) => flatten(args).filter((value) => value !== '' && value !== null && value !== undefined).length,
  ABS: (args) => Math.abs(toNumber(args[0])),
  SQRT: (args) => {
    const value = toNumber(args[0]);
    if (value < 0) throw new FormulaError('#NUM!');
    return Math.sqrt(value);
  },
  POWER: (args) => numOp(args[0], args[1], (a, b) => Math.pow(a, b)),
  MOD: (args) => {
    const divisor = toNumber(args[1]);
    if (divisor === 0) throw new FormulaError('#DIV/0!');
    return toNumber(args[0]) % divisor;
  },
  INT: (args) => Math.floor(toNumber(args[0])),
  ROUND: (args) => {
    const digits = args.length > 1 ? toNumber(args[1]) : 0;
    const factor = Math.pow(10, digits);
    return Math.round(toNumber(args[0]) * factor) / factor;
  },
  ROUNDUP: (args) => {
    const digits = args.length > 1 ? toNumber(args[1]) : 0;
    const factor = Math.pow(10, digits);
    return Math.ceil(toNumber(args[0]) * factor) / factor;
  },
  ROUNDDOWN: (args) => {
    const digits = args.length > 1 ? toNumber(args[1]) : 0;
    const factor = Math.pow(10, digits);
    return Math.floor(toNumber(args[0]) * factor) / factor;
  },
  IF: (args) => (truthy(args[0]) ? args[1] ?? true : args[2] ?? false),
  AND: (args) => flatten(args).every((value) => truthy(value as Value)),
  OR: (args) => flatten(args).some((value) => truthy(value as Value)),
  NOT: (args) => !truthy(args[0]),
  LEN: (args) => toText(args[0]).length,
  LEFT: (args) => toText(args[0]).slice(0, args.length > 1 ? toNumber(args[1]) : 1),
  RIGHT: (args) => {
    const count = args.length > 1 ? toNumber(args[1]) : 1;
    const text = toText(args[0]);
    return count <= 0 ? '' : text.slice(-count);
  },
  MID: (args) => {
    const start = toNumber(args[1]);
    const count = toNumber(args[2]);
    return toText(args[0]).substr(Math.max(0, start - 1), count);
  },
  UPPER: (args) => toText(args[0]).toUpperCase(),
  LOWER: (args) => toText(args[0]).toLowerCase(),
  TRIM: (args) => toText(args[0]).trim().replace(/\s+/g, ' '),
  CONCAT: (args) => flatten(args).map((value) => toText(value as Value)).join(''),
  CONCATENATE: (args) => flatten(args).map((value) => toText(value as Value)).join(''),
  TEXTJOIN: (args) => {
    const separator = toText(args[0]);
    const values = flatten(args.slice(1)).filter((value) => value !== '').map((value) => toText(value as Value));
    return values.join(separator);
  },
  VALUE: (args) => toNumber(args[0]),
  TEXT: (args) => toText(args[0]),
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString().replace('T', ' ').slice(0, 16),
  COUNTIF: (args) => {
    if (!isRange(args[0])) throw new FormulaError('#VALUE!');
    const test = criteriaMatcher(args[1] as CellValue);
    return flatten([args[0]]).filter((value) => test(value)).length;
  },
  SUMIF: (args) => {
    if (!isRange(args[0]) || !isRange(args[1])) throw new FormulaError('#VALUE!');
    const test = criteriaMatcher(args[2] as CellValue);
    const criteriaCells = flatten([args[0]]);
    const sumCells = flatten([args[1]]);
    let total = 0;
    criteriaCells.forEach((value, index) => {
      if (!test(value)) return;
      const sumValue = sumCells[index];
      if (typeof sumValue === 'number') total += sumValue;
    });
    return total;
  },
  VLOOKUP: (args) => {
    if (!isRange(args[1])) throw new FormulaError('#VALUE!');
    const lookup = args[0];
    const column = Math.max(1, Math.round(toNumber(args[2])));
    const exact = args.length > 3 ? !truthy(args[3]) : false;
    const rows = args[1].values;
    let found: CellValue[] | null = null;
    for (const row of rows) {
      const first = row[0];
      const equal =
        typeof lookup === 'number' && typeof first === 'number'
          ? lookup === first
          : toText(first as Value).toLowerCase() === toText(lookup).toLowerCase();
      if (equal) {
        found = row;
        break;
      }
      if (!exact && typeof lookup === 'number' && typeof first === 'number' && first <= lookup) {
        found = row;
      }
    }
    if (!found) throw new FormulaError('#N/A');
    const value = found[column - 1];
    return value === undefined ? '' : value;
  },
  HLOOKUP: (args) => {
    if (!isRange(args[1])) throw new FormulaError('#VALUE!');
    const lookup = toText(args[0]).toLowerCase();
    const rowIndex = Math.max(1, Math.round(toNumber(args[2])));
    const rows = args[1].values;
    const header = rows[0] ?? [];
    const column = header.findIndex((value) => toText(value as Value).toLowerCase() === lookup);
    if (column < 0) throw new FormulaError('#N/A');
    return rows[rowIndex - 1]?.[column] ?? '';
  },
  INDEX: (args) => {
    if (!isRange(args[0])) throw new FormulaError('#VALUE!');
    const row = Math.round(toNumber(args[1]));
    const column = args.length > 2 ? Math.round(toNumber(args[2])) : 1;
    const values = args[0].values;
    if (values.length === 1 && args.length === 2) return values[0][row - 1] ?? '';
    return values[row - 1]?.[column - 1] ?? '';
  },
  MATCH: (args) => {
    if (!isRange(args[1])) throw new FormulaError('#VALUE!');
    const lookup = toText(args[0]).toLowerCase();
    const flat = flatten([args[1]]);
    const index = flat.findIndex((value) => toText(value as Value).toLowerCase() === lookup);
    if (index < 0) throw new FormulaError('#N/A');
    return index + 1;
  },
  ROW: () => 1,
  COLUMN: () => 1,
};

interface EvalContext {
  sheet: string;
  value(sheet: string | undefined, ref: string): Value;
  range(sheet: string | undefined, start: string, end: string): RangeValue;
}

class EvalCtx implements EvalContext {
  constructor(
    private sheets: Record<string, CellMap>,
    private canonical: Record<string, string>,
    private memo: Map<string, CellResult>,
    private visiting: Set<string>
  ) {}

  sheet = '';

  private canonicalName(name?: string): string {
    if (!name) return this.sheet;
    return this.canonical[name.toLowerCase()] ?? name;
  }

  value(sheetName: string | undefined, ref: string): Value {
    const sheet = this.canonicalName(sheetName);
    const key = `${sheet}!${ref}`;
    const cached = this.memo.get(key);
    if (cached) {
      if (cached.error) throw new FormulaError(cached.error);
      return cached.value;
    }
    if (this.visiting.has(key)) throw new FormulaError('#CIRC!');
    const raw = this.sheets[sheet]?.[ref] ?? '';

    if (raw.startsWith('=')) {
      this.visiting.add(key);
      try {
        const parser = new Parser(tokenize(raw.slice(1)), this);
        const parsed = parser.parse();
        if (isRange(parsed)) throw new FormulaError('#VALUE!');
        const value = typeof parsed === 'number' ? Math.round(parsed * 1e10) / 1e10 : parsed;
        this.memo.set(key, { raw, value, isFormula: true });
        return value;
      } catch (error) {
        const code = error instanceof FormulaError ? error.code : '#ERROR!';
        this.memo.set(key, { raw, value: code, error: code, isFormula: true });
        throw new FormulaError(code);
      } finally {
        this.visiting.delete(key);
      }
    }

    let literal: CellValue = raw;
    const trimmed = raw.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed)) && !/[A-Za-z]/.test(trimmed)) {
      literal = Number(trimmed);
    } else if (trimmed.toUpperCase() === 'TRUE') {
      literal = true;
    } else if (trimmed.toUpperCase() === 'FALSE') {
      literal = false;
    }
    this.memo.set(key, { raw, value: literal, isFormula: false });
    return literal;
  }

  range(sheetName: string | undefined, start: string, end: string): RangeValue {
    const sheet = this.canonicalName(sheetName);
    const a = refParts(start);
    const b = refParts(end);
    const minCol = Math.min(a.col, b.col);
    const maxCol = Math.max(a.col, b.col);
    const minRow = Math.min(a.row, b.row);
    const maxRow = Math.max(a.row, b.row);
    if ((maxCol - minCol + 1) * (maxRow - minRow + 1) > 20000) throw new FormulaError('#REF!');
    const values: CellValue[][] = [];
    for (let row = minRow; row <= maxRow; row++) {
      const line: CellValue[] = [];
      for (let col = minCol; col <= maxCol; col++) {
        const value = this.value(sheet, `${columnLabel(col)}${row + 1}`);
        if (isRange(value)) throw new FormulaError('#VALUE!');
        line.push(value);
      }
      values.push(line);
    }
    return { kind: 'range', values };
  }
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: EvalContext) {}

  parse(): Value {
    const value = this.comparison();
    if (this.peek().type !== 'eof') throw new FormulaError('#SYNTAX!');
    return value;
  }

  private comparison(): Value {
    let left = this.concat();
    while (
      this.peek().type === 'op' &&
      ['=', '<>', '>', '<', '>=', '<='].includes(String(this.peek().value))
    ) {
      const operator = String(this.next().value);
      const right = this.concat();
      left = compareValues(left, right, operator);
    }
    return left;
  }

  private concat(): Value {
    let left = this.expression();
    while (this.peek().type === 'op' && this.peek().value === '&') {
      this.next();
      const right = this.expression();
      left = toText(left) + toText(right);
    }
    return left;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expression(): Value {
    let left = this.term();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const operator = this.next().value;
      const right = this.term();
      left = operator === '+' ? numOp(left, right, (a, b) => a + b) : numOp(left, right, (a, b) => a - b);
    }
    return left;
  }

  private term(): Value {
    let left = this.power();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const operator = this.next().value;
      const right = this.power();
      left =
        operator === '*'
          ? numOp(left, right, (a, b) => a * b)
          : numOp(left, right, (a, b) => {
              if (b === 0) throw new FormulaError('#DIV/0!');
              return a / b;
            });
    }
    return left;
  }

  private power(): Value {
    let left = this.unary();
    while (this.peek().type === 'op' && this.peek().value === '^') {
      this.next();
      const right = this.unary();
      left = numOp(left, right, (a, b) => Math.pow(a, b));
    }
    return left;
  }

  private unary(): Value {
    const token = this.peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      this.next();
      const value = this.unary();
      return token.value === '-' ? numOp(0, value, (a, b) => a - b) : value;
    }
    return this.postfix();
  }

  private postfix(): Value {
    const value = this.primary();
    if (this.peek().type === 'op' && this.peek().value === '%') {
      this.next();
      return numOp(value, 100, (a, b) => a / b);
    }
    return value;
  }

  private primary(): Value {
    const token = this.peek();

    if (token.type === 'num') {
      this.next();
      return token.value as number;
    }
    if (token.type === 'str') {
      this.next();
      return token.value as string;
    }
    if (token.type === 'lparen') {
      this.next();
      const value = this.comparison();
      if (!this.match('rparen')) throw new FormulaError('#SYNTAX!');
      return value;
    }
    if (token.type === 'ref') {
      this.next();
      const start = token.ref!;
      if (this.match('colon')) {
        const endToken = this.next();
        if (endToken.type !== 'ref' || !endToken.ref) throw new FormulaError('#REF!');
        return this.ctx.range(token.sheet, start, endToken.ref);
      }
      return this.ctx.value(token.sheet, start);
    }
    if (token.type === 'name') {
      this.next();
      const name = String(token.value);
      if (this.match('lparen')) {
        const args: Value[] = [];
        if (this.peek().type !== 'rparen') {
          do {
            args.push(this.comparison());
          } while (this.match('comma'));
        }
        if (!this.match('rparen')) throw new FormulaError('#SYNTAX!');
        const fn = FUNCTIONS[name];
        if (!fn) throw new FormulaError('#NAME?');
        return fn(args);
      }
      if (name === 'TRUE') return true;
      if (name === 'FALSE') return false;
      throw new FormulaError('#NAME?');
    }
    throw new FormulaError('#SYNTAX!');
  }
}

export function evaluateWorkbook(sheets: SheetInput[]): WorkbookResult {
  const cellsByName: Record<string, CellMap> = {};
  const canonical: Record<string, string> = {};
  for (const sheet of sheets) {
    cellsByName[sheet.name] = sheet.cells;
    canonical[sheet.name.toLowerCase()] = sheet.name;
  }

  const memo = new Map<string, CellResult>();
  const visiting = new Set<string>();
  const ctx = new EvalCtx(cellsByName, canonical, memo, visiting);
  const output: WorkbookResult = {};

  for (const sheet of sheets) {
    ctx.sheet = sheet.name;
    const results: Record<string, CellResult> = {};
    for (const key of Object.keys(sheet.cells)) {
      try {
        ctx.value(sheet.name, key);
      } catch {
        /* recorded in memo */
      }
      const record = memo.get(`${sheet.name}!${key}`);
      if (record) results[key] = record;
    }
    output[sheet.name] = results;
  }

  return output;
}

export function displayValue(result: CellResult | undefined): string {
  if (!result) return '';
  return typeof result.value === 'number'
    ? String(Math.round(result.value * 1e10) / 1e10)
    : String(result.value);
}

export function sheetToMatrix(cells: CellMap, results: Record<string, CellResult>, rows: number, cols: number): CellValue[][] {
  const matrix: CellValue[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: CellValue[] = [];
    for (let col = 0; col < cols; col++) {
      const id = cellId(col, row);
      const result = results[id];
      line.push(result ? result.value : '');
    }
    matrix.push(line);
  }
  return matrix;
}
