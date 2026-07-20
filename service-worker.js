const CACHE="simulador-academy-v6-1-0-full-account-sync";
const ASSETS=["./","./index.html","./style.css","./app.js","./db.js","./cloud.js","./manifest.webmanifest"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const u=new URL(e.request.url);
 const core=u.origin===self.location.origin&&(u.pathname.endsWith("/")||/\.(html|js|css|webmanifest)$/.test(u.pathname));
 e.respondWith(core?fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)):caches.match(e.request).then(r=>r||fetch(e.request)));
});
