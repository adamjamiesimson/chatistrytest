-- Chatice — Supabase Schema
-- Run this on a fresh project, then disable email confirmation in Auth settings.

-- 1. Users table
CREATE TABLE public.users (
  id uuid REFERENCES auth.users NOT NULL PRIMARY KEY,
  username text UNIQUE NOT NULL,
  is_online boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

-- 2. Conversations table
CREATE TABLE public.conversations (
  id text PRIMARY KEY,
  participants uuid[] NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

-- 3. Messages table
CREATE TABLE public.messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id text REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON public.messages (sender_id);
CREATE INDEX idx_users_username ON public.users (username);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS: users
CREATE POLICY "Users can view other users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- RLS: conversations
CREATE POLICY "Users can view their conversations" ON public.conversations
  FOR SELECT USING (auth.uid() = ANY(participants));
CREATE POLICY "Users can insert their conversations" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = ANY(participants));
CREATE POLICY "Users can update their conversations" ON public.conversations
  FOR UPDATE USING (auth.uid() = ANY(participants));

-- RLS: messages
CREATE POLICY "Users can view messages in their conversations" ON public.messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND auth.uid() = ANY(c.participants))
  );
CREATE POLICY "Users can insert messages in their conversations" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND auth.uid() = ANY(c.participants))
  );

-- Auto-sync new auth users into public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, username)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Auto-delete messages beyond 200 per conversation
CREATE OR REPLACE FUNCTION prune_old_messages()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.messages
  WHERE conversation_id = NEW.conversation_id
    AND id NOT IN (
      SELECT id FROM public.messages
      WHERE conversation_id = NEW.conversation_id
      ORDER BY created_at DESC
      LIMIT 200
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prune_messages
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION prune_old_messages();

-- === MIGRATION: images, edit, delete, avatars ===

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_content text;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE POLICY "Users can update own messages" ON public.messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "Users can delete own messages" ON public.messages
  FOR DELETE USING (auth.uid() = sender_id);

-- Storage
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-images', 'chat-images', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Public avatar read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users upload own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own avatar" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Public chat image read" ON storage.objects FOR SELECT USING (bucket_id = 'chat-images');
CREATE POLICY "Authenticated users upload chat images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-images' AND auth.role() = 'authenticated');

-- ================================================================
-- MIGRATION: all new features (read receipts, voice, pinning, etc.)
-- ================================================================

-- conversation_reads (enables unread counts + read receipts)
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  user_id        uuid REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  last_read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users manage own reads" ON public.conversation_reads
  FOR ALL USING (auth.uid() = user_id);

-- message_reactions (emoji reactions)
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES public.users(id)    ON DELETE CASCADE NOT NULL,
  emoji      text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE(message_id, user_id, emoji)
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users view reactions" ON public.message_reactions FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Users insert reactions" ON public.message_reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Users delete reactions" ON public.message_reactions FOR DELETE USING (auth.uid() = user_id);

-- Reply fields on messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id           uuid,
  ADD COLUMN IF NOT EXISTS reply_to_content      text,
  ADD COLUMN IF NOT EXISTS reply_to_sender_id    uuid,
  ADD COLUMN IF NOT EXISTS reply_to_message_type text;

-- last_seen_at on users (for "last seen X ago" in chat header)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- pinned_messages (one pinned message per conversation)
CREATE TABLE IF NOT EXISTS public.pinned_messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id text NOT NULL,
  message_id      uuid REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  message_content text NOT NULL,
  message_type    text NOT NULL DEFAULT 'text',
  pinned_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pinned_at       timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  UNIQUE(conversation_id, message_id)
);
ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users view pinned" ON public.pinned_messages FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Users insert pinned" ON public.pinned_messages FOR INSERT WITH CHECK (auth.uid() = pinned_by);
CREATE POLICY IF NOT EXISTS "Users delete pinned" ON public.pinned_messages FOR DELETE USING (true);

-- user_pinned_conversations (starred chats in sidebar)
CREATE TABLE IF NOT EXISTS public.user_pinned_conversations (
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  pinned_at       timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
ALTER TABLE public.user_pinned_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users manage pinned convos" ON public.user_pinned_conversations
  FOR ALL USING (auth.uid() = user_id);

-- Storage bucket for voice messages (reuses chat-images bucket)
-- Voice messages are stored under the chat-images bucket as audio files.
-- (already covered by existing chat-images policies)

-- ================================================================
-- MIGRATION: get_unread_counts RPC — eliminates N+1 query problem
-- Replaces the per-conversation message count loop in App.tsx with
-- a single database call. Keyed by conversation_id (not partner_id)
-- so it works uniformly for 1:1 DMs and group chats — see the group
-- chat migration further down for why this changed.
-- ================================================================

DROP FUNCTION IF EXISTS public.get_unread_counts(uuid);

CREATE FUNCTION public.get_unread_counts(p_user_id uuid)
RETURNS TABLE(conversation_id text, unread_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT
    c.id AS conversation_id,
    COUNT(m.id)::bigint AS unread_count
  FROM conversations c
  JOIN messages m ON m.conversation_id = c.id
  LEFT JOIN conversation_reads cr
    ON cr.conversation_id = c.id AND cr.user_id = p_user_id
  WHERE
    p_user_id = ANY(c.participants)
    AND m.sender_id <> p_user_id
    AND m.created_at > COALESCE(cr.last_read_at, '1970-01-01'::timestamptz)
  GROUP BY c.id
  HAVING COUNT(m.id) > 0;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid) TO authenticated;

-- ================================================================
-- MIGRATION: display names, status, and rate limiting
-- ================================================================

-- Display name (shown to others, not unique)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name text;

-- Status (emoji + text)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status_emoji text NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status_text  text NOT NULL DEFAULT '';

-- ================================================================
-- MIGRATION: private per-user appearance preferences
-- Run this section in Supabase SQL Editor before deploying the liquid-glass UI.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  accent text NOT NULL DEFAULT 'aqua' CHECK (accent IN ('aqua', 'iris', 'rose', 'amber', 'sage')),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own preferences" ON public.user_preferences;
CREATE POLICY "Users can create own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ================================================================
-- MIGRATION: private per-user, per-conversation chat themes
-- This does not change the theme another participant sees.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.user_conversation_themes (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  theme_id text NOT NULL DEFAULT 'aurora' CHECK (theme_id IN (
    'aurora', 'lagoon', 'iris', 'rosewater', 'apricot',
    'moss', 'ember', 'midnight', 'porcelain', 'stone',
    'amethyst', 'blue-hour', 'citrine', 'blush', 'forest',
    'sapphire', 'cocoa', 'coral', 'ice', 'obsidian'
  )),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, conversation_id)
);

ALTER TABLE public.user_conversation_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversation themes" ON public.user_conversation_themes;
CREATE POLICY "Users can view own conversation themes"
  ON public.user_conversation_themes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own conversation themes" ON public.user_conversation_themes;
CREATE POLICY "Users can create own conversation themes"
  ON public.user_conversation_themes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND auth.uid() = ANY(c.participants)
    )
  );

DROP POLICY IF EXISTS "Users can update own conversation themes" ON public.user_conversation_themes;
CREATE POLICY "Users can update own conversation themes"
  ON public.user_conversation_themes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Rate limiting: max 30 messages per user per minute
CREATE OR REPLACE FUNCTION enforce_rate_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM messages
    WHERE sender_id = NEW.sender_id
      AND created_at > NOW() - INTERVAL '1 minute'
  ) >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded — max 30 messages per minute.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS messages_rate_limit ON public.messages;
CREATE TRIGGER messages_rate_limit
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION enforce_rate_limit();

-- ================================================================
-- MIGRATION: group chats
--
-- Groups reuse the existing `conversations` table and its
-- `participants uuid[]` column rather than introducing a separate
-- membership table — every existing RLS policy, the messages table,
-- reactions, pins, and reads all key off conversation_id already, so
-- this is the minimal change that makes the whole feature set (pins,
-- reactions, replies, read receipts, search, forwarding...) "just work"
-- for groups too. Group conversation ids are generated client-side as
-- 'group_' || uuid; DM ids stay the existing sorted-pair scheme.
-- ================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON public.conversations (is_group);

COMMENT ON COLUMN public.conversations.is_group IS 'true for group chats, false for 1:1 DMs';
COMMENT ON COLUMN public.conversations.name IS 'Group display name (null for DMs)';
COMMENT ON COLUMN public.conversations.avatar_url IS 'Group avatar image (null for DMs)';
COMMENT ON COLUMN public.conversations.created_by IS 'User who created the group; has admin rights (rename/avatar/remove members) — enforced client-side and in remove_group_member()';

-- Existing conversation_reads policies only let a user see their OWN read row,
-- so the partner's (or, for groups, any other member's) last_read_at could never
-- actually be fetched — the "read" double-checkmark could never light up. Add a
-- permissive SELECT-only policy so any participant of a conversation can see all
-- read rows for that conversation; writes remain restricted to one's own row.
CREATE POLICY IF NOT EXISTS "Conversation participants can view all reads" ON public.conversation_reads
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_reads.conversation_id
      AND auth.uid() = ANY(c.participants)
  )
);

-- Atomic, permission-checked group membership management.
-- Both are SECURITY DEFINER (bypass RLS), so authorization is hand-checked inside:
--   add_group_member    — any current member may add someone new
--   remove_group_member — a member may remove themself (leave); only the
--                         creator may remove someone else. Deletes the
--                         conversation if it would end up with no members.
CREATE OR REPLACE FUNCTION public.add_group_member(p_conversation_id text, p_new_member uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participants uuid[];
  v_is_group boolean;
BEGIN
  SELECT participants, is_group INTO v_participants, v_is_group
  FROM conversations WHERE id = p_conversation_id;

  IF v_participants IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF NOT v_is_group THEN
    RAISE EXCEPTION 'Not a group conversation';
  END IF;
  IF NOT (auth.uid() = ANY(v_participants)) THEN
    RAISE EXCEPTION 'Only group members can add members';
  END IF;
  IF p_new_member = ANY(v_participants) THEN
    RETURN; -- already a member, no-op
  END IF;

  UPDATE conversations
  SET participants = array_append(participants, p_new_member), updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_group_member(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_conversation_id text, p_member uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participants uuid[];
  v_is_group boolean;
  v_created_by uuid;
  v_new_participants uuid[];
BEGIN
  SELECT participants, is_group, created_by INTO v_participants, v_is_group, v_created_by
  FROM conversations WHERE id = p_conversation_id;

  IF v_participants IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  IF NOT v_is_group THEN
    RAISE EXCEPTION 'Not a group conversation';
  END IF;
  IF NOT (auth.uid() = ANY(v_participants)) THEN
    RAISE EXCEPTION 'Only group members can do this';
  END IF;
  IF NOT (auth.uid() = p_member OR auth.uid() = v_created_by) THEN
    RAISE EXCEPTION 'Only the group creator can remove other members';
  END IF;

  v_new_participants := array_remove(v_participants, p_member);

  IF array_length(v_new_participants, 1) IS NULL OR array_length(v_new_participants, 1) = 0 THEN
    DELETE FROM conversations WHERE id = p_conversation_id;
  ELSE
    UPDATE conversations
    SET participants = v_new_participants, updated_at = now()
    WHERE id = p_conversation_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_group_member(text, uuid) TO authenticated;

-- Group avatars live at avatars/groups/{conversation_id}/avatar.{ext}.
-- Only current members of that group may upload/update its avatar.
CREATE POLICY IF NOT EXISTS "Group members upload group avatar" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'groups'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = (storage.foldername(name))[2]
      AND auth.uid() = ANY(c.participants)
  )
);

CREATE POLICY IF NOT EXISTS "Group members update group avatar" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'groups'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = (storage.foldername(name))[2]
      AND auth.uid() = ANY(c.participants)
  )
);
