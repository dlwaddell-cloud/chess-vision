import { onRequestPost } from '../functions/api/gemini.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gemini' && request.method === 'POST') {
      return onRequestPost({ request, env });
    }

    // For other requests, serve the static site
    // This uses the site bucket for static assets
    return env.ASSETS.fetch(request);
  },
};