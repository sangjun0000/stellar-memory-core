import type { Memory, MemoryType, SunState } from './types.js';

interface SessionActivity {
  recallQueries: string[];
  rememberedByType: Record<MemoryType, string[]>;
  observedSummaries: string[];
  updatedAt: string;
}

export interface SessionCommitDraft {
  current_work?: string;
  decisions: string[];
  next_steps: string[];
  errors: string[];
  context?: string;
}

const MAX_RECALL_QUERIES = 5;
const MAX_TYPE_SUMMARIES = 8;
const MAX_OBSERVED_SUMMARIES = 5;

const activities = new Map<string, SessionActivity>();

function createEmptyRememberedByType(): Record<MemoryType, string[]> {
  return {
    decision: [],
    observation: [],
    task: [],
    context: [],
    error: [],
    milestone: [],
    procedural: [],
  };
}

function normalizeSummary(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function pushUnique(target: string[], value: string, max: number): void {
  const normalized = normalizeSummary(value);
  if (!normalized || target.includes(normalized)) return;
  target.unshift(normalized);
  if (target.length > max) target.length = max;
}

function getActivity(project: string): SessionActivity {
  let activity = activities.get(project);
  if (!activity) {
    activity = {
      recallQueries: [],
      rememberedByType: createEmptyRememberedByType(),
      observedSummaries: [],
      updatedAt: new Date(0).toISOString(),
    };
    activities.set(project, activity);
  }
  activity.updatedAt = new Date().toISOString();
  return activity;
}

export function noteRecall(project: string, query: string): void {
  const activity = getActivity(project);
  pushUnique(activity.recallQueries, query, MAX_RECALL_QUERIES);
}

export function noteRemember(project: string, memory: Pick<Memory, 'type' | 'summary' | 'content'>): void {
  const activity = getActivity(project);
  const summary = normalizeSummary(memory.summary) || normalizeSummary(memory.content);
  pushUnique(activity.rememberedByType[memory.type], summary, MAX_TYPE_SUMMARIES);
}

export function noteObserve(project: string, summary: string): void {
  const activity = getActivity(project);
  pushUnique(activity.observedSummaries, summary, MAX_OBSERVED_SUMMARIES);
}

export function clearSessionActivity(project: string): void {
  activities.delete(project);
}

export function getSessionCommitDraft(project: string, existingSun?: SunState | null): SessionCommitDraft | null {
  const activity = activities.get(project);
  if (!activity) return null;

  const decisions = [
    ...activity.rememberedByType.decision,
    ...activity.rememberedByType.milestone,
  ].slice(0, MAX_TYPE_SUMMARIES);
  const next_steps = activity.rememberedByType.task.slice(0, MAX_TYPE_SUMMARIES);
  const errors = activity.rememberedByType.error.slice(0, MAX_TYPE_SUMMARIES);

  const current_work = existingSun?.current_work?.trim()
    || activity.recallQueries[0]
    || activity.rememberedByType.task[0]
    || activity.rememberedByType.context[0]
    || activity.rememberedByType.decision[0]
    || activity.observedSummaries[0];

  const contextParts = [
    ...activity.rememberedByType.context.slice(0, 3),
    ...activity.observedSummaries.slice(0, 2),
  ];
  const context = contextParts.length > 0 ? contextParts.join(' | ') : existingSun?.project_context;

  if (!current_work && decisions.length === 0 && next_steps.length === 0 && errors.length === 0 && !context) {
    return null;
  }

  return { current_work, decisions, next_steps, errors, context };
}

export function formatSessionDraftNote(project: string, existingSun?: SunState | null): string | null {
  const draft = getSessionCommitDraft(project, existingSun);
  if (!draft) return null;

  const parts: string[] = [];
  if (draft.current_work) parts.push(`topic: ${draft.current_work}`);
  if (draft.decisions.length > 0) parts.push(`decisions: ${draft.decisions.length}`);
  if (draft.next_steps.length > 0) parts.push(`steps: ${draft.next_steps.length}`);
  if (draft.errors.length > 0) parts.push(`errors: ${draft.errors.length}`);

  if (parts.length === 0) return null;
  return `Session draft active | ${parts.join(' | ')}`;
}

