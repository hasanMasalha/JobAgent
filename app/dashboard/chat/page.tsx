"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/app/components/ui";
import { cn } from "@/lib/cn";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_PROMPTS = [
  "What backend roles did I match today?",
  "Which companies have I applied to?",
  "Show me my best matches this week",
  "Give me a summary of my job search",
];

export default function ChatPage() {
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streaming, toolLabel]);

  const autoResize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = newHeight + "px";
    textarea.style.overflowY = textarea.scrollHeight > 200 ? "auto" : "hidden";
  };

  useEffect(() => {
    autoResize();
  }, [input]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
    setStreaming(true);
    setToolLabel(null);

    // Placeholder assistant message
    setHistory([...nextHistory, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          history,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type: string; label?: string; chunk?: string };

            if (event.type === "tool" && event.label) {
              setToolLabel(event.label);
            } else if (event.type === "text" && event.chunk) {
              setToolLabel(null);
              assistantText += event.chunk;
              setHistory([
                ...nextHistory,
                { role: "assistant", content: assistantText },
              ]);
            }
          } catch {
            // malformed line — ignore
          }
        }
      }

      // Flush any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as { type: string; chunk?: string };
          if (event.type === "text" && event.chunk) {
            assistantText += event.chunk;
            setHistory([...nextHistory, { role: "assistant", content: assistantText }]);
          }
        } catch {
          // ignore
        }
      }

      // If Claude returned nothing (shouldn't happen), clear the placeholder
      if (!assistantText) {
        setHistory(nextHistory);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setHistory([...nextHistory, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setStreaming(false);
      setToolLabel(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-80px)] max-w-2xl flex-col">
      <div className="mb-4">
        <h1 className="font-serif text-title-page-sm text-ink sm:text-title-page">Assistant</h1>
        <p className="mt-1 text-body-sm text-ink-muted">Ask about your matches, applications and progress. Answers use your live data.</p>
      </div>

      {/* Message area */}
      <div className="flex-1 space-y-4 overflow-y-auto pb-4 pr-1" aria-live="polite">
        {history.length === 0 && !streaming && (
          <div className="pt-6">
            <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">Try asking</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className={cn(
                    "rounded-card border border-line bg-surface px-4 py-3 text-left text-body-sm text-ink transition-colors",
                    "hover:border-brand/50 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-body-sm",
                msg.role === "user"
                  ? "rounded-br-sm bg-brand text-brand-on"
                  : "rounded-bl-sm border border-line bg-surface text-ink",
              )}
            >
              {msg.content}
              {msg.role === "assistant" && msg.content === "" && streaming && !toolLabel && (
                <span className="inline-flex h-4 items-center gap-1" aria-label="Thinking">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle motion-safe:animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle motion-safe:animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle motion-safe:animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-line pt-4">
        {toolLabel && (
          <div className="mb-2 flex items-center gap-2 px-1 text-caption text-ink-subtle" role="status">
            <Spinner size="sm" decorative />
            {toolLabel}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-4 py-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <textarea
            ref={textareaRef}
            aria-label="Message the assistant"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowHint(true)}
            onBlur={() => setShowHint(false)}
            placeholder="Ask about your job search…"
            rows={1}
            disabled={streaming}
            style={{
              height: "auto",
              minHeight: "44px",
              maxHeight: "200px",
              resize: "none",
              overflowY: "hidden",
            }}
            className="flex-1 bg-transparent py-2.5 text-body-sm text-ink placeholder:text-ink-subtle focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="mb-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Send"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className={cn("mt-1.5 text-center text-caption text-ink-subtle transition-opacity", showHint ? "opacity-100" : "opacity-0")} aria-hidden={!showHint}>
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
