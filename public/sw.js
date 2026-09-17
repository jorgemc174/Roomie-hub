/* RoomieHub: caches only this explicit public shell. No authenticated data or writes. */
const VERSION='roomiehub-public-v1';
const PUBLIC=['/offline.html','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(PUBLIC)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==VERSION)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{
 if(event.data?.type==='APPLY_UPDATE')self.skipWaiting();
 if(event.data?.type==='LOGOUT')event.waitUntil((async()=>{for(const key of await caches.keys())await caches.delete(key);const cache=await caches.open(VERSION);await cache.addAll(PUBLIC);})());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(PUBLIC.includes(url.pathname)&&!url.search){event.respondWith(caches.open(VERSION).then(async cache=>(await cache.match(request))||fetch(request)));return;}
 if(request.mode==='navigate')event.respondWith(fetch(request).catch(async()=>{return (await caches.match('/offline.html'))||new Response('RoomieHub — Offline / Sin conexión',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}));
});
function safeTarget(value){try{const u=new URL(value,self.location.origin);return typeof value==='string'&&(value.startsWith('/homes/')||value.startsWith(self.location.origin+'/homes/'))&&!value.includes('\\')&&u.origin===self.location.origin?u.href:new URL('/notifications',self.location.origin).href;}catch{return new URL('/notifications',self.location.origin).href;}}
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data?.json();}catch{return;}if(!data||typeof data.title!=='string'||typeof data.id!=='string')return;
 if(data.eventAt&&new Date(data.eventAt).getTime()<=Date.now())return;
 await self.registration.showNotification(data.title.slice(0,160),{body:typeof data.body==='string'?data.body.slice(0,300):'',icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:`roomiehub:${data.id}`,data:{url:safeTarget(data.url)}});
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const target=safeTarget(event.notification.data?.url);const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate(target);await client.focus();return;}}await self.clients.openWindow(target);})());});
