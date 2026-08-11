"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile, formatDbError } from "@/lib/supabase/ensure-profile";
import { isUuid } from "@/lib/is-uuid";
import { ProgressRepository } from "@/features/progress/repositories/progress.repository";
import type { LearnerWorkspace } from "@/features/progress/lib/workspace-mapper";
import type {
  JourneyAssignmentSubmissionRow,
  LearnerPreferencesRow,
  LearnerResumeRow,
} from "@/types/database";

type ActionResult<T = undefined> =
  | { success: true; data?: T; message?: string }
  | { success: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null };
  await ensureProfile(supabase, user);
  return { supabase, user };
}

export async function getLearnerWorkspaceAction(): Promise<
  ActionResult<{ workspace: LearnerWorkspace }>
> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    const workspace = await repo.getWorkspace(user.id);
    return { success: true, data: { workspace } };
  } catch (error) {
    const message = formatDbError(error, "Failed to load progress.");
    console.error("[progress] getLearnerWorkspaceAction", error);
    return { success: false, error: message };
  }
}

export async function setEntityCompleteAction(input: {
  entityId: string;
  completed?: boolean;
  xp?: number;
  sourceKey?: string;
}): Promise<ActionResult<{ result: unknown }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    const result = await repo.completeEntity(input.entityId, {
      completed: input.completed ?? true,
      xp: input.xp ?? 0,
      sourceKey: input.sourceKey,
    });
    // Dual-write CMS lesson_progress when entity looks like a lesson uuid
    if (isUuid(input.entityId)) {
      await supabase.from("lesson_progress").upsert(
        {
          lesson_id: input.entityId,
          profile_id: user.id,
          completed: input.completed ?? true,
          completed_at: (input.completed ?? true)
            ? new Date().toISOString()
            : null,
        } as never,
        { onConflict: "lesson_id,profile_id" }
      );
    }
    return { success: true, data: { result } };
  } catch (error) {
    const message = formatDbError(error, "Failed to update progress.");
    console.error("[progress] setEntityCompleteAction", input.entityId, error);
    return { success: false, error: message };
  }
}

export async function setEntityNoteAction(
  entityId: string,
  note: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertEntityNote(user.id, entityId, note);
    return { success: true };
  } catch (error) {
    const message = formatDbError(error, "Failed to save note.");
    console.error("[progress] setEntityNoteAction", entityId, error);
    return { success: false, error: message };
  }
}

export async function toggleBookmarkAction(
  entityId: string,
  on: boolean
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.toggleBookmark(user.id, entityId, on);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update bookmark.",
    };
  }
}

export async function upsertProjectMetaAction(input: {
  projectId: string;
  progress?: number;
  status?: string;
  githubLink?: string;
  notes?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertProject(user.id, input.projectId, {
      progress: input.progress,
      status: input.status,
      github_link: input.githubLink,
      notes: input.notes,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save project.",
    };
  }
}

export async function upsertAssignmentMetaAction(input: {
  catalogId: string;
  updates: Record<string, unknown>;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertAssignmentMeta(user.id, input.catalogId, input.updates);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to save assignment.",
    };
  }
}

export async function setResumePositionAction(
  resume: Omit<LearnerResumeRow, "updated_at" | "profile_id">
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertResume(user.id, { ...resume, profile_id: user.id });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save resume.",
    };
  }
}

export async function updateLearnerPreferencesAction(
  patch: Partial<LearnerPreferencesRow>
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const { profile_id: _ignore, ...safe } = patch;
    const repo = new ProgressRepository(supabase);
    await repo.updatePreferences(user.id, safe);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to save preferences.",
    };
  }
}

export async function upsertLearnerNoteAction(input: {
  id?: string;
  title?: string;
  content?: string;
  weekId?: number | null;
  pinned?: boolean;
  accent?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    const row = await repo.upsertNote(user.id, {
      id: input.id,
      title: input.title,
      content: input.content,
      week_id: input.weekId ?? null,
      pinned: input.pinned,
      accent: input.accent ?? null,
    });
    return { success: true, data: { id: row.id } };
  } catch (error) {
    const message = formatDbError(error, "Failed to save note.");
    console.error("[progress] upsertLearnerNoteAction", error);
    return { success: false, error: message };
  }
}

export async function deleteLearnerNoteAction(
  noteId: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.deleteNote(user.id, noteId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete note.",
    };
  }
}

export async function listLearnerNotificationsAction(): Promise<
  ActionResult<{ notifications: LearnerWorkspace["notifications"] }>
> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    const notifications = await repo.listNotifications(user.id);
    return { success: true, data: { notifications } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load notifications.",
    };
  }
}

export async function markNotificationReadAction(
  id: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.markNotificationRead(user.id, id);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update.",
    };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.markAllNotificationsRead(user.id);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update.",
    };
  }
}

export async function clearNotificationsAction(
  onlyRead: boolean
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.clearNotifications(user.id, onlyRead);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to clear.",
    };
  }
}

export async function upsertHubLibraryAction(payload: {
  bookmarks?: string[];
  liked?: string[];
  recent?: unknown;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertHubLibrary(user.id, payload);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save library.",
    };
  }
}

export async function upsertCertAttemptAction(input: {
  certificationId: string;
  payload: Record<string, unknown>;
  status: string;
  score?: number | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertCertAttempt(
      user.id,
      input.certificationId,
      input.payload,
      input.status,
      input.score
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save attempt.",
    };
  }
}

export async function getCertAttemptsAction(): Promise<
  ActionResult<{ attempts: unknown[] }>
> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    const attempts = await repo.getCertAttempts(user.id);
    return { success: true, data: { attempts } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load attempts.",
    };
  }
}

export async function addStudySessionAction(
  hours: number,
  weekId: number
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.addStudyHours(user.id, hours, weekId);
    await repo.touchActivity();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save session.",
    };
  }
}

export async function upsertWeekNoteAction(
  weekId: number,
  note: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await repo.upsertWeekNote(user.id, weekId, note);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save note.",
    };
  }
}

export async function syncModuleGatesAction(
  gates: Record<string, { unlockedWeekIds: number[]; completedWeekIds: number[] }>
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const repo = new ProgressRepository(supabase);
    await Promise.all(
      Object.entries(gates).map(([module, gate]) =>
        repo.upsertModuleGate(
          user.id,
          module,
          gate.unlockedWeekIds,
          gate.completedWeekIds
        )
      )
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to sync gates.",
    };
  }
}

/** Atomic journey submit + XP + streak + notification (RPC). */
export async function submitJourneyAssignmentAtomicAction(input: {
  catalogId: string;
  assignmentNumber: number;
  assignmentTitle: string;
  moduleSlug: string;
  moduleTitle: string;
  studentName: string;
  studentEmail: string;
  githubUrl?: string;
  liveUrl?: string;
  screenshots?: string;
  notes?: string;
  reflection?: string;
  xp?: number;
}): Promise<
  ActionResult<{ submission: JourneyAssignmentSubmissionRow; streak: number }>
> {
  const { supabase, user } = await requireUser();
  if (!user) return { success: false, error: "Sign in required." };
  try {
    const { data, error } = await supabase.rpc(
      "submit_and_complete_journey_assignment",
      {
        p_catalog_id: input.catalogId,
        p_assignment_number: input.assignmentNumber,
        p_assignment_title: input.assignmentTitle,
        p_module_slug: input.moduleSlug,
        p_module_title: input.moduleTitle,
        p_student_name: input.studentName,
        p_student_email: input.studentEmail,
        p_github_url: input.githubUrl ?? "",
        p_live_url: input.liveUrl ?? "",
        p_screenshots: input.screenshots ?? "",
        p_notes: input.notes ?? "",
        p_reflection: input.reflection ?? "",
        p_xp: input.xp ?? 50,
      } as never
    );
    if (error) throw error;
    const payload = data as {
      submission: JourneyAssignmentSubmissionRow;
      streak: number;
    };
    revalidatePath("/dashboard");
    revalidatePath(`/assignments/${input.moduleSlug}`);
    return {
      success: true,
      data: {
        submission: payload.submission,
        streak: payload.streak,
      },
      message: "Submitted for review.",
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to submit assignment.",
    };
  }
}
