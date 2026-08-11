"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SupraMascot } from "@/components/brand/supra-mascot";
import {
  ArrowUp,
  Blocks,
  Bookmark,
  Bug,
  Check,
  ClipboardCheck,
  Code2,
  Copy,
  CornerDownLeft,
  Database,
  Eye,
  FileText,
  FolderTree,
  Gauge,
  GitBranch,
  ImageIcon,
  Lightbulb,
  Loader2,
  LockKeyhole,
  Network,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AiMessageRow } from "@/types/database";
import type { MentorResponseMode } from "@/features/ai-mentor/types";
import { MentorMarkdown } from "@/components/ai-mentor/mentor-markdown";
import { MentorModelPicker } from "@/components/ai-mentor/mentor-model-picker";
import { bookmarkMessageAction } from "@/features/ai-mentor/actions/mentor-actions";
import { AI_MENTOR_ROUTES } from "@/features/ai-mentor/types";
import { AI_MENTOR_MAX_ATTACHMENTS } from "@/features/ai-mentor/repositories/attachments.repository";
import { isAllowedAttachment } from "@/features/ai-mentor/lib/attachments";
import {
  ComposerAttachmentChip,
  ImagePreviewModal,
  MessageAttachments,
  stripAttachmentMarkup,
  useConversationAttachments,
  withPreservedAttachmentMarkup,
  type DisplayAttachment,
} from "@/components/ai-mentor/attachment-ui";
import { cn } from "@/lib/utils";

type UploadStatus = "queued" | "uploading" | "done" | "error";

type PendingAttachment = {
  localId: string;
  file: File;
  id?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
  progress: number;
  status: UploadStatus;
  error?: string;
};

type MentorChatPaneProps = {
  title: string;
  conversationId: string | null;
  messages: AiMessageRow[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  onSend: (
    content: string,
    attachmentIds?: string[],
    responseMode?: MentorResponseMode
  ) => void;
  onEditMessage: (messageId: string, content: string) => void;
  onStop: () => void;
  onRegenerate: (messageId?: string) => void;
  onContinue: () => void;
  onEnsureConversation?: () => Promise<string | null>;
  /** Slimmer mobile header — ChatGPT-style model title centered. */
  compactMobileChrome?: boolean;
};

function MentorAuroraBackground({ vivid = false }: { vivid?: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute inset-0 bg-background" />
      <motion.div
        className={cn(
          "absolute -left-[20%] top-[-10%] h-[55%] w-[70%] rounded-full blur-3xl",
          vivid ? "opacity-50" : "opacity-25"
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(167,66,61,0.32) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, 40, -20, 0],
          y: [0, 30, -10, 0],
          scale: [1, 1.12, 0.96, 1],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute -right-[15%] top-[5%] h-[50%] w-[60%] rounded-full blur-3xl",
          vivid ? "opacity-45" : "opacity-20"
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(220,163,154,0.3) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, -35, 25, 0],
          y: [0, 40, -15, 0],
          scale: [1, 0.94, 1.1, 1],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute bottom-[-10%] left-[15%] h-[45%] w-[65%] rounded-full blur-3xl",
          vivid ? "opacity-40" : "opacity-18"
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(95,52,53,0.22) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, 30, -40, 0],
          y: [0, -25, 20, 0],
          scale: [1, 1.08, 0.92, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute right-[10%] bottom-[15%] h-[35%] w-[40%] rounded-full blur-3xl",
          vivid ? "opacity-35" : "opacity-15"
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(233,221,216,0.4) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, -20, 15, 0],
          y: [0, 25, -20, 0],
          opacity: vivid ? [0.25, 0.4, 0.28, 0.25] : [0.1, 0.18, 0.12, 0.1],
        }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="mentor-aurora-mesh absolute inset-0 opacity-[0.35] mix-blend-soft-light dark:opacity-[0.22]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/20 to-background/85" />
    </div>
  );
}

const PLACEHOLDERS = [
  "Message AI Mentor…",
  "Ask about React, SQL, system design…",
  "Paste code to review…",
  "Help me debug this…",
];

const PROMPT_GROUPS = {
  Explore: [
    { text: "Explain React Server Components simply", icon: Sparkles },
    { text: "Design a production-ready learning dashboard", icon: Code2 },
    { text: "Help me debug a Next.js hydration error", icon: GitBranch },
  ],
  Explain: [
    { text: "Explain authentication like I’m a beginner", icon: Lightbulb },
    { text: "Compare REST and GraphQL with real examples", icon: Network },
    { text: "Teach me database indexing step by step", icon: Database },
  ],
  Debug: [
    { text: "Review this SQL schema for N+1 risks", icon: ScanSearch },
    { text: "Find the bug in my React component", icon: Bug },
    { text: "Help me diagnose a slow API endpoint", icon: Gauge },
  ],
  Build: [
    { text: "Plan a modern SaaS application architecture", icon: Blocks },
    { text: "Create a clean Next.js project structure", icon: FolderTree },
    { text: "Design a secure authentication flow", icon: ShieldCheck },
  ],
  Review: [
    { text: "Review my code for production risks", icon: ClipboardCheck },
    { text: "Improve the accessibility of my interface", icon: Eye },
    { text: "Check my API design for security issues", icon: LockKeyhole },
  ],
} as const;

type PromptGroup = keyof typeof PROMPT_GROUPS;

const PROMPT_GROUP_ICONS = {
  Explore: Sparkles,
  Explain: Lightbulb,
  Debug: Bug,
  Build: Blocks,
  Review: ClipboardCheck,
} as const;

const PROMPT_RESPONSE_MODES: Record<PromptGroup, MentorResponseMode> = {
  Explore: "suggested",
  Explain: "explain",
  Debug: "debug",
  Build: "build",
  Review: "review",
};

const PLACEHOLDERS_HERO = "Ask Supra anything…";

const ATTACH_OPTIONS: {
  id: string;
  label: string;
  accept: string;
  icon: ReactNode;
  future?: boolean;
}[] = [
  {
    id: "document",
    label: "Upload Document",
    accept:
      ".pdf,.docx,.txt,.csv,.json,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.h,.zip,application/pdf,application/zip,text/plain",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: "image",
    label: "Upload Image",
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    id: "markdown",
    label: "Markdown",
    accept: ".md,text/markdown",
    icon: <NotebookPen className="h-4 w-4" />,
  },
  {
    id: "github",
    label: "GitHub Repository",
    accept: "",
    icon: <GitBranch className="h-4 w-4" />,
    future: true,
  },
];

function wasEdited(message: AiMessageRow) {
  try {
    const created = new Date(message.created_at).getTime();
    const updated = new Date(message.updated_at).getTime();
    return Number.isFinite(created) && Number.isFinite(updated) && updated - created > 1500;
  } catch {
    return false;
  }
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground",
        "transition-colors duration-150 hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      {children}
    </button>
  );
}

function resizeTextarea(el: HTMLTextAreaElement | null, max = 240) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  conversationId,
  isStreaming,
  editingId,
  attachments,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onContinue,
  onOpenAttachments,
}: {
  message: AiMessageRow;
  isLastAssistant: boolean;
  conversationId: string | null;
  isStreaming: boolean;
  editingId: string | null;
  attachments: DisplayAttachment[];
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, content: string) => void;
  onRegenerate: (messageId?: string) => void;
  onContinue: () => void;
  onOpenAttachments: (attachments: DisplayAttachment[], index: number) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const streaming = message.status === "streaming";
  const isEditing = editingId === message.id;
  const visibleContent = useMemo(
    () => stripAttachmentMarkup(message.content),
    [message.content]
  );
  const [draft, setDraft] = useState(visibleContent);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const edited =
    wasEdited(message) || Boolean((message as { __edited?: boolean }).__edited);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(visibleContent);
    const id = window.requestAnimationFrame(() => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      resizeTextarea(el, 280);
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isEditing, visibleContent]);

  const copyText = async () => {
    await navigator.clipboard.writeText(visibleContent || message.content);
    toast.success("Copied");
  };

  const save = () => {
    const nextVisible = draft.replace(/\s+$/g, "");
    if (!nextVisible.trim() && attachments.length === 0) return;
    if (nextVisible.trim() === visibleContent.trim()) {
      onCancelEdit();
      return;
    }
    onSaveEdit(
      message.id,
      withPreservedAttachmentMarkup(message.content, nextVisible)
    );
  };

  if (isUser && isEditing) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div className="ml-auto max-w-[min(92%,34rem)] rounded-2xl border border-border/80 bg-muted/50 p-3 shadow-sm ring-1 ring-foreground/5">
          <textarea
            ref={editRef}
            value={draft}
            aria-label="Edit message"
            onChange={(e) => {
              setDraft(e.target.value);
              resizeTextarea(e.target, 280);
            }}
            rows={2}
            className="max-h-[280px] min-h-[52px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancelEdit();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              ⌘/Ctrl+Enter to save · Esc to cancel
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground transition hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                disabled={(!draft.trim() && attachments.length === 0) || isStreaming}
                onClick={save}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[12px] font-medium text-background transition hover:opacity-90 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      className={cn(
        "group/msg mx-auto w-full max-w-[760px]",
        isUser && "flex justify-end"
      )}
    >
      {isUser ? (
        <div className="max-w-[min(85%,34rem)]">
          <MessageAttachments
            attachments={attachments}
            onOpenImage={(index) => onOpenAttachments(attachments, index)}
          />
          {visibleContent ? (
            <div className="rounded-2xl bg-muted px-3.5 py-2 text-[15px] leading-relaxed text-foreground">
              <p className="whitespace-pre-wrap">{visibleContent}</p>
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-end gap-1">
            {edited ? (
              <span className="mr-1 text-[10px] text-muted-foreground/80">
                Edited
              </span>
            ) : null}
            <div className="flex gap-0.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/msg:opacity-100 sm:focus-within:opacity-100">
              <IconAction label="Copy" onClick={copyText}>
                <Copy className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction
                label="Edit"
                disabled={isStreaming || message.id.startsWith("temp-")}
                onClick={() => onStartEdit(message.id)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconAction>
            </div>
          </div>
        </div>
      ) : null}

      {isAssistant ? (
        <div className="w-full">
          <div className="text-[15px] leading-[1.7] text-foreground">
            {visibleContent ? (
              <MentorMarkdown content={visibleContent} streaming={streaming} />
            ) : message.content ? (
              <MentorMarkdown content={message.content} streaming={streaming} />
            ) : streaming ? (
              <div className="flex items-center gap-2 py-2 text-sm text-zinc-500">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50 opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Supra is thinking…
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No reply yet.</p>
            )}
          </div>

          {message.status === "error" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm text-rose-600">
                {message.error || "Something went wrong while generating a reply."}
              </p>
              {isLastAssistant ? (
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => onRegenerate(message.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {message.status === "complete" && message.content ? (
            <div className="mt-1.5 flex items-center gap-0.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/msg:opacity-100 sm:focus-within:opacity-100">
              <IconAction label="Copy" onClick={copyText}>
                <Copy className="h-3.5 w-3.5" />
              </IconAction>
              {isLastAssistant ? (
                <>
                  <IconAction
                    label="Retry"
                    disabled={isStreaming}
                    onClick={() => onRegenerate(message.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </IconAction>
                  <IconAction
                    label="Continue"
                    disabled={isStreaming}
                    onClick={onContinue}
                  >
                    <CornerDownLeft className="h-3.5 w-3.5" />
                  </IconAction>
                </>
              ) : null}
              <IconAction
                label="Bookmark"
                disabled={!conversationId || message.id.startsWith("temp-")}
                onClick={async () => {
                  if (!conversationId) return;
                  const result = await bookmarkMessageAction({
                    conversationId,
                    messageId: message.id,
                    snippet: message.content,
                  });
                  if (!result.success) toast.error(result.error);
                  else toast.success("Bookmarked");
                }}
              >
                <Bookmark className="h-3.5 w-3.5" />
              </IconAction>
              <IconAction
                label="Share"
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    message.content.slice(0, 2000)
                  );
                  toast.success("Copied to share");
                }}
              >
                <Share2 className="h-3.5 w-3.5" />
              </IconAction>
            </div>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
});

export function MentorChatPane({
  title,
  conversationId,
  messages,
  isLoading,
  isStreaming,
  error,
  onSend,
  onEditMessage,
  onStop,
  onRegenerate,
  onContinue,
  onEnsureConversation,
  compactMobileChrome = false,
}: MentorChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [promptGroup, setPromptGroup] = useState<PromptGroup>("Explore");
  const [pendingLocalMessage, setPendingLocalMessage] = useState<string | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedIds, setEditedIds] = useState<Set<string>>(() => new Set());
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{
    attachments: DisplayAttachment[];
    index: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef("*/*");
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const dropDepth = useRef(0);
  const stickToBottomRef = useRef(true);

  const { attachmentsByMessageId, reloadAttachments } =
    useConversationAttachments(conversationId);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  const messageIdsKey = useMemo(
    () => messages.map((m) => m.id).join("|"),
    [messages]
  );

  const uploading = pendingFiles.some((p) => p.status === "uploading" || p.status === "queued");

  // Reload attachments when the conversation or message set changes — not on every streamed token.
  useEffect(() => {
    if (isStreaming) return;
    void reloadAttachments();
  }, [conversationId, messageIdsKey, isStreaming, reloadAttachments]);

  useEffect(() => {
    if (!isStreaming && messages.length === 0) return;
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (messages.length > 0) setPendingLocalMessage(null);
  }, [messages.length]);

  useEffect(() => {
    if (draft || isStreaming || messages.length > 0) return;
    const id = window.setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [draft, isStreaming, messages.length]);

  useEffect(() => {
    const empty = !isLoading && messages.length === 0;
    resizeTextarea(textareaRef.current, empty ? 160 : 200);
  }, [draft, isLoading, messages.length]);

  useEffect(() => {
    if (!attachOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!attachMenuRef.current?.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [attachOpen]);

  const uploadOne = useCallback(
    async (item: PendingAttachment, convId: string) => {
      setPendingFiles((prev) =>
        prev.map((p) =>
          p.localId === item.localId
            ? { ...p, status: "uploading", progress: 12, error: undefined }
            : p
        )
      );

      try {
        const form = new FormData();
        form.set("conversationId", convId);
        form.append("files", item.file);

        // Simulated progress while waiting (fetch has no upload progress in browsers easily)
        const tick = window.setInterval(() => {
          setPendingFiles((prev) =>
            prev.map((p) =>
              p.localId === item.localId && p.status === "uploading"
                ? { ...p, progress: Math.min(p.progress + 11, 88) }
                : p
            )
          );
        }, 180);

        const res = await fetch(AI_MENTOR_ROUTES.attachmentsApi, {
          method: "POST",
          body: form,
        });
        window.clearInterval(tick);
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error ?? "Upload failed. Please try again.");
        }
        const uploaded = (payload?.attachments?.[0] ?? null) as {
          id: string;
          fileName: string;
        } | null;
        if (!uploaded?.id) throw new Error("Upload failed. Please try again.");

        setPendingFiles((prev) =>
          prev.map((p) =>
            p.localId === item.localId
              ? { ...p, id: uploaded.id, status: "done", progress: 100 }
              : p
          )
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed. Please try again.";
        setPendingFiles((prev) =>
          prev.map((p) =>
            p.localId === item.localId
              ? { ...p, status: "error", progress: 0, error: message }
              : p
          )
        );
        toast.error(message);
      }
    },
    []
  );

  const queueFiles = useCallback(
    async (files: FileList | File[] | DataTransferItemList) => {
      const list: File[] = [];
      if (typeof DataTransferItemList !== "undefined" && files instanceof DataTransferItemList) {
        for (const item of Array.from(files)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) list.push(f);
          }
        }
      } else {
        list.push(...Array.from(files as FileList | File[]));
      }
      if (list.length === 0) return;

      let convId = conversationId;
      if (!convId && onEnsureConversation) {
        convId = await onEnsureConversation();
      }
      if (!convId) {
        toast.error("Start a chat first, then attach files.");
        return;
      }

      setPendingFiles((prev) => {
        const room = AI_MENTOR_MAX_ATTACHMENTS - prev.length;
        if (room <= 0) {
          toast.error(`You can attach up to ${AI_MENTOR_MAX_ATTACHMENTS} files.`);
          return prev;
        }

        const locals: PendingAttachment[] = [];
        for (const file of list.slice(0, room)) {
          const check = isAllowedAttachment(file.name, file.size);
          if (!check.ok) {
            toast.error(check.error);
            continue;
          }
          locals.push({
            localId: crypto.randomUUID(),
            file,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            previewUrl: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : undefined,
            progress: 0,
            status: "queued",
          });
        }
        if (locals.length === 0) return prev;

        // Kick off uploads after state commit
        queueMicrotask(() => {
          for (const local of locals) {
            void uploadOne(local, convId!);
          }
        });

        return [...prev, ...locals];
      });
    },
    [conversationId, onEnsureConversation, uploadOne]
  );

  const retryUpload = async (localId: string) => {
    const item = pendingFiles.find((p) => p.localId === localId);
    if (!item) return;
    let convId = conversationId;
    if (!convId && onEnsureConversation) {
      convId = await onEnsureConversation();
    }
    if (!convId) {
      toast.error("Start a chat first, then attach files.");
      return;
    }
    await uploadOne(item, convId);
  };

  const removePending = async (localId: string) => {
    const item = pendingFiles.find((p) => p.localId === localId);
    setPendingFiles((prev) => prev.filter((p) => p.localId !== localId));
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item?.id) {
      await fetch(
        `${AI_MENTOR_ROUTES.attachmentsApi}?id=${encodeURIComponent(item.id)}`,
        { method: "DELETE" }
      ).catch(() => null);
    }
  };

  const submit = () => {
    const value = draft.trim();
    const ids = pendingFiles.filter((p) => p.id && p.status === "done").map((p) => p.id!);
    if ((!value && ids.length === 0) || isStreaming || uploading) return;
    if (pendingFiles.some((p) => p.status === "error")) {
      toast.message("Remove or retry failed uploads first");
      return;
    }
    if (pendingFiles.some((p) => p.status !== "done")) {
      toast.message("Wait for uploads to finish");
      return;
    }
    stickToBottomRef.current = true;
    setDraft("");
    setPendingFiles((prev) => {
      for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    const content = value || "Please review the attached files.";
    setPendingLocalMessage(content);
    onSend(
      content,
      ids,
      PROMPT_RESPONSE_MODES[promptGroup]
    );
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropDepth.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropDepth.current = Math.max(0, dropDepth.current - 1);
    if (dropDepth.current === 0) setDragOver(false);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropDepth.current = 0;
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void queueFiles(e.dataTransfer.files);
  };

  const displayMessages = useMemo(() => {
    const source =
      messages.length > 0 || !pendingLocalMessage
        ? messages
        : [
            {
              id: "pending-local-user",
              conversation_id: conversationId ?? "",
              profile_id: "",
              role: "user" as const,
              content: pendingLocalMessage,
              status: "complete" as const,
              model: null,
              error: null,
              token_input: null,
              token_output: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];

    return source.map((m) =>
        editedIds.has(m.id)
          ? ({ ...m, __edited: true } as AiMessageRow & { __edited?: boolean })
          : m
      );
  }, [messages, pendingLocalMessage, conversationId, editedIds]);

  const isEmptyChat =
    !isLoading && messages.length === 0 && !pendingLocalMessage;
  const ActivePromptIcon = PROMPT_GROUP_ICONS[promptGroup];
  const canSend =
    !uploading &&
    !isStreaming &&
    (Boolean(draft.trim()) || pendingFiles.some((p) => p.status === "done")) &&
    !(
      pendingFiles.length > 0 &&
      pendingFiles.some((p) => p.status !== "done")
    );

  const renderComposer = () => (
    <div
      className={cn(
        "relative rounded-[28px] border border-border/70",
        "bg-card/90 backdrop-blur-xl",
        "shadow-[0_18px_50px_-28px_rgba(24,24,27,0.38),0_0_0_1px_rgba(255,255,255,0.35)_inset]",
        "transition-[box-shadow,border-color,transform] duration-200",
        "focus-within:border-brand/40 focus-within:shadow-[0_22px_55px_-30px_rgba(95,52,53,0.5),0_0_0_1px_rgba(255,255,255,0.45)_inset]",
        dragOver && "border-brand/50 ring-2 ring-brand/15",
        isEmptyChat && "rounded-[26px]"
      )}
    >
      {pendingFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-1 pt-3.5">
          <AnimatePresence mode="popLayout">
            {pendingFiles.map((file) => (
              <ComposerAttachmentChip
                key={file.localId}
                file={file}
                onRemove={() => void removePending(file.localId)}
                onRetry={() => void retryUpload(file.localId)}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col",
          isEmptyChat ? "min-h-[132px] px-4 pt-4 pb-3" : "px-2 py-1.5"
        )}
      >
        <div
          className={cn(
            "relative flex min-w-0 flex-1",
            isEmptyChat ? "min-h-[52px]" : "items-center"
          )}
        >
          {!draft ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-0 flex px-1",
                isEmptyChat ? "items-start pt-0.5" : "items-center"
              )}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={
                    isEmptyChat
                      ? PLACEHOLDERS_HERO
                      : PLACEHOLDERS[placeholderIndex]
                  }
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 0.5, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    "block w-full text-[15px] leading-6 text-muted-foreground",
                    !isEmptyChat && "truncate"
                  )}
                >
                  {isEmptyChat
                    ? PLACEHOLDERS_HERO
                    : PLACEHOLDERS[placeholderIndex]}
                </motion.span>
              </AnimatePresence>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              resizeTextarea(e.target, isEmptyChat ? 160 : 200);
            }}
            rows={isEmptyChat ? 2 : 1}
            disabled={isStreaming}
            aria-label="Message AI Mentor"
            className={cn(
              "w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none disabled:opacity-60",
              isEmptyChat
                ? "min-h-[52px] max-h-[160px] px-1 py-0.5"
                : "max-h-[200px] min-h-9 px-2 py-[6px]"
            )}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              const files = e.clipboardData?.files;
              const hasFile =
                (files && files.length > 0) ||
                (items && Array.from(items).some((i) => i.kind === "file"));
              if (hasFile) {
                e.preventDefault();
                if (items) void queueFiles(items);
                else if (files) void queueFiles(files);
              }
            }}
          />
        </div>

        <div
          className={cn(
            "flex items-center justify-between gap-2",
            isEmptyChat ? "mt-3" : "mt-0"
          )}
        >
          <div className="relative flex items-center gap-0.5" ref={attachMenuRef}>
            <button
              type="button"
              aria-label="Add attachment"
              aria-expanded={attachOpen}
              disabled={isStreaming}
              onClick={() => setAttachOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
            >
              <Plus className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Upload image"
              disabled={isStreaming}
              onClick={() => {
                acceptRef.current =
                  "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
                requestAnimationFrame(() => fileInputRef.current?.click());
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
            >
              <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {isEmptyChat ? (
              <>
                <span className="mx-1 h-5 w-px bg-border" />
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#ece3df] px-3 text-[12px] font-medium text-[#5f3435] dark:bg-[#5f3435]/35 dark:text-[#dca39a]">
                  <ActivePromptIcon className="h-3.5 w-3.5" />
                  {promptGroup}
                </span>
              </>
            ) : null}
            <AnimatePresence>
              {attachOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute bottom-11 left-0 z-30 w-[240px] overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-xl"
                >
                  {ATTACH_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                      onClick={() => {
                        if (opt.future) {
                          toast.message("Coming soon");
                          setAttachOpen(false);
                          return;
                        }
                        acceptRef.current = opt.accept;
                        setAttachOpen(false);
                        requestAnimationFrame(() =>
                          fileInputRef.current?.click()
                        );
                      }}
                    >
                      <span className="text-muted-foreground">{opt.icon}</span>
                      <span className="flex-1">{opt.label}</span>
                      {opt.future ? (
                        <span className="text-[10px] text-muted-foreground">
                          Soon
                        </span>
                      ) : null}
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={acceptRef.current}
              onChange={(e) => {
                if (e.target.files) void queueFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            {isEmptyChat ? (
              <div className={cn(compactMobileChrome && "max-lg:hidden")}>
                <MentorModelPicker />
              </div>
            ) : null}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  canSend
                    ? "bg-[#242328] text-white shadow-[0_6px_16px_-8px_rgba(24,24,27,0.7)] hover:bg-[#3b363b]"
                    : "bg-muted-foreground/20 text-muted-foreground/50"
                )}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className="mentor-composer-glow pointer-events-none absolute inset-x-5 bottom-0 h-[2.5px] rounded-full opacity-90"
      />
    </div>
  );

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <MentorAuroraBackground vivid={isEmptyChat} />

      <AnimatePresence>
        {dragOver ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
          >
            <div className="rounded-2xl border border-dashed border-foreground/30 bg-card px-8 py-6 text-center shadow-lg">
              <p className="text-sm font-medium text-foreground">
                Drop files to attach
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Images, PDFs, code, and documents · max 10 MB each
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Desktop conversation chrome only — mobile uses workspace bar */}
      {!isEmptyChat ? (
        <header
          className={cn(
            "relative z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/40 px-4 backdrop-blur-md sm:px-6",
            compactMobileChrome && "max-lg:hidden"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-foreground/70" />
              <p className="text-[13px] font-semibold tracking-tight text-foreground">
                AI Mentor
              </p>
            </div>
            <p className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground">
              {title && title !== "AI Mentor" ? title : "New conversation"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isStreaming ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Generating
              </span>
            ) : null}
            <MentorModelPicker />
          </div>
        </header>
      ) : null}

      {/* Reserve space under floating mobile chrome */}
      {compactMobileChrome ? (
        <div className="h-11 shrink-0 lg:hidden" aria-hidden />
      ) : null}

      <div
        ref={scrollRef}
        className="mentor-scroll relative z-10 min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = distanceFromBottom < 160;
        }}
      >
        {isLoading && !pendingLocalMessage && messages.length === 0 ? (
          <div className="mx-auto max-w-[760px] space-y-4 px-4 py-8">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-14 animate-pulse rounded-2xl bg-muted/70",
                  i % 2 === 0 ? "ml-auto w-2/5" : "w-3/4"
                )}
              />
            ))}
          </div>
        ) : isEmptyChat ? (
          <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-4 px-4 py-5 max-md:pb-4 sm:px-6 sm:py-6">
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex flex-col items-center"
            >
              <SupraMascot
                showLabel
                labelClassName="text-muted-foreground/80"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-20 w-full"
            >
              {renderComposer()}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.4 }}
              className="w-full space-y-3"
            >
              <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(Object.keys(PROMPT_GROUPS) as PromptGroup[]).map((group) => (
                  <button
                    key={group}
                    type="button"
                    onClick={() => setPromptGroup(group)}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-medium transition-all",
                      group === promptGroup
                        ? "border-[#5f3435]/25 bg-[#5f3435] text-white shadow-sm"
                        : "border-border/70 bg-card/70 text-muted-foreground hover:bg-card hover:text-foreground"
                    )}
                  >
                    {group === "Explore" ? (
                      <Sparkles className="h-3.5 w-3.5" />
                    ) : null}
                    {group}
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-[22px] border border-border/60 bg-card/70 p-1.5 backdrop-blur-lg">
                {PROMPT_GROUPS[promptGroup].map((prompt, index) => {
                  const PromptIcon = prompt.icon;
                  return (
                    <motion.button
                      key={`${promptGroup}-${prompt.text}`}
                      type="button"
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.045 }}
                      onClick={() => {
                        stickToBottomRef.current = true;
                        setPendingLocalMessage(prompt.text);
                        onSend(
                          prompt.text,
                          undefined,
                          PROMPT_RESPONSE_MODES[promptGroup]
                        );
                      }}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors",
                        "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-[#5f3435] dark:text-[#dca39a]">
                        <PromptIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {prompt.text}
                      </span>
                      <ArrowUp className="h-3.5 w-3.5 rotate-90 opacity-30 transition-transform group-hover:translate-x-0.5 group-hover:opacity-70" />
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="space-y-6 px-4 py-6 sm:px-6 sm:py-8">
            {displayMessages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                isLastAssistant={message.id === lastAssistantId}
                conversationId={conversationId}
                isStreaming={isStreaming}
                editingId={editingId}
                attachments={attachmentsByMessageId[message.id] ?? []}
                onStartEdit={setEditingId}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(id, content) => {
                  setEditingId(null);
                  setEditedIds((prev) => new Set(prev).add(id));
                  onEditMessage(id, content);
                }}
                onRegenerate={onRegenerate}
                onContinue={onContinue}
                onOpenAttachments={(atts, index) =>
                  setPreview({
                    attachments: atts.filter((a) => a.isImage && a.url),
                    index,
                  })
                }
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!isEmptyChat ? (
        <div className="relative z-10 shrink-0 px-3 pb-3 pt-1 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          {error ? (
            <p className="mb-2 text-center text-xs text-rose-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mx-auto max-w-[760px]">
            {renderComposer()}
            <p className="mt-2.5 hidden text-center text-[11px] text-muted-foreground/75 sm:block">
              Enter to send · Shift+Enter newline · Drop or paste files · Esc
              stops generation
            </p>
          </div>
        </div>
      ) : error ? (
        <p className="px-4 pb-3 text-center text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <ImagePreviewModal
        open={Boolean(preview)}
        attachments={preview?.attachments ?? []}
        index={preview?.index ?? 0}
        onClose={() => setPreview(null)}
        onIndexChange={(next) =>
          setPreview((prev) => (prev ? { ...prev, index: next } : prev))
        }
      />
    </div>
  );
}
