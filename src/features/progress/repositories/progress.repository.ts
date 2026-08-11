import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  LearnerNoteRow,
  LearnerNotificationRow,
  LearnerPreferencesRow,
  LearnerResumeRow,
  LearnerStatsRow,
  StudySessionRow,
} from "@/types/database";
import {
  mapLearnerNotes,
  mapStudySessions,
  mapWorkspaceToProgress,
  type LearnerWorkspace,
} from "@/features/progress/lib/workspace-mapper";
import { createDefaultModuleGates } from "@/lib/module-progress";
import { isUuid } from "@/lib/is-uuid";

type Client = SupabaseClient<Database>;

function emptyStats(profileId: string): LearnerStatsRow {
  const now = new Date().toISOString();
  return {
    profile_id: profileId,
    total_xp: 0,
    level: 1,
    streak: 0,
    last_active_date: null,
    total_study_hours: 0,
    current_week: 1,
    created_at: now,
    updated_at: now,
  };
}

function emptyPreferences(profileId: string): LearnerPreferencesRow {
  return {
    profile_id: profileId,
    notifications_muted: false,
    notification_sound: "chime",
    notify_learning: true,
    notify_mentor: true,
    notify_achievements: true,
    celebrations_enabled: true,
    today_goal: "",
    today_goal_date: null,
    today_goal_completed: false,
    celebrated_week_ids: [],
    scroll_positions: {},
    github_repo_links: {},
    updated_at: new Date().toISOString(),
  };
}

export class ProgressRepository {
  constructor(private readonly client: Client) {}

  async ensureWorkspace(profileId: string) {
    await this.client.rpc("ensure_learner_workspace", {
      p_profile_id: profileId,
    } as never);
  }

  async getWorkspace(profileId: string): Promise<LearnerWorkspace> {
    await this.ensureWorkspace(profileId);

    const [
      statsRes,
      prefsRes,
      entitiesRes,
      entityNotesRes,
      weekNotesRes,
      bookmarksRes,
      projectsRes,
      assignmentsRes,
      gatesRes,
      notesRes,
      sessionsRes,
      resumeRes,
      notificationsRes,
      hubRes,
    ] = await Promise.all([
      this.client
        .from("learner_stats")
        .select("*")
        .eq("profile_id", profileId)
        .maybeSingle(),
      this.client
        .from("learner_preferences")
        .select("*")
        .eq("profile_id", profileId)
        .maybeSingle(),
      this.client
        .from("entity_progress")
        .select("*")
        .eq("profile_id", profileId)
        .eq("completed", true),
      this.client
        .from("entity_notes")
        .select("*")
        .eq("profile_id", profileId),
      this.client.from("week_notes").select("*").eq("profile_id", profileId),
      this.client
        .from("learner_bookmarks")
        .select("*")
        .eq("profile_id", profileId),
      this.client
        .from("project_progress")
        .select("*")
        .eq("profile_id", profileId),
      this.client
        .from("assignment_local_meta")
        .select("*")
        .eq("profile_id", profileId),
      this.client.from("module_gates").select("*").eq("profile_id", profileId),
      this.client
        .from("learner_notes")
        .select("*")
        .eq("profile_id", profileId)
        .order("updated_at", { ascending: false }),
      this.client
        .from("study_sessions")
        .select("*")
        .eq("profile_id", profileId)
        .order("session_date", { ascending: false })
        .limit(90),
      this.client
        .from("learner_resume")
        .select("*")
        .eq("profile_id", profileId)
        .maybeSingle(),
      this.client
        .from("learner_notifications")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(80),
      this.client
        .from("hub_library")
        .select("*")
        .eq("profile_id", profileId)
        .maybeSingle(),
    ]);

    const errors = [
      statsRes.error,
      prefsRes.error,
      entitiesRes.error,
      entityNotesRes.error,
      weekNotesRes.error,
      bookmarksRes.error,
      projectsRes.error,
      assignmentsRes.error,
      gatesRes.error,
      notesRes.error,
      sessionsRes.error,
      resumeRes.error,
      notificationsRes.error,
      hubRes.error,
    ].filter(Boolean);
    if (errors[0]) throw errors[0];

    const stats = (statsRes.data as LearnerStatsRow | null) ?? emptyStats(profileId);
    const preferences =
      (prefsRes.data as LearnerPreferencesRow | null) ??
      emptyPreferences(profileId);

    const progress = mapWorkspaceToProgress({
      entities: (entitiesRes.data ?? []) as never[],
      entityNotes: (entityNotesRes.data ?? []) as never[],
      weekNotes: (weekNotesRes.data ?? []) as never[],
      bookmarks: (bookmarksRes.data ?? []) as never[],
      projects: (projectsRes.data ?? []) as never[],
      assignments: (assignmentsRes.data ?? []) as never[],
      gates: (gatesRes.data ?? []) as never[],
      preferences,
    });

    if (!gatesRes.data?.length) {
      progress.moduleGates = createDefaultModuleGates();
    }

    return {
      stats,
      preferences,
      progress,
      profile: {
        currentWeek: stats.current_week,
        streak: stats.streak,
        totalStudyHours: Number(stats.total_study_hours),
        lastActiveDate: stats.last_active_date ?? "",
        resumeReadinessScore: 0,
        githubProgress: 0,
        totalXp: stats.total_xp,
        level: stats.level,
      },
      notes: mapLearnerNotes((notesRes.data ?? []) as LearnerNoteRow[]),
      studySessions: mapStudySessions((sessionsRes.data ?? []) as never[]),
      resumePosition: (resumeRes.data as LearnerResumeRow | null) ?? null,
      notifications: (notificationsRes.data ?? []) as LearnerNotificationRow[],
      hubLibrary: hubRes.data as never,
    };
  }

  async completeEntity(
    entityId: string,
    options?: { xp?: number; sourceKey?: string; completed?: boolean }
  ) {
    const { data, error } = await this.client.rpc("complete_entity", {
      p_entity_id: entityId,
      p_xp: options?.xp ?? 0,
      p_source_key: options?.sourceKey ?? undefined,
      p_completed: options?.completed ?? true,
    } as never);
    if (error) throw error;
    return data;
  }

  async touchActivity() {
    const { data, error } = await this.client.rpc(
      "touch_daily_activity" as never
    );
    if (error) throw error;
    return data as number;
  }

  async upsertEntityNote(profileId: string, entityId: string, note: string) {
    const { error } = await this.client.from("entity_notes").upsert(
      {
        profile_id: profileId,
        entity_id: entityId,
        note,
      } as never,
      { onConflict: "profile_id,entity_id" }
    );
    if (error) throw error;
  }

  async toggleBookmark(profileId: string, entityId: string, on: boolean) {
    if (on) {
      const { error } = await this.client.from("learner_bookmarks").upsert(
        { profile_id: profileId, entity_id: entityId } as never,
        { onConflict: "profile_id,entity_id" }
      );
      if (error) throw error;
      return;
    }
    const { error } = await this.client
      .from("learner_bookmarks")
      .delete()
      .eq("profile_id", profileId)
      .eq("entity_id", entityId);
    if (error) throw error;
  }

  async upsertProject(
    profileId: string,
    projectId: string,
    updates: Partial<{
      progress: number;
      status: string;
      github_link: string;
      notes: string;
    }>
  ) {
    const { error } = await this.client.from("project_progress").upsert(
      {
        profile_id: profileId,
        project_id: projectId,
        ...updates,
      } as never,
      { onConflict: "profile_id,project_id" }
    );
    if (error) throw error;
  }

  async upsertAssignmentMeta(
    profileId: string,
    catalogId: string,
    updates: Record<string, unknown>
  ) {
    const { error } = await this.client.from("assignment_local_meta").upsert(
      {
        profile_id: profileId,
        catalog_id: catalogId,
        ...updates,
      } as never,
      { onConflict: "profile_id,catalog_id" }
    );
    if (error) throw error;
  }

  async upsertResume(profileId: string, resume: Omit<LearnerResumeRow, "updated_at">) {
    const { error } = await this.client.from("learner_resume").upsert(
      { ...resume, profile_id: profileId } as never,
      { onConflict: "profile_id" }
    );
    if (error) throw error;
  }

  async updatePreferences(
    profileId: string,
    patch: Partial<LearnerPreferencesRow>
  ) {
    const { error } = await this.client.from("learner_preferences").upsert(
      { profile_id: profileId, ...patch } as never,
      { onConflict: "profile_id" }
    );
    if (error) throw error;
  }

  async upsertNote(
    profileId: string,
    note: Partial<LearnerNoteRow> & { id?: string }
  ) {
    // Client temp ids (note-… / local-…) are not UUIDs. Those must INSERT.
    // Real UUIDs upsert so create+edit both persist the same row.
    if (note.id && isUuid(note.id)) {
      const { data, error } = await this.client
        .from("learner_notes")
        .upsert(
          {
            id: note.id,
            profile_id: profileId,
            title: note.title ?? "",
            content: note.content ?? "",
            week_id: note.week_id ?? null,
            pinned: note.pinned ?? false,
            accent: note.accent ?? null,
          } as never,
          { onConflict: "id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return data as LearnerNoteRow;
    }

    const { data, error } = await this.client
      .from("learner_notes")
      .insert({
        profile_id: profileId,
        title: note.title ?? "",
        content: note.content ?? "",
        week_id: note.week_id ?? null,
        pinned: note.pinned ?? false,
        accent: note.accent ?? null,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    return data as LearnerNoteRow;
  }

  async deleteNote(profileId: string, noteId: string) {
    const { error } = await this.client
      .from("learner_notes")
      .delete()
      .eq("id", noteId)
      .eq("profile_id", profileId);
    if (error) throw error;
  }

  async listNotifications(profileId: string) {
    const { data, error } = await this.client
      .from("learner_notifications")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw error;
    return (data ?? []) as LearnerNotificationRow[];
  }

  async markNotificationRead(profileId: string, id: string) {
    const { error } = await this.client
      .from("learner_notifications")
      .update({ read: true } as never)
      .eq("id", id)
      .eq("profile_id", profileId);
    if (error) throw error;
  }

  async markAllNotificationsRead(profileId: string) {
    const { error } = await this.client
      .from("learner_notifications")
      .update({ read: true } as never)
      .eq("profile_id", profileId)
      .eq("read", false);
    if (error) throw error;
  }

  async clearNotifications(profileId: string, onlyRead: boolean) {
    let query = this.client
      .from("learner_notifications")
      .delete()
      .eq("profile_id", profileId);
    if (onlyRead) query = query.eq("read", true);
    const { error } = await query;
    if (error) throw error;
  }

  async upsertHubLibrary(
    profileId: string,
    payload: Partial<{
      bookmarks: string[];
      liked: string[];
      recent: unknown;
    }>
  ) {
    const { error } = await this.client.from("hub_library").upsert(
      { profile_id: profileId, ...payload } as never,
      { onConflict: "profile_id" }
    );
    if (error) throw error;
  }

  async upsertCertAttempt(
    profileId: string,
    certificationId: string,
    payload: Record<string, unknown>,
    status: string,
    score?: number | null
  ) {
    const { error } = await this.client.from("cert_attempts").upsert(
      {
        profile_id: profileId,
        certification_id: certificationId,
        payload,
        status,
        score: score ?? null,
      } as never,
      { onConflict: "profile_id,certification_id" }
    );
    if (error) throw error;
  }

  async getCertAttempts(profileId: string) {
    const { data, error } = await this.client
      .from("cert_attempts")
      .select("*")
      .eq("profile_id", profileId);
    if (error) throw error;
    return data ?? [];
  }

  async addStudyHours(profileId: string, hours: number, weekId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await this.client
      .from("study_sessions")
      .select("*")
      .eq("profile_id", profileId)
      .eq("session_date", today)
      .maybeSingle();

    const existingRow = existing as StudySessionRow | null;
    const nextHours = Number(existingRow?.hours ?? 0) + hours;
    const { error } = await this.client.from("study_sessions").upsert(
      {
        profile_id: profileId,
        session_date: today,
        hours: nextHours,
        week_id: weekId,
      } as never,
      { onConflict: "profile_id,session_date" }
    );
    if (error) throw error;

    const { data: stats } = await this.client
      .from("learner_stats")
      .select("total_study_hours")
      .eq("profile_id", profileId)
      .maybeSingle();
    const statsRow = stats as Pick<LearnerStatsRow, "total_study_hours"> | null;
    const total = Number(statsRow?.total_study_hours ?? 0) + hours;
    await this.client
      .from("learner_stats")
      .update({ total_study_hours: total } as never)
      .eq("profile_id", profileId);
  }

  async upsertWeekNote(profileId: string, weekId: number, note: string) {
    const { error } = await this.client.from("week_notes").upsert(
      { profile_id: profileId, week_id: weekId, note } as never,
      { onConflict: "profile_id,week_id" }
    );
    if (error) throw error;
  }

  async upsertModuleGate(
    profileId: string,
    module: string,
    unlocked: number[],
    completed: number[]
  ) {
    const { error } = await this.client.from("module_gates").upsert(
      {
        profile_id: profileId,
        module,
        unlocked_week_ids: unlocked,
        completed_week_ids: completed,
      } as never,
      { onConflict: "profile_id,module" }
    );
    if (error) throw error;
  }
}
