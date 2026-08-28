import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, ReactionsMap, PinnedMessage, ConversationSummary, UserRow } from '../types';
import {
  Send, MessageSquareDashed, Paperclip, X,
  Pencil, Trash2, Check, CheckCheck, ChevronDown, Play, CornerUpLeft, Smile,
  Search, SearchX, Mic, Pin, PinOff, ArrowLeft, Forward, Info, Plus, Sparkles, Palette,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import { supabase } from '../supabase';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { VoiceRecorder } from './VoiceRecorder';
import { LinkPreview } from './LinkPreview';
import { ForwardModal } from './ForwardModal';
import { GroupInfoModal } from './GroupInfoModal';
import { WingmanPanel } from './WingmanPanel';
import { CHAT_THEMES, ChatThemeId, ChatThemePicker } from './ChatThemePicker';

const PAGE_SIZE = 200;

interface ChatAreaProps {
  currentUser: User;
  conversation: ConversationSummary | null;
  onlineUserIds: string[];
  onBackToSidebar?: () => void;
  onLeftGroup?: () => void;
  onMarkConversationRead?: (convId: string) => void;
}

const EMOJI_SET = ['❤️', '👍', '😂', '😭', '😮', '😢', '😡', '🔥', '👏'];
const MAX_TEXTAREA_LINES = 6; // textarea grows up to ~6 lines while typing
const LIST_LINE_HEIGHT_PX = 20; // text-sm (14px) line-height in the textarea
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 80 * 1024 * 1024;
const ACCEPTED_IMAGE = ['image/jpeg','image/png','image/gif','image/webp'];
const ACCEPTED_VIDEO = ['video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo'];

// A few distinct accent colors so multiple senders in a group are visually distinguishable.
const SENDER_COLORS = ['text-cyan-400', 'text-violet-400', 'text-amber-400', 'text-rose-400', 'text-emerald-400', 'text-sky-400'];
function colorForSender(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[hash % SENDER_COLORS.length];
}

function getMediaType(file: File): 'image' | 'video' | 'audio' | null {
  if (ACCEPTED_IMAGE.includes(file.type)) return 'image';
  if (ACCEPTED_VIDEO.includes(file.type)) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function extractFirstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"{}|\\^\[\]`]+/.exec(text);
  return m ? m[0] : null;
}

function renderTextWithLinks(text: string): React.ReactNode[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^\[\]`]+/g;
  const nodes: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={last}>{text.slice(last, m.index)}</span>);
    nodes.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer"
        className="text-cyan-400 underline decoration-dotted underline-offset-2 hover:text-cyan-300 break-all"
        onClick={e => e.stopPropagation()}>{m[0]}</a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={last}>{text.slice(last)}</span>);
  return nodes;
}

// ── #1 Image compression — resize to max 1200px before upload ──
async function compressImage(file: File, maxDimension = 1200, quality = 0.82): Promise<File> {
  if (!ACCEPTED_IMAGE.includes(file.type) || file.type === 'image/gif') return file;
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return; }
        const out = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
        resolve(out.size < file.size ? out : file);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── #5 Reaction tooltip — format reactor names ──
function formatReactors(userIds: string[], getName: (id: string) => string): string {
  const names = userIds.map(getName);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function mapRow(m: any): Message {
  return {
    id: m.id, senderId: m.sender_id,
    content: m.content ?? '', timestamp: m.created_at,
    messageType: m.message_type ?? 'text', mediaUrl: m.image_url ?? undefined,
    isEdited: m.is_edited ?? false, originalContent: m.original_content ?? undefined,
    replyToId: m.reply_to_id ?? undefined, replyToContent: m.reply_to_content ?? undefined,
    replyToSenderId: m.reply_to_sender_id ?? undefined, replyToMessageType: m.reply_to_message_type ?? undefined,
  };
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id, username: row.username, displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined, lastSeenAt: row.last_seen_at ?? undefined,
    statusEmoji: row.status_emoji ?? undefined, statusText: row.status_text ?? undefined,
  };
}

function formatLastSeen(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatTypingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState<number | null>(null); // null = length not known yet
  const audioRef = useRef<HTMLAudioElement>(null);

  const grabDuration = () => {
    const d = audioRef.current?.duration;
    setDuration(Number.isFinite(d) && (d ?? 0) > 0 ? (d as number) : null);
  };

  // Blob/WebM audio frequently reports duration as Infinity until the whole clip is
  // decoded. Force the browser to resolve the real duration by seeking to a huge
  // timestamp right after metadata loads, then jump back to the start. This makes the
  // seek bar and blue progress fill available immediately instead of only after the
  // message has been played through once.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const probeDuration = () => {
      if (Number.isFinite(a.duration)) { grabDuration(); return; }
      const reset = () => {
        a.ontimeupdate = null;
        a.currentTime = 0;
        grabDuration();
      };
      a.ontimeupdate = reset;
      try { a.currentTime = 1e10; } catch { reset(); }
    };
    a.addEventListener('loadedmetadata', probeDuration);
    return () => a.removeEventListener('loadedmetadata', probeDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    playing ? a.pause() : a.play(); setPlaying(!playing);
  };
  const handleTimeUpdate = () => {
    const a = audioRef.current; if (!a) return;
    // Blob audio may report duration as Infinity until fully buffered, so guard it.
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
    setProgress(d ? (a.currentTime / d) * 100 : 0);
  };
  const handleEnded = () => { setPlaying(false); setProgress(0); };
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a) return;
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null;
    if (d === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * d;
  };
  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  const currentTime = audioRef.current?.currentTime ?? 0;
  // Show the clip's length before it's been played (currentTime 0), otherwise the
  // position it's paused at. Falls back to the current position if length is unknown.
  const displayTime = !playing && currentTime === 0 ? (duration ?? currentTime) : currentTime;

  return (
    <div className="flex items-center gap-2 min-w-[190px] py-0.5">
      <audio ref={audioRef} src={url} onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={grabDuration} onDurationChange={grabDuration} onEnded={handleEnded} />
      <button onClick={toggle}
        className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/30 transition-colors flex-shrink-0">
        {playing
          ? <span className="w-3 h-3 flex gap-0.5 items-center justify-center"><span className="w-0.5 h-3 bg-current rounded" /><span className="w-0.5 h-3 bg-current rounded" /></span>
          : <Play className="w-3 h-3 ml-0.5" fill="currentColor" />}
      </button>
      <div className="flex-1 h-1 bg-[var(--border)] rounded-full cursor-pointer" onClick={handleSeek}>
        <div className="h-full bg-cyan-400 rounded-full transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-[10px] text-[var(--txt3)] font-mono flex-shrink-0 w-8 text-right">
        {fmt(displayTime)}
      </span>
    </div>
  );
}

export function ChatArea({ currentUser, conversation, onlineUserIds, onBackToSidebar, onLeftGroup, onMarkConversationRead }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [reactions, setReactions] = useState<Record<string, ReactionsMap>>({});
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Emoji picker
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  // Full reaction emoji picker
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);

  // Reply
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Media
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const [expandedOriginals, setExpandedOriginals] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // ── NEW FEATURES ──
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [otherReads, setOtherReads] = useState<Map<string, Date>>(new Map());
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Forwarding
  const [forwardingMsg, setForwardingMsg] = useState<Message | null>(null);

  // Unread divider
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  // Pagination
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const oldestTimestampRef = useRef<string | null>(null);

  // ── #3 New messages jump button ──
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMsgCount, setNewMsgCount] = useState(0);

  // ── Group chat state ──
  const isGroup = conversation?.isGroup ?? false;
  const [liveName, setLiveName] = useState(conversation?.name ?? '');
  const [liveAvatarUrl, setLiveAvatarUrl] = useState(conversation?.avatarUrl);
  const [liveParticipantIds, setLiveParticipantIds] = useState<string[]>(conversation?.participantIds ?? []);
  const [liveCreatedBy, setLiveCreatedBy] = useState(conversation?.createdBy);
  const [groupMembers, setGroupMembers] = useState<User[]>([]);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showWingman, setShowWingman] = useState(false);
  const [showChatThemes, setShowChatThemes] = useState(false);
  const [chatThemeId, setChatThemeId] = useState<ChatThemeId>('aurora');
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const partner = conversation?.partner;
  const chatId = conversation?.id ?? null;
  const currentChatTheme = CHAT_THEMES.find(theme => theme.id === chatThemeId) ?? CHAT_THEMES[0];

  useEffect(() => {
    if (!chatId) return;
    const storageKey = `chatistry-chat-theme:${currentUser.id}:${chatId}`;
    const localTheme = localStorage.getItem(storageKey) as ChatThemeId | null;
    if (localTheme && CHAT_THEMES.some(theme => theme.id === localTheme)) setChatThemeId(localTheme);
    else setChatThemeId('aurora');

    let cancelled = false;
    supabase.from('user_conversation_themes').select('theme_id')
      .eq('user_id', currentUser.id).eq('conversation_id', chatId).maybeSingle()
      .then(({ data }) => {
        const savedTheme = data?.theme_id as ChatThemeId | undefined;
        if (!cancelled && savedTheme && CHAT_THEMES.some(theme => theme.id === savedTheme)) {
          setChatThemeId(savedTheme);
          localStorage.setItem(storageKey, savedTheme);
        }
      });
    return () => { cancelled = true; };
  }, [chatId, currentUser.id]);

  const applyChatTheme = (themeId: ChatThemeId) => {
    if (!chatId) return;
    setChatThemeId(themeId);
    localStorage.setItem(`chatistry-chat-theme:${currentUser.id}:${chatId}`, themeId);
    supabase.from('user_conversation_themes').upsert({
      user_id: currentUser.id, conversation_id: chatId, theme_id: themeId, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,conversation_id' }).then(({ error }) => {
      if (error) console.warn('Could not save chat theme:', error.message);
    });
  };

  // Fetch full member profiles whenever group membership changes
  useEffect(() => {
    if (!isGroup || liveParticipantIds.length === 0) { setGroupMembers([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users').select('id, username, display_name, avatar_url, last_seen_at, status_emoji, status_text')
        .in('id', liveParticipantIds);
      if (error) { console.warn('Failed to load group members:', error.message); return; }
      if (!cancelled && data) setGroupMembers((data as UserRow[]).map(rowToUser));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, liveParticipantIds.join(',')]);

  const memberMap = useMemo(() => {
    const map = new Map<string, User>();
    map.set(currentUser.id, currentUser);
    if (isGroup) groupMembers.forEach(m => map.set(m.id, m));
    else if (partner) map.set(partner.id, partner);
    return map;
  }, [currentUser, isGroup, groupMembers, partner]);

  const nameFor = useCallback((id: string): string => {
    if (id === currentUser.id) return 'You';
    const u = memberMap.get(id);
    return u ? `@${u.username}` : 'someone';
  }, [memberMap, currentUser.id]);

  const loadMore = useCallback(async () => {
    if (!chatId || loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const { data } = await supabase.from('messages').select('*')
      .eq('conversation_id', chatId)
      .lt('created_at', oldestTimestampRef.current!)
      .order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (data) {
      const older = data.reverse().map(mapRow);
      setMessages(prev => [...older, ...prev]);
      hasMoreRef.current = data.length === PAGE_SIZE;
      setHasMore(data.length === PAGE_SIZE);
      if (older.length > 0) oldestTimestampRef.current = older[0].timestamp;
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [chatId]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setNewMsgCount(0);
    if (el.scrollTop < 80) loadMore();
  }, [loadMore]);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const scrollToBottom = useCallback(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, []);
  const scrollToMessage = (id: string) => {
    const el = messageRefs.current.get(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-cyan-500/50', 'rounded-xl'); setTimeout(() => el.classList.remove('ring-2', 'ring-cyan-500/50', 'rounded-xl'), 1500); }
  };

  useEffect(() => { if (conversation) setTimeout(() => textareaRef.current?.focus(), 120); }, [conversation]);
  useEffect(() => { if (replyingTo) textareaRef.current?.focus(); }, [replyingTo]);
  useEffect(() => { if (isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 100); }, [isSearchOpen]);

  useEffect(() => {
    if (!emojiPickerFor) return;
    const h = (e: MouseEvent) => { if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setEmojiPickerFor(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [emojiPickerFor]);

  useEffect(() => {
    if (!reactionPickerFor) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(t)) setReactionPickerFor(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [reactionPickerFor]);

  useEffect(() => {
    if (!conversation || !chatId) return;
    setLoading(true); setMessages([]); setReactions({});
    setTypingUserIds(new Set());
    typingTimeoutsRef.current.forEach(t => clearTimeout(t)); typingTimeoutsRef.current.clear();
    setEditingId(null); setReplyingTo(null); setExpandedOriginals(new Set());
    setOtherReads(new Map()); setPartnerLastSeen(null); setPinnedMessage(null);
    setIsSearchOpen(false); setSearchQuery(''); setShowVoiceRecorder(false);
    setNewMsgCount(0); isAtBottomRef.current = true; setIsAtBottom(true);
    setFirstUnreadId(null); setHasMore(false); setLoadingMore(false);
    hasMoreRef.current = false; loadingMoreRef.current = false; oldestTimestampRef.current = null;
    setLiveName(conversation.name); setLiveAvatarUrl(conversation.avatarUrl);
    setLiveParticipantIds(conversation.participantIds); setLiveCreatedBy(conversation.createdBy);
    setShowGroupInfo(false);

    const loadAll = async () => {
      // Messages — load newest PAGE_SIZE, descending then reverse
      const { data } = await supabase.from('messages').select('*')
        .eq('conversation_id', chatId).order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (data) {
        const msgs = data.reverse().map(mapRow);
        setMessages(msgs);
        hasMoreRef.current = data.length === PAGE_SIZE;
        setHasMore(data.length === PAGE_SIZE);
        if (msgs.length > 0) oldestTimestampRef.current = msgs[0].timestamp;

        // Unread divider: find first other-sender message after my last read
        const { data: myRead } = await supabase.from('conversation_reads')
          .select('last_read_at').eq('user_id', currentUser.id).eq('conversation_id', chatId).maybeSingle();
        if (myRead?.last_read_at) {
          const cutoff = new Date(myRead.last_read_at);
          const first = msgs.find(m => m.senderId !== currentUser.id && new Date(m.timestamp) > cutoff);
          setFirstUnreadId(first?.id ?? null);
        }

        if (msgs.length > 0) {
          const { data: rxData } = await supabase.from('message_reactions')
            .select('message_id, user_id, emoji').in('message_id', msgs.map(m => m.id));
          if (rxData) {
            const map: Record<string, ReactionsMap> = {};
            rxData.forEach((r: any) => {
              if (!map[r.message_id]) map[r.message_id] = {};
              if (!map[r.message_id][r.emoji]) map[r.message_id][r.emoji] = [];
              map[r.message_id][r.emoji].push(r.user_id);
            });
            setReactions(map);
          }
        }
      }

      // Everyone else's last read (for read receipts — works for DMs and groups alike)
      const { data: readsData } = await supabase.from('conversation_reads')
        .select('user_id, last_read_at').eq('conversation_id', chatId).neq('user_id', currentUser.id);
      if (readsData) {
        const map = new Map<string, Date>();
        readsData.forEach((r: { user_id: string; last_read_at: string }) => map.set(r.user_id, new Date(r.last_read_at)));
        setOtherReads(map);
      }

      // Partner's last seen (DM only)
      if (!isGroup && partner) {
        const { data: userData } = await supabase.from('users')
          .select('last_seen_at').eq('id', partner.id).maybeSingle();
        if (userData?.last_seen_at) setPartnerLastSeen(userData.last_seen_at);
      }

      // Pinned message
      const { data: pinData } = await supabase.from('pinned_messages')
        .select('*').eq('conversation_id', chatId).order('pinned_at', { ascending: false }).limit(1).maybeSingle();
      if (pinData) setPinnedMessage({
        id: pinData.id, messageId: pinData.message_id, conversationId: pinData.conversation_id,
        messageContent: pinData.message_content, messageType: pinData.message_type,
        pinnedBy: pinData.pinned_by, pinnedAt: pinData.pinned_at,
      });

      setLoading(false);
      // Force scroll to bottom using direct DOM manipulation for reliability
      const forceScrollToBottom = () => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      };
      // Primary scroll for initial messages
      setTimeout(forceScrollToBottom, 50);
      // Secondary scroll to catch any delayed-loaded messages
      setTimeout(forceScrollToBottom, 250);
    };

    loadAll();

    // Message realtime
    const msgChannel = supabase.channel(`messages:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` },
        ({ new: m }) => {
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, mapRow(m)]);
          if (m.sender_id !== currentUser.id && !isAtBottomRef.current) setNewMsgCount(prev => prev + 1);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` },
        ({ new: m }) => setMessages(prev => prev.map(x => x.id === m.id ? mapRow(m) : x)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` },
        ({ old: m }) => setMessages(prev => prev.filter(x => x.id !== m.id)))
      .subscribe();

    // Reactions realtime
    const rxChannel = supabase.channel(`reactions:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: r }) => {
        if (!messagesRef.current.some(m => m.id === r.message_id)) return;
        setReactions(prev => { const n = { ...prev }; if (!n[r.message_id]) n[r.message_id] = {}; if (!n[r.message_id][r.emoji]) n[r.message_id][r.emoji] = []; if (!n[r.message_id][r.emoji].includes(r.user_id)) n[r.message_id][r.emoji] = [...n[r.message_id][r.emoji], r.user_id]; return n; });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old: r }) => {
        if (!messagesRef.current.some(m => m.id === r.message_id)) return;
        setReactions(prev => { const n = { ...prev }; if (!n[r.message_id]?.[r.emoji]) return prev; const f = n[r.message_id][r.emoji].filter(id => id !== r.user_id); if (f.length === 0) { const { [r.emoji]: _, ...rest } = n[r.message_id]; n[r.message_id] = rest; } else { n[r.message_id][r.emoji] = f; } return n; });
      }).subscribe();

    // Typing — generalized to track any number of other typists (works for DMs and groups)
    const typingChannel = supabase.channel(`typing:${chatId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const uid = payload.userId as string;
        if (uid === currentUser.id) return;
        setTypingUserIds(prev => new Set(prev).add(uid));
        const timeouts = typingTimeoutsRef.current;
        if (timeouts.has(uid)) clearTimeout(timeouts.get(uid)!);
        timeouts.set(uid, setTimeout(() => {
          setTypingUserIds(prev => { const n = new Set(prev); n.delete(uid); return n; });
          timeouts.delete(uid);
        }, 2000));
      }).subscribe();
    typingChannelRef.current = typingChannel;

    // Read receipts realtime — any member's read row, not just one partner's
    const readsChannel = supabase.channel(`reads:${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${chatId}` }, ({ new: r }) => {
        const row = r as { user_id: string; last_read_at: string } | undefined;
        if (!row || row.user_id === currentUser.id) return;
        setOtherReads(prev => new Map(prev).set(row.user_id, new Date(row.last_read_at)));
      }).subscribe();

    // Pinned messages realtime
    const pinChannel = supabase.channel(`pins:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pinned_messages' }, ({ new: p }) => {
        if (p.conversation_id === chatId) setPinnedMessage({ id: p.id, messageId: p.message_id, conversationId: p.conversation_id, messageContent: p.message_content, messageType: p.message_type, pinnedBy: p.pinned_by, pinnedAt: p.pinned_at });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pinned_messages' }, ({ old: p }) => {
        if (p.conversation_id === chatId) setPinnedMessage(null);
      }).subscribe();

    // Conversation metadata realtime — group renames/avatar/membership changes (or deletion)
    const convChannel = supabase.channel(`conv-meta:${chatId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${chatId}` }, ({ new: row }) => {
        setLiveName(row.name ?? ''); setLiveAvatarUrl(row.avatar_url ?? undefined);
        setLiveParticipantIds(row.participants ?? []); setLiveCreatedBy(row.created_by ?? undefined);
        if (row.is_group && !(row.participants ?? []).includes(currentUser.id)) onLeftGroup?.();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversations', filter: `id=eq.${chatId}` }, () => {
        onLeftGroup?.();
      }).subscribe();

    return () => {
      supabase.removeChannel(msgChannel); supabase.removeChannel(rxChannel);
      supabase.removeChannel(typingChannel); supabase.removeChannel(readsChannel);
      supabase.removeChannel(pinChannel); supabase.removeChannel(convChannel);
      typingChannelRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutsRef.current.forEach(t => clearTimeout(t)); typingTimeoutsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, currentUser.id, scrollToBottom]);

  // Auto-scroll: always on own messages, only if at bottom for others' messages
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.senderId === currentUser.id || isAtBottomRef.current) {
      scrollToBottom();
      setNewMsgCount(0);
    }
  }, [messages]);

  const typingLabel = useMemo(() => formatTypingLabel(Array.from(typingUserIds).map(nameFor)), [typingUserIds, nameFor]);
  useEffect(() => { if (isAtBottomRef.current) scrollToBottom(); }, [typingLabel]);

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = LIST_LINE_HEIGHT_PX * MAX_TEXTAREA_LINES;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    autoResizeTextarea();
    if (conversation && typingChannelRef.current)
      typingChannelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser.id } });
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        let file = item.getAsFile(); if (!file) return;
        if (file.size > MAX_IMAGE_SIZE) { alert('Image must be under 8 MB'); return; }
        file = await compressImage(file);
        setMediaFile(file); setMediaType('image'); setMediaPreview(URL.createObjectURL(file)); return;
      }
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) { setInput(prev => prev + emoji); return; }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next); setShowEmojiPicker(false);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = start + emoji.length; }, 0);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0]; if (!file) return;
    const mt = getMediaType(file);
    if (!mt || mt === 'audio') { alert('Unsupported file type'); return; }
    const limit = mt === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > limit) { alert(`${mt === 'video' ? 'Video' : 'Image'} must be under ${mt === 'video' ? '80' : '8'} MB`); return; }
    if (mt === 'image') file = await compressImage(file);
    setMediaFile(file); setMediaType(mt); setMediaPreview(URL.createObjectURL(file));
  };

  const cancelMedia = () => { setMediaFile(null); setMediaPreview(null); setMediaType(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  // Groups are created up front (via the New Group flow), so this only ever needs to lazily
  // create the row for a brand-new DM — a group conversation always already exists.
  const ensureConversation = async (id: string) => {
    if (isGroup) return;
    const { data } = await supabase.from('conversations').select('id').eq('id', id).single();
    if (!data) await supabase.from('conversations').insert({ id, participants: [currentUser.id, partner!.id], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  };
  const bumpConversation = (id: string) => supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id);
  const buildReplyPayload = () => replyingTo ? { reply_to_id: replyingTo.id, reply_to_sender_id: replyingTo.senderId, reply_to_message_type: replyingTo.messageType, reply_to_content: replyingTo.messageType === 'text' ? replyingTo.content : replyingTo.messageType === 'image' ? '📷 Image' : replyingTo.messageType === 'audio' ? '🎤 Voice' : '🎥 Video' } : {};

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !chatId) return;
    const text = input.trim();
    const replyPayload = buildReplyPayload();
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id, senderId: currentUser.id, content: text,
      timestamp: new Date().toISOString(), messageType: 'text', isEdited: false,
      replyToId: replyPayload.reply_to_id, replyToContent: replyPayload.reply_to_content,
      replyToSenderId: replyPayload.reply_to_sender_id, replyToMessageType: replyPayload.reply_to_message_type,
    };
    // Optimistically show the message immediately — no waiting for the realtime echo.
    setMessages(prev => prev.some(x => x.id === id) ? prev : [...prev, optimistic]);
    setInput(''); setReplyingTo(null);
    setEmojiPickerFor(null);
    // Reset the auto-grown textarea height back to a single line
    const ta = textareaRef.current;
    if (ta) { ta.style.height = `${LIST_LINE_HEIGHT_PX}px`; ta.style.overflowY = 'hidden'; }
    if (chatId) onMarkConversationRead?.(chatId);
    try {
      await ensureConversation(chatId);
      await supabase.from('messages').insert({ id, conversation_id: chatId, sender_id: currentUser.id, content: text, message_type: 'text', created_at: optimistic.timestamp, ...replyPayload });
      await bumpConversation(chatId);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleSendMedia = async () => {
    if (!mediaFile || !mediaType || !chatId || uploading) return;
    setUploading(true);
    try {
      await ensureConversation(chatId);
      const ext = mediaFile.name.split('.').pop();
      const path = `${chatId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('chat-images').upload(path, mediaFile);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('chat-images').getPublicUrl(path);
      await supabase.from('messages').insert({ conversation_id: chatId, sender_id: currentUser.id, content: mediaFile.name, message_type: mediaType, image_url: publicUrl, created_at: new Date().toISOString(), ...buildReplyPayload() });
      await bumpConversation(chatId);
      cancelMedia(); setReplyingTo(null);
    } catch (err) { console.error('Upload failed:', err); }
    finally { setUploading(false); }
  };

  const handleSendVoice = async (file: File) => {
    if (!chatId) return;
    setShowVoiceRecorder(false);
    try {
      await ensureConversation(chatId);
      const path = `${chatId}/${file.name}`;
      const { error } = await supabase.storage.from('chat-images').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('chat-images').getPublicUrl(path);
      await supabase.from('messages').insert({ conversation_id: chatId, sender_id: currentUser.id, content: '🎤 Voice message', message_type: 'audio', image_url: publicUrl, created_at: new Date().toISOString(), ...buildReplyPayload() });
      await bumpConversation(chatId);
      setReplyingTo(null);
    } catch (err) { console.error('Voice upload failed:', err); }
  };

  const startEdit = (msg: Message) => { setEditingId(msg.id); setEditContent(msg.content); setTimeout(() => editInputRef.current?.focus(), 50); };
  const cancelEdit = () => { setEditingId(null); setEditContent(''); };
  const saveEdit = async (msg: Message) => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === msg.content) { cancelEdit(); return; }
    await supabase.from('messages').update({ content: trimmed, is_edited: true, original_content: msg.isEdited ? msg.originalContent : msg.content }).eq('id', msg.id);
    cancelEdit();
  };
  const handleDelete = async (id: string) => supabase.from('messages').delete().eq('id', id);

  const toggleReaction = async (msgId: string, emoji: string) => {
    const existing = reactions[msgId]?.[emoji] ?? [];
    const hasReacted = existing.includes(currentUser.id);
    setEmojiPickerFor(null);
    setReactionPickerFor(null);
    if (hasReacted) { await supabase.from('message_reactions').delete().eq('message_id', msgId).eq('user_id', currentUser.id).eq('emoji', emoji); }
    else { await supabase.from('message_reactions').insert({ message_id: msgId, user_id: currentUser.id, emoji }); }
  };

  const handlePinMessage = async (msg: Message) => {
    if (!chatId) return;
    if (pinnedMessage?.messageId === msg.id) {
      // Optimistic update first — don't wait for realtime
      const id = pinnedMessage.id;
      setPinnedMessage(null);
      await supabase.from('pinned_messages').delete().eq('id', id);
    } else {
      if (pinnedMessage) await supabase.from('pinned_messages').delete().eq('id', pinnedMessage.id);
      await supabase.from('pinned_messages').insert({
        conversation_id: chatId, message_id: msg.id,
        message_content: msg.messageType === 'text' ? msg.content : msg.messageType === 'image' ? '📷 Image' : msg.messageType === 'audio' ? '🎤 Voice' : '🎥 Video',
        message_type: msg.messageType, pinned_by: currentUser.id, pinned_at: new Date().toISOString(),
      });
    }
  };

  const toggleOriginal = (id: string) => setExpandedOriginals(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const getReplyLabel = (msg: Message): string => {
    const senderName = nameFor(msg.senderId);
    if (msg.replyToSenderId === msg.senderId) return `${senderName} replied to ${msg.senderId === currentUser.id ? 'yourself' : 'themselves'}`;
    if (msg.senderId === currentUser.id) return `You replied to ${nameFor(msg.replyToSenderId!)}`;
    if (msg.replyToSenderId === currentUser.id) return `${senderName} replied to you`;
    return `${senderName} replied to ${nameFor(msg.replyToSenderId!)}`;
  };

  const displayMessages = isSearchOpen && searchQuery.trim()
    ? messages.filter(m => m.messageType === 'text' && m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  // Format date for day separators
  const formatDateSeparator = (date: Date): string => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    
    const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined };
    return date.toLocaleDateString(undefined, options);
  };

  // Check if we need a date separator before a message
  const needsDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const current = new Date(displayMessages[index].timestamp);
    const previous = new Date(displayMessages[index - 1].timestamp);
    return current.toDateString() !== previous.toDateString();
  };

  const isPartnerOnline = !isGroup && partner ? onlineUserIds.includes(partner.id) : false;
  const onlineMembersCount = isGroup
    ? liveParticipantIds.filter(id => id !== currentUser.id && onlineUserIds.includes(id)).length
    : 0;

  if (!conversation || !chatId) {
    return (
      <div className="chat-pane glass-panel relative flex-1 flex flex-col items-center justify-center bg-[var(--surface2)] max-h-full m-0 rounded-[32px] overflow-hidden text-[var(--txt3)] min-w-0">
        <div className="caustic-orb w-[29rem] h-[29rem] -right-40 -top-40 opacity-35 pointer-events-none" />
        <div className="caustic-orb w-[22rem] h-[22rem] -left-32 -bottom-36 opacity-20 pointer-events-none" />
        {onBackToSidebar && (
          <button onClick={onBackToSidebar}
            className="absolute top-5 left-5 z-10 flex items-center gap-2 text-sm text-[var(--txt2)] hover:text-[var(--txt)] transition-colors">
            <ArrowLeft className="w-4 h-4" /> Chats
          </button>
        )}
        <div className="relative z-10 mx-6 max-w-sm text-center">
          <div className="glass-panel-strong mx-auto grid w-20 h-20 place-items-center rounded-[28px] shadow-[0_18px_45px_rgba(0,0,0,.22)]">
            <MessageSquareDashed className="w-9 h-9 text-[var(--accent)]" />
          </div>
          <p className="mt-7 text-[10px] font-bold uppercase tracking-[.2em] text-[var(--accent)]">Your space</p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-[-.045em] text-[var(--txt)]">Pick up a conversation.</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--txt2)]">Choose someone from your recent chats, search for a person, or make a new group when the conversation needs a room.</p>
          <div className="mt-7 flex justify-center gap-2">
            <span className="glass-panel rounded-full px-3 py-1.5 text-[11px] text-[var(--txt2)]">Private by default</span>
            <span className="glass-panel rounded-full px-3 py-1.5 text-[11px] text-[var(--txt2)]">Made for people</span>
          </div>
        </div>
      </div>
    );
  }

  const headerAvatarUser = isGroup ? ({ id: chatId, username: liveName, avatarUrl: liveAvatarUrl } as User) : partner!;
  const headerName = isGroup ? liveName : (partner?.displayName || `@${partner?.username}`);
  const firstTyperId = Array.from(typingUserIds)[0];
  const firstTyper = firstTyperId ? memberMap.get(firstTyperId) : undefined;

  return (
    <div className="chat-pane glass-panel relative flex-1 flex flex-col bg-[var(--surface2)] max-h-full m-0 rounded-[32px] overflow-hidden text-[var(--txt)] min-w-0 overflow-x-hidden" style={currentChatTheme.variables}>

      {/* Header */}
      <div className="h-20 border-b border-[var(--border)] bg-[var(--surface)] px-7 flex items-center gap-4 shrink-0 backdrop-blur-xl">
        {/* Back button — mobile only */}
        {onBackToSidebar && (
          <button onClick={onBackToSidebar}
            className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-[var(--txt2)] hover:text-[var(--txt)] hover:bg-[var(--surface3)] transition-colors flex-shrink-0"
            title="Back to chats">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={() => isGroup && setShowGroupInfo(true)}
          className={cn('flex items-center gap-3 flex-1 min-w-0 text-left', isGroup ? 'cursor-pointer' : 'cursor-default')}
        >
          <Avatar user={headerAvatarUser} size="md" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{headerName}</div>
            <div className="text-[10px] flex items-center gap-1.5 flex-wrap">
              {isGroup ? (
                <>
                  <span className="text-[var(--txt3)]">{liveParticipantIds.length} members</span>
                  {onlineMembersCount > 0 && <span className="text-green-400">· {onlineMembersCount} online</span>}
                </>
              ) : (
                <>
                  {partner?.displayName && <span className="text-[var(--txt3)]">@{partner.username}</span>}
                  {(partner?.statusEmoji || partner?.statusText) && (
                    <span className="text-[var(--txt3)]">{partner.statusEmoji} {partner.statusText}</span>
                  )}
                  {!partner?.statusText && (isPartnerOnline
                    ? <span className="text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-400 rounded-full inline-block" />Online</span>
                    : partnerLastSeen
                      ? <span className="text-[var(--txt3)]">Last seen {formatLastSeen(partnerLastSeen)}</span>
                      : <span className="text-[var(--txt3)]">Offline</span>
                  )}
                </>
              )}
            </div>
          </div>
        </button>
        {!isGroup && !isPartnerOnline && !partnerLastSeen && (
          <div className="ml-1 px-2 py-0.5 rounded bg-cyan-900/20 border border-cyan-800/40 text-[10px] text-cyan-400 font-mono">LIVE</div>
        )}
        {isGroup && (
          <button onClick={() => setShowGroupInfo(true)}
            className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800 transition-colors flex-shrink-0"
            title="Group info">
            <Info className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => setShowChatThemes(true)}
          className="w-9 h-9 rounded-xl border border-[var(--border)] bg-[var(--surface3)] flex items-center justify-center text-[var(--txt3)] hover:text-[var(--accent)] hover:border-[var(--border3)] transition-colors flex-shrink-0"
          title="Choose chat theme">
          <Palette className="w-4 h-4" />
        </button>
        <button onClick={() => setShowWingman(o => !o)}
          className={cn('h-8 rounded-lg border px-2.5 flex items-center gap-1.5 transition-colors flex-shrink-0',
            showWingman ? 'border-violet-500/70 bg-violet-600/20 text-violet-300' : 'border-[var(--border)] text-[var(--txt3)] hover:border-violet-500/60 hover:text-violet-300')}
          title="Ask Wingman AI">
          <Sparkles className="w-4 h-4" />
          <span className="text-[11px] font-medium leading-none">Ask Wingman AI</span>
        </button>
        <button onClick={() => { setIsSearchOpen(o => !o); setSearchQuery(''); }}
          className={cn('w-8 h-8 rounded-lg border flex items-center justify-center transition-colors flex-shrink-0',
            isSearchOpen ? 'border-cyan-700 bg-cyan-900/20 text-cyan-400' : 'border-[var(--border)] text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800')}
          title="Search messages">
          {isSearchOpen ? <SearchX className="w-4 h-4" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {/* Wingman AI assistant */}
      <AnimatePresence>
        {showWingman && chatId && (
          <WingmanPanel conversationId={chatId} onClose={() => setShowWingman(false)} />
        )}
      </AnimatePresence>
      {showChatThemes && <ChatThemePicker activeThemeId={chatThemeId} onSelect={applyChatTheme} onClose={() => setShowChatThemes(false)} />}

      {/* Search bar */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
            <div className="px-4 py-2.5">
              <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search in this conversation…"
                className="w-full bg-[var(--surface3)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-600 text-[var(--txt)] placeholder-[var(--txt3)]" />
              {searchQuery.trim() && (
                <div className="text-[11px] text-[var(--txt3)] mt-1.5 px-1">
                  {displayMessages.length === 0 ? 'No messages found' : `${displayMessages.length} message${displayMessages.length !== 1 ? 's' : ''} found`}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pinned message banner */}
      <AnimatePresence>
        {pinnedMessage && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
            <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--surface3)] transition-colors"
              onClick={() => scrollToMessage(pinnedMessage.messageId)}>
              <Pin className="w-3 h-3 text-cyan-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-cyan-400 font-medium leading-none mb-0.5">Pinned Message</div>
                <div className="text-xs text-[var(--txt2)] truncate">{pinnedMessage.messageContent}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); const id = pinnedMessage.id; setPinnedMessage(null); supabase.from('pinned_messages').delete().eq('id', id); }}
                className="text-[var(--txt3)] hover:text-[var(--txt)] transition-colors flex-shrink-0 p-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll}
          onClick={() => { if (chatId) onMarkConversationRead?.(chatId); }}
          className="chat-scroll flex-1 overflow-y-auto p-6 md:p-9 relative">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-[var(--border)] border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex flex-col items-center opacity-30 mt-20">
            <p className="text-[var(--txt2)]">
              {isSearchOpen && searchQuery ? `No messages matching "${searchQuery}"` : isGroup ? `Say hello to ${liveName}!` : `Say hello to @${partner?.username}!`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col space-y-1">
            {/* Load more indicator */}
            {loadingMore && (
              <div className="flex justify-center py-3">
                <div className="w-4 h-4 border-2 border-[var(--border)] border-t-cyan-500 rounded-full animate-spin" />
              </div>
            )}
            {hasMore && !loadingMore && (
              <button onClick={loadMore}
                className="text-xs text-[var(--txt3)] hover:text-cyan-400 transition-colors py-2 text-center">
                Load earlier messages
              </button>
            )}
            {displayMessages.map((msg, i) => {
              const isMe = msg.senderId === currentUser.id;
              const grouped = !msg.replyToId && displayMessages[i - 1]?.senderId === msg.senderId && !displayMessages[i-1]?.replyToId;
              const isEditing = editingId === msg.id;
              const isHovered = hoveredId === msg.id;
              const origExpanded = expandedOriginals.has(msg.id);
              const msgReactions = reactions[msg.id] ?? {};
              const hasReactions = Object.keys(msgReactions).length > 0;
              const quotedIsMe = msg.replyToSenderId === currentUser.id;
              const isRead = isMe && Array.from(otherReads.values()).some(d => d >= new Date(msg.timestamp));
              const readByNames = isMe && isGroup
                ? Array.from(otherReads.entries()).filter(([, d]) => d >= new Date(msg.timestamp)).map(([id]) => nameFor(id))
                : [];
              const firstUrl = msg.messageType === 'text' && msg.content ? extractFirstUrl(msg.content) : null;
              const isPinned = pinnedMessage?.messageId === msg.id;
              const sender = isMe ? currentUser : (memberMap.get(msg.senderId) ?? { id: msg.senderId, username: 'unknown' } as User);
              const showSenderLabel = isGroup && !isMe && !grouped;

              return (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  ref={el => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}
                  className={cn('flex flex-col transition-all', grouped ? 'mt-0.5' : 'mt-5', isPinned ? 'bg-cyan-500/5 rounded-xl -mx-2 px-2' : '')}>

                  {/* Day separator */}
                  {needsDateSeparator(i) && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-[var(--border)]" />
                      <span className="text-[11px] text-[var(--txt3)] font-medium px-2 whitespace-nowrap">
                        {formatDateSeparator(new Date(msg.timestamp))}
                      </span>
                      <div className="flex-1 h-px bg-[var(--border)]" />
                    </div>
                  )}

                  {/* Unread divider */}
                  {firstUnreadId === msg.id && (
                    <div className="flex items-center gap-3 my-3 -mx-1">
                      <div className="flex-1 h-px bg-red-500/25" />
                      <span className="text-[10px] text-red-400 font-semibold uppercase tracking-wide whitespace-nowrap">New Messages</span>
                      <div className="flex-1 h-px bg-red-500/25" />
                    </div>
                  )}

                  {/* Reply label */}
                  {msg.replyToId && (
                    <div className={cn('text-[11px] text-[var(--txt3)] mb-1.5 flex items-center gap-1', isMe ? 'justify-end pr-12' : 'pl-12')}>
                      <CornerUpLeft className="w-3 h-3" />{getReplyLabel(msg)}
                    </div>
                  )}

                  {/* Sender name label (group chats only) */}
                  {showSenderLabel && (
                    <div className={cn('text-[11px] font-medium mb-1 pl-12', colorForSender(msg.senderId))}>
                      {sender.displayName || `@${sender.username}`}
                    </div>
                  )}

                  {/* Row */}
                  <div className={cn('flex items-end gap-2', isMe ? 'flex-row-reverse' : 'flex-row')}
                    onMouseEnter={() => setHoveredId(msg.id)}
                    onMouseLeave={() => { if (emojiPickerFor !== msg.id) setHoveredId(null); }}>

                    {/* Avatar */}
                    <div className="flex-shrink-0 self-end mb-1">
                      {grouped ? <div className="w-10 h-10" /> : <Avatar user={sender} size="md" isCurrentUser={isMe} />}
                    </div>

                    {/* Bubble column */}
                    <div className={cn('flex flex-col max-w-[52%]', isMe ? 'items-end' : 'items-start')}>
                      {/* Quoted bubble */}
                      {msg.replyToId && (
                        <div className={cn('px-3 py-2 rounded-xl text-xs mb-1 max-w-full border cursor-default select-none',
                          quotedIsMe ? 'bg-cyan-950/70 border-cyan-900/40 text-cyan-100/50' : 'bg-[var(--surface4)] border-[var(--border)] text-[var(--txt3)]')}>
                          {msg.replyToContent ?? '(deleted message)'}
                        </div>
                      )}

                      {/* Main bubble */}
                      {isEditing ? (
                        <div className="w-full bg-[var(--surface3)] border border-cyan-700/50 rounded-xl p-3 space-y-2">
                          <textarea ref={editInputRef} value={editContent} onChange={e => setEditContent(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msg); } if (e.key === 'Escape') cancelEdit(); }}
                            className="w-full bg-transparent text-sm text-[var(--txt)] resize-none outline-none min-h-[40px]" rows={2} />
                          <div className="flex gap-2 justify-end">
                            <button onClick={cancelEdit} className="text-[10px] text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors">Cancel</button>
                            <button onClick={() => saveEdit(msg)} className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                              <Check className="w-3 h-3" /> Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={cn(
                          'relative px-4 py-2.5 text-sm leading-relaxed break-words max-w-full',
                          isMe
                            ? 'bg-[var(--bubble-me-bg)] border border-[var(--bubble-me-border)] text-[var(--bubble-me-text)] rounded-tl-2xl rounded-bl-2xl rounded-br-2xl backdrop-blur-xl shadow-[inset_0_1px_rgba(255,255,255,.18),0_10px_24px_rgba(var(--accent-rgb),.08)]'
                            : 'bg-[var(--bubble-them-bg)] border border-[var(--bubble-them-border)] text-[var(--txt)] rounded-tr-2xl rounded-br-2xl rounded-bl-2xl backdrop-blur-xl shadow-[inset_0_1px_rgba(255,255,255,.09),0_10px_24px_rgba(0,0,0,.08)]',
                          grouped && isMe && !msg.replyToId ? 'rounded-tr-md' : '',
                          grouped && !isMe && !msg.replyToId ? 'rounded-tl-md' : '',
                        )}>
                          {msg.messageType === 'image' && msg.mediaUrl ? (
                            <img src={msg.mediaUrl} alt="image"
                              className="max-w-[280px] max-h-[320px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => setLightbox({ url: msg.mediaUrl!, type: 'image' })} />
                          ) : msg.messageType === 'video' && msg.mediaUrl ? (
                            <div className="relative max-w-[280px]">
                              <video src={msg.mediaUrl} className="max-w-full max-h-[320px] rounded-lg object-contain" preload="metadata" />
                              <div className="absolute inset-0 flex items-center justify-center cursor-pointer group/play"
                                onClick={() => setLightbox({ url: msg.mediaUrl!, type: 'video' })}>
                                <div className="w-10 h-10 rounded-full bg-black/60 border border-white/20 flex items-center justify-center group-hover/play:bg-black/80 transition-colors">
                                  <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                                </div>
                              </div>
                            </div>
                          ) : msg.messageType === 'audio' && msg.mediaUrl ? (
                            <AudioPlayer url={msg.mediaUrl} />
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap">{renderTextWithLinks(msg.content)}</p>
                              {firstUrl && <LinkPreview url={firstUrl} isMe={isMe} />}
                            </>
                          )}
                        </div>
                      )}

                      {/* Reactions */}
                      {hasReactions && (
                        <div className={cn('flex flex-wrap gap-1 mt-1.5', isMe ? 'justify-end' : 'justify-start')}>
                          {Object.entries(msgReactions).map(([emoji, userIds]) => {
                            const mine = userIds.includes(currentUser.id);
                            const tooltip = formatReactors(userIds, nameFor);
                            return (
                              <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                                title={tooltip}
                                aria-label={`${emoji} reaction — ${tooltip}`}
                                className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all',
                                  mine ? 'bg-cyan-900/30 border-cyan-700/50 text-cyan-300' : 'bg-[var(--surface3)] border-[var(--border)] text-[var(--txt2)] hover:border-[var(--border3)]')}>
                                <span>{emoji}</span>
                                {userIds.length > 1 && <span className="text-[10px] font-medium">{userIds.length}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Edited indicator */}
                      {msg.isEdited && !isEditing && (
                        <button onClick={() => toggleOriginal(msg.id)}
                          className="flex items-center gap-1 mt-0.5 text-[10px] text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors">
                          <span className="italic">edited</span>
                          <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', origExpanded ? 'rotate-180' : '')} />
                        </button>
                      )}
                      <AnimatePresence>
                        {msg.isEdited && origExpanded && msg.originalContent && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--txt3)] italic max-w-full break-words">
                              <span className="text-[var(--txt3)] not-italic font-medium">Original: </span>{msg.originalContent}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Timestamp + read receipt */}
                      <div className={cn('flex items-center gap-1 text-[10px] text-[var(--txt4)] px-1 mt-0.5', isMe ? 'flex-row-reverse' : '')}>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isMe && !isEditing && (
                          isRead
                            ? <span title={readByNames.length ? `Read by ${readByNames.join(', ')}` : 'Read'}><CheckCheck className="w-3 h-3 text-cyan-400" /></span>
                            : <Check className="w-3 h-3 text-[var(--txt4)]" />
                        )}
                      </div>
                    </div>

                    {/* Hover actions */}
                    {!isEditing && (
                      <div className={cn('flex items-center gap-1 self-center mb-1 transition-opacity relative',
                        isHovered || emojiPickerFor === msg.id || reactionPickerFor === msg.id ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
                        {/* Emoji popover */}
                        {emojiPickerFor === msg.id && (
                          <div ref={emojiPickerRef}
                            className={cn('absolute bottom-9 z-20 flex gap-1 p-1.5 bg-[var(--surface4)] border border-[var(--border3)] rounded-xl shadow-2xl', isMe ? 'right-0' : 'left-0')}>
                            {EMOJI_SET.map(emoji => (
                              <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                                className="w-8 h-8 text-lg flex items-center justify-center rounded-lg hover:bg-[var(--surface3)] transition-colors">{emoji}</button>
                            ))}
                            <button onClick={() => { setEmojiPickerFor(null); setReactionPickerFor(msg.id); }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--txt3)] hover:bg-[var(--surface3)] hover:text-cyan-400 transition-colors"
                              title="All emoji"
                              aria-label="Show all emoji">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {/* Full emoji picker */}
                        {reactionPickerFor === msg.id && (
                          <div ref={reactionPickerRef}
                            className={cn('absolute bottom-9 z-20', isMe ? 'right-0' : 'left-0')}>
                            <EmojiPicker align={isMe ? 'right' : 'left'}
                              onSelect={(emoji) => toggleReaction(msg.id, emoji)}
                              onClose={() => setReactionPickerFor(null)} />
                          </div>
                        )}
                        {/* Forward */}
                        <button onClick={() => setForwardingMsg(msg)}
                          className="w-7 h-7 rounded-md bg-[var(--surface3)] border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800 transition-colors"
                          title="Forward message"><Forward className="w-3.5 h-3.5" /></button>
                        {/* Reply */}
                        <button onClick={() => setReplyingTo(replyingTo?.id === msg.id ? null : msg)}
                          className={cn('w-7 h-7 rounded-md bg-[var(--surface3)] border flex items-center justify-center transition-colors',
                            replyingTo?.id === msg.id ? 'border-cyan-700 text-cyan-400' : 'border-[var(--border)] text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800')}
                          title="Reply"><CornerUpLeft className="w-3.5 h-3.5" /></button>
                        {/* React */}
                        <button onClick={() => setEmojiPickerFor(prev => prev === msg.id ? null : msg.id)}
                          className={cn('w-7 h-7 rounded-md bg-[var(--surface3)] border flex items-center justify-center transition-colors',
                            emojiPickerFor === msg.id ? 'border-cyan-700 text-cyan-400' : 'border-[var(--border)] text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800')}
                          title="React"><Smile className="w-3.5 h-3.5" /></button>
                        {/* Pin */}
                        <button onClick={() => handlePinMessage(msg)}
                          className={cn('w-7 h-7 rounded-md bg-[var(--surface3)] border flex items-center justify-center transition-colors',
                            pinnedMessage?.messageId === msg.id ? 'border-cyan-700 text-cyan-400' : 'border-[var(--border)] text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800')}
                          title={pinnedMessage?.messageId === msg.id ? 'Unpin' : 'Pin message'}>
                          {pinnedMessage?.messageId === msg.id ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                        {/* Edit */}
                        {isMe && msg.messageType === 'text' && (
                          <button onClick={() => startEdit(msg)}
                            className="w-7 h-7 rounded-md bg-[var(--surface3)] border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800 transition-colors"
                            title="Edit"><Pencil className="w-3 h-3" /></button>
                        )}
                        {/* Delete */}
                        {isMe && (
                          <button onClick={() => handleDelete(msg.id)}
                            className="w-7 h-7 rounded-md bg-[var(--surface3)] border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-red-400 hover:border-red-900 transition-colors"
                            title="Delete"><Trash2 className="w-3 h-3" /></button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {/* Typing indicator */}
            {typingLabel && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-1 mt-4">
                {isGroup && <span className="text-[10px] text-[var(--txt3)] pl-12">{typingLabel}</span>}
                <div className="flex items-end gap-2">
                  <Avatar user={firstTyper ?? partner ?? ({ id: firstTyperId ?? 'unknown', username: '?' } as User)} size="md" />
                  <div className="px-4 py-3 bg-[var(--bubble-them-bg)] border border-[var(--bubble-them-border)] rounded-tr-2xl rounded-br-2xl rounded-bl-2xl flex gap-1.5 items-center">
                    <div className="w-1.5 h-1.5 bg-cyan-500/70 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 bg-cyan-500/70 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 bg-cyan-500/70 rounded-full animate-bounce" />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}
        {/* ── #3 New messages jump button ── */}
        <AnimatePresence>
          {newMsgCount > 0 && !isAtBottom && (
            <motion.button
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              onClick={() => { scrollToBottom(); setNewMsgCount(0); }}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-black text-xs font-semibold rounded-full shadow-lg shadow-cyan-900/40 transition-colors z-10 mx-auto w-fit"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              {newMsgCount} new message{newMsgCount !== 1 ? 's' : ''}
            </motion.button>
          )}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      {/* Reply bar */}
      <AnimatePresence>
        {replyingTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="px-5 pt-3 bg-[var(--surface)] border-t border-[var(--border)] overflow-hidden">
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[var(--surface3)] border border-[var(--border)]">
              <div className="w-0.5 self-stretch bg-cyan-500 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-cyan-400 font-medium mb-0.5">
                  Replying to {replyingTo.senderId === currentUser.id ? 'yourself' : nameFor(replyingTo.senderId)}
                </div>
                <div className="text-xs text-[var(--txt3)] truncate">
                  {replyingTo.messageType === 'image' ? '📷 Image' : replyingTo.messageType === 'video' ? '🎥 Video' : replyingTo.messageType === 'audio' ? '🎤 Voice' : replyingTo.content}
                </div>
              </div>
              <button onClick={() => setReplyingTo(null)} className="text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media preview */}
      <AnimatePresence>
        {mediaPreview && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="px-6 pt-4 bg-[var(--surface)] border-t border-[var(--border)] overflow-hidden">
            <div className="relative inline-block">
              {mediaType === 'video'
                ? <video src={mediaPreview} className="h-24 rounded-lg border border-[var(--border3)]" preload="metadata" />
                : <img src={mediaPreview} alt="preview" className="h-24 rounded-lg object-cover border border-[var(--border3)]" />}
              <div className="absolute -top-0.5 left-0 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[9px] text-[var(--txt3)] font-mono uppercase">{mediaType}</div>
              <button onClick={cancelMedia} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--surface3)] border border-[var(--border3)] flex items-center justify-center text-[var(--txt2)] hover:text-[var(--txt)] transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="p-4 md:p-5 bg-[var(--surface)] border-t border-[var(--border)] shrink-0 backdrop-blur-xl">
        <input ref={fileInputRef} type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo"
          className="hidden" onChange={handleFileSelect} />
        <div className="flex items-end gap-3">
          {/* Attach */}
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 rounded-full bg-[var(--surface3)] border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800 transition-colors flex-shrink-0 mb-0.5"
            title="Attach image or video">
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Emoji */}
          <div className="relative flex-shrink-0 mb-0.5">
            <button type="button" onClick={() => setShowEmojiPicker(p => !p)}
              className={cn('w-10 h-10 rounded-full bg-[var(--surface3)] border flex items-center justify-center transition-colors',
                showEmojiPicker ? 'border-cyan-700 text-cyan-400' : 'border-[var(--border)] text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800')}
              title="Emoji"><Smile className="w-4 h-4" /></button>
            <AnimatePresence>
              {showEmojiPicker && <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmojiPicker(false)} />}
            </AnimatePresence>
          </div>

          {/* Voice recorder or text input or send media */}
          {showVoiceRecorder ? (
            <VoiceRecorder onSend={handleSendVoice} onCancel={() => setShowVoiceRecorder(false)} />
          ) : mediaPreview ? (
            <button type="button" onClick={handleSendMedia} disabled={uploading}
              className="flex-1 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 text-black text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
              {uploading ? <><div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Uploading…</> : <><Send className="w-4 h-4" /> Send {mediaType === 'video' ? 'Video' : 'Image'}</>}
            </button>
          ) : (
            <form onSubmit={handleSendText} className="flex-1 flex items-end gap-3">
              <div className="composer-shell flex-1 flex items-end bg-[var(--input-bg)] border border-[var(--border)] rounded-[22px] px-5 py-3 focus-within:border-cyan-700 transition-colors">
                <textarea ref={textareaRef} value={input} onChange={handleInputChange} onPaste={handlePaste}
                  onFocus={() => { if (chatId) onMarkConversationRead?.(chatId); }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(e as any); } }}
                  placeholder="Type a message… or paste / attach media"
                  rows={1}
                  style={{ height: `${LIST_LINE_HEIGHT_PX}px` }}
                  onInput={autoResizeTextarea}
                  className="flex-1 bg-transparent outline-none text-sm placeholder-[var(--txt3)] text-[var(--txt)] resize-none overflow-y-auto block w-full" />
              </div>
              <button type="submit" disabled={!input.trim()}
                className="w-10 h-10 bg-cyan-600 hover:bg-cyan-500 rounded-full flex items-center justify-center text-black shadow-[0_0_15px_rgba(8,145,178,0.15)] disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 transition-colors">
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* Mic button — only when not in voice mode and no media */}
          {!showVoiceRecorder && !mediaPreview && (
            <button type="button" onClick={() => setShowVoiceRecorder(true)}
              className="w-10 h-10 rounded-full bg-[var(--surface3)] border border-[var(--border)] flex items-center justify-center text-[var(--txt3)] hover:text-cyan-400 hover:border-cyan-800 transition-colors flex-shrink-0 mb-0.5"
              title="Record voice message">
              <Mic className="w-4 h-4" />
            </button>
          )}
        </div>
      </footer>

      {/* Forward modal */}
      <AnimatePresence>
        {forwardingMsg && (
          <ForwardModal
            message={forwardingMsg}
            currentUser={currentUser}
            excludeConversationId={chatId}
            onClose={() => setForwardingMsg(null)}
          />
        )}
      </AnimatePresence>

      {/* Group info modal */}
      <AnimatePresence>
        {isGroup && showGroupInfo && (
          <GroupInfoModal
            conversationId={chatId}
            name={liveName}
            avatarUrl={liveAvatarUrl}
            createdBy={liveCreatedBy}
            currentUser={currentUser}
            members={groupMembers}
            onlineUserIds={onlineUserIds}
            onClose={() => setShowGroupInfo(false)}
            onLeft={() => { setShowGroupInfo(false); onLeftGroup?.(); }}
          />
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/92 flex items-center justify-center p-8"
            onClick={() => setLightbox(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()} className="max-w-full max-h-full">
              {lightbox.type === 'video'
                ? <video src={lightbox.url} controls autoPlay className="max-w-[90vw] max-h-[85vh] rounded-xl outline-none" />
                : <img src={lightbox.url} alt="full" className="max-w-[90vw] max-h-[85vh] rounded-xl object-contain" />}
            </motion.div>
            <button onClick={() => setLightbox(null)}
              className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#222] border border-[#333] flex items-center justify-center text-[#aaa] hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
