import { type InitiativeInspection } from './inspect.ts';
import { type StartPlan } from './lifecycle.ts';
import { type OperationRecord } from './operations.ts';
import type { Workspace } from './workspace.ts';
export interface SwitchExecutionResult {
    plan: StartPlan;
    switchedRepositories: string[];
    noteTransfers: Array<{
        repository: string;
        parked: number;
        restored: number;
    }>;
    dependencyChanges: string[];
}
export declare function beginStartSwitch(workspace: Workspace, inspection: InitiativeInspection, _initialPlan: StartPlan): Promise<SwitchExecutionResult>;
export declare function resumeStartSwitch(workspace: Workspace, inspection: InitiativeInspection, operation: OperationRecord): Promise<SwitchExecutionResult>;
export declare function repairStartPointers(workspace: Workspace, inspection: InitiativeInspection): Promise<void>;
