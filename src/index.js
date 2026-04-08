async function handleGeminiPost(request, env) {
  try {
    // 1. Get the prompt and image data sent from your React frontend
    const body = await request.json();

    // 2. Forward the request to Google securely using your hidden API key
    const model = 'gemini-3.1-flash-lite-preview';
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const googleResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    // 3. Get Google's response
    const data = await googleResponse.json();

    // Check if Google API returned an error and forward the status code
    if (!googleResponse.ok) {
      return new Response(JSON.stringify({ 
        error: data.error?.message || `Google API error: ${googleResponse.status}`,
        details: data.error 
      }), {
        status: googleResponse.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. Send the result back to your React app
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gemini' && request.method === 'POST') {
      return handleGeminiPost(request, env);
    }

    // For other requests, serve the static site
    if (!env.ASSETS) {
      return new Response(
        'Static asset binding missing: env.ASSETS is undefined. Check wrangler.toml site bucket and redeploy.',
        { status: 500 }
      );
    }

    return env.ASSETS.fetch(request);
  },
};