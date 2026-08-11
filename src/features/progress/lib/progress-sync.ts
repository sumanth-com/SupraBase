"use client";

import { toast } from "sonner";
import {
  addStudySessionAction,
  deleteLearnerNoteAction,
  getLearnerWorkspaceAction,
  setEntityCompleteAction,
  setEntityNoteAction,
  setResumePositionAction,
  syncModuleGatesAction,
  toggleBookmarkAction,
  updateLearnerPreferencesAction,
  upsertAssignmentMetaAction,
  upsertLearnerNoteAction,
  upsertProjectMetaAction,
  upsertWeekNoteAction,
} from "@/features/progress/actions/progress-actions";
import type { LearnerWorkspace } from "@/features/progress/lib/workspace-mapper";
import { isUuid } from "@/lib/is-uuid";
import type { ResumePosition } from "@/lib/module-progress";
import type { AssignmentProgressMeta, ProjectProgressMeta } from "@/store/progress-types";
import type { AppNote } from "@/types";

type ActionResult<T = undefined> =
  | { success: true; data?: T; message?: string }
  | { success: false; error: string };

function assertOk<T>(result: ActionResult<T>, context: string): T | undefined {
  if (!result.success) {
    console.error(`[progress-sync] ${context}`, result.error);
    throw new Error(result.error || context);
  }
  return result.data;
}

/** Background server sync — UI stays optimistic; failures are logged and toasted. */
function sync(task: () => Promise<unknown>, context: string) {
  void task().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Progress did not save.";
    console.error(`[progress-sync] ${context}`, error);
    toast.error(message);
  });
}

export async function fetchLearnerWorkspace(): Promise<{
  workspace: LearnerWorkspace | null;
  error: string | null;
}> {
  const result = await getLearnerWorkspaceAction();
  if (!result.success) {
    console.error("[progress] failed to load workspace", result.error);
    return { workspace: null, error: result.error };
  }
  return { workspace: result.data?.workspace ?? null, error: null };
}

export async function persistEntityComplete(
  entityId: string,
  completed: boolean,
  xp = 10
): Promise<boolean> {
  try {
    const result = await setEntityCompleteAction({
      entityId,
      completed,
      xp: completed ? xp : 0,
      sourceKey: completed ? `entity:${entityId}` : undefined,
    });
    assertOk(result, `complete ${entityId}`);
    return true;
  } catch (error) {
    console.error("[progress-sync] persistEntityComplete", entityId, error);
    toast.error(
      error instanceof Error
        ? error.message
        : "Progress did not save. Try again."
    );
    return false;
  }
}

export function syncEntityComplete(
  entityId: string,
  completed: boolean,
  xp = 10
) {
  void persistEntityComplete(entityId, completed, xp);
}

export function syncEntityNote(entityId: string, note: string) {
  sync(
    () => setEntityNoteAction(entityId, note).then((r) => assertOk(r, "save entity note")),
    "entity note"
  );
}

export function syncBookmark(entityId: string, on: boolean) {
  sync(
    () => toggleBookmarkAction(entityId, on).then((r) => assertOk(r, "bookmark")),
    "bookmark"
  );
}

export function syncProjectMeta(
  projectId: string,
  updates: Partial<ProjectProgressMeta>
) {
  sync(
    () =>
      upsertProjectMetaAction({
        projectId,
        progress: updates.progress,
        status: updates.status,
        githubLink: updates.githubLink,
        notes: updates.notes,
      }).then((r) => assertOk(r, "project meta")),
    "project meta"
  );
}

export function syncAssignmentMeta(
  catalogId: string,
  updates: Partial<AssignmentProgressMeta>
) {
  sync(
    () =>
      upsertAssignmentMetaAction({
        catalogId,
        updates: {
          status: updates.status,
          github_url: updates.githubUrl,
          live_url: updates.liveUrl,
          screenshots: updates.screenshots,
          notes: updates.notes,
          reflection: updates.reflection,
          submitted_at: updates.submittedAt,
          reviewed_at: updates.reviewedAt,
          feedback: updates.feedback,
          marks: updates.marks,
        },
      }).then((r) => assertOk(r, "assignment meta")),
    "assignment meta"
  );
}

export function syncResume(position: ResumePosition) {
  sync(
    () =>
      setResumePositionAction({
        module: position.module,
        week_id: position.weekId,
        title: position.title,
        subtitle: position.subtitle ?? null,
        href: position.href,
        topic_slug: position.topicSlug ?? null,
        topic_title: position.topicTitle ?? null,
        lesson_id: position.lessonId ?? null,
      }).then((r) => assertOk(r, "resume")),
    "resume"
  );
}

export function syncWeekNote(weekId: number, note: string) {
  sync(
    () => upsertWeekNoteAction(weekId, note).then((r) => assertOk(r, "week note")),
    "week note"
  );
}

export function syncPreferences(patch: Record<string, unknown>) {
  sync(
    () =>
      updateLearnerPreferencesAction(patch as never).then((r) =>
        assertOk(r, "preferences")
      ),
    "preferences"
  );
}

export function syncStudySession(hours: number, weekId: number) {
  sync(
    () => addStudySessionAction(hours, weekId).then((r) => assertOk(r, "study session")),
    "study session"
  );
}

const pendingNoteIds = new Map<string, Promise<string | null>>();

export async function persistAddNote(note: AppNote): Promise<string | null> {
  const result = await upsertLearnerNoteAction({
    id: isUuid(note.id) ? note.id : undefined,
    title: note.title,
    content: note.content,
    weekId: note.weekId ?? null,
    pinned: note.pinned,
    accent: note.accent ?? null,
  });
  if (!result.success) {
    console.error("[progress-sync] persistAddNote", result.error);
    toast.error(result.error);
    return null;
  }
  return result.data?.id ?? null;
}

export function syncAddNote(note: AppNote) {
  const pending = persistAddNote(note);
  pendingNoteIds.set(note.id, pending);
  void pending.catch((error) => {
    console.error("[progress-sync] add note", error);
  });
  return pending;
}

export function syncUpdateNote(id: string, updates: Partial<AppNote>) {
  sync(async () => {
    const serverId = isUuid(id)
      ? id
      : ((await pendingNoteIds.get(id)) ?? null);
    if (!serverId || !isUuid(serverId)) {
      const inserted = await persistAddNote({
        id,
        title: updates.title ?? "Untitled Note",
        content: updates.content ?? "",
        updatedAt: new Date().toISOString(),
        pinned: updates.pinned ?? false,
        weekId: updates.weekId,
        accent: updates.accent,
      });
      if (!inserted) {
        throw new Error("Note did not save.");
      }
      return inserted;
    }
    const result = await upsertLearnerNoteAction({
      id: serverId,
      title: updates.title,
      content: updates.content,
      weekId: updates.weekId,
      pinned: updates.pinned,
      accent: updates.accent,
    });
    assertOk(result, "update note");
  }, "update note");
}

export function syncDeleteNote(id: string) {
  sync(async () => {
    const serverId = isUuid(id)
      ? id
      : ((await pendingNoteIds.get(id)) ?? id);
    if (!isUuid(serverId)) return;
    const result = await deleteLearnerNoteAction(serverId);
    assertOk(result, "delete note");
  }, "delete note");
}

export function syncModuleGates(
  gates: Record<string, { unlockedWeekIds: number[]; completedWeekIds: number[] }>
) {
  sync(
    () => syncModuleGatesAction(gates).then((r) => assertOk(r, "module gates")),
    "module gates"
  );
}
