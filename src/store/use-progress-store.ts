"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { UserProfile, AppNote, StudySession, ProjectStatus } from "@/types";
import type {
  AssignmentProgressMeta,
  ProjectProgressMeta,
  UserProgressState,
  ResumePosition,
} from "./progress-types";
import { defaultProgressState, PROGRESS_VERSION } from "./progress-types";
import type { AssignmentSubmissionStatus } from "@/curriculum/assignment-catalog/types";
import { getCurriculumWeeks, getTotalWeeks } from "@/curriculum/registry";
import {
  entityMatchesRoadmapModule,
  getResetEntityIds,
  getResetGitHubWeekIds,
  getResetProjectIds,
  type ResetScope,
  type ResetSectionId,
} from "@/lib/reset-sections";
import {
  downloadJson,
  getWeekEntityIds,
  getWeekProjectIds,
  parseImportedProgress,
} from "@/lib/progress-storage";
import {
  computeWeekProgress,
  computeGlobalStats,
  getCurrentWeekId,
  isWeekLocked,
  isWeekCompleted,
  type ProgressCounts,
} from "@/lib/progress-engine";
import {
  getModuleCurrentWeek,
  getModuleWeekProgress,
  isModuleWeekCompleted,
  isModuleWeekLocked,
  migrateProgressStateV3,
  rebuildModuleGatesFromProgress,
  createDefaultModuleGates,
  type LearningModule,
} from "@/lib/module-progress";
import { COMMUNICATION_WEEKS } from "@/curriculum/communication-skills";
import { createIdbPersistStorage } from "@/lib/idb-persist-storage";
import { publishLiveActivity } from "@/lib/live-activity-sync";
import { EXPORT_APP_ID, PERSIST_KEY } from "@/lib/client-persistence";
import {
  registerProgressWorkspaceRehydrate,
  registerProgressWorkspaceReset,
} from "@/lib/client-workspace";
import {
  persistEntityComplete,
  syncAssignmentMeta,
  syncBookmark,
  syncDeleteNote,
  syncEntityNote,
  syncModuleGates,
  syncPreferences,
  syncProjectMeta,
  syncResume,
  syncStudySession,
  syncAddNote,
  persistUpdateNote,
  syncWeekNote,
} from "@/features/progress/lib/progress-sync";
import type { LearnerWorkspace } from "@/features/progress/lib/workspace-mapper";
import type { LearningModule as ResumeModule } from "@/lib/module-progress";

const defaultProfile: UserProfile = {
  name: "",
  avatar: "S",
  currentWeek: 1,
  streak: 0,
  totalStudyHours: 0,
  lastActiveDate: "",
  resumeReadinessScore: 0,
  githubProgress: 0,
};

/** Strip demo-seeded assignment completions left by older portal builds. */
function scrubLegacyDemoAssignmentSeeds(
  progress: UserProgressState
): UserProgressState {
  const withFlag = progress as UserProgressState & {
    assignmentJourneySeeded?: boolean;
  };
  const hadSeedFlag = Boolean(withFlag.assignmentJourneySeeded);

  const completed = { ...progress.completed };
  const completionDates = { ...progress.completionDates };
  const assignmentMeta = { ...(progress.assignmentMeta ?? {}) };
  let changed = hadSeedFlag;

  for (const [id, meta] of Object.entries(assignmentMeta)) {
    const isSeedNote =
      meta.notes === "Seeded foundation completion" ||
      meta.reflection === "Completed as part of Developer Foundation.";
    if (!isSeedNote) continue;
    changed = true;
    delete assignmentMeta[id];
    delete completed[`${id}-complete`];
    delete completionDates[`${id}-complete`];
    delete completed[id];
    delete completionDates[id];
  }

  if (!changed) return progress;

  const { assignmentJourneySeeded: _removed, ...rest } = withFlag;

  return {
    ...rest,
    completed,
    completionDates,
    assignmentMeta,
  };
}

function createEmptyStoreSlice() {
  return {
    progress: {
      ...defaultProgressState,
      completed: {},
      notes: {},
      bookmarks: {},
      completionDates: {},
      projectMeta: {},
      assignmentMeta: {},
      githubRepoLinks: {},
      weekNotes: {},
      moduleGates: createDefaultModuleGates(),
      scrollPositions: {},
      unlockedWeekIds: [1],
      completedWeekIds: [],
      version: PROGRESS_VERSION,
    },
    profile: { ...defaultProfile },
    studySessions: [] as StudySession[],
    notes: [] as AppNote[],
    todayGoal: "Complete today's learning plan items",
    todayGoalDate: todayIso(),
    todayGoalCompleted: false,
    resumePosition: null as ResumePosition | null,
  };
}

const defaultNotes: AppNote[] = [];

function syncModuleUnlocks(progress: UserProgressState): UserProgressState {
  const weeks = getCurriculumWeeks();
  return migrateProgressStateV3(progress, weeks, { rebuildGates: true });
}

interface ProgressStore {
  progress: UserProgressState;
  profile: UserProfile;
  studySessions: StudySession[];
  notes: AppNote[];
  todayGoal: string;
  todayGoalDate: string;
  todayGoalCompleted: boolean;
  resumePosition: ResumePosition | null;

  getCompletionDate: (entityId: string) => string | undefined;
  getStats: () => ReturnType<typeof computeGlobalStats>;
  getWeekProgress: (weekId: number) => ReturnType<typeof computeWeekProgress>;
  getModuleWeekProgress: (module: LearningModule, weekId: number) => ProgressCounts;
  getCurrentWeekId: () => number;
  getModuleCurrentWeek: (module: LearningModule) => number;
  isLocked: (weekId: number) => boolean;
  isModuleWeekLocked: (module: LearningModule, weekId: number) => boolean;
  isCompleted: (weekId: number) => boolean;
  isModuleWeekCompleted: (module: LearningModule, weekId: number) => boolean;
  isDone: (entityId: string) => boolean;
  getNote: (entityId: string) => string;
  isBookmarked: (entityId: string) => boolean;

  // Universal toggle
  toggleComplete: (entityId: string) => void;
  setComplete: (entityId: string, value: boolean) => void;
  setNote: (entityId: string, note: string) => void;
  toggleBookmark: (entityId: string) => void;

  // Project-specific
  updateProjectMeta: (
    projectId: string,
    updates: Partial<{ progress: number; status: ProjectStatus; githubLink: string; notes: string }>
  ) => void;
  setProjectComplete: (projectId: string, complete: boolean) => void;

  // Assignment journey
  getAssignmentMeta: (assignmentId: string) => AssignmentProgressMeta | undefined;
  setAssignmentComplete: (assignmentId: string, complete: boolean) => void;
  setAssignmentSubmission: (
    assignmentId: string,
    updates: Partial<AssignmentProgressMeta>
  ) => void;

  // GitHub repo links
  setGitHubRepoLink: (weekId: number, link: string) => void;
  getGitHubRepoLink: (weekId: number) => string;

  // Week
  updateWeekNotes: (weekId: number, notes: string) => void;
  completeWeek: (weekId: number) => void;
  completeModuleWeek: (module: LearningModule, weekId: number) => void;
  setResumePosition: (position: ResumePosition) => void;
  setScrollPosition: (key: string, scrollY: number) => void;
  getScrollPosition: (key: string) => number;

  // Profile & misc
  setTodayGoal: (goal: string) => void;
  toggleTodayGoal: () => void;
  addStudySession: (hours: number) => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  addNote: (note: AppNote) => void;
  updateNote: (id: string, updates: Partial<AppNote>) => void;
  deleteNote: (id: string) => void;
  updateStreak: () => void;
  syncProfileFromProgress: () => void;
  bootstrapSession: () => void;
  /** Replace local cache from authoritative server workspace. */
  hydrateFromServer: (workspace: import("@/features/progress/lib/workspace-mapper").LearnerWorkspace) => void;
  resetWeekProgress: (weekId: number) => void;
  resetSectionProgress: (section: ResetSectionId, scope: ResetScope) => void;
  resetAllProgress: () => void;
  exportProgress: () => void;
  importProgress: (json: string) => void;
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function stripEntityKeys<T extends Record<string, unknown>>(map: T, ids: Set<string>): T {
  const next = { ...map };
  ids.forEach((id) => {
    delete next[id];
  });
  return next;
}

function syncDerivedProfile(
  profile: UserProfile,
  stats: ReturnType<typeof computeGlobalStats>,
  currentWeek: number
): UserProfile {
  return {
    ...profile,
    currentWeek,
    resumeReadinessScore: Math.min(
      Math.round(stats.overallProgress * 0.6 + stats.interviewCompleted * 2),
      100
    ),
    githubProgress: stats.githubTotal
      ? Math.round((stats.githubCompleted / stats.githubTotal) * 100)
      : 0,
  };
}

export const useProgressStore = create<ProgressStore>()(
  persist(
    (set, get) => ({
      progress: defaultProgressState,
      profile: defaultProfile,
      studySessions: [],
      notes: defaultNotes,
      todayGoal: "Complete today's learning plan items",
      todayGoalDate: todayIso(),
      todayGoalCompleted: false,
      resumePosition: null,

      getStats: () => computeGlobalStats(getCurriculumWeeks(), get().progress),

      getWeekProgress: (weekId) => {
        const week = getCurriculumWeeks().find((w) => w.id === weekId);
        if (!week) {
          const empty = { completed: 0, total: 0, percentage: 0 };
          return {
            overall: empty,
            dayItems: empty,
            topicItems: empty,
            programming: empty,
            projects: empty,
            ai: empty,
            github: empty,
            interview: empty,
          };
        }
        return computeWeekProgress(week, get().progress);
      },

      getModuleWeekProgress: (module, weekId) => {
        const week = getCurriculumWeeks().find((w) => w.id === weekId);
        return getModuleWeekProgress(module, weekId, week, get().progress);
      },

      getCurrentWeekId: () => getCurrentWeekId(getCurriculumWeeks(), get().progress),

      getModuleCurrentWeek: (module) => {
        const max =
          module === "communication" ? COMMUNICATION_WEEKS.length : getTotalWeeks();
        return getModuleCurrentWeek(module, get().progress, max);
      },

      isLocked: (weekId) => isModuleWeekLocked("practice", weekId, get().progress),

      isModuleWeekLocked: (module, weekId) =>
        isModuleWeekLocked(module, weekId, get().progress),

      isCompleted: (weekId) => isModuleWeekCompleted("practice", weekId, get().progress),

      isModuleWeekCompleted: (module, weekId) =>
        isModuleWeekCompleted(module, weekId, get().progress),

      isDone: (entityId) => Boolean(get().progress.completed[entityId]),

      getNote: (entityId) => get().progress.notes[entityId] ?? "",

      isBookmarked: (entityId) => Boolean(get().progress.bookmarks[entityId]),

      getCompletionDate: (entityId) => get().progress.completionDates[entityId],

      toggleComplete: (entityId) => {
        const wasDone = get().progress.completed[entityId];
        const nowDone = !wasDone;
        set((state) => {
          const completed = { ...state.progress.completed, [entityId]: nowDone };
          const completionDates = { ...state.progress.completionDates };
          if (nowDone) {
            completionDates[entityId] = todayIso();
          } else {
            delete completionDates[entityId];
          }
          const progress = syncModuleUnlocks({ ...state.progress, completed, completionDates });
          const stats = computeGlobalStats(getCurriculumWeeks(), progress);
          const currentWeek = getCurrentWeekId(getCurriculumWeeks(), progress);
          return {
            progress,
            profile: syncDerivedProfile(state.profile, stats, currentWeek),
          };
        });
        void persistEntityComplete(entityId, nowDone, 10).then((ok) => {
          if (ok) return;
          set((state) => {
            const completed = { ...state.progress.completed, [entityId]: Boolean(wasDone) };
            const completionDates = { ...state.progress.completionDates };
            if (wasDone) {
              completionDates[entityId] =
                completionDates[entityId] ?? todayIso();
            } else {
              delete completionDates[entityId];
            }
            const progress = syncModuleUnlocks({
              ...state.progress,
              completed,
              completionDates,
            });
            const stats = computeGlobalStats(getCurriculumWeeks(), progress);
            const currentWeek = getCurrentWeekId(getCurriculumWeeks(), progress);
            return {
              progress,
              profile: syncDerivedProfile(state.profile, stats, currentWeek),
            };
          });
        });
        syncModuleGates(get().progress.moduleGates);
        if (nowDone) get().updateStreak();
      },

      setComplete: (entityId, value) => {
        const current = get().isDone(entityId);
        if (current !== value) get().toggleComplete(entityId);
      },

      setNote: (entityId, note) => {
        set((state) => ({
          progress: {
            ...state.progress,
            notes: { ...state.progress.notes, [entityId]: note },
          },
        }));
        syncEntityNote(entityId, note);
      },

      toggleBookmark: (entityId) => {
        let nextOn = false;
        set((state) => {
          const next = { ...state.progress.bookmarks };
          if (next[entityId]) {
            delete next[entityId];
            nextOn = false;
          } else {
            next[entityId] = true;
            nextOn = true;
          }
          return {
            progress: {
              ...state.progress,
              bookmarks: next,
            },
          };
        });
        syncBookmark(entityId, nextOn);
      },

      updateProjectMeta: (projectId, updates) => {
        let merged: ProjectProgressMeta = {
          progress: 0,
          status: "not-started",
          githubLink: "",
          notes: "",
        };
        set((state) => {
          const existing = state.progress.projectMeta[projectId] ?? {
            progress: 0,
            status: "not-started" as ProjectStatus,
            githubLink: "",
            notes: "",
          };
          merged = { ...existing, ...updates };
          if (updates.progress !== undefined) {
            merged.status =
              updates.progress >= 100
                ? "completed"
                : updates.progress > 0
                  ? "in-progress"
                  : "not-started";
          }
          return {
            progress: {
              ...state.progress,
              projectMeta: { ...state.progress.projectMeta, [projectId]: merged },
            },
          };
        });
        syncProjectMeta(projectId, merged);
      },

      setProjectComplete: (projectId, complete) => {
        get().setComplete(`${projectId}-complete`, complete);
        get().updateProjectMeta(projectId, {
          progress: complete ? 100 : get().progress.projectMeta[projectId]?.progress ?? 0,
          status: complete ? "completed" : "in-progress",
        });
      },

      getAssignmentMeta: (assignmentId) =>
        get().progress.assignmentMeta?.[assignmentId],

      setAssignmentComplete: (assignmentId, complete) => {
        get().setComplete(`${assignmentId}-complete`, complete);
        let nextMeta: AssignmentProgressMeta | undefined;
        set((state) => {
          const existing = state.progress.assignmentMeta?.[assignmentId] ?? {
            status: "not_started" as AssignmentSubmissionStatus,
            githubUrl: "",
            liveUrl: "",
            screenshots: "",
            notes: "",
            reflection: "",
          };
          nextMeta = {
            ...existing,
            status: complete
              ? "completed"
              : existing.status === "completed"
                ? "in_progress"
                : existing.status,
          };
          return {
            progress: {
              ...state.progress,
              assignmentMeta: {
                ...(state.progress.assignmentMeta ?? {}),
                [assignmentId]: nextMeta,
              },
            },
          };
        });
        if (nextMeta) syncAssignmentMeta(assignmentId, nextMeta);
      },

      setAssignmentSubmission: (assignmentId, updates) => {
        let merged: AssignmentProgressMeta | undefined;
        set((state) => {
          const existing = state.progress.assignmentMeta?.[assignmentId] ?? {
            status: "not_started" as AssignmentSubmissionStatus,
            githubUrl: "",
            liveUrl: "",
            screenshots: "",
            notes: "",
            reflection: "",
          };
          merged = {
            ...existing,
            ...updates,
          };
          if (updates.status === "submitted" || updates.status === "pending_review") {
            merged.submittedAt = updates.submittedAt ?? new Date().toISOString();
          }
          return {
            progress: {
              ...state.progress,
              assignmentMeta: {
                ...(state.progress.assignmentMeta ?? {}),
                [assignmentId]: merged,
              },
            },
          };
        });
        if (merged) syncAssignmentMeta(assignmentId, merged);
      },

      setGitHubRepoLink: (weekId, link) => {
        set((state) => ({
          progress: {
            ...state.progress,
            githubRepoLinks: { ...state.progress.githubRepoLinks, [weekId]: link },
          },
        }));
        syncPreferences({
          github_repo_links: {
            ...get().progress.githubRepoLinks,
            [weekId]: link,
          },
        });
      },

      getGitHubRepoLink: (weekId) => get().progress.githubRepoLinks[weekId] ?? "",

      updateWeekNotes: (weekId, notes) => {
        set((state) => ({
          progress: {
            ...state.progress,
            weekNotes: { ...state.progress.weekNotes, [weekId]: notes },
          },
        }));
        syncWeekNote(weekId, notes);
      },

      completeWeek: (weekId) => get().completeModuleWeek("practice", weekId),

      completeModuleWeek: (_module, _weekId) =>
        set((state) => {
          const progress = syncModuleUnlocks(state.progress);
          const stats = computeGlobalStats(getCurriculumWeeks(), progress);
          const currentWeek = getModuleCurrentWeek("practice", progress, getTotalWeeks());
          syncModuleGates(progress.moduleGates);
          return {
            progress,
            profile: syncDerivedProfile(state.profile, stats, currentWeek),
          };
        }),

      setResumePosition: (position) => {
        set((state) => {
          publishLiveActivity({ ...position, learnerName: state.profile.name });
          return { resumePosition: position };
        });
        syncResume(position);
      },

      setScrollPosition: (key, scrollY) => {
        set((state) => {
          if (state.progress.scrollPositions[key] === scrollY) return state;
          return {
            progress: {
              ...state.progress,
              scrollPositions: { ...state.progress.scrollPositions, [key]: scrollY },
            },
          };
        });
        syncPreferences({
          scroll_positions: {
            ...get().progress.scrollPositions,
            [key]: scrollY,
          },
        });
      },

      getScrollPosition: (key) => get().progress.scrollPositions[key] ?? 0,

      setTodayGoal: (goal) => {
        set({ todayGoal: goal });
        syncPreferences({
          today_goal: goal,
          today_goal_date: get().todayGoalDate || todayIso(),
        });
      },
      toggleTodayGoal: () => {
        set((s) => ({ todayGoalCompleted: !s.todayGoalCompleted }));
        syncPreferences({
          today_goal_completed: get().todayGoalCompleted,
          today_goal_date: get().todayGoalDate || todayIso(),
        });
      },

      hydrateFromServer: (workspace: LearnerWorkspace) => {
        const resume = workspace.resumePosition
          ? {
              module: workspace.resumePosition.module as ResumeModule,
              weekId: workspace.resumePosition.week_id,
              title: workspace.resumePosition.title,
              subtitle: workspace.resumePosition.subtitle ?? undefined,
              href: workspace.resumePosition.href,
              updatedAt: workspace.resumePosition.updated_at,
              topicSlug: workspace.resumePosition.topic_slug ?? undefined,
              topicTitle: workspace.resumePosition.topic_title ?? undefined,
              lessonId: workspace.resumePosition.lesson_id ?? undefined,
            }
          : null;
        const weeks = getCurriculumWeeks();
        const progress = syncModuleUnlocks(
          migrateProgressStateV3(workspace.progress, weeks, { rebuildGates: true })
        );
        const stats = computeGlobalStats(weeks, progress);
        const currentWeek = getCurrentWeekId(weeks, progress);
        set({
          progress,
          notes: workspace.notes,
          studySessions: workspace.studySessions,
          resumePosition: resume,
          todayGoal: workspace.preferences.today_goal || "Complete today's learning plan items",
          todayGoalDate: workspace.preferences.today_goal_date || todayIso(),
          todayGoalCompleted: workspace.preferences.today_goal_completed,
          profile: syncDerivedProfile(
            {
              ...get().profile,
              streak: workspace.profile.streak,
              totalStudyHours: workspace.profile.totalStudyHours,
              lastActiveDate: workspace.profile.lastActiveDate,
              currentWeek: workspace.profile.currentWeek,
            },
            stats,
            currentWeek
          ),
        });
      },

      bootstrapSession: () => {
        const today = todayIso();
        set((state) => {
          const updates: Partial<typeof state> = {};
          if (state.todayGoalDate !== today) {
            updates.todayGoalDate = today;
            updates.todayGoalCompleted = false;
          }
          const weeks = getCurriculumWeeks();
          let progress = syncModuleUnlocks(
            scrubLegacyDemoAssignmentSeeds(
              migrateProgressStateV3(state.progress, weeks, { rebuildGates: true })
            )
          );
          if (!progress.assignmentMeta) {
            progress = { ...progress, assignmentMeta: {} };
          }
          updates.progress = progress;

          const practiceWeek = getModuleCurrentWeek("practice", progress, getTotalWeeks());
          const resume = state.resumePosition;
          if (resume && resume.weekId < practiceWeek) {
            updates.resumePosition = null;
          } else if (resume) {
            publishLiveActivity({
              ...resume,
              learnerName: state.profile.name,
            });
          }

          const stats = computeGlobalStats(weeks, progress);
          const currentWeek = getCurrentWeekId(weeks, progress);
          updates.profile = syncDerivedProfile(state.profile, stats, currentWeek);
          return { ...state, ...updates };
        });
      },

      resetWeekProgress: (weekId) => {
        const week = getCurriculumWeeks().find((w) => w.id === weekId);
        if (!week) return;
        const ids = new Set(getWeekEntityIds(week));
        const projectIds = getWeekProjectIds(week);

        set((state) => {
          const base = {
            ...state.progress,
            completed: stripEntityKeys(state.progress.completed, ids),
            notes: stripEntityKeys(state.progress.notes, ids),
            bookmarks: stripEntityKeys(state.progress.bookmarks, ids),
            completionDates: stripEntityKeys(state.progress.completionDates, ids),
            projectMeta: Object.fromEntries(
              Object.entries(state.progress.projectMeta).filter(([id]) => !projectIds.includes(id))
            ),
            githubRepoLinks: Object.fromEntries(
              Object.entries(state.progress.githubRepoLinks).filter(([id]) => Number(id) !== weekId)
            ),
            weekNotes: Object.fromEntries(
              Object.entries(state.progress.weekNotes).filter(([id]) => Number(id) !== weekId)
            ),
          };
          const progress = syncModuleUnlocks(base);
          const stats = computeGlobalStats(getCurriculumWeeks(), progress);
          const currentWeek = getCurrentWeekId(getCurriculumWeeks(), progress);
          return { progress, profile: syncDerivedProfile(state.profile, stats, currentWeek) };
        });
      },

      resetSectionProgress: (section, scope) => {
        if (section === "notes") {
          set({ notes: defaultNotes });
          return;
        }

        if (section === "study-stats") {
          set((state) => ({
            studySessions: [],
            profile: {
              ...state.profile,
              streak: 0,
              totalStudyHours: 0,
              lastActiveDate: todayIso(),
            },
          }));
          return;
        }

        const ids = getResetEntityIds(section, scope);
        const projectIds = getResetProjectIds(section, scope);
        const githubWeekIds = getResetGitHubWeekIds(section, scope);
        const moduleIndex = typeof scope === "number" ? scope : null;

        set((state) => {
          const stripModuleKeys = <T,>(
            record: Record<string, T>
          ): Record<string, T> => {
            if (moduleIndex == null) return record;
            if (section !== "roadmap" && section !== "projects") return record;
            return Object.fromEntries(
              Object.entries(record).filter(
                ([id]) => !entityMatchesRoadmapModule(id, moduleIndex)
              )
            );
          };

          const base = {
            ...state.progress,
            completed: stripModuleKeys(
              stripEntityKeys(state.progress.completed, ids)
            ),
            notes: stripModuleKeys(stripEntityKeys(state.progress.notes, ids)),
            bookmarks: stripModuleKeys(
              stripEntityKeys(state.progress.bookmarks, ids)
            ),
            completionDates: stripModuleKeys(
              stripEntityKeys(state.progress.completionDates, ids)
            ),
            projectMeta:
              projectIds.length > 0
                ? Object.fromEntries(
                    Object.entries(state.progress.projectMeta).filter(
                      ([id]) => !projectIds.includes(id)
                    )
                  )
                : state.progress.projectMeta,
            githubRepoLinks:
              githubWeekIds.length > 0
                ? Object.fromEntries(
                    Object.entries(state.progress.githubRepoLinks).filter(
                      ([id]) => !githubWeekIds.includes(Number(id))
                    )
                  )
                : state.progress.githubRepoLinks,
          };
          const progress = syncModuleUnlocks(base);
          const stats = computeGlobalStats(getCurriculumWeeks(), progress);
          const currentWeek = getCurrentWeekId(getCurriculumWeeks(), progress);
          return { progress, profile: syncDerivedProfile(state.profile, stats, currentWeek) };
        });
      },

      resetAllProgress: () => {
        set({
          progress: defaultProgressState,
          profile: { ...defaultProfile, lastActiveDate: todayIso() },
          studySessions: [],
          notes: defaultNotes,
          todayGoal: "Complete today's learning plan items",
          todayGoalDate: todayIso(),
          todayGoalCompleted: false,
          resumePosition: null,
        });
      },

      exportProgress: () => {
        const state = get();
        const payload = {
          version: PROGRESS_VERSION,
          exportedAt: new Date().toISOString(),
          app: EXPORT_APP_ID,
          progress: state.progress,
          profile: state.profile,
          studySessions: state.studySessions,
          notes: state.notes,
          todayGoal: state.todayGoal,
          todayGoalDate: state.todayGoalDate,
          todayGoalCompleted: state.todayGoalCompleted,
          resumePosition: state.resumePosition,
        };
        downloadJson(`SupraBase-progress-${todayIso()}.json`, JSON.stringify(payload, null, 2));
      },

      importProgress: (json) => {
        const data = parseImportedProgress(json);
        const weeks = getCurriculumWeeks();
        const mergedProgress = migrateProgressStateV3(
          {
            ...defaultProgressState,
            ...(data.progress as UserProgressState),
            scrollPositions: {
              ...defaultProgressState.scrollPositions,
              ...((data.progress as UserProgressState)?.scrollPositions ?? {}),
            },
          },
          weeks,
          { rebuildGates: true }
        );
        const progress = syncModuleUnlocks(mergedProgress);

        set({
          progress,
          profile: syncDerivedProfile(
            { ...defaultProfile, ...(data.profile as UserProfile) },
            computeGlobalStats(weeks, progress),
            getCurrentWeekId(weeks, progress)
          ),
          studySessions: (data.studySessions as StudySession[]) ?? [],
          notes: (data.notes as AppNote[]) ?? defaultNotes,
          todayGoal: data.todayGoal ?? "Complete today's learning plan items",
          todayGoalDate: data.todayGoalDate ?? todayIso(),
          todayGoalCompleted: Boolean(data.todayGoalCompleted),
          resumePosition: (data.resumePosition as ResumePosition | null) ?? null,
        });

        const resume = (data.resumePosition as ResumePosition | null) ?? null;
        if (resume) {
          publishLiveActivity({
            ...resume,
            learnerName: get().profile.name,
          });
        }
      },

      addStudySession: (hours) => {
        set((state) => {
          const today = todayIso();
          const weekId = getCurrentWeekId(getCurriculumWeeks(), state.progress);
          const existing = state.studySessions.find((s) => s.date === today);
          const sessions = existing
            ? state.studySessions.map((s) =>
                s.date === today ? { ...s, hours: s.hours + hours } : s
              )
            : [...state.studySessions, { date: today, hours, weekId }];
          return {
            studySessions: sessions,
            profile: { ...state.profile, totalStudyHours: state.profile.totalStudyHours + hours },
          };
        });
        syncStudySession(hours, get().getCurrentWeekId());
      },

      updateProfile: (updates) => set((s) => ({ profile: { ...s.profile, ...updates } })),

      addNote: (note) => {
        set((s) => ({ notes: [...s.notes, note] }));
        void syncAddNote(note).then((serverId) => {
          if (!serverId || serverId === note.id) return;
          set((s) => ({
            notes: s.notes.map((n) =>
              n.id === note.id ? { ...n, id: serverId } : n
            ),
          }));
        });
      },
      updateNote: (id, updates) => {
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
          ),
        }));
        void persistUpdateNote(id, updates).then((serverId) => {
          if (!serverId || serverId === id) return;
          set((s) => ({
            notes: s.notes.map((n) => (n.id === id ? { ...n, id: serverId } : n)),
          }));
        });
      },
      deleteNote: (id) => {
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
        syncDeleteNote(id);
      },

      updateStreak: () =>
        set((state) => {
          const today = todayIso();
          const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
          const { lastActiveDate, streak } = state.profile;
          if (lastActiveDate === today) return state;
          const newStreak = lastActiveDate === yesterday ? streak + 1 : 1;
          return { profile: { ...state.profile, streak: newStreak, lastActiveDate: today } };
        }),

      syncProfileFromProgress: () =>
        set((state) => {
          const stats = computeGlobalStats(getCurriculumWeeks(), state.progress);
          const currentWeek = getCurrentWeekId(getCurriculumWeeks(), state.progress);
          return { profile: syncDerivedProfile(state.profile, stats, currentWeek) };
        }),
    }),
    {
      name: PERSIST_KEY,
      version: PROGRESS_VERSION,
      storage: createJSONStorage(() => createIdbPersistStorage()),
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const state = persisted as Record<string, unknown>;
        if (!state.todayGoalDate) state.todayGoalDate = todayIso();
        if (state.progress) {
          const weeks = getCurriculumWeeks();
          let progress = scrubLegacyDemoAssignmentSeeds(
            state.progress as UserProgressState
          );
          if (!progress.scrollPositions) {
            progress = { ...progress, scrollPositions: {} };
          }
          if (version < PROGRESS_VERSION) {
            progress = {
              ...progress,
              version: PROGRESS_VERSION,
              moduleGates: rebuildModuleGatesFromProgress(weeks, progress),
              scrollPositions: progress.scrollPositions ?? {},
            };
          }
          state.progress = migrateProgressStateV3(progress, weeks, {
            rebuildGates: true,
          });
        }
        if (version < PROGRESS_VERSION && !state.resumePosition) {
          state.resumePosition = null;
        }
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        state?.bootstrapSession();
      },
    }
  )
);

registerProgressWorkspaceReset(() => {
  useProgressStore.setState(createEmptyStoreSlice());
});

registerProgressWorkspaceRehydrate(async () => {
  await useProgressStore.persist.rehydrate();
});

/** Load authoritative progress from Supabase into the in-memory store. */
export async function rehydrateProgressWorkspace() {
  const { fetchLearnerWorkspace } = await import(
    "@/features/progress/lib/progress-sync"
  );
  const { useProgressHydration } = await import(
    "@/store/use-progress-hydration"
  );
  useProgressHydration.getState().setLoading();
  const { workspace, error } = await fetchLearnerWorkspace();
  if (workspace) {
    useProgressStore.getState().hydrateFromServer(workspace);
    useProgressStore.getState().bootstrapSession();
    useProgressHydration.getState().setReady();
    return;
  }
  if (error) {
    console.error("[progress] rehydrateProgressWorkspace", error);
    useProgressHydration.getState().setError(error);
    return;
  }
  useProgressStore.getState().bootstrapSession();
  useProgressHydration.getState().setReady();
}

/** Backward-compatible alias */
export const useAppStore = useProgressStore;

export function getStats() {
  return useProgressStore.getState().getStats();
}
