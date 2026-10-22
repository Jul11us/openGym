import gymHtml from '../generated/gym.html?raw';

export function gymShell(request: Request): Response {
  const path = new URL(request.url).pathname;
  // Missing static files must not be mistaken for the app's HTML.
  if (path.startsWith('/api/') || /\.[a-z0-9]{1,12}$/i.test(path)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(gymHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
