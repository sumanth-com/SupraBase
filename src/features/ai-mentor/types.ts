import type { AiConversationRow, AiMessageRow } from "@/types/database";

export type LearningContext = {
  moduleSlug?: string;
  moduleTitle?: string;
  topicTitle?: string;
  lessonTitle?: string;
  assignmentTitle?: string;
  projectTitle?: string;
  progressSummary?: string;
};

export type MentorResponseMode =
  | "suggested"
  | "explain"
  | "debug"
  | "build"
  | "review";

export type ChatMessageInput = {
  role: "user" | "assistant" | "system";
  content: string;
  images?: { mediaType: string; data: string }[];
};

export type ConversationListItem = AiConversationRow;

export type MessageListItem = AiMessageRow;

export const AI_MENTOR_ROUTES = {
  root: "/ai-mentor",
  conversation: (id: string) => `/ai-mentor?c=${id}`,
  chatApi: "/api/ai-mentor/chat",
  attachmentsApi: "/api/ai-mentor/attachments",
  conversationsApi: "/api/ai-mentor/conversations",
  messagesApi: "/api/ai-mentor/messages",
} as const;

export function groupConversationsByRecency(
  conversations: AiConversationRow[]
): {
  pinned: AiConversationRow[];
  today: AiConversationRow[];
  yesterday: AiConversationRow[];
  lastWeek: AiConversationRow[];
  older: AiConversationRow[];
} {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfLastWeek = new Date(startOfToday);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const pinned: AiConversationRow[] = [];
  const today: AiConversationRow[] = [];
  const yesterday: AiConversationRow[] = [];
  const lastWeek: AiConversationRow[] = [];
  const older: AiConversationRow[] = [];

  for (const c of conversations) {
    if (c.archived) continue;
    if (c.pinned || c.favorited) {
      pinned.push(c);
      continue;
    }
    const ts = new Date(c.last_message_at ?? c.updated_at ?? c.created_at);
    if (ts >= startOfToday) today.push(c);
    else if (ts >= startOfYesterday) yesterday.push(c);
    else if (ts >= startOfLastWeek) lastWeek.push(c);
    else older.push(c);
  }

  return { pinned, today, yesterday, lastWeek, older };
}
