// ============================================
// ScreenAI — AI Proxy Edge Function
// ============================================
// Routes requests from free-tier users through server-side API keys.
// Quota: 10 requests/day per free user.
// Supports: Claude, GPT, Gemini, Mistral, Grok
// Streaming: SSE relay from provider → client

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DAILY_QUOTA = 10;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Check quota
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('proxy_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', `${today}T00:00:00Z`);

    if ((count || 0) >= DAILY_QUOTA) {
      return new Response(JSON.stringify({
        error: 'Daily quota exceeded. Add your own API key in Settings or upgrade to Pro.',
        quota: { used: count, limit: DAILY_QUOTA },
      }), {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Parse request
    const body = await req.json();
    const { provider, model, messages, systemPrompt } = body;

    if (!provider || !messages) {
      return new Response(JSON.stringify({ error: 'Missing provider or messages' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Get server-side API key for provider
    const apiKey = getProviderKey(provider);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: `Provider ${provider} not configured on server` }), {
        status: 503,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Route to provider
    const providerResponse = await routeToProvider(provider, model, messages, systemPrompt, apiKey);

    // Record usage
    await supabase.from('proxy_usage').insert({
      user_id: user.id,
      provider,
      model: model || 'default',
      tokens_in: 0, // Updated after response if available
      tokens_out: 0,
    });

    // Stream response back
    return new Response(providerResponse.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('Proxy error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

function getProviderKey(provider: string): string | null {
  const keys: Record<string, string> = {
    claude: Deno.env.get('ANTHROPIC_API_KEY') || '',
    openai: Deno.env.get('OPENAI_API_KEY') || '',
    gemini: Deno.env.get('GOOGLE_AI_KEY') || '',
    mistral: Deno.env.get('MISTRAL_API_KEY') || '',
    grok: Deno.env.get('GROK_API_KEY') || '',
  };
  return keys[provider] || null;
}

async function routeToProvider(
  provider: string,
  model: string,
  messages: any[],
  systemPrompt: string | undefined,
  apiKey: string
): Promise<Response> {
  switch (provider) {
    case 'claude':
      return callClaude(model || 'claude-sonnet-4-20250514', messages, systemPrompt, apiKey);
    case 'openai':
    case 'grok':
      return callOpenAICompat(
        provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
        model || (provider === 'grok' ? 'grok-2-vision-1220' : 'gpt-4o'),
        messages, systemPrompt, apiKey
      );
    case 'gemini':
      return callGemini(model || 'gemini-2.0-flash', messages, systemPrompt, apiKey);
    case 'mistral':
      return callOpenAICompat(
        'https://api.mistral.ai/v1/chat/completions',
        model || 'mistral-large-latest',
        messages, systemPrompt, apiKey
      );
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function callClaude(model: string, messages: any[], systemPrompt: string | undefined, apiKey: string): Promise<Response> {
  const anthropicMessages = messages.map((m: any) => {
    const content: any[] = [];
    if (m.screenshot?.dataUrl) {
      const base64 = m.screenshot.dataUrl.split(',')[1];
      const mediaType = m.screenshot.dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }
    if (m.content) content.push({ type: 'text', text: m.content });
    return { role: m.role, content };
  });

  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      stream: true,
    }),
  });
}

async function callOpenAICompat(url: string, model: string, messages: any[], systemPrompt: string | undefined, apiKey: string): Promise<Response> {
  const openaiMessages: any[] = [];
  if (systemPrompt) openaiMessages.push({ role: 'system', content: systemPrompt });

  for (const m of messages) {
    const content: any[] = [];
    if (m.screenshot?.dataUrl) {
      content.push({ type: 'image_url', image_url: { url: m.screenshot.dataUrl } });
    }
    if (m.content) content.push({ type: 'text', text: m.content });
    openaiMessages.push({ role: m.role, content: content.length === 1 ? content[0].text || content[0] : content });
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: openaiMessages, stream: true }),
  });
}

async function callGemini(model: string, messages: any[], systemPrompt: string | undefined, apiKey: string): Promise<Response> {
  const parts: any[] = [];
  if (systemPrompt) parts.push({ text: systemPrompt });

  const contents = messages.map((m: any) => {
    const msgParts: any[] = [];
    if (m.screenshot?.dataUrl) {
      const base64 = m.screenshot.dataUrl.split(',')[1];
      const mimeType = m.screenshot.dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      msgParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    }
    if (m.content) msgParts.push({ text: m.content });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: msgParts };
  });

  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    }),
  });
}
