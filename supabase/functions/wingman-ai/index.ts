import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// Wingman AI — context-aware chat assistant.
//
// This Edge Function is the ONLY place Gemini API keys are used. It:
//   1. Authenticates the caller and verifies they're a participant of the
//      conversation, then pulls the last ~20 messages as context.
//   2. Dispatches to Gemini using the key pool, rotating to the next key
//      automatically whenever the current one reports that its credits are
//      finished (HTTP 429 / RESOURCE_EXHAUSTED / quota). No hard token limits.
//   3. Streams the model's reply back to the client.
//
// Requires these env vars (set in Supabase > Edge Functions > Secrets):
//   SERVICE_ROLE_KEY — service-role key, NEVER in the client.
//   (SUPABASE_URL is auto-injected by the platform.)
// ---------------------------------------------------------------------------

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

function buildPrompt(
  messages: { sender: string; me: boolean; content: string }[],
  query: string,
): string {
  const transcript = messages.length
    ? messages.map((m) => `${m.me ? 'You' : m.sender}: ${m.content}`).join('\n')
    : '(no prior messages yet)';
  return [
    'You are Wingman, a helpful in-chat assistant in the Chatistry messaging app. ' +
      'A user asks you a question in the context of their recent conversation. ' +
      'Be concise, helpful, and use context when relevant. Answer in plain text.',
    '',
    '## Recent conversation',
    transcript,
    '',
    "## User's request to Wingman",
    query,
  ].join('\n');
}

function isQuotaError(status: number, text: string): boolean {
  const t = (text || '').toLowerCase();
  return (
    status === 429 ||
    t.includes('resource_exhausted') ||
    t.includes('quota') ||
    t.includes('exhausted') ||
    t.includes('billing') ||
    t.includes('rate limit')
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const conversationId: string = body?.conversationId;
    const query: string = body?.query ?? '';
    if (!conversationId) return jsonError(400, 'conversationId is required');
    if (!query.trim()) return jsonError(400, 'query is required');

    // Prefer the service-role key (bypasses RLS) if the platform injected it;
    // otherwise fall back to the anon key. The RPCs are SECURITY DEFINER, so in
    // either case the key pool reads happen with elevated privileges and raw
    // Gemini keys never reach the browser.
    const supabaseKey =
      Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseKey) return jsonError(500, 'Edge function key not configured');
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Identify the caller from the JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonError(401, 'Not authenticated');
    const { data: { user }, error: authErr } = await serviceClient.auth.getUser(token);
    if (authErr || !user) return jsonError(401, 'Not authenticated');

    // Authorization: caller must be a participant.
    const { data: conv, error: convErr } = await serviceClient
      .from('conversations')
      .select('participants')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) return jsonError(500, 'Failed to load conversation');
    const participants: string[] = conv?.participants ?? [];
    if (!participants.includes(user.id)) {
      return jsonError(403, 'Not a participant of this conversation');
    }

    // Context: last ~20 messages.
    const { data: rows, error: msgErr } = await serviceClient
      .from('messages')
      .select('sender_id, content, message_type, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (msgErr) return jsonError(500, 'Failed to load messages');

    // Resolve sender display names.
    const senderIds = Array.from(new Set((rows ?? []).map((r) => r.sender_id)));
    const names: Record<string, string> = {};
    if (senderIds.length) {
      const { data: us } = await serviceClient
        .from('users')
        .select('id, username, display_name')
        .in('id', senderIds);
      for (const u of us ?? []) {
        names[u.id as string] = (u.display_name as string) || `@${u.username}`;
      }
    }
    const context = (rows ?? []).reverse().map((r) => ({
      sender: names[r.sender_id as string] ?? 'Unknown',
      me: r.sender_id === user.id,
      content:
        r.message_type === 'image'
          ? '📷 [image]'
          : r.message_type === 'audio'
            ? '🎤 [voice message]'
            : r.message_type === 'video'
              ? '🎥 [video]'
              : (r.content as string) ?? '',
    }));

    const prompt = buildPrompt(context, query);

    // Rotate through the key pool on "credits finished" errors.
    const seen = new Set<string>();
    while (true) {
      const { data: picked, error: pickErr } = await serviceClient.rpc('get_best_gemini_key');
      if (pickErr || !picked || !picked.id) {
        return jsonError(503, 'All Gemini API keys are currently unavailable. Try again later.');
      }
      const key = picked as { id: string; api_key: string };
      if (seen.has(key.id)) {
        return jsonError(503, 'All Gemini API keys are currently out of credit. Try again later.');
      }
      seen.add(key.id);

      const geminiRes = await fetch(
        `${GEMINI_ENDPOINT}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${key.api_key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
          }),
        },
      );

      if (geminiRes.ok) {
        await serviceClient.rpc('record_gemini_success', { p_key_id: key.id }).catch(() => {});
        return new Response(geminiRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            ...corsHeaders,
          },
        });
      }

      const errText = await geminiRes.text().catch(() => '');
      const quotaError = isQuotaError(geminiRes.status, errText);
      await serviceClient.rpc('mark_gemini_key_failed', {
        p_key_id: key.id,
        p_error: `HTTP ${geminiRes.status}: ${errText.slice(0, 200)}`,
      }).catch(() => {});

      if (!quotaError) {
        return jsonError(geminiRes.status, `Wingman hit an error (HTTP ${geminiRes.status}). Try again.`);
      }
      // Quota / credits finished -> mark this key and loop to try the next one.
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error';
    return jsonError(500, message);
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}