/**
 * 六味情书表白墙 · 轻量后端
 * 零依赖（仅 Node.js 内置模块），同时托管前端静态文件 + 提供提交/读取/删除接口。
 *
 * 运行： node server.js        （默认端口 3000）
 *       PORT=8080 node server.js
 *
 * 接口：
 *   POST   /api/confess       body:{flavor,name,text}  → 存储一条表白（status=pending 待审核），返回 {ok,id,count}（公开，含违禁词校验）
 *   GET    /api/confess       → 返回全部表白数组（公开）；?status=approved 仅返回已通过的表白
 *   PATCH  /api/confess?id=*  body:{status:'approved'}  → 审核一条表白（需登录）
 *   DELETE /api/confess?id=*  → 删除指定 id 的表白（需登录）
 *   POST   /api/login         body:{user,pass}         → 登录，返回 {ok} 并下发会话 Cookie
 *   POST   /api/logout        → 退出登录
 *   GET    /api/me            → {ok:true/false} 当前是否已登录
 *
 * 页面保护：admin.html / screen.html 未登录访问时 302 跳转到 login.html
 * 账号密码在 config.json（支持多账号 users 数组）；违禁词表在 banned-words.txt（一行一词，# 为注释）
 * 审核机制：新提交的表白 status=pending，大屏（screen.html）只显示已通过的表白，需在 admin.html 审核通过后才上弹幕。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'confess.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const BANNED_FILE = path.join(ROOT, 'banned-words.txt');
const SESSION_COOKIE = 'liuwei_session';
const SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 天免登录

// ---------- 数据存储 ----------
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}
function save(arr) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// ---------- 登录鉴权（无状态签名 Cookie，零依赖） ----------
function getSecret() {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch (e) {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s);
    return s;
  }
}
const SECRET = getSecret();

function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return { user: 'admin', passHash: '' }; }
}
function getUsers() {
  const cfg = getConfig();
  if (Array.isArray(cfg.users) && cfg.users.length) return cfg.users;
  if (cfg.user) return [{ user: cfg.user, passHash: cfg.passHash || '' }];
  return [];
}
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}
function makeToken(user) {
  const expires = Date.now() + SESSION_TTL;
  const payload = user + '.' + expires;
  return payload + '.' + sign(payload);
}
function verifyToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  if (sign(parts[0] + '.' + parts[1]) !== parts[2]) return false;
  if (Number(parts[1]) < Date.now()) return false;
  return true;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}
function isAuthed(req) {
  return verifyToken(parseCookies(req)[SESSION_COOKIE]);
}

// ---------- 违禁词 ----------
function loadBanned() {
  try {
    return fs.readFileSync(BANNED_FILE, 'utf8')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'));
  } catch (e) { return []; }
}
function hasBannedWord(text, name) {
  const t = String(text || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return loadBanned().find(w => t.includes(w.toLowerCase()) || n.includes(w.toLowerCase()));
}

// ---------- 数据存储 ----------
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}
function save(arr) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// ---------- MIME ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm'
};

// ---------- 工具：读取请求体 ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ---------- 服务 ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const sendJSON = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  try {
    // ---------- 登录 / 退出 / 状态 ----------
    if (req.method === 'POST' && url === '/api/login') {
      const raw = await readBody(req);
      let d;
      try { d = JSON.parse(raw); } catch (e) { d = null; }
      if (!d) return sendJSON(400, { ok: false, msg: 'bad json' });
      const hash = crypto.createHash('sha256').update(String(d.pass || '')).digest('hex');
      const user = String(d.user || '');
      const account = getUsers().find(u => u.user === user && u.passHash === hash);
      if (account) {
        const token = makeToken(account.user);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}`
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      return sendJSON(401, { ok: false, msg: '账号或密码错误' });
    }

    if (req.method === 'POST' && url === '/api/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET' && url === '/api/me') {
      return sendJSON(200, { ok: isAuthed(req) });
    }

    // 提交一条表白（公开，含违禁词校验）
    if (req.method === 'POST' && url === '/api/confess') {
      const raw = await readBody(req);
      let d;
      try { d = JSON.parse(raw); } catch (e) { return sendJSON(400, { ok: false, msg: 'bad json' }); }
      if (!d.text || !d.flavor) return sendJSON(400, { ok: false, msg: 'missing fields' });
      if (hasBannedWord(d.text, d.name)) {
        return sendJSON(400, { ok: false, msg: '内容包含敏感词，请修改后重新提交' });
      }
      const arr = load();
      const item = {
        id: Date.now() + '_' + Math.floor(Math.random() * 1000),
        flavor: d.flavor,
        name: (d.name || '匿名').toString().slice(0, 12),
        text: d.text.toString().slice(0, 120),
        time: Date.now(),
        status: 'pending'
      };
      arr.push(item);
      save(arr);
      return sendJSON(200, { ok: true, id: item.id, count: arr.length });
    }

    // 读取全部表白（可用 ?status=approved 仅返回已通过审核的，供大屏使用）
    if (req.method === 'GET' && url === '/api/confess') {
      const q = new URL(req.url, 'http://localhost');
      const status = q.searchParams.get('status');
      let arr = load();
      if (status) arr = arr.filter(x => (x.status || 'approved') === status);
      return sendJSON(200, arr);
    }

    // 审核一条表白（需登录）
    if (req.method === 'PATCH' && url === '/api/confess') {
      if (!isAuthed(req)) return sendJSON(401, { ok: false, msg: '未登录，请先登录' });
      const q = new URL(req.url, 'http://localhost');
      const id = q.searchParams.get('id');
      const raw = await readBody(req);
      let d;
      try { d = JSON.parse(raw); } catch (e) { d = null; }
      if (!id || !d || !d.status) return sendJSON(400, { ok: false, msg: 'missing id/status' });
      let arr = load();
      const item = arr.find(x => x.id === id);
      if (!item) return sendJSON(404, { ok: false, msg: 'not found' });
      item.status = (d.status === 'approved') ? 'approved' : 'pending';
      save(arr);
      return sendJSON(200, { ok: true });
    }

    // 删除一条表白（需登录）
    if (req.method === 'DELETE' && url === '/api/confess') {
      if (!isAuthed(req)) return sendJSON(401, { ok: false, msg: '未登录，请先登录' });
      const q = new URL(req.url, 'http://localhost');
      const id = q.searchParams.get('id');
      if (!id) return sendJSON(400, { ok: false, msg: 'missing id' });
      let arr = load();
      const before = arr.length;
      arr = arr.filter(x => x.id !== id);
      save(arr);
      return sendJSON(200, { ok: true, count: arr.length, removed: before - arr.length });
    }

    // 静态文件（admin.html / screen.html 需登录，未登录跳 login.html）
    let p = (url === '/') ? '/confession-wall-step1.html' : url;
    if ((p === '/admin.html' || p === '/screen.html') && !isAuthed(req)) {
      res.writeHead(302, { 'Location': '/login.html?next=' + encodeURIComponent(p) });
      return res.end();
    }
    const fp = path.join(ROOT, path.normalize(p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.stat(fp, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(fp).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      // 支持 Range 请求（视频/音频拖动进度需要）
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
        let end = m && m[2] !== '' ? parseInt(m[2], 10) : stat.size - 1;
        if (end >= stat.size) end = stat.size - 1;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Accept-Ranges': 'bytes'
        });
        return fs.createReadStream(fp, { start, end }).pipe(res);
      }
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(fp).pipe(res);
    });
  } catch (e) {
    sendJSON(500, { ok: false, msg: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  六味情书表白墙 已启动');
  console.log('  登录页:        http://localhost:' + PORT + '/login.html');
  console.log('  首页(选味道):  http://localhost:' + PORT + '/');
  console.log('  大屏弹幕:      http://localhost:' + PORT + '/screen.html (需登录)');
  console.log('  后台管理:      http://localhost:' + PORT + '/admin.html  (需登录)');
  console.log('  后台账号: admin / shenhe (密码见 config.json / README.txt)');
  console.log('========================================');
});
