"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Bold,
  Check,
  Copy,
  Italic,
  List,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useProgressStore } from "@/store/use-progress-store";
import { persistUpdateNote } from "@/features/progress/lib/progress-sync";
import { useStoreHydrated } from "@/hooks/use-store-hydrated";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import type { AppNote, NoteAccent } from "@/types";

const SAVE_DELAY_MS = 400;

const ACCENTS: {
  id: NoteAccent;
  label: string;
  dot: string;
  soft: string;
  ring: string;
  wash: string;
}[] = [
  {
    id: "indigo",
    label: "Indigo",
    dot: "bg-indigo-500",
    soft: "bg-indigo-500/12",
    ring: "ring-indigo-500/40",
    wash: "from-indigo-500/[0.07]",
  },
  {
    id: "emerald",
    label: "Emerald",
    dot: "bg-emerald-500",
    soft: "bg-emerald-500/12",
    ring: "ring-emerald-500/40",
    wash: "from-emerald-500/[0.07]",
  },
  {
    id: "amber",
    label: "Amber",
    dot: "bg-amber-500",
    soft: "bg-amber-500/12",
    ring: "ring-amber-500/40",
    wash: "from-amber-500/[0.07]",
  },
  {
    id: "rose",
    label: "Rose",
    dot: "bg-rose-500",
    soft: "bg-rose-500/12",
    ring: "ring-rose-500/40",
    wash: "from-rose-500/[0.07]",
  },
  {
    id: "sky",
    label: "Sky",
    dot: "bg-sky-500",
    soft: "bg-sky-500/12",
    ring: "ring-sky-500/40",
    wash: "from-sky-500/[0.07]",
  },
];

function accentMeta(accent?: NoteAccent) {
  return ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function looksLikeHtml(value: string): boolean {
  return /<(?:b|i|u|strong|em|ul|ol|li|p|div|br|span|h[1-6])\b/i.test(value);
}

/** Convert plain / markdown-ish notes into HTML the rich editor can show. */
function toEditorHtml(raw: string): string {
  if (!raw.trim()) return "";
  if (looksLikeHtml(raw)) return raw;

  const formatInline = (line: string) => {
    let s = escapeHtml(line);
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<i>$2</i>");
    return s;
  };

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${formatInline(line.replace(/^\s*-\s+/, ""))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (!line.trim()) {
      out.push("<div><br></div>");
    } else {
      out.push(`<div>${formatInline(line)}</div>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function notePreview(content: string, max = 48): string {
  const text = stripHtml(content).replace(/\s+/g, " ");
  if (!text) return "Empty note";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function wordCount(html: string) {
  const words = stripHtml(html).match(/\S+/g);
  return words?.length ?? 0;
}

function createBlankNote(): AppNote {
  return {
    id: crypto.randomUUID(),
    title: "Untitled Note",
    content: "",
    updatedAt: new Date().toISOString(),
    pinned: false,
    accent: "indigo",
  };
}

type SaveStatus = "idle" | "saving" | "saved" | "unsaved";

export function NotesWorkspace() {
  const hydrated = useStoreHydrated();
  const notes = useProgressStore((s) => s.notes);
  const addNote = useProgressStore((s) => s.addNote);
  const updateNote = useProgressStore((s) => s.updateNote);
  const deleteNote = useProgressStore((s) => s.deleteNote);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [copied, setCopied] = useState(false);
  const [fmt, setFmt] = useState({ bold: false, italic: false, list: false });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef({ id: "", title: "", content: "" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  const sortedNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            stripHtml(n.content).toLowerCase().includes(q)
        )
      : notes;
    return [...filtered].sort((a, b) => {
      const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pin !== 0) return pin;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, query]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const flushSave = useCallback(
    async (id: string, title: string, content: string) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const current = useProgressStore.getState().notes.find((n) => n.id === id);
      if (!current) return;
      if (current.title === title && current.content === content) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      useProgressStore.setState((s) => ({
        notes: s.notes.map((n) =>
          n.id === id
            ? {
                ...n,
                title: title || "Untitled Note",
                content,
                updatedAt: new Date().toISOString(),
              }
            : n
        ),
      }));
      const serverId = await persistUpdateNote(id, {
        title: title || "Untitled Note",
        content,
      });
      if (!serverId) {
        setSaveStatus("unsaved");
        return;
      }
      if (serverId !== id) {
        useProgressStore.setState((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, id: serverId } : n)),
        }));
        setSelectedId((prev) => (prev === id ? serverId : prev));
      }
      setSaveStatus("saved");
    },
    []
  );

  const scheduleSave = useCallback(
    (id: string, title: string, content: string) => {
      draftRef.current = { id, title, content };
      setSaveStatus("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flushSave(id, title, content);
      }, SAVE_DELAY_MS);
    },
    [flushSave]
  );

  // Hydrate selection once store is ready
  useEffect(() => {
    if (!hydrated || initialized.current) return;
    initialized.current = true;
    if (notes.length > 0) {
      const first = [...notes].sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
      setSelectedId(first.id);
    }
  }, [hydrated, notes]);

  // Load draft when switching notes
  useEffect(() => {
    if (!selected) {
      setDraftTitle("");
      setDraftContent("");
      setSaveStatus("idle");
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setDraftTitle(selected.title);
    const html = toEditorHtml(selected.content);
    setDraftContent(html);
    draftRef.current = {
      id: selected.id,
      title: selected.title,
      content: html,
    };
    setSaveStatus("saved");
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep selection valid
  useEffect(() => {
    if (!selectedId) return;
    if (!notes.some((n) => n.id === selectedId)) {
      setSelectedId(sortedNotes[0]?.id ?? notes[0]?.id ?? null);
    }
  }, [notes, selectedId, sortedNotes]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      const d = draftRef.current;
      if (d.id) flushSave(d.id, d.title, d.content);
    };
  }, [flushSave]);

  const handleCreate = useCallback(() => {
    if (selectedId) {
      const d = draftRef.current;
      if (d.id === selectedId) flushSave(d.id, d.title, d.content);
    }
    const note = createBlankNote();
    addNote(note);
    setSelectedId(note.id);
    setQuery("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [addNote, flushSave, selectedId]);

  const selectNote = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      const d = draftRef.current;
      if (d.id) flushSave(d.id, d.title, d.content);
      setSelectedId(id);
    },
    [flushSave, selectedId]
  );

  const requestDelete = useCallback(() => {
    if (!selected) return;
    setConfirmDeleteOpen(true);
  }, [selected]);

  const confirmDelete = useCallback(() => {
    if (!selected) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const remaining = notes.filter((n) => n.id !== selected.id);
    deleteNote(selected.id);
    draftRef.current = { id: "", title: "", content: "" };
    setSelectedId(remaining[0]?.id ?? null);
    setConfirmDeleteOpen(false);
  }, [deleteNote, notes, selected]);

  const togglePin = useCallback(() => {
    if (!selected) return;
    updateNote(selected.id, { pinned: !selected.pinned });
  }, [selected, updateNote]);

  const setAccent = useCallback(
    (accent: NoteAccent) => {
      if (!selected) return;
      updateNote(selected.id, { accent });
    },
    [selected, updateNote]
  );

  // Sync rich editor when switching notes
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !selected) return;
    const html = toEditorHtml(selected.content);
    if (el.innerHTML !== html) {
      el.innerHTML = html || "";
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshFmt = useCallback(() => {
    try {
      setFmt({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        list: document.queryCommandState("insertUnorderedList"),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onSel = () => {
      if (editorRef.current?.contains(document.activeElement)) refreshFmt();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [refreshFmt]);

  const readEditorHtml = useCallback(() => {
    const el = editorRef.current;
    if (!el) return "";
    const html = el.innerHTML;
    // Treat empty editor shells as blank
    if (
      !html ||
      html === "<br>" ||
      html === "<div><br></div>" ||
      html === "<p><br></p>"
    ) {
      return "";
    }
    return html;
  }, []);

  const handleEditorInput = useCallback(() => {
    if (!selectedId) return;
    const html = readEditorHtml();
    setDraftContent(html);
    scheduleSave(selectedId, draftTitle, html);
    refreshFmt();
  }, [draftTitle, readEditorHtml, refreshFmt, scheduleSave, selectedId]);

  const applyFormat = useCallback(
    (command: "bold" | "italic" | "insertUnorderedList") => {
      const el = editorRef.current;
      if (!el || !selectedId) return;
      el.focus();
      document.execCommand(command, false);
      const html = readEditorHtml();
      setDraftContent(html);
      scheduleSave(selectedId, draftTitle, html);
      refreshFmt();
    },
    [draftTitle, readEditorHtml, refreshFmt, scheduleSave, selectedId]
  );

  const copyNote = useCallback(async () => {
    const plain = `${draftTitle}\n\n${stripHtml(draftContent)}`.trim();
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [draftContent, draftTitle]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleCreate();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const d = draftRef.current;
        if (d.id) flushSave(d.id, d.title, d.content);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flushSave, handleCreate]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading notes…
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-muted/50 via-background to-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,_color-mix(in_srgb,var(--color-primary)_12%,transparent),_transparent_65%)]"
      />

      {/* Header */}
      <div className="relative shrink-0 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/25">
                <StickyNote className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Notes
                </h1>
                <SaveStatusLine status={saveStatus} hasNotes={notes.length > 0} />
              </div>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleCreate}
            className="h-10 gap-1.5 rounded-xl bg-indigo-600 px-5 text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            New note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyNotes onCreate={handleCreate} />
      ) : (
        <div className="relative mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-1 gap-0 overflow-hidden px-3 pb-3 sm:px-4 sm:pb-4 lg:grid-cols-[minmax(270px,310px)_1fr] lg:gap-5 lg:px-6 lg:pb-6">
          {/* List */}
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/80 bg-card/90 shadow-[0_10px_40px_-24px_rgba(15,23,42,0.35)] backdrop-blur-sm">
            <div className="shrink-0 border-b border-border/70 p-3.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notes…"
                  className="h-10 w-full rounded-2xl border border-border/80 bg-muted/40 pl-10 pr-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-indigo-500/40 focus:bg-background focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
              <p className="mt-3 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                {sortedNotes.length} of {notes.length}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {sortedNotes.length === 0 ? (
                <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                  No matches for “{query}”
                </p>
              ) : (
                sortedNotes.map((note) => {
                  const active = selectedId === note.id;
                  const meta = accentMeta(note.accent);
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => selectNote(note.id)}
                      className={cn(
                        "mb-1.5 flex w-full gap-3 rounded-2xl border p-3.5 text-left transition last:mb-0",
                        active
                          ? cn(
                              "border-transparent shadow-sm ring-1",
                              meta.soft,
                              meta.ring
                            )
                          : "border-transparent hover:bg-muted/60"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full shadow-sm",
                          meta.dot
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-foreground">
                            {note.id === selectedId
                              ? draftTitle || "Untitled Note"
                              : note.title}
                          </span>
                          {note.pinned ? (
                            <Pin className="h-3 w-3 shrink-0 text-amber-500" />
                          ) : null}
                        </span>
                        <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {note.id === selectedId
                            ? notePreview(draftContent)
                            : notePreview(note.content)}
                        </span>
                        <span className="mt-2 block text-[10px] text-muted-foreground/75">
                          {formatRelative(note.updatedAt)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Editor */}
          {selected ? (
            <section className="relative mt-3 flex min-h-[52vh] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/95 shadow-[0_20px_60px_-32px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.03] lg:mt-0 lg:min-h-0 dark:ring-white/[0.04]">
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b to-transparent",
                  accentMeta(selected.accent).wash
                )}
              />

              <div className="relative flex shrink-0 flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-3.5 rounded-full border border-border/50 bg-background/70 px-3.5 py-2 shadow-sm backdrop-blur-sm">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      title={a.label}
                      onClick={() => setAccent(a.id)}
                      className={cn(
                        "h-[15px] w-[15px] rounded-full transition duration-200",
                        a.dot,
                        selected.accent === a.id ||
                          (!selected.accent && a.id === "indigo")
                          ? "scale-125 shadow-md ring-2 ring-offset-2 ring-offset-background ring-foreground/20"
                          : "opacity-40 hover:scale-110 hover:opacity-100"
                      )}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-0.5 rounded-full border border-border/50 bg-background/70 p-1 shadow-sm backdrop-blur-sm">
                  <ToolbarButton
                    title="Bold"
                    active={fmt.bold}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyFormat("bold")}
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </ToolbarButton>
                  <ToolbarButton
                    title="Italic"
                    active={fmt.italic}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyFormat("italic")}
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </ToolbarButton>
                  <ToolbarButton
                    title="Bullet list"
                    active={fmt.list}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyFormat("insertUnorderedList")}
                  >
                    <List className="h-3.5 w-3.5" />
                  </ToolbarButton>
                </div>

                <div className="ml-auto flex items-center gap-0.5 rounded-full border border-border/50 bg-background/70 p-1 shadow-sm backdrop-blur-sm">
                  <ToolbarButton
                    title={selected.pinned ? "Unpin" : "Pin note"}
                    onClick={togglePin}
                  >
                    {selected.pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </ToolbarButton>
                  <ToolbarButton title="Copy note" onClick={copyNote}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </ToolbarButton>
                  <ToolbarButton
                    title="Delete"
                    onClick={requestDelete}
                    danger
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ToolbarButton>
                </div>
              </div>

              <div className="relative shrink-0 px-6 pt-2 sm:px-8 sm:pt-3">
                <input
                  ref={titleRef}
                  value={draftTitle}
                  onChange={(e) => {
                    const title = e.target.value;
                    setDraftTitle(title);
                    scheduleSave(selected.id, title, draftContent);
                  }}
                  onBlur={() =>
                    flushSave(selected.id, draftTitle, draftContent)
                  }
                  placeholder="Note title"
                  className="w-full bg-transparent text-[1.4rem] font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 sm:text-[1.75rem]"
                />
              </div>

              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Note content"
                data-placeholder="Start writing… autosaves as you type."
                data-empty={stripHtml(draftContent) ? "false" : "true"}
                onInput={handleEditorInput}
                onBlur={() => {
                  flushSave(selected.id, draftTitle, readEditorHtml());
                  refreshFmt();
                }}
                onKeyUp={refreshFmt}
                onMouseUp={refreshFmt}
                className={cn(
                  "note-editor relative min-h-0 flex-1 overflow-y-auto bg-transparent px-6 py-4 text-[15.5px] leading-8 text-foreground outline-none sm:px-8 sm:py-5",
                  "before:pointer-events-none before:absolute before:left-6 before:top-4 before:text-muted-foreground/40 before:content-[attr(data-placeholder)] sm:before:left-8 sm:before:top-5",
                  "data-[empty=false]:before:hidden",
                  "[&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic",
                  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
                  "[&_li]:my-1 [&_div]:min-h-[2rem]"
                )}
              />

              <div className="relative flex shrink-0 items-center px-6 pb-4 pt-1 sm:px-8">
                <span className="rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground/75">
                  {wordCount(draftContent)} words ·{" "}
                  {stripHtml(draftContent).length} chars
                </span>
              </div>
            </section>
          ) : (
            <div className="mt-3 flex min-h-[40vh] items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-muted/15 text-sm text-muted-foreground lg:mt-0">
              Select a note to edit
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete this note?"
        description={
          selected?.title?.trim()
            ? `“${selected.title.trim()}” will be permanently removed. This can’t be undone.`
            : "This note will be permanently removed. This can’t be undone."
        }
        confirmLabel="Delete note"
        cancelLabel="Keep note"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}

function SaveStatusLine({
  status,
  hasNotes,
}: {
  status: SaveStatus;
  hasNotes: boolean;
}) {
  if (!hasNotes) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Capture ideas — they save as you type
      </p>
    );
  }
  if (status === "saving" || status === "unsaved") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-amber-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </p>
    );
  }
  if (status === "saved") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-emerald-500">
        <Check className="h-3 w-3" />
        Saved automatically
      </p>
    );
  }
  return (
    <p className="text-[12px] text-muted-foreground">Saved automatically</p>
  );
}

function ToolbarButton({
  children,
  onClick,
  onMouseDown,
  title,
  danger,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  onMouseDown?: (e: MouseEvent<HTMLButtonElement>) => void;
  title: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground",
        active && "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
        danger && "hover:bg-rose-500/10 hover:text-rose-500"
      )}
    >
      {children}
    </button>
  );
}

function EmptyNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-border/80 bg-card p-9 text-center shadow-[0_20px_60px_-30px_rgba(15,23,42,0.45)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-indigo-500/15 to-transparent"
        />
        <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
          <StickyNote className="h-6 w-6" />
        </div>
        <h2 className="relative mt-5 text-lg font-semibold text-foreground">
          Your notebook is empty
        </h2>
        <p className="relative mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Start a note and keep typing — every change saves automatically so
          nothing gets lost.
        </p>
        <Button
          onClick={onCreate}
          className="relative mt-6 gap-1.5 rounded-xl bg-indigo-600 px-5 text-white shadow-md shadow-indigo-500/25 hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          Create first note
        </Button>
      </div>
    </div>
  );
}
