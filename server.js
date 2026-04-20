const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const candidates = [
  path.join(__dirname, 'index.html'),
  path.join(process.cwd(), 'index.html'),
  '/app/index.html',
];
let HTML = null;
for (const p of candidates) {
  try { HTML = fs.readFileSync(p); console.log('로드 성공:', p); break; }
  catch(e) { console.log('시도 실패:', p); }
}
if (!HTML) HTML = Buffer.from('<h1>index.html not found</h1>');

const imageStore = new Map();
function storeImage(id, dataUrl) {
  imageStore.set(id, { dataUrl, ts: Date.now() });
  setTimeout(() => imageStore.delete(id), 3600000);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20*1024*1024) reject(new Error('too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (pathname === '/api/generate' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!ANTHROPIC_API_KEY) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'API_KEY_MISSING'}));
        return;
      }
      const payload = JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2000,system:body.system,messages:body.messages});
      const cr = https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(payload)}},
        cres => { let d=''; cres.on('data',c=>d+=c); cres.on('end',()=>{res.writeHead(cres.statusCode,{'Content-Type':'application/json'});res.end(d);}); });
      cr.on('error',e=>{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));});
      cr.write(payload); cr.end();
    } catch(e) { res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (pathname === '/api/save-image' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const id = Math.random().toString(36).substr(2, 8);
      storeImage(id, body.dataUrl);
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['host'];
      const imageUrl = `${proto}://${host}/img/${id}`;
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({id, imageUrl}));
    } catch(e) { res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (pathname.startsWith('/img/') && req.method === 'GET') {
    const id = pathname.replace('/img/','');
    const entry = imageStore.get(id);
    if (!entry) { res.writeHead(404); res.end('Not found'); return; }
    const m = entry.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) { res.writeHead(400); res.end('Invalid'); return; }
    res.writeHead(200,{'Content-Type':m[1],'Cache-Control':'public,max-age=3600'});
    res.end(Buffer.from(m[2],'base64'));
    return;
  }

  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
  res.end(HTML);
}).listen(PORT, '0.0.0.0', () => {
  console.log('서버 실행: PORT=' + PORT);
  console.log('API KEY:', ANTHROPIC_API_KEY ? '설정됨' : '없음(데모)');
});
