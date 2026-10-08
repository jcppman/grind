import { type Diagnostic } from './errors.ts';
import { type Frontmatter } from './frontmatter.ts';
export interface RoadmapDocument {
    id: string;
    path: string;
    body: string;
    metadata: Record<string, unknown>;
}
export interface RoadmapCatalog {
    documents: Map<string, RoadmapDocument[]>;
    diagnostics: Diagnostic[];
}
/** Finds roadmap identities throughout the state directory without following symlinks. */
export declare function readRoadmaps(stateDir: string): Promise<RoadmapCatalog>;
export declare function resolveRoadmap(frontmatter: Frontmatter, file: string, catalog: RoadmapCatalog, diagnostics: Diagnostic[]): RoadmapDocument | null;
