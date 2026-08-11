"use client";

import dynamic from "next/dynamic";
import {
  ProgressBootstrap,
  ProgressHydrationBanner,
} from "@/components/shared/progress-bootstrap";
import type { PortalUser } from "@/features/portal/types";

const ModuleCompletionWatcher = dynamic(
  () =>
    import("@/components/shared/progress-bootstrap").then(
      (m) => m.ModuleCompletionWatcher
    ),
  { ssr: false }
);

const WeekCompletionCelebration = dynamic(
  () =>
    import("@/components/shared/week-completion-celebration").then(
      (m) => m.WeekCompletionCelebration
    ),
  { ssr: false }
);

/** Student-only progress sync + celebration — keep off marketing pages. */
export function PortalRuntimeProviders({
  seedUser,
}: {
  seedUser?: PortalUser;
}) {
  return (
    <>
      <ProgressBootstrap seedUser={seedUser} />
      <ProgressHydrationBanner />
      <ModuleCompletionWatcher />
      <WeekCompletionCelebration />
    </>
  );
}
