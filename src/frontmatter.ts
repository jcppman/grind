import { parse as parseYaml } from 'yaml';

export interface Frontmatter {
  /** Parsed YAML mapping, or null when the file has no frontmatter block. */
  data: Record<string, unknown> | null;
  /** Everything after the closing delimiter, unchanged. */
  body: string;
  raw: string;
  hasFrontmatter: boolean;
  /** Set when a frontmatter block exists but could not be parsed. */
  error?: string;
}

const OPEN = /^\uFEFF?---\r?\n/;

/** Splits a leading `---` YAML block from the Markdown body without rewriting either. */
export function parseFrontmatter(raw: string): Frontmatter {
  const open = OPEN.exec(raw);
  if (!open) {
    return { data: null, body: raw, raw, hasFrontmatter: false };
  }
  const afterOpen = raw.slice(open[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(afterOpen);
  if (!close) {
    return {
      data: null,
      body: raw,
      raw,
      hasFrontmatter: true,
      error: 'Frontmatter block is not closed by a "---" line',
    };
  }
  const yamlText = afterOpen.slice(0, close.index);
  const body = afterOpen.slice(close.index + close[0].length);
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    return {
      data: null,
      body,
      raw,
      hasFrontmatter: true,
      error: `Invalid YAML frontmatter: ${(error as Error).message}`,
    };
  }
  if (parsed === null || parsed === undefined) {
    return { data: {}, body, raw, hasFrontmatter: true };
  }
  if (!isRecord(parsed)) {
    return {
      data: null,
      body,
      raw,
      hasFrontmatter: true,
      error: 'Frontmatter must be a YAML mapping',
    };
  }
  return { data: parsed, body, raw, hasFrontmatter: true };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
