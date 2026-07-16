# Pro Watermark Camera

Aplikasi web (PWA) untuk menambahkan watermark bergaya kamera flagship premium (terinspirasi tampilan OPPO x Hasselblad) pada foto — 100% berjalan di sisi klien, tanpa backend, tanpa CDN, tanpa dependensi eksternal.

## Struktur File

```
├── index.html          # Struktur halaman aplikasi
├── style.css            # Seluruh styling (dark/light, responsive, material-ish)
├── script.js             # Seluruh logika: editor foto + watermark + export
├── manifest.json         # Konfigurasi PWA (installable, icon, dsb.)
├── service-worker.js     # Caching offline
├── icons/                # Ikon aplikasi (SVG sumber + PNG semua ukuran)
│   ├── icon.svg
│   ├── icon-maskable.svg
│   ├── gen_icons.py      # Skrip pembuat PNG dari desain ikon (Pillow)
│   └── icon-*.png
└── assets/
    └── logo-placeholder.svg
```

## Menjalankan secara lokal

Karena berbasis Service Worker, aplikasi perlu diakses melalui server HTTP (bukan `file://`). Contoh cara termudah:

```bash
# Python 3
python3 -m http.server 8080

# lalu buka http://localhost:8080 di browser
```

## Upload ke GitHub

1. Buat repository baru di GitHub (contoh: `pro-watermark-camera`).
2. Upload seluruh isi folder ini (jaga strukturnya tetap sama, jangan diubah nama folder `icons/` atau `assets/`).
3. Aktifkan **GitHub Pages** (Settings → Pages → Deploy from branch → pilih `main` / folder root).
4. URL GitHub Pages Anda (misalnya `https://username.github.io/pro-watermark-camera/`) inilah yang akan dipakai di PWA Builder.

## Build APK dengan PWA Builder

1. Buka [https://www.pwabuilder.com](https://www.pwabuilder.com)
2. Masukkan URL GitHub Pages Anda pada kolom pencarian.
3. Tunggu proses analisis manifest & service worker selesai (skor sebaiknya hijau di semua kategori).
4. Pilih platform **Android**.
5. Unduh paket APK/AAB yang dihasilkan.
6. (Opsional) Sesuaikan signing key dan nama paket sesuai kebutuhan Play Store.

## Catatan Font

Aplikasi menggunakan system font stack (mendekati Inter/Roboto) agar tetap 100% offline tanpa CDN. Jika ingin menggunakan font Inter/Poppins asli:
1. Unduh file `.woff2` font tersebut secara manual (bebas lisensi, misalnya dari Google Fonts, diunduh lalu disimpan lokal).
2. Simpan di `assets/fonts/`.
3. Aktifkan blok `@font-face` yang sudah disiapkan (dalam bentuk komentar) di bagian atas `style.css`.

## Mengganti Logo

Buka tab **Watermark** di aplikasi → tombol **"Unggah Logo Kustom"** untuk mengganti logo placeholder bulat dengan logo Anda sendiri (PNG/JPG/SVG dirender sebagai gambar raster).

## Lisensi Aset

Seluruh ikon & placeholder logo pada proyek ini dibuat khusus (vector shapes sederhana berbentuk lingkaran), bebas digunakan dan dimodifikasi.
