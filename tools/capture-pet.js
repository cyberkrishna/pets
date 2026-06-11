// capture-pet.js — dev/debug helper: screenshot the running pet window through
// the Chrome DevTools Protocol (start the app with --remote-debugging-port=9223).
// Usage: node tools/capture-pet.js [out.png] [evalJs]
// Needs Node 22+ (built-in WebSocket). Zero dependencies.
const fs = require('fs');

const out = process.argv[2] || 'pet-capture.png';
const evalJs = process.argv[3] || '';
const port = 9223;

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && /pet\.html/.test(t.url));
  if (!page) throw new Error('pet.html page not found; targets: ' + targets.map((t) => t.url).join(', '));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  if (evalJs) {
    const r = await send('Runtime.evaluate', { expression: evalJs, returnByValue: true });
    console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result));
    await new Promise((r2) => setTimeout(r2, 600)); // let animations react
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', out);
  ws.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
