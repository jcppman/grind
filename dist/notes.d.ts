import type { CommandContext } from './commands.ts';
export declare const NOTES_FILENAME = "notes.md";
export interface ReviewNote {
    id: string;
    repository: string;
    path: string;
    start: number;
    end: number;
    /** First line of the range when the note was written, or null. */
    anchor: string | null;
    body: string;
}
/** Review notes recorded for the initiative in `dir`. */
export declare function readNotes(dir: string): Promise<ReviewNote[]>;
export interface AddNoteInput {
    file: string;
    start: number;
    end: number;
    comment: string;
    initiative?: string;
}
export interface AddNoteResult {
    id: string;
    initiative: string;
    reference: string;
    notes: string;
}
/** Records a review note with the initiative owning the file's branch, or the given initiative. */
export declare function addNote(context: CommandContext, input: AddNoteInput): Promise<AddNoteResult>;
export interface ListedNote extends ReviewNote {
    /** Absolute path of the file in the checkout currently holding the initiative's branch, or null. */
    file: string | null;
}
export declare function listNotes(context: CommandContext, identifier?: string): Promise<{
    initiative: string;
    notes: ListedNote[];
}>;
/** Removes a resolved note; its history stays in the state repository. */
export declare function resolveNote(context: CommandContext, id: string, identifier?: string): Promise<{
    initiative: string;
    id: string;
}>;
