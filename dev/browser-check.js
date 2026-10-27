const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set([
  'config.js', 'content.js', 'filter-core.js', 'metrics-core.js', 'tweet-metrics.js', 'x-net-hook.js', 'account-signals.js', 'account-decorations.js', 'options.js', 'options.css', 'icons/icon32.png',
  'dev/browser-check.html', 'dev/browser-storage.js', 'dev/browser-scenarios.js',
  'assets/sponsor/alipay.svg', 'assets/sponsor/wechat.svg'
]);

function payload(id, partial) {
  return { data: { tweet_results: { result: {
    rest_id: id,
    legacy: {
      created_at: new Date(Date.now() - 100 * 3600000).toUTCString(),
      full_text: '测试帖子', lang: 'en', favorite_count: 20, reply_count: 3, retweet_count: 4, bookmark_count: 2
    },
    ...(partial ? {} : { views: { count: '120000' } })
  } } } };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  const tweetId = url.pathname.match(/^\/graphql\/(\d+)$/)?.[1];
  if (tweetId) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(payload(tweetId, url.searchParams.has('partial'))));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/options') {
    response.end(fs.readFileSync(path.join(root, 'options.html'), 'utf8')
      .replace('<script src="config.js">', '<script src="/dev/browser-storage.js"></script><script src="config.js">')
      .replace('</body>', `<pre id="audit-storage"${url.searchParams.has('check') ? '' : ' hidden'} style="white-space:pre-wrap;overflow-wrap:anywhere">尚未保存</pre></body>`));
    return;
  }
  const file = url.pathname === '/' ? 'dev/browser-check.html' : url.pathname.slice(1);
  if (!files.has(file)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  if (file.endsWith('.js')) response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  if (file.endsWith('.css')) response.setHeader('Content-Type', 'text/css; charset=utf-8');
  if (file.endsWith('.png')) response.setHeader('Content-Type', 'image/png');
  if (file.endsWith('.svg')) response.setHeader('Content-Type', 'image/svg+xml');
  response.end(fs.readFileSync(path.join(root, file)));
});
server.listen(18763, '127.0.0.1', () => console.log('Browser checks: http://127.0.0.1:18763 (settings: /options)'));
