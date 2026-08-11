"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiMessageRow } from "@/types/database";
import type {
  LearningContext,
  MentorResponseMode,
} from "@/features/ai-mentor/types";
import { AI_MENTOR_ROUTES } from "@/features/ai-mentor/types";
import { fetchMessages } from "@/features/ai-mentor/lib/mentor-client";
import { friendlyLlmError } from "@/features/ai-mentor/providers/types";

type StreamMode = "send" | "regenerate" | "continue" | "edit";

type StreamMeta = {
  title?: string;
};

export function useMentorChat(conversationId: string | null) {
  const [messages, setMessages] = useState<AiMessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const conversationRef = useRef(conversationId);
  const tokenBufferRef = useRef("");
  const streamedByIdRef = useRef<Record<string, string>>({});
  const flushRafRef = useRef<number | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const skipHydrateRef = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  const prepareConversation = useCallback((id: string) => {
    skipHydrateRef.current = true;
    conversationRef.current = id;
  }, []);

  const loadMessages = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    const seq = ++requestSeq.current;
    if (!opts?.silent) {
      setIsLoading(true);
      setError(null);
    }
    const result = await fetchMessages(id);
    if (seq !== requestSeq.current) return;
    if (conversationRef.current !== id) return;
    if (!opts?.silent) setIsLoading(false);
    if (!result.success) {
      if (!opts?.silent) {
        setError(result.error);
      }
      return;
    }
    const next = result.data.messages ?? [];
    setMessages((prev) => {
      if (opts?.silent && prev.some((m) => m.status === "streaming")) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (skipHydrateRef.current && conversationId) {
      skipHydrateRef.current = false;
      conversationRef.current = conversationId;
      setIsLoading(false);
      return;
    }

    // Switching chats: cancel in-flight stream so tokens don't land on the wrong thread.
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    tokenBufferRef.current = "";
    streamedByIdRef.current = {};
    assistantIdRef.current = null;
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }

    if (!conversationId) {
      setMessages([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    void loadMessages(conversationId);
  }, [conversationId, loadMessages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const flushTokens = useCallback(() => {
    flushRafRef.current = null;
    const id = assistantIdRef.current;
    if (!id) return;
    const content = streamedByIdRef.current[id];
    if (content == null) return;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx < 0) return prev;
      const current = prev[idx]!;
      if (current.content === content && current.status === "streaming") {
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...current, content, status: "streaming" };
      return next;
    });
  }, []);

  const queueToken = useCallback(
    (text: string) => {
      if (!text) return;
      const id = assistantIdRef.current;
      if (!id) {
        tokenBufferRef.current += text;
        return;
      }
      streamedByIdRef.current[id] =
        (streamedByIdRef.current[id] ?? "") + text;
      if (flushRafRef.current != null) return;
      flushRafRef.current = requestAnimationFrame(() => {
        flushRafRef.current = requestAnimationFrame(flushTokens);
      });
    },
    [flushTokens]
  );

  const runStream = useCallback(
    async (
      mode: StreamMode,
      content: string,
      learningContext?: LearningContext | null,
      messageId?: string,
      attachmentIds?: string[],
      responseMode: MentorResponseMode = "suggested",
      conversationIdOverride?: string
    ): Promise<StreamMeta | null> => {
      const streamForId = conversationIdOverride ?? conversationId;
      if (!streamForId) return null;
      conversationRef.current = streamForId;

      // Cancel any previous stream on this hook instance.
      abortRef.current?.abort();
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      tokenBufferRef.current = "";
      streamedByIdRef.current = {};
      assistantIdRef.current = null;

      setError(null);
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let assistantId: string | null = null;
      let meta: StreamMeta | null = null;
      const tempAssistantId = `temp-assistant-${Date.now()}`;

      if (mode === "send" || mode === "continue") {
        const optimisticContent =
          mode === "continue"
            ? "Please continue from where you left off."
            : content;
        setMessages((prev) => [
          ...prev,
          {
            id: `temp-user-${Date.now()}`,
            conversation_id: streamForId,
            profile_id: "",
            role: "user",
            content: optimisticContent,
            status: "complete",
            model: null,
            error: null,
            token_input: null,
            token_output: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: tempAssistantId,
            conversation_id: streamForId,
            profile_id: "",
            role: "assistant",
            content: "",
            status: "streaming",
            model: null,
            error: null,
            token_input: null,
            token_output: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }

      if (mode === "edit" && messageId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === messageId);
          if (idx < 0) return prev;
          return [
            ...prev.slice(0, idx),
            {
              ...prev[idx]!,
              content,
              updated_at: new Date().toISOString(),
            },
            {
              id: tempAssistantId,
              conversation_id: streamForId,
              profile_id: "",
              role: "assistant",
              content: "",
              status: "streaming",
              model: null,
              error: null,
              token_input: null,
              token_output: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];
        });
      }

      if (mode === "regenerate" && messageId) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== messageId),
          {
            id: tempAssistantId,
            conversation_id: streamForId,
            profile_id: "",
            role: "assistant",
            content: "",
            status: "streaming",
            model: null,
            error: null,
            token_input: null,
            token_output: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }

      try {
        const res = await fetch(AI_MENTOR_ROUTES.chatApi, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: streamForId,
            content,
            learningContext: learningContext ?? undefined,
            mode,
            responseMode,
            messageId,
            attachmentIds,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (conversationRef.current !== streamForId) {
            controller.abort();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.split("\n");
            let event = "message";
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              if (line.startsWith("data:")) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(dataLine) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (event === "meta") {
              assistantId = String(data.assistantMessageId ?? "");
              const id = assistantId;
              const persistedUserId =
                typeof data.userMessageId === "string" && data.userMessageId
                  ? data.userMessageId
                  : null;
              if (!id) continue;
              assistantIdRef.current = id;
              const early = tokenBufferRef.current;
              tokenBufferRef.current = "";
              streamedByIdRef.current[id] =
                (streamedByIdRef.current[id] ?? "") + early;
              setMessages((prev) => {
                let next = prev;
                if (persistedUserId) {
                  const tempUserIdx = next.findIndex((m) =>
                    m.id.startsWith("temp-user")
                  );
                  if (tempUserIdx >= 0) {
                    next = [...next];
                    next[tempUserIdx] = {
                      ...next[tempUserIdx]!,
                      id: persistedUserId,
                    };
                  }
                }
                const tempIdx = next.findIndex((m) =>
                  m.id.startsWith("temp-assistant")
                );
                if (tempIdx >= 0) {
                  const copy = [...next];
                  const temp = copy[tempIdx]!;
                  copy[tempIdx] = {
                    ...temp,
                    id,
                    content: streamedByIdRef.current[id] ?? temp.content,
                    status: "streaming",
                    model: (data.model as string) ?? temp.model,
                    error: null,
                  };
                  return copy.filter((m, i) => i === tempIdx || m.id !== id);
                }
                if (next.some((m) => m.id === id)) return next;
                return [
                  ...next,
                  {
                    id,
                    conversation_id: streamForId,
                    profile_id: "",
                    role: "assistant" as const,
                    content: streamedByIdRef.current[id] ?? "",
                    status: "streaming" as const,
                    model: (data.model as string) ?? null,
                    error: null,
                    token_input: null,
                    token_output: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                ];
              });
              if (streamedByIdRef.current[id]) {
                flushTokens();
              }
            }

            if (event === "token" && assistantId) {
              queueToken(String(data.text ?? ""));
            }

            if (event === "done" && assistantId) {
              if (flushRafRef.current != null) {
                cancelAnimationFrame(flushRafRef.current);
                flushRafRef.current = null;
              }
              const finalContent = String(data.content ?? "");
              streamedByIdRef.current[assistantId] = finalContent;
              flushTokens();
              if (typeof data.title === "string" && data.title.trim()) {
                meta = { title: data.title.trim() };
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: finalContent, status: "complete" }
                    : m
                )
              );
            }

            if (event === "error" || event === "cancelled") {
              if (flushRafRef.current != null) {
                cancelAnimationFrame(flushRafRef.current);
                flushRafRef.current = null;
              }
              const finalContent = String(data.content ?? "");
              if (assistantId) {
                streamedByIdRef.current[assistantId] = finalContent;
                flushTokens();
              }
              const msg = String(data.message ?? "Error");
              if (assistantId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: finalContent,
                          status:
                            event === "cancelled" ? "cancelled" : "error",
                          error: msg,
                        }
                      : m
                  )
                );
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantId
                      ? {
                          ...m,
                          content: finalContent || m.content,
                          status: event === "cancelled" ? "cancelled" : "error",
                          error: msg,
                        }
                      : m
                  )
                );
              }
              if (event === "error") setError(msg);
            }
          }
        }

        return meta;
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMessages((prev) =>
            prev
              .filter((m) => !(m.id.startsWith("temp-assistant") && !m.content))
              .map((m) =>
                m.status === "streaming"
                  ? { ...m, status: "cancelled" as const }
                  : m
              )
          );
          return null;
        }
        const message = friendlyLlmError(err);
        setError(message);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId || m.status === "streaming"
              ? {
                  ...m,
                  status: "error" as const,
                  error: message,
                  content:
                    m.content ||
                    "Something went wrong while generating a reply. Try again.",
                }
              : m
          )
        );
        return null;
      } finally {
        if (conversationRef.current === streamForId) {
          setIsStreaming(false);
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        assistantIdRef.current = null;
        tokenBufferRef.current = "";
        streamedByIdRef.current = {};
      }
    },
    [conversationId, flushTokens, queueToken]
  );

  const send = useCallback(
    (
      content: string,
      learningContext?: LearningContext | null,
      attachmentIds?: string[],
      responseMode: MentorResponseMode = "suggested",
      conversationIdOverride?: string
    ) => {
      if (sendingRef.current) return Promise.resolve(null);
      sendingRef.current = true;
      return runStream(
        "send",
        content,
        learningContext,
        undefined,
        attachmentIds,
        responseMode,
        conversationIdOverride
      ).finally(() => {
        sendingRef.current = false;
      });
    },
    [runStream]
  );

  const editMessage = useCallback(
    (
      messageId: string,
      content: string,
      learningContext?: LearningContext | null
    ) => runStream("edit", content, learningContext, messageId),
    [runStream]
  );

  const regenerate = useCallback(
    (messageId?: string, learningContext?: LearningContext | null) =>
      runStream("regenerate", "regenerate", learningContext, messageId),
    [runStream]
  );

  const continueResponse = useCallback(
    (learningContext?: LearningContext | null) =>
      runStream("continue", "continue", learningContext),
    [runStream]
  );

  return {
    messages,
    setMessages,
    isLoading,
    isStreaming,
    error,
    setError,
    send,
    editMessage,
    stop,
    regenerate,
    continueResponse,
    prepareConversation,
    reload: () =>
      conversationId ? loadMessages(conversationId) : Promise.resolve(),
  };
}
