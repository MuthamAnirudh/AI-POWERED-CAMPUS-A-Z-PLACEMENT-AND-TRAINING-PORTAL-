const CACHE='govcareer-shell-v17';
const ASSETS=['/','/index.html','/styles.css','/app.js','/account.js','/account.css','/bridge.js','/bridge.css','/live.js','/live.css','/advanced.js','/advanced.css','/jobsplus.js','/jobsplus.css','/livejobs.js','/livejobs.css','/embed.js','/embed.css','/manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 const u=new URL(e.request.url);
 if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/campus'))return;
 if(e.request.mode==='navigate'||u.pathname==='/'||u.pathname==='/index.html'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}
 e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match('/index.html'))));
});
