"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProgressStore } from "@/store/use-progress-store";
import { useCurriculum } from "@/hooks/use-curriculum";
import { useStoreHydrated } from "@/hooks/use-store-hydrated";
import { useUser } from "@/hooks/use-user";
import { getWeekById } from "@/curriculum/java-roadmap/curriculum";
import { isWeekFullyCompleteAcrossModules } from "@/lib/module-progress";
import { fireWeekCelebration } from "@/components/shared/week-completion-celebration";
import { syncCelebratedWeeks } from "@/lib/week-celebration-storage";
import {
  bindClientWorkspace,
  clearClientWorkspace,
} from "@/lib/client-workspace";
import { fetchLearnerWorkspace } from "@/features/progress/lib/progress-sync";
import { refreshNotificationsFromServer } from "@/lib/notifications";
import type { PortalUser } from "@/features/portal/types";

type SeedUser = Pick<PortalUser, "id" | "name" | "email">;

/** Binds auth user and hydrates progress from Supabase (server is source of truth). */
export function ProgressBootstrap({ seedUser }: { seedUser?: SeedUser }) {
  const { user, profile, isLoading } = useUser({ enabled: !seedUser });
  const boundUserRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const activeId = seedUser?.id ?? user?.id ?? null;
  const displayName =
    seedUser?.name ||
    profile?.full_name?.trim() ||
    user?.user_metadata?.full_name ||
    seedUser?.email?.split("@")[0] ||
    user?.email?.split("@")[0] ||
    "";

  useEffect(() => {
    if (!activeId && isLoading && !seedUser) return;

    const requestId = ++requestIdRef.current;

    void (async () => {
      if (!activeId) {
        boundUserRef.current = null;
        await clearClientWorkspace();
        return;
      }

      if (boundUserRef.current !== activeId) {
        await bindClientWorkspace(activeId);
        boundUserRef.current = activeId;
      }

      const { workspace, error } = await fetchLearnerWorkspace();
      if (requestId !== requestIdRef.current) return;

      if (workspace) {
        const store = useProgressStore.getState();
        store.hydrateFromServer(workspace);
        store.bootstrapSession();
        void refreshNotificationsFromServer();
      } else if (error) {
        console.error("[progress] workspace hydrate failed", error);
        toast.error(`Progress did not load: ${error}`);
      }

      if (displayName) {
        useProgressStore.getState().updateProfile({
          name: displayName,
          avatar: displayName.charAt(0).toUpperCase(),
        });
      }
    })();
  }, [activeId, displayName, isLoading, seedUser]);

  return null;
}

/** Celebrates when a week is newly fully complete across every learning module. */
export function ModuleCompletionWatcher() {
  const weeks = useCurriculum();
  const progress = useProgressStore((s) => s.progress);
  const hydrated = useStoreHydrated();
  const prevCompleteRef = useRef<Record<number, boolean>>({});
  const syncedBaselineRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;

    const completedIds: number[] = [];

    weeks.forEach((week) => {
      const complete = isWeekFullyCompleteAcrossModules(progress, week.id, weeks);
      if (complete) completedIds.push(week.id);

      const prev = prevCompleteRef.current[week.id];
      const hasBaseline = prev !== undefined;

      if (hasBaseline && !prev && complete) {
        const meta = getWeekById(week.id);
        const nextWeek = week.id + 1;
        fireWeekCelebration({
          completedWeekId: week.id,
          nextWeekId: nextWeek <= weeks.length ? nextWeek : null,
          weekTitle: meta?.title ?? `Week ${week.id}`,
          weekEmoji: meta?.emoji,
        });
      }

      prevCompleteRef.current[week.id] = complete;
    });

    if (!syncedBaselineRef.current) {
      syncCelebratedWeeks(completedIds);
      syncedBaselineRef.current = true;
    }
  }, [weeks, progress.completed, hydrated]);

  return null;
}

/** @deprecated use ModuleCompletionWatcher */
export function WeekCompletionWatcher() {
  return <ModuleCompletionWatcher />;
}

export { MODULE_LABELS, type LearningModule } from "@/lib/module-progress";
