import { MentorService } from "@/features/ai-mentor/services/mentor.service";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile, formatDbError } from "@/lib/supabase/ensure-profile";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json(
        { error: "User session missing. Sign in again." },
        { status: 401 }
      );
    }
    await ensureProfile(supabase, user);

    const conversationId = new URL(request.url).searchParams.get(
      "conversationId"
    );
    if (!conversationId) {
      return Response.json(
        { error: "conversationId is required." },
        { status: 400 }
      );
    }

    const service = new MentorService(supabase);
    const conversation = await service.getConversation(conversationId, user.id);
    if (!conversation) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    const messages = await service.listMessages(conversationId, user.id);
    return Response.json({ messages });
  } catch (error) {
    console.error("[ai-mentor/messages] GET", error);
    return Response.json(
      { error: formatDbError(error, "Failed to load messages.") },
      { status: 500 }
    );
  }
}
