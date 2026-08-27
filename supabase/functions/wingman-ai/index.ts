// ---------------------------------------------------------------------------
// Wingman AI — context-aware chat assistant (zero-dependency Edge Function).
//
// No external imports (no esm.sh) so it bundles reliably when pasted into the
// Supabase Dashboard editor. All Supabase access is via plain fetch to the
// REST API, authenticated with the JWT sent by the browser + the injected
// SERVICE_ROLE_KEY (falls back to anon). Gemini keys live only here, never in
// the browser.
//
// Rotation: on a "credits finished" error (HTTP 429 / RESOURCE_EXHAUSTED /
// quota), the key is quarantined and the next key is tried automatically.
// No hard token numbers.
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function jsonText(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!SB_URL || !SB_KEY) {
    return jsonError(500, 'Edge function is not configured (missing URL/keys).');
  }

  const body = await req.json().catch(() => ({}));
  const conversationId: string = body?.conversationId;
  const query: string = body?.query ?? '';
  if (!conversationId) return jsonError(400, 'conversationId is required');
  if (!query.trim()) return jsonError(400, 'query is required');

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return jsonError(401, 'Not authenticated');

  // ---- Identify the caller from the JWT via the Auth REST endpoint.
  const meRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!meRes.ok) return jsonError(401, 'Not authenticated');
  const me = (await meRes.json()) as { id: string; aud?: string };
  if (!me?.id) return jsonError(401, 'Not authenticated');

  // ---- Verify caller is a participant.
  const convRes = await fetch(
    `${SB_URL}/rest/v1/conversations?select=participants&id=eq.${encodeURIComponent(conversationId)}`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    },
  );
  if (!convRes.ok) return jsonError(500, 'Failed to load conversation');
  const convRows = (await convRes.json()) as { participants?: string[] }[];
  const participants: string[] = convRows?.[0]?.participants ?? [];
  if (!participants.includes(me.id)) {
    return jsonError(403, 'Not a participant of this conversation');
  }

  // ---- Last ~20 messages.
  const msgRes = await fetch(
    `${SB_URL}/rest/v1/messages?select=sender_id,content,message_type,created_at&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.desc&limit=20`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    },
  );
  if (!msgRes.ok) return jsonError(500, 'Failed to load messages');
  const rows = (await msgRes.json()) as {
    sender_id: string;
    content: string | null;
    message_type: string;
    created_at: string;
  }[];
  rows.reverse();

  // ---- Resolve sender names.
  const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));
  const names: Record<string, string> = {};
  if (senderIds.length) {
    const idsParam = senderIds.map((s) => `id=eq.${encodeURIComponent(s)}`).join('&');
    const usRes = await fetch(`${SB_URL}/rest/v1/users?select=id,username,display_name&${idsParam}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (usRes.ok) {
      const us = (await usRes.json()) as { id: string; username: string; display_name: string | null }[];
      for (const u of us) names[u.id] = u.display_name || `@${u.username}`;
    }
  }

  const context = rows.map((r) => ({
    sender: names[r.sender_id] ?? 'Unknown',
    me: r.sender_id === me.id,
    content:
      r.message_type === 'image'
        ? '📷 [image]'
        : r.message_type === 'audio'
          ? '🎤 [voice message]'
          : r.message_type === 'video'
            ? '🎥 [video]'
            : r.content ?? '',
  }));
  const prompt = buildPrompt(context, query);

  // ---- Rotate keys on "credits finished" errors.
  const seen = new Set<string>();
  while (true) {
    const pickRes = await fetch(`${SB_URL}/rest/v1/rpc/get_best_gemini_key`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: '{}',
    });
    if (!pickRes.ok || pickRes.status >= 400) {
      return jsonError(503, 'All Gemini API keys are currently unavailable. Try again later.');
    }
    const picked = (await pickRes.json()) as { id?: string; api_key?: string } | null;
    if (!picked?.id || !picked.api_key || seen.has(picked.id)) {
      return jsonError(503, 'All Gemini API keys are currently out of credit. Try again later.');
    }
    seen.add(picked.id);

    const geminiRes = await fetch(
      `${GEMINI_ENDPOINT}/models/${GEMINI_MODEL}:generateContent?key=${picked.api_key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      },
    );
    const resText = await geminiRes.text().catch(() => '');

    if (geminiRes.ok) {
      try {
        const parsed = JSON.parse(resText);
        const text = (parsed?.candidates?.[0]?.content?.parts ?? [])
          .map((p: { text?: string }) => p.text ?? '')
          .join('');
        if (!text) return jsonError(502, 'Gemini returned an empty response.');
        // Clear quarantine on success (best-effort).
        await fetch(`${SB_URL}/rest/v1/rpc/record_gemini_success`, {
          method: 'POST',
          headers: {
            apikey: SB_KEY,
            Authorization: `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ p_key_id: picked.id }),
        }).catch(() => {});
        return jsonText(200, text);
      } catch (parseErr) {
        return jsonError(502, `Failed to parse Gemini response: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`);
      }
    }

    const quotaError = isQuotaError(geminiRes.status, resText);
    await fetch(`${SB_URL}/rest/v1/rpc/mark_gemini_key_failed`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ p_key_id: picked.id, p_error: `HTTP ${geminiRes.status}: ${resText.slice(0, 200)}` }),
    }).catch(() => {});

    if (!quotaError) {
      return jsonError(geminiRes.status, `Wingman hit an error (HTTP ${geminiRes.status}). Try again.`);
    }
    // Quota / credits finished -> loop to next key.
  }
});