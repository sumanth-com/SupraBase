import type { LearningContext } from "@/features/ai-mentor/types";
import { MentorService } from "@/features/ai-mentor/services/mentor.service";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile, formatDbError } from "@/lib/supabase/ensure-profile";

export const runtime = "nodejs";

async function requireMentorUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null as null };
  await ensureProfile(supabase, user);
  return { supabase, user };
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireMentorUser();
    if (!user) {
      return Response.json(
        { error: "User session missing. Sign in again." },
        { status: 401 }
      );
    }
    const q = new URL(request.url).searchParams.get("q") ?? undefined;
    const service = new MentorService(supabase);
    const conversations = await service.listConversations(user.id, q);
    return Response.json({ conversations });
  } catch (error) {
    console.error("[ai-mentor/conversations] GET", error);
    return Response.json(
      { error: formatDbError(error, "Failed to load chats.") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireMentorUser();
    if (!user) {
      return Response.json(
        { error: "User session missing. Sign in again." },
        { status: 401 }
      );
    }
    let body: { learningContext?: LearningContext } = {};
    try {
      body = (await request.json()) as { learningContext?: LearningContext };
    } catch {
      body = {};
    }
    const service = new MentorService(supabase);
    const conversation = await service.createConversation(user.id, {
      context: body.learningContext,
    });
    if (!conversation?.id) {
      return Response.json(
        { error: "Supabase insert failed: no conversation id returned." },
        { status: 500 }
      );
    }
    return Response.json({ conversation });
  } catch (error) {
    console.error("[ai-mentor/conversations] POST", error);
    return Response.json(
      { error: formatDbError(error, "Failed to create chat.") },
      { status: 500 }
    );
  }
}
