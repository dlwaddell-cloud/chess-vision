export async function onRequestPost(context) {
  // `context.request` contains the data from your React app
  // `context.env` contains your secure Cloudflare environment variables
  const { request, env } = context;

  try {
    // 1. Get the prompt and image data sent from your React frontend
    const body = await request.json();

    // 2. Forward the request to Google securely using your hidden API key
    // Note: Update "gemini-1.5-flash" if you are using a different vision model
    const googleResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    // 3. Get Google's response
    const data = await googleResponse.json();

    // 4. Send the result back to your React app
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}