"use client";

import type { AiConversationRow, AiMessageRow } from "@/types/database";
import type { LearningContext } from "@/features/ai-mentor/types";
import { AI_MENTOR_ROUTES } from "@/features/ai-mentor/types";

type ClientResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function readResult<T>(res: Response): Promise<ClientResult<T>> {
  const payload = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | { error?: string }
    | null;
  if (!res.ok) {
    return {
      success: false,
      error:
        (payload && "error" in payload && payload.error) ||
        `Request failed (${res.status})`,
    };
  }
  return { success: true, data: payload as T };
}

export async function fetchConversations(q?: string): Promise<
  ClientResult<{ conversations: AiConversationRow[] }>
> {
  const url = q
    ? `${AI_MENTOR_ROUTES.conversationsApi}?q=${encodeURIComponent(q)}`
    : AI_MENTOR_ROUTES.conversationsApi;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  return readResult(res);
}

export async function createConversationClient(
  context?: LearningContext
): Promise<ClientResult<{ conversation: AiConversationRow }>> {
  const res = await fetch(AI_MENTOR_ROUTES.conversationsApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ learningContext: context ?? {} }),
  });
  return readResult(res);
}

export async function fetchMessages(
  conversationId: string
): Promise<ClientResult<{ messages: AiMessageRow[] }>> {
  const res = await fetch(
    `${AI_MENTOR_ROUTES.messagesApi}?conversationId=${encodeURIComponent(conversationId)}`,
    { method: "GET", cache: "no-store" }
  );
  return readResult(res);
}
