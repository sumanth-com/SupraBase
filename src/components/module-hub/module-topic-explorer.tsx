"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import {
  SaveDiamondButton,
  TrackSavedDiamond,
  DiamondGem,
} from "@/components/shared/save-diamond-button";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DifficultyBadge } from "@/components/curriculum/difficulty-badge";
import { CURRICULUM_ROUTES } from "@/features/curriculum/lib/curriculum-routes";
import type { ModuleHubPayload } from "@/features/curriculum/actions/module-hub-actions";
import type { ModuleHubChallengeSummary } from "@/features/curriculum/lib/module-hub-challenge-summary";
import {
  formatModuleDuration,
  moduleDifficulty,
} from "@/features/curriculum/lib/module-hub";
import {
  buildTopicCards,
  type TopicCardModel,
} from "@/features/curriculum/lib/topic-cards";
import {
  isChallengeHubModule,
  isDrillStyleModule,
  isInterviewPrepKitModule,
} from "@/features/curriculum/lib/hub-module-guards";
import {
  prefetchModuleTopic,
  useModuleHub,
} from "@/features/curriculum/hooks/use-module-hub";
import { DIFFICULTY_LABELS } from "@/learning-engine/labels";
import type { LearnDifficulty } from "@/learning-engine/types";
import { useProgressStore } from "@/store/use-progress-store";
import { useStoreHydrated } from "@/hooks/use-store-hydrated";
import { useProgressHydration } from "@/store/use-progress-hydration";
import { useTrackResumePosition } from "@/hooks/use-resume-position";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const InterviewPrepKitHub = dynamic(
  () =>
    import("@/components/interview-prep/interview-prep-kit-hub").then(
      (m) => m.InterviewPrepKitHub
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-6xl animate-pulse space-y-6 pb-10">
        <div className="h-4 w-48 rounded bg-zinc-800" />
        <div className="h-24 rounded-xl bg-zinc-900/50" />
        <div className="h-64 rounded-xl bg-zinc-900/40" />
      </div>
    ),
  }
);

const PAGE_SIZE = 25;

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-800/80 pb-4 last:border-0">
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 accent-emerald-500"
      />
      {label}
    </label>
  );
}

const DIFFICULTY_COLORS: Record<LearnDifficulty, string> = {
  easy: "text-emerald-400",
  medium: "text-amber-400",
  hard: "text-rose-400",
};

export function ModuleTopicExplorer() {
  const params = useParams<{ slug: string }>();
  const moduleSlug = params.slug;
  const hub = useModuleHub(moduleSlug);
  const payload = hub.data;
  const { detail } = payload ?? { detail: null };

  if (!payload || !detail) {
    return (
      <div className="mx-auto max-w-6xl animate-pulse space-y-6 pb-10">
        <div className="h-4 w-48 rounded bg-zinc-800" />
        <div className="h-24 rounded-xl bg-zinc-900/50" />
        <div className="h-10 rounded bg-zinc-900/50" />
        <div className="h-64 rounded-xl bg-zinc-900/40" />
      </div>
    );
  }

  if (isInterviewPrepKitModule(detail.module.slug)) {
    return <InterviewPrepKitHub payload={payload} />;
  }

  return <ModuleTopicExplorerInner payload={payload} />;
}

function ModuleTopicExplorerInner({
  payload,
}: {
  payload: ModuleHubPayload;
}) {
  const { detail, challenges: allChallenges } = payload;
  const moduleSlug = detail.module.slug;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const hydrated = useStoreHydrated();
  const hydrationStatus = useProgressHydration((s) => s.status);

  const cards = useMemo(
    () => buildTopicCards(detail.lessons, moduleSlug),
    [detail.lessons, moduleSlug]
  );

  const validTopicSlugs = useMemo(
    () => new Set(cards.map((c) => c.slug)),
    [cards]
  );

  const [activeTopic, setActiveTopic] = useState("all");
  const [page, setPage] = useState(0);
  const [showSolved, setShowSolved] = useState(true);
  const [showUnsolved, setShowUnsolved] = useState(true);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [diffEasy, setDiffEasy] = useState(true);
  const [diffMedium, setDiffMedium] = useState(true);
  const [diffHard, setDiffHard] = useState(true);

  useEffect(() => {
    const topic = searchParams.get("topic");
    const next = topic && validTopicSlugs.has(topic) ? topic : "all";
    setActiveTopic(next);
  }, [searchParams, validTopicSlugs]);

  useEffect(() => {
    const firstUnlocked = cards.find((card) => card.status !== "locked");
    if (firstUnlocked) {
      prefetchModuleTopic(queryClient, moduleSlug, firstUnlocked.slug);
    }
  }, [cards, moduleSlug, queryClient]);

  const syncTopicUrl = useCallback(
    (slug: string) => {
      startTransition(() => {
        router.replace(
          CURRICULUM_ROUTES.moduleHub(moduleSlug, slug === "all" ? null : slug),
          { scroll: false }
        );
      });
    },
    [moduleSlug, router]
  );

  const isDoneFn = useProgressStore((s) => s.isDone);
  const bookmarks = useProgressStore((s) => s.progress.bookmarks);
  const isBookmarkedFn = useProgressStore((s) => s.isBookmarked);

  const challengeProgress = useMemo(() => {
    const total = allChallenges.length;
    if (!hydrated || total === 0) {
      return { completed: 0, total, percent: detail.progressPercent };
    }
    const completed = allChallenges.filter((c) => isDoneFn(c.entityId)).length;
    const percent = Math.round((completed / total) * 100);
    return { completed, total, percent };
  }, [allChallenges, detail.progressPercent, hydrated, isDoneFn]);

  const filteredAndSorted = useMemo(() => {
    const byDifficultyRank: Record<LearnDifficulty, number> = {
      easy: 0,
      medium: 1,
      hard: 2,
    };

    return allChallenges
      .filter((c) => {
        if (activeTopic !== "all" && c.curriculumTopicSlug !== activeTopic) {
          return false;
        }
        const done = hydrated && isDoneFn(c.entityId);
        if (done && !showSolved) return false;
        if (!done && !showUnsolved) return false;
        if (bookmarkedOnly && !isBookmarkedFn(c.entityId)) return false;
        const d = c.difficulty;
        if (d === "easy" && !diffEasy) return false;
        if (d === "medium" && !diffMedium) return false;
        if (d === "hard" && !diffHard) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.topicIndex !== b.topicIndex) return a.topicIndex - b.topicIndex;
        const da = byDifficultyRank[a.difficulty];
        const db = byDifficultyRank[b.difficulty];
        if (da !== db) return da - db;
        return a.lessonIndex - b.lessonIndex;
      });
  }, [
    activeTopic,
    allChallenges,
    bookmarkedOnly,
    bookmarks,
    diffEasy,
    diffHard,
    diffMedium,
    hydrated,
    isBookmarkedFn,
    isDoneFn,
    showSolved,
    showUnsolved,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredAndSorted.length / PAGE_SIZE)
  );
  const pageItems = filteredAndSorted.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );

  useEffect(() => {
    if (page > 0 && page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const selectTopic = (slug: string, card?: TopicCardModel) => {
    if (card?.status === "locked") return;
    setActiveTopic(slug);
    setPage(0);
    syncTopicUrl(slug);
  };

  const activeCard =
    activeTopic === "all" ? null : cards.find((c) => c.slug === activeTopic);

  const activeTopicTitle =
    activeTopic === "all" ? "All topics" : (activeCard?.title ?? activeTopic);

  const hubHref = CURRICULUM_ROUTES.moduleHub(
    moduleSlug,
    activeTopic === "all" ? null : activeTopic
  );

  useTrackResumePosition(
    "roadmap",
    Math.max(1, detail.module.sort_order),
    detail.module.title,
    activeTopicTitle,
    hubHref,
    hydrated,
    activeTopic !== "all" && activeCard
      ? { topicSlug: activeTopic, topicTitle: activeTopicTitle }
      : { topicTitle: detail.module.title }
  );

  const progressReady = hydrated && hydrationStatus === "ready";
  const progressFailed = hydrationStatus === "error";
  const displayProgress = progressReady || progressFailed
    ? challengeProgress
    : { completed: 0, total: challengeProgress.total, percent: 0 };
  const showProgressCounts = progressReady || (progressFailed && challengeProgress.completed > 0);

  const savedCount = useMemo(() => {
    if (!hydrated) return 0;
    return allChallenges.filter((c) => isBookmarkedFn(c.entityId)).length;
  }, [allChallenges, bookmarks, hydrated, isBookmarkedFn]);

  const drillStyle = isDrillStyleModule(moduleSlug);

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4 px-1 pt-1 sm:px-2">
      <div className="surface-card-3d shrink-0 space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                Module
              </span>
              <DifficultyBadge difficulty={moduleDifficulty(detail.lessons)} />
              {!isChallengeHubModule(moduleSlug) ? (
                <span className="text-[11px] text-zinc-500">
                  {formatModuleDuration(detail)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
                {detail.module.title}
              </h1>
              <p
                className="text-xs tabular-nums text-zinc-500 sm:text-sm"
                suppressHydrationWarning
              >
                {progressFailed && !showProgressCounts
                  ? "Progress unavailable"
                  : showProgressCounts
                    ? drillStyle
                      ? `Drills ready: ${displayProgress.completed}/${displayProgress.total} · Topics: ${detail.completedCount}/${detail.totalCount}`
                      : `Challenges: ${displayProgress.completed}/${displayProgress.total} · Topics: ${detail.completedCount}/${detail.totalCount}`
                    : "\u00a0"}
              </p>
            </div>
            {detail.module.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                {detail.module.description}
              </p>
            ) : null}
            {drillStyle ? (
              <p className="mt-3 max-w-2xl rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-3 py-2.5 text-sm leading-relaxed text-zinc-200">
                Interview Preparation Kit — practice aloud with a checklist. No
                code editor. Mark complete when you can run the approach cleanly.
              </p>
            ) : null}
          </div>

          <div className="flex w-full shrink-0 items-center gap-3 sm:w-52 sm:pt-8">
            <Progress
              value={displayProgress.percent}
              className="h-2.5 flex-1 bg-[#b7a994] ring-1 ring-[#5C3A21]/30"
              indicatorClassName="bg-emerald-500"
            />
            <span
              className="min-w-[2.5rem] text-right text-sm font-semibold tabular-nums text-primary"
              suppressHydrationWarning
            >
              {progressFailed && !showProgressCounts
                ? "—"
                : showProgressCounts
                  ? `${displayProgress.percent}%`
                  : "\u00a0"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <TrackSavedDiamond
            active={bookmarkedOnly}
            count={savedCount}
            onClick={() => {
              setBookmarkedOnly((v) => !v);
              setPage(0);
            }}
          />
          <div className="topic-pills-scroll min-w-0 flex-1 -mx-0.5 flex items-center gap-2 overflow-x-auto px-0.5 pb-2.5">
            <button
              type="button"
              onClick={() => selectTopic("all")}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                activeTopic === "all"
                  ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500/60"
                  : "bg-zinc-900 text-zinc-200 ring-1 ring-zinc-700 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              All
            </button>
            {cards.map((card) => {
              const locked = card.status === "locked";
              const active = activeTopic === card.slug;
              return (
                <button
                  key={card.slug}
                  type="button"
                  disabled={locked}
                  onClick={() => selectTopic(card.slug, card)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                    active
                      ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500/60"
                      : locked
                        ? "cursor-not-allowed bg-zinc-950 text-zinc-500 ring-1 ring-zinc-800"
                        : "bg-zinc-900 text-zinc-200 ring-1 ring-zinc-700 hover:bg-zinc-800 hover:text-zinc-50"
                  )}
                >
                  {locked ? (
                    <Lock className="h-3 w-3 shrink-0 opacity-70" />
                  ) : null}
                  {card.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden pt-4 lg:flex-row">
        <div className="module-list-scroll min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-8 pr-1">
          {pageItems.length === 0 ? (
            <div className="surface-card-3d p-8 sm:p-10">
              {activeCard?.status === "locked" ? (
                <p className="text-center text-sm text-zinc-500">
                  Complete the previous topic to unlock practice here.
                </p>
              ) : bookmarkedOnly ? (
                <div className="mx-auto max-w-md space-y-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#5C3A21] text-[#f5efe8]">
                      <DiamondGem filled className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-sm font-semibold text-zinc-100">
                      No saved questions
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-400">
                    You have not saved any challenges yet. Click the diamond next
                    to a challenge title to save it — it turns dark brown when
                    saved. Then click the diamond on the topic track bar above to
                    come back and review your saved list.
                  </p>
                </div>
              ) : (
                <p className="text-center text-sm text-zinc-500">
                  No challenges match your filters.
                </p>
              )}
            </div>
          ) : (
            pageItems.map((item, i) => (
              <ChallengeListCard
                key={item.entityId}
                item={item}
                isFirst={page === 0 && i === 0}
                hydrated={hydrated}
                done={hydrated && isDoneFn(item.entityId)}
                bookmarkedOnly={bookmarkedOnly}
                moduleSlug={moduleSlug}
                drillStyle={drillStyle}
              />
            ))
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="h-8 border-zinc-800"
              >
                Previous
              </Button>
              <span className="text-xs tabular-nums text-zinc-500">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 border-zinc-800"
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="surface-card-3d hidden w-64 shrink-0 space-y-4 overflow-y-auto p-4 lg:block">
          <FilterSection title="Status">
            <FilterCheckbox
              label="Solved"
              checked={showSolved}
              onChange={setShowSolved}
            />
            <FilterCheckbox
              label="Unsolved"
              checked={showUnsolved}
              onChange={setShowUnsolved}
            />
            <FilterCheckbox
              label="Saved only"
              checked={bookmarkedOnly}
              onChange={setBookmarkedOnly}
            />
          </FilterSection>
          <FilterSection title="Difficulty">
            <FilterCheckbox
              label="Easy"
              checked={diffEasy}
              onChange={setDiffEasy}
            />
            <FilterCheckbox
              label="Medium"
              checked={diffMedium}
              onChange={setDiffMedium}
            />
            <FilterCheckbox
              label="Hard"
              checked={diffHard}
              onChange={setDiffHard}
            />
          </FilterSection>
        </aside>
      </div>
    </div>
  );
}

function ChallengeListCard({
  item,
  isFirst,
  hydrated,
  done,
  bookmarkedOnly,
  moduleSlug,
  drillStyle,
}: {
  item: ModuleHubChallengeSummary;
  isFirst: boolean;
  hydrated: boolean;
  done: boolean;
  bookmarkedOnly: boolean;
  moduleSlug: string;
  drillStyle: boolean;
}) {
  const estimatedMinutes =
    item.estimatedMinutes ??
    (item.difficulty === "easy"
      ? 8
      : item.difficulty === "medium"
        ? 15
        : 25);
  const xpPoints =
    estimatedMinutes *
    (item.difficulty === "easy" ? 2 : item.difficulty === "medium" ? 3 : 4);
  const successRate =
    item.difficulty === "easy" ? 82 : item.difficulty === "medium" ? 67 : 41;

  return (
    <article className="surface-card-3d p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <SaveDiamondButton
              entityId={item.entityId}
              showUnsaveAction={bookmarkedOnly}
            />
            <h2 className="min-w-0 truncate text-base font-semibold text-zinc-100">
              {item.title}
            </h2>
          </div>
          <div className="mt-1.5 min-w-0 sm:pl-9">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
              <span
                className={cn(
                  "font-semibold",
                  DIFFICULTY_COLORS[item.difficulty]
                )}
              >
                {DIFFICULTY_LABELS[item.difficulty]}
              </span>
              <span>|</span>
              <span>{item.kindLabel}</span>
              <span>|</span>
              <span>Est. {estimatedMinutes} min</span>
              <span>|</span>
              <span>{xpPoints} XP</span>
              <span>|</span>
              <span className="tabular-nums text-emerald-400">
                {successRate}% success
              </span>
              {hydrated && done ? (
                <>
                  <span>|</span>
                  <span className="text-emerald-400">Solved</span>
                </>
              ) : null}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {item.scenario}
            </p>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          className={cn(
            "h-9 min-w-[8.5rem] shrink-0 rounded-full font-semibold shadow-sm",
            isFirst && !done
              ? "bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-500"
              : done
                ? "border border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
                : "border border-emerald-600/60 bg-transparent text-emerald-400 hover:bg-emerald-500/10"
          )}
          variant={isFirst && !done ? "default" : "outline"}
        >
          <Link
            href={CURRICULUM_ROUTES.moduleChallenge(
              moduleSlug,
              item.curriculumTopicSlug,
              item.id
            )}
            prefetch={false}
          >
            {drillStyle
              ? done
                ? "Practiced"
                : "Start drill"
              : done
                ? "Solved"
                : "Solve Challenge"}
          </Link>
        </Button>
      </div>
    </article>
  );
}
