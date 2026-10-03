export declare function markdownSection(body: string, fragment: string): string;
export declare function requiredLinks(body: string): string[];
export interface ContextLink {
    label: string;
    path: string;
    fragment: string | null;
    external: boolean;
}
export declare function resolveLink(href: string, source: string): Omit<ContextLink, 'label'>;
export declare function navigation(body: string, source: string): ContextLink[];
