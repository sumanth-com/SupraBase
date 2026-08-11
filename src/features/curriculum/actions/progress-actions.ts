"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile, formatDbError } from "@/lib/supabase/ensure-profile";
import { ProgressService } from "@/features/curriculum/services/progress.service";
import { LessonsRepository } from "@/features/curriculum/repositories/lessons.repository";
import { ModulesRepository } from "@/features/curriculum/repositories/modules.repository";
import { CURRICULUM_ROUTES } from "@/features/curriculum/types";

export type ProgressActionResult =
  | { success: true; completed: boolean }
  | { success: false; error: string };

export async function toggleLessonCompleteAction(
  lessonId: string,
  currentlyCompleted: boolean
): Promise<ProgressActionResult> {
  if (!lessonId) {
    return { success: false, error: "Lesson id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in." };
  }

  try {
    await ensureProfile(supabase, user);
    const progress = new ProgressService(supabase);
    const next = !currentlyCompleted;
    if (next) {
      await progress.markComplete(user.id, lessonId);
    } else {
      await progress.markIncomplete(user.id, lessonId);
    }

    // Dual-write into universal entity_progress via atomic RPC
    const { error: entityError } = await supabase.rpc("complete_entity", {
      p_entity_id: lessonId,
      p_xp: next ? 10 : 0,
      p_source_key: next ? `lesson:${lessonId}` : undefined,
      p_completed: next,
    } as never);
    if (entityError) throw entityError;

    const lessonsRepo = new LessonsRepository(supabase);
    const modulesRepo = new ModulesRepository(supabase);
    const lesson = await lessonsRepo.findById(lessonId);

    if (lesson) {
      revalidatePath(CURRICULUM_ROUTES.lesson(lesson.slug));
      const module = await modulesRepo.findById(lesson.module_id);
      if (module) {
        revalidatePath(CURRICULUM_ROUTES.module(module.slug));
      }
    }

    return { success: true, completed: next };
  } catch (error) {
    const message = formatDbError(error, "Unable to update progress.");
    console.error("[progress] toggleLessonCompleteAction", lessonId, error);
    return { success: false, error: message };
  }
}
