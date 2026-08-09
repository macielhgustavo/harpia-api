import { Prisma } from '@prisma/client';

const MAX_DEPTH = 6;
const MAX_COLLECTION_ITEMS = 50;
const MAX_KEY_LENGTH = 120;
const MAX_STRING_LENGTH = 2_000;
const MAX_TOTAL_BYTES = 16_000;
const MAX_NODES = 500;

const SENSITIVE_KEY_TOKENS = new Set([
  'password',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'hash',
  'file',
  'buffer',
  'content',
  'request',
  'headers',
]);

const OMIT = Symbol('omit-audit-metadata-value');
type SanitizedValue = Prisma.InputJsonValue | null;

interface SanitizerState {
  activeObjects: WeakSet<object>;
  nodes: number;
  remainingBytes: number;
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): Prisma.InputJsonValue {
  const state: SanitizerState = {
    activeObjects: new WeakSet<object>(),
    nodes: 0,
    remainingBytes: MAX_TOTAL_BYTES,
  };

  const sanitized = sanitizeObject(metadata, 0, state);
  return sanitized === OMIT ? {} : sanitized;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  state: SanitizerState,
): SanitizedValue | typeof OMIT {
  if (state.nodes >= MAX_NODES || state.remainingBytes < 16) {
    return OMIT;
  }

  state.nodes += 1;
  state.remainingBytes -= 4;

  if (value === null) return null;

  if (typeof value === 'string') {
    return takeString(value, state);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    state.remainingBytes -= String(value).length;
    return value;
  }

  if (typeof value === 'boolean') {
    state.remainingBytes -= value ? 4 : 5;
    return value;
  }

  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return OMIT;
  }

  if (depth >= MAX_DEPTH) {
    return takeString('[Truncated]', state);
  }

  if (value instanceof Date) {
    return takeString(
      Number.isNaN(value.getTime()) ? '[Invalid date]' : value.toISOString(),
      state,
    );
  }

  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return takeString('[Binary omitted]', state);
  }

  if (state.activeObjects.has(value)) {
    return takeString('[Circular]', state);
  }

  if (Array.isArray(value)) {
    state.activeObjects.add(value);
    const result: SanitizedValue[] = [];

    for (const item of value.slice(0, MAX_COLLECTION_ITEMS)) {
      const sanitized = sanitizeValue(item, depth + 1, state);
      if (sanitized !== OMIT) result.push(sanitized);
      if (state.remainingBytes < 16 || state.nodes >= MAX_NODES) break;
    }

    state.activeObjects.delete(value);
    return result;
  }

  return sanitizeObject(value, depth, state);
}

function sanitizeObject(
  value: object,
  depth: number,
  state: SanitizerState,
): Prisma.InputJsonObject | typeof OMIT {
  if (state.activeObjects.has(value)) return OMIT;

  state.activeObjects.add(value);
  const result: Record<string, SanitizedValue> = {};
  let acceptedKeys = 0;
  let keys: string[];

  try {
    keys = Object.keys(value);
  } catch {
    state.activeObjects.delete(value);
    return result;
  }

  for (const key of keys) {
    if (acceptedKeys >= MAX_COLLECTION_ITEMS) break;
    if (isSensitiveKey(key) || isPrototypeKey(key)) continue;

    const safeKey = key.slice(0, MAX_KEY_LENGTH);
    if (!safeKey || Object.prototype.hasOwnProperty.call(result, safeKey)) {
      continue;
    }

    const keyCost = Buffer.byteLength(safeKey, 'utf8') + 4;
    if (state.remainingBytes <= keyCost + 16) break;
    state.remainingBytes -= keyCost;

    let child: unknown;
    try {
      child = Reflect.get(value, key);
    } catch {
      continue;
    }

    const sanitized = sanitizeValue(child, depth + 1, state);
    if (sanitized !== OMIT) {
      result[safeKey] = sanitized;
      acceptedKeys += 1;
    }

    if (state.remainingBytes < 16 || state.nodes >= MAX_NODES) break;
  }

  state.activeObjects.delete(value);
  return result;
}

function isPrototypeKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function isSensitiveKey(key: string): boolean {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (tokens.some((token) => SENSITIVE_KEY_TOKENS.has(token))) return true;

  const normalized = tokens.join('');
  return (
    SENSITIVE_KEY_TOKENS.has(normalized) ||
    [...SENSITIVE_KEY_TOKENS]
      .filter((token) => token !== 'file')
      .some((token) => normalized.startsWith(token)) ||
    normalized.startsWith('file')
  );
}

function takeString(value: string, state: SanitizerState): string {
  const suffix = value.length > MAX_STRING_LENGTH ? '…' : '';
  let candidate = `${value.slice(0, MAX_STRING_LENGTH)}${suffix}`;
  const available = Math.max(0, state.remainingBytes - 4);

  while (Buffer.byteLength(candidate, 'utf8') > available && candidate) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.75));
  }

  state.remainingBytes -= Buffer.byteLength(candidate, 'utf8') + 2;
  return candidate;
}
