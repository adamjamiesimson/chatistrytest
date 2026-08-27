import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '../supabase';

interface WingmanPanelProps {
  conversationId: string | null;
  onClose: () => void;
}

export function WingmanPanel({ conversationId, onClose }: WingmanPanelProps) {
  const [input, setInput] = useState('');
  const [reply, setReply] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortRef] = useState<{ controller?: AbortController }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);

  // Focus the input on open; close on Escape.
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Keep the reply area scrolled to the bottom while streaming.
  useEffect(() => {
    const el = replyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reply]);

  useEffect(() => () => abortRef.controller?.abort(), [abortRef]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || !conversationId || loading) return;
    setInput('');
    setError(null);
    setReply('');
    setLoading(true);
    const controller = new AbortController();
    abortRef.controller = controller;

    try {
      const { data, error: fnError } = await supabase.functions.invoke('wingman-ai', {
        body: { conversationId, query: q },
        headers: { 'Content-Type': 'application/json' },
      });
      // data is the streamed text/plain response (SSE from Gemini passed through).
      if (fnError) throw fnError;
      if (data && typeof data === 'object' && (data as any).error) {
        setError((data as any).error);
        return;
      }
      setReply(String(data ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wingman is having trouble. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute top-16 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden flex flex-col"
      style={{ maxHeight: '60vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-gradient-to-r from-violet-600/15 via-purple-600/10 to-fuchsia-600/10">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span>Ask Wingman AI</span>
        </div>
        <button onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--txt3)] hover:text-[var(--txt)] hover:bg-[var(--surface3)] transition-colors"
          title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Reply area */}
      <div ref={replyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[6rem] text-sm leading-relaxed text-[var(--txt)] whitespace-pre-wrap">
        {!reply && !loading && !error && (
          <p className="text-[var(--txt3)] text-xs">
            Ask about this chat, get a summary, draft a reply, or get conversation tips. Wingman sees the recent messages for context.
          </p>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-[var(--txt3)] text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            <span>Wingman is thinking…</span>
          </div>
        )}
        {reply && <div>{reply}</div>}
        {error && <div className="text-red-400 text-xs">{error}</div>}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="border-t border-[var(--border)] p-3 flex items-center gap-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Wingman AI…"
          className="flex-1 bg-[var(--surface3)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500/70 text-[var(--txt)] placeholder-[var(--txt3)]"
        />
        <button type="submit"
          disabled={!input.trim() || loading || !conversationId}
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-600 text-white enabled:hover:bg-violet-500 disabled:opacity-40 transition-colors flex-shrink-0"
          title="Send to Wingman">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}