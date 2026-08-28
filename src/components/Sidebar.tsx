import React, { useState, useEffect, useRef } from 'react';
import { User, ConversationSummary, UserRow, ConversationRow } from '../types';
import { Search, LogOut, Loader2, Camera, SlidersHorizontal, Star, X, Smile, Users, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import { supabase } from '../supabase';
import { Avatar } from './Avatar';
import { useTheme } from '../context/ThemeContext';
import { EmojiPicker } from './EmojiPicker';
import { NewGroupModal } from './NewGroupModal';
import { AppearanceMenu } from './AppearanceMenu';

interface SidebarProps {
  currentUser: User;
  activeConversation: ConversationSummary | null;
  onSelectConversation: (conv: ConversationSummary) => void;
  onLogout: () => void;
  onlineUserIds: string[];
  onAvatarUpdate: (url: string) => void;
  unreadCounts: Record<string, number>;
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  currentUser, activeConversation, onSelectConversation, onLogout,
  onlineUserIds, onAvatarUpdate, unreadCounts,
  isMobile, mobileOpen, onMobileClose,
}: SidebarProps) {
  const { theme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pinnedConvoIds, setPinnedConvoIds] = useState<Set<string>>(new Set());
  const [hoveredConvoId, setHoveredConvoId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusEmoji, setStatusEmoji] = useState(currentUser.statusEmoji ?? '');
  const [statusText, setStatusText] = useState(currentUser.statusText ?? '');
  const [showStatusEmojiPicker, setShowStatusEmojiPicker] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const saveStatus = async () => {
    setEditingStatus(false);
    await supabase.from('users').update({ status_emoji: statusEmoji.trim(), status_text: statusText.trim() }).eq('id', currentUser.id);
  };

  const fetchConversations = async () => {
    const { data: convs } = await supabase
      .from('conversations').select('id, participants, updated_at, is_group, name, avatar_url, created_by')
      .contains('participants', [currentUser.id])
      .order('updated_at', { ascending: false });
    if (!convs?.length) { setConversations([]); return; }

    const rows = convs as ConversationRow[];
    const dmPartnerIds = Array.from(new Set(
      rows.filter(c => !c.is_group)
        .map(c => c.participants.find(id => id !== currentUser.id))
        .filter((id): id is string => !!id)
    ));

    const partnerMap = new Map<string, UserRow>();
    if (dmPartnerIds.length) {
      const { data: users } = await supabase
        .from('users').select('id, username, display_name, avatar_url, status_emoji, status_text')
        .in('id', dmPartnerIds);
      (users as UserRow[] ?? []).forEach(u => partnerMap.set(u.id, u));
    }

    const summaries: ConversationSummary[] = [];
    for (const c of rows) {
      if (c.is_group) {
        summaries.push({
          id: c.id, isGroup: true,
          name: c.name || 'Group chat',
          avatarUrl: c.avatar_url ?? undefined,
          subtitle: `${c.participants.length} member${c.participants.length !== 1 ? 's' : ''}`,
          participantIds: c.participants,
          updatedAt: c.updated_at,
          createdBy: c.created_by ?? undefined,
        });
      } else {
        const pid = c.participants.find(id => id !== currentUser.id);
        const u = pid ? partnerMap.get(pid) : undefined;
        if (!u) continue; // partner profile missing — skip defensively
        summaries.push({
          id: c.id, isGroup: false,
          name: u.display_name || `@${u.username}`,
          avatarUrl: u.avatar_url ?? undefined,
          subtitle: u.display_name ? `@${u.username}` : undefined,
          participantIds: c.participants,
          updatedAt: c.updated_at,
          partner: {
            id: u.id, username: u.username, displayName: u.display_name ?? undefined,
            avatarUrl: u.avatar_url ?? undefined, statusEmoji: u.status_emoji ?? undefined, statusText: u.status_text ?? undefined,
          },
          statusEmoji: u.status_emoji ?? undefined,
          statusText: u.status_text ?? undefined,
        });
      }
    }
    setConversations(summaries);
  };

  const loadPinnedConvos = async () => {
    const { data } = await supabase
      .from('user_pinned_conversations').select('conversation_id').eq('user_id', currentUser.id);
    if (data) setPinnedConvoIds(new Set(data.map((r: any) => r.conversation_id)));
  };

  useEffect(() => {
    fetchConversations();
    loadPinnedConvos();
    const ch = supabase.channel('sidebar_convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, fetchConversations)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [currentUser.id]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users').select('id, username, display_name, avatar_url, status_emoji, status_text')
          .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`).neq('id', currentUser.id).limit(10);
        setSearchResults((data ?? []).map((u: any) => ({
          id: u.id, username: u.username, displayName: u.display_name ?? undefined,
          avatarUrl: u.avatar_url ?? undefined, statusEmoji: u.status_emoji ?? undefined, statusText: u.status_text ?? undefined,
        })));
      } finally { setIsSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery, currentUser.id]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2MB'); return; }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${currentUser.id}/avatar.${ext}`;
      await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const bustedUrl = `${publicUrl}?t=${Date.now()}`;
      await supabase.from('users').update({ avatar_url: bustedUrl }).eq('id', currentUser.id);
      onAvatarUpdate(bustedUrl);
    } catch (err) { console.error('Avatar upload failed:', err); }
    finally { setUploadingAvatar(false); if (avatarInputRef.current) avatarInputRef.current.value = ''; }
  };

  const togglePinConvo = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    if (pinnedConvoIds.has(convId)) {
      await supabase.from('user_pinned_conversations').delete().eq('user_id', currentUser.id).eq('conversation_id', convId);
      setPinnedConvoIds(prev => { const s = new Set(prev); s.delete(convId); return s; });
    } else {
      await supabase.from('user_pinned_conversations').insert({ user_id: currentUser.id, conversation_id: convId });
      setPinnedConvoIds(prev => new Set([...prev, convId]));
    }
  };

  const handleSelectSearchUser = (u: User) => {
    const chatId = [currentUser.id, u.id].sort().join('_');
    const existing = conversations.find(c => c.id === chatId);
    if (existing) { onSelectConversation(existing); return; }
    onSelectConversation({
      id: chatId, isGroup: false,
      name: u.displayName || `@${u.username}`,
      avatarUrl: u.avatarUrl, subtitle: u.displayName ? `@${u.username}` : undefined,
      partner: u, participantIds: [currentUser.id, u.id],
      statusEmoji: u.statusEmoji, statusText: u.statusText,
      updatedAt: new Date().toISOString(),
    });
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredConversations = query
    ? conversations.filter(c => c.name.toLowerCase().includes(query) || (c.subtitle ?? '').toLowerCase().includes(query))
    : conversations;
  const pinnedList = filteredConversations.filter(c => pinnedConvoIds.has(c.id));
  const unpinnedList = filteredConversations.filter(c => !pinnedConvoIds.has(c.id));
  const displayList = [...pinnedList, ...unpinnedList];
  // Don't suggest people you're already chatting with as "new" search results
  const knownPartnerIds = new Set(conversations.filter(c => !c.isGroup).map(c => c.partner!.id));
  const newPeopleResults = searchResults.filter(u => !knownPartnerIds.has(u.id));

  const sidebarContent = (
    <div className={cn(
      'glass-panel sidebar-panel flex flex-col h-full bg-[var(--surface2)] overflow-hidden',
      isMobile ? 'w-full rounded-none border-0' : 'w-[22rem] m-0 rounded-[32px] shrink-0'
    )}>
      {/* Header */}
      <div className="relative p-6 border-b border-[var(--border)] flex items-center justify-between">
        <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[var(--accent)] opacity-[.12] blur-3xl pointer-events-none" />
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="CHATistry logo" className="w-8 h-8 object-contain" />
          <div><h1 className="text-xl font-extrabold tracking-[-0.065em] text-[var(--txt)]">Chatistry</h1><p className="text-[9px] uppercase tracking-[0.2em] text-[var(--accent)] mt-0.5">Your private space</p></div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowNewGroup(true)}
            className="p-2 text-[var(--txt3)] hover:text-[var(--txt)] transition-colors rounded-lg hover:bg-[var(--surface3)]"
            title="New group">
            <Users className="w-4 h-4" />
          </button>
          <div className="relative">
            <button onClick={() => setShowAppearance(v => !v)}
              className={cn('p-2 transition-colors rounded-xl liquid-icon', showAppearance ? 'text-[var(--accent)] border-[var(--accent)]/40' : 'text-[var(--txt3)] hover:text-[var(--txt)]')}
              title={`Appearance: ${theme} mode`}><SlidersHorizontal className="w-4 h-4" /></button>
            {showAppearance && <AppearanceMenu variant="dialog" onClose={() => setShowAppearance(false)} />}
          </div>
          <button onClick={onLogout}
            className="p-2 text-[var(--txt3)] hover:text-[var(--txt)] transition-colors rounded-lg hover:bg-[var(--surface3)]"
            title="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
          {/* Close drawer button — mobile only */}
          {isMobile && (
            <button onClick={onMobileClose}
              className="p-2 text-[var(--txt3)] hover:text-[var(--txt)] transition-colors rounded-lg hover:bg-[var(--surface3)]"
              title="Close menu">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="p-5 pb-4">
        <div className="relative group">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--txt3)] group-focus-within:text-cyan-600 transition-colors" />
          <input
            type="text" placeholder="Search chats or people..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-[18px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-cyan-600 transition-colors placeholder-[var(--txt3)] text-[var(--txt)]"
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 space-y-1">
          <h3 className="text-[10px] font-bold text-[var(--txt3)] uppercase tracking-[.16em] mb-3 px-2 mt-1">
            {searchQuery.trim() ? 'Your Chats' : 'Recent Chats'}
          </h3>
          {displayList.length === 0 ? (
            <div className="p-4 text-center text-[var(--txt3)] text-sm">
              {searchQuery.trim() ? 'No matching chats' : 'No chats yet'}
            </div>
          ) : (
            displayList.map(c => {
              const isActive = activeConversation?.id === c.id;
              const isOnline = !c.isGroup && c.partner ? onlineUserIds.includes(c.partner.id) : false;
              const onlineMemberCount = c.isGroup
                ? c.participantIds.filter(id => id !== currentUser.id && onlineUserIds.includes(id)).length
                : 0;
              const unread = unreadCounts[c.id] ?? 0;
              const isPinned = pinnedConvoIds.has(c.id);
              const isHov = hoveredConvoId === c.id;
              const avatarUser = { id: c.id, username: c.name, avatarUrl: c.avatarUrl } as User;

              return (
                <button
                  key={c.id}
                  onClick={() => onSelectConversation(c)}
                  onMouseEnter={() => setHoveredConvoId(c.id)}
                  onMouseLeave={() => setHoveredConvoId(null)}
                  className={cn(
                    'w-full flex items-center gap-3.5 p-3.5 text-left rounded-[20px] transition-all border border-transparent',
                    isActive
                      ? 'bg-[var(--surface4)] border-[var(--border2)] shadow-[inset_0_1px_rgba(255,255,255,.16),0_12px_28px_rgba(0,0,0,.12)]'
                      : 'hover:bg-[var(--surface3)] hover:translate-x-0.5 text-[var(--txt2)] hover:text-[var(--txt)]'
                  )}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar user={avatarUser} size="md" />
                    {isOnline && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--surface2)] rounded-full shadow-[0_0_4px_rgba(34,197,94,0.6)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className={cn('text-sm font-semibold truncate', isActive ? 'text-[var(--txt)]' : '')}>
                        {c.name}
                      </h4>
                      {isPinned && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                    </div>
                    <div className="text-[10px] text-[var(--txt3)]">
                      {c.isGroup ? (
                        <>
                          {c.subtitle}
                          {onlineMemberCount > 0 && <span className="text-green-400"> · {onlineMemberCount} online</span>}
                        </>
                      ) : (
                        <>
                          {c.subtitle && <span className="text-[var(--txt3)]">{c.subtitle} · </span>}
                          {isOnline ? <span className="text-green-400">Online</span> : 'Offline'}
                        </>
                      )}
                    </div>
                    {!c.isGroup && (c.statusEmoji || c.statusText) && (
                      <div className="text-[10px] text-[var(--txt3)] truncate mt-0.5">
                        {c.statusEmoji} {c.statusText}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(isHov || isPinned) && unread === 0 && (
                      <button
                        onClick={e => togglePinConvo(e, c.id)}
                        className={cn('w-6 h-6 rounded flex items-center justify-center transition-colors',
                          isPinned ? 'text-yellow-400 hover:text-yellow-300' : 'text-[var(--txt3)] hover:text-yellow-400'
                        )}
                        title={isPinned ? 'Unpin' : 'Pin conversation'}
                      >
                        <Star className={cn('w-3.5 h-3.5', isPinned ? 'fill-yellow-400' : '')} />
                      </button>
                    )}
                    {unread > 0 && (
                      <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}

          {/* New people (search only) */}
          {searchQuery.trim() && (
            <>
              <h3 className="text-xs font-semibold text-[var(--txt3)] uppercase tracking-wider mb-2 px-2 mt-5 flex items-center gap-1.5">
                <UserPlus className="w-3 h-3" /> Start New Chat
              </h3>
              {isSearching ? (
                <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 text-[var(--txt3)] animate-spin" /></div>
              ) : newPeopleResults.length === 0 ? (
                <div className="p-4 text-center text-[var(--txt3)] text-sm">No users found</div>
              ) : (
                newPeopleResults.map(u => (
                  <button key={u.id} onClick={() => handleSelectSearchUser(u)}
                    className="w-full flex items-center gap-3 p-3 text-left rounded-lg transition-colors hover:bg-[var(--surface3)] text-[var(--txt2)] hover:text-[var(--txt)]">
                    <Avatar user={u} size="md" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold truncate">{u.displayName || `@${u.username}`}</h4>
                      <div className="text-[10px] text-[var(--txt3)]">
                        {u.displayName && <span>@{u.username} · </span>}
                        {onlineUserIds.includes(u.id) ? <span className="text-green-400">Online</span> : 'Offline'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-5 bg-[var(--surface)] border-t border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="relative group flex-shrink-0">
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <button onClick={() => avatarInputRef.current?.click()} className="relative block" title="Change avatar" disabled={uploadingAvatar}>
              <Avatar user={currentUser} size="md" isCurrentUser />
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Camera className="w-3.5 h-3.5 text-white" />}
              </div>
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-[var(--txt)] truncate">
              {currentUser.displayName || `@${currentUser.username}`}
            </div>
            {currentUser.displayName && (
              <div className="text-[10px] text-[var(--txt3)]">@{currentUser.username}</div>
            )}
            {editingStatus ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-1.5">
                  {/* Emoji picker button */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setShowStatusEmojiPicker(p => !p)}
                      className="w-8 h-8 bg-[var(--surface4)] border border-[var(--border2)] rounded-lg flex items-center justify-center hover:bg-[var(--surface3)] hover:border-[var(--border3)] transition-colors"
                      title="Pick emoji"
                    >
                      {statusEmoji
                        ? <span className="text-base leading-none">{statusEmoji}</span>
                        : <Smile className="w-4 h-4 text-[var(--txt3)]" />}
                    </button>
                    <AnimatePresence>
                      {showStatusEmojiPicker && (
                        <div className="absolute bottom-full mb-2 left-0 z-50">
                          <EmojiPicker
                            onSelect={emoji => { setStatusEmoji(emoji); setShowStatusEmojiPicker(false); }}
                            onClose={() => setShowStatusEmojiPicker(false)}
                          />
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                  <input
                    value={statusText}
                    onChange={e => setStatusText(e.target.value)}
                    placeholder="Set a status…"
                    onKeyDown={e => { if (e.key === 'Enter') saveStatus(); if (e.key === 'Escape') { setEditingStatus(false); setShowStatusEmojiPicker(false); } }}
                    className="flex-1 min-w-0 bg-[var(--surface4)] border border-[var(--border2)] rounded-lg px-2 py-1.5 text-xs text-[var(--txt)] placeholder-[var(--txt3)] focus:outline-none focus:border-cyan-700 transition-colors"
                    maxLength={40}
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between px-0.5">
                  <button onClick={() => { setStatusEmoji(''); setStatusText(''); }}
                    className="text-[10px] text-[var(--txt3)] hover:text-red-400 transition-colors">
                    Clear status
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingStatus(false); setShowStatusEmojiPicker(false); }}
                      className="text-[10px] text-[var(--txt3)] hover:text-[var(--txt2)] transition-colors">
                      Cancel
                    </button>
                    <button onClick={saveStatus}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="mt-1 w-full text-left flex items-center gap-1.5 group"
              >
                {(statusEmoji || statusText) ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    {statusEmoji && <span className="text-sm leading-none flex-shrink-0">{statusEmoji}</span>}
                    <span className="text-[11px] text-[var(--txt2)] truncate group-hover:text-[var(--txt)] transition-colors">
                      {statusText || <span className="italic text-[var(--txt3)]">Edit status</span>}
                    </span>
                  </div>
                ) : (
                  <span className="text-[10px] text-[var(--txt3)] group-hover:text-[var(--txt2)] transition-colors flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0 shadow-[0_0_4px_rgba(34,197,94,0.6)]" />
                    Online · <span className="underline underline-offset-2 decoration-dotted">set a status</span>
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <AnimatePresence>
          {mobileOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={onMobileClose}
              />
              {/* Drawer */}
              <motion.div
                key="drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="fixed top-0 left-0 bottom-0 z-50 w-[85vw] max-w-sm shadow-2xl"
              >
                {sidebarContent}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      ) : sidebarContent}

      <AnimatePresence>
        {showNewGroup && (
          <NewGroupModal
            currentUser={currentUser}
            onClose={() => setShowNewGroup(false)}
            onCreated={conv => { onSelectConversation(conv); fetchConversations(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
