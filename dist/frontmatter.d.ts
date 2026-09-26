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
/** Splits a leading `---` YAML block from the Markdown body without rewriting either. */
export declare function parseFrontmatter(raw: string): Frontmatter;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function getString(record: Record<string, unknown>, key: string): string | null;
