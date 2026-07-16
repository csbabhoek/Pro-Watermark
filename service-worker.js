/* ================================================================
   PRO WATERMARK CAMERA — service-worker.js
   ================================================================
   Service worker sederhana dengan strategi "cache-first, fallback
   ke network". Karena aplikasi ini 100% berjalan di sisi klien
   (tanpa backend, tanpa API eksternal), seluruh aset yang diperlukan
   di-cache saat instalasi agar aplikasi dapat berjalan SEPENUHNYA
   OFFLINE setelah kunjungan pertama.
   ================================================================ */

// Naikkan versi ini setiap kali file aplikasi (html/css/js) diubah,
// agar service worker lama otomatis diganti dengan cache baru.
const CACHE_VERSION = 'pro-watermark-camera-v1.0.0';

// Daftar seluruh aset inti aplikasi yang wajib tersedia offline.
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

/* ---------------- INSTALL ----------------
   Mengunduh & menyimpan seluruh aset inti ke cache saat instalasi. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------------- ACTIVATE ----------------
   Membersihkan cache versi lama agar tidak menumpuk. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------------- FETCH ----------------
   Strategi: Cache First, lalu fallback ke jaringan bila tidak ada
   di cache. Karena aplikasi ini tanpa backend/API eksternal, hampir
   seluruh request akan selalu berhasil dipenuhi dari cache. */
self.addEventListener('fetch', (event) => {
  // Hanya tangani request GET (hindari mengintersep POST dsb.)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Simpan salinan response baru ke cache untuk penggunaan offline berikutnya
          const responseClone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => {
          // Jika benar-benar offline dan aset tidak ada di cache,
          // kembalikan halaman utama sebagai fallback (untuk navigasi).
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline dan aset tidak tersedia di cache.', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
    })
  );
});
