/* ================================================================
   PRO WATERMARK CAMERA — script.js
   Vanilla JavaScript murni. Tanpa framework, tanpa dependensi.
   Semua proses (edit, filter, watermark, export) berjalan 100% di
   sisi klien / offline menggunakan Canvas API.
   ================================================================
   DAFTAR ISI:
   1.  STATE & KONSTANTA GLOBAL
   2.  UTILITAS UMUM
   3.  MANAJEMEN TEMA (DARK / LIGHT)
   4.  MEMUAT FOTO (UPLOAD)
   5.  VIEW TRANSFORM: ZOOM & PAN (CSS transform, non-destruktif)
   6.  RENDER PIPELINE (transform + filter + watermark -> canvas)
   7.  FILTER PIXEL-LEVEL (temperature, tint, shadow, highlight, sharpen)
   8.  WATERMARK: penggambaran bar & metadata
   9.  MODE FLOATING WATERMARK: drag dengan pointer
   10. TOOL CROP (interaktif dengan handle)
   11. BINDING KONTROL UI (slider, tombol, input)
   12. EXPORT GAMBAR (PNG/JPG/WEBP, resolusi penuh)
   13. SERVICE WORKER REGISTRATION (PWA)
   14. INISIALISASI APLIKASI
   ================================================================ */


/* ================================================================
   1. STATE & KONSTANTA GLOBAL
   ================================================================ */

// Batas resolusi canvas PREVIEW agar interaksi (slider/drag) tetap
// mulus meskipun foto asli beresolusi sangat tinggi (misal 4000px+).
// Saat EKSPOR, seluruh pipeline dijalankan ulang di RESOLUSI ASLI.
const PREVIEW_MAX_DIM = 1600;

// Tinggi watermark bar = 12% dari tinggi foto (sesuai spesifikasi).
const WATERMARK_HEIGHT_RATIO = 0.12;

// Padding watermark dalam satuan "unit dasar" @ tinggi bar referensi 100px.
// Akan diskalakan proporsional terhadap tinggi bar aktual.
const WM_PADDING_LEFT = 45;
const WM_PADDING_RIGHT = 45;
const WM_PADDING_TOP = 22;
const WM_PADDING_BOTTOM = 22;
const WM_REFERENCE_BAR_HEIGHT = 170; // tinggi bar acuan tempat padding di atas diukur

// Warna watermark tetap (sesuai spesifikasi, tidak mengikuti tema app)
const WM_COLOR_BG = '#FFFFFF';
const WM_COLOR_TEXT = '#111111';
const WM_COLOR_META = '#666666';

// Objek state tunggal (single source of truth) untuk seluruh aplikasi.
const state = {
  // --- Sumber gambar ---
  originalImage: null,      // HTMLImageElement asli yang diunggah
  workingSource: null,      // Canvas hasil bake (setelah "Apply Crop"), dipakai sbg dasar edit
  workingWidth: 0,
  workingHeight: 0,

  // --- Transformasi non-destruktif (di-bake saat crop diterapkan) ---
  rotation: 0,     // 0, 90, 180, 270
  flipH: false,
  flipV: false,

  // --- Filter warna & cahaya ---
  filters: {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    shadow: 0,
    highlight: 0,
    sharpen: 0,
    blur: 0,
    opacity: 100,
  },

  // --- View transform (zoom/pan) — murni tampilan, tidak memengaruhi hasil export ---
  view: {
    zoom: 1,
    panX: 0,
    panY: 0,
  },

  // --- Watermark ---
  watermark: {
    brand: 'PRO CAMERA',
    lens: 'HASSELBLAD',
    focal: '70mm',
    aperture: 'f/2.2',
    shutter: '1/50s',
    iso: 'ISO250',
    showDate: false,
    date: '',
    showTime: false,
    time: '',
    showGps: false,
    lat: '',
    lng: '',
    hideLogo: false,
    hideCameraName: false,
    hideMetadata: false,
    hideWatermark: false,
    verticalMode: 'bottom',   // 'bottom' | 'top' | 'center' (floating)
    mirrorSides: false,       // tukar posisi brand text <-> logo
    sizeScale: 100,           // 30-100 (%)
    floatOffsetX: 0,          // offset drag khusus mode floating (px, skala working resolution)
    floatOffsetY: 0,
    logoImage: null,          // Image kustom (jika user unggah logo sendiri)
  },

  // --- Crop ---
  cropRect: null, // {x,y,w,h} dalam koordinat workingSource (setelah rotasi/flip di-preview)
  isCropping: false,

  // --- Export ---
  exportFormat: 'png',

  // --- Render cache ---
  renderScale: 1, // skala canvas preview terhadap resolusi kerja penuh
};

// Referensi elemen DOM penting (diisi saat init)
let dom = {};

// requestAnimationFrame throttle handle untuk render preview
let renderPending = false;


/* ================================================================
   2. UTILITAS UMUM
   ================================================================ */

/** Membatasi nilai angka ke rentang [min, max]. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Menampilkan notifikasi toast singkat di bagian bawah layar. */
let toastTimeout = null;
function showToast(message, duration = 2200) {
  const toast = dom.toast;
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

/** Menjadwalkan render preview pada frame berikutnya (menghindari render berlebihan). */
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderPreview();
  });
}

/** Membuat canvas baru dengan ukuran tertentu. */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Mengambil dimensi foto setelah memperhitungkan rotasi (menukar w/h pada 90/270). */
function getRotatedDims(w, h, rotationDeg) {
  const swapped = rotationDeg % 180 !== 0;
  return swapped ? { w: h, h: w } : { w, h };
}


/* ================================================================
   3. MANAJEMEN TEMA (DARK / LIGHT)
   ================================================================ */

function initTheme() {
  const saved = localStorageSafeGet('pwc_theme');
  const theme = saved || 'dark';
  document.body.setAttribute('data-theme', theme);
  updateThemeIcon(theme);

  dom.themeToggleBtn.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    updateThemeIcon(next);
    localStorageSafeSet('pwc_theme', next);
  });
}

function updateThemeIcon(theme) {
  // Ikon bulan untuk dark, matahari untuk light — cukup ganti path via title
  const icon = dom.themeIconMoon;
  if (!icon) return;
  if (theme === 'dark') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  }
}

// Wrapper localStorage aman (beberapa WebView APK mungkin membatasi storage)
function localStorageSafeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function localStorageSafeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* diamkan */ }
}


/* ================================================================
   4. MEMUAT FOTO (UPLOAD)
   ================================================================ */

function initFileUpload() {
  dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImageFile(file);
    e.target.value = '';
  });

  dom.canvasArea.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  dom.canvasArea.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImageFile(file);
  });
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      resetStateForNewImage(img);
      showToast('Foto berhasil dimuat');
    };
    img.onerror = () => showToast('Gagal memuat foto. Coba file lain.');
    img.src = evt.target.result;
  };
  reader.onerror = () => showToast('Gagal membaca file.');
  reader.readAsDataURL(file);
}

function resetStateForNewImage(img) {
  state.originalImage = img;

  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext('2d').drawImage(img, 0, 0);
  state.workingSource = c;
  state.workingWidth = c.width;
  state.workingHeight = c.height;

  state.rotation = 0;
  state.flipH = false;
  state.flipV = false;
  state.cropRect = null;
  state.isCropping = false;
  Object.assign(state.filters, {
    brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
    shadow: 0, highlight: 0, sharpen: 0, blur: 0, opacity: 100,
  });
  state.view.zoom = 1;
  state.view.panX = 0;
  state.view.panY = 0;
  state.watermark.floatOffsetX = 0;
  state.watermark.floatOffsetY = 0;

  syncFilterInputsFromState();
  applyViewTransform();

  dom.emptyState.classList.add('hidden');
  dom.canvasWrapper.classList.remove('hidden');

  scheduleRender();
}

function syncFilterInputsFromState() {
  dom.brightnessSlider.value = state.filters.brightness;
  dom.contrastSlider.value = state.filters.contrast;
  dom.saturationSlider.value = state.filters.saturation;
  dom.temperatureSlider.value = state.filters.temperature;
  dom.tintSlider.value = state.filters.tint;
  dom.shadowSlider.value = state.filters.shadow;
  dom.highlightSlider.value = state.filters.highlight;
  dom.sharpenSlider.value = state.filters.sharpen;
  dom.blurSlider.value = state.filters.blur;
  dom.opacitySlider.value = state.filters.opacity;
  updateAllSliderLabels();
}

function updateAllSliderLabels() {
  dom.brightnessValue.textContent = state.filters.brightness;
  dom.contrastValue.textContent = state.filters.contrast;
  dom.saturationValue.textContent = state.filters.saturation;
  dom.temperatureValue.textContent = state.filters.temperature;
  dom.tintValue.textContent = state.filters.tint;
  dom.shadowValue.textContent = state.filters.shadow;
  dom.highlightValue.textContent = state.filters.highlight;
  dom.sharpenValue.textContent = state.filters.sharpen;
  dom.blurValue.textContent = state.filters.blur;
  dom.opacityValue.textContent = state.filters.opacity;
  dom.sizeValue.textContent = state.watermark.sizeScale + '%';
}


/* ================================================================
   5. VIEW TRANSFORM: ZOOM & PAN (CSS transform, non-destruktif)
   ================================================================ */

function applyViewTransform() {
  const { zoom, panX, panY } = state.view;
  dom.mainCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  dom.zoomLabel.textContent = Math.round(zoom * 100) + '%';
}

function initViewInteractions() {
  dom.zoomInBtn.addEventListener('click', () => {
    state.view.zoom = clamp(state.view.zoom + 0.15, 0.2, 6);
    applyViewTransform();
  });
  dom.zoomOutBtn.addEventListener('click', () => {
    state.view.zoom = clamp(state.view.zoom - 0.15, 0.2, 6);
    applyViewTransform();
  });
  dom.resetViewBtn.addEventListener('click', () => {
    state.view.zoom = 1;
    state.view.panX = 0;
    state.view.panY = 0;
    applyViewTransform();
  });

  let isPanning = false;
  let lastX = 0, lastY = 0;
  const viewport = dom.canvasViewport;

  viewport.addEventListener('pointerdown', (e) => {
    if (state.isCropping) return;
    if (e.target.closest('.wm-drag-hitbox')) return;
    isPanning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    viewport.classList.add('panning');
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.view.panX += dx;
    state.view.panY += dy;
    applyViewTransform();
  });
  const endPan = () => { isPanning = false; viewport.classList.remove('panning'); };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  viewport.addEventListener('pointerleave', endPan);

  viewport.addEventListener('wheel', (e) => {
    if (state.isCropping) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.view.zoom = clamp(state.view.zoom + delta, 0.2, 6);
    applyViewTransform();
  }, { passive: false });
}


/* ================================================================
   6. RENDER PIPELINE (transform + filter + watermark -> canvas)
   ================================================================
   Alur:
   1) Hitung dimensi hasil rotasi dari workingSource.
   2) Gambar workingSource ke canvas foto dengan rotate/flip + filter
      CSS (brightness/contrast/saturate/blur) sekaligus (cepat, GPU).
   3) Terapkan filter piksel manual (temperature/tint/shadow/highlight/
      sharpen) — hanya jika salah satu nilainya aktif (optimasi).
   4) Bangun canvas akhir: foto + watermark bar sesuai mode posisi.
   ================================================================ */

/**
 * Membangun "foto yang telah diproses" (rotasi + flip + semua filter)
 * pada resolusi target tertentu. Dipakai bersama oleh preview & export.
 * @param {number|null} maxDim - batas dimensi terpanjang (null = resolusi penuh)
 * @returns {{canvas: HTMLCanvasElement, width: number, height: number}}
 */
function buildProcessedPhoto(maxDim) {
  const src = state.workingSource;
  const srcW = state.workingWidth;
  const srcH = state.workingHeight;

  // Dimensi setelah rotasi (sebelum scaling resolusi preview)
  const rotatedDims = getRotatedDims(srcW, srcH, state.rotation);

  // Hitung faktor skala untuk preview (agar performa tetap mulus)
  let scale = 1;
  if (maxDim) {
    const longest = Math.max(rotatedDims.w, rotatedDims.h);
    if (longest > maxDim) scale = maxDim / longest;
  }

  const outW = Math.max(1, Math.round(rotatedDims.w * scale));
  const outH = Math.max(1, Math.round(rotatedDims.h * scale));

  const canvas = makeCanvas(outW, outH);
  const ctx = canvas.getContext('2d');

  // --- Terapkan filter CSS bawaan canvas (cepat) ---
  const f = state.filters;
  const brightnessMul = 1 + f.brightness / 100;   // 0 - 2
  const contrastMul = 1 + f.contrast / 100;       // 0 - 2
  const saturateMul = 1 + f.saturation / 100;     // 0 - 2
  const blurPx = f.blur * (scale) ; // blur diskalakan supaya konsisten visualnya di preview vs full-res

  ctx.save();
  ctx.filter = `brightness(${brightnessMul}) contrast(${contrastMul}) saturate(${saturateMul}) blur(${blurPx}px)`;

  // Transformasi rotate + flip, digambar dari titik tengah kanvas
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);

  const drawW = srcW * scale;
  const drawH = srcH * scale;
  ctx.drawImage(src, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // --- Filter piksel manual (hanya jika diperlukan, demi performa) ---
  const needsPixelPass =
    f.temperature !== 0 || f.tint !== 0 || f.shadow !== 0 ||
    f.highlight !== 0 || f.sharpen > 0;

  if (needsPixelPass) {
    applyPixelLevelFilters(ctx, canvas, f);
  }

  return { canvas, width: outW, height: outH, scale };
}

/**
 * Render pipeline untuk PREVIEW (ditampilkan langsung di #mainCanvas).
 * Dipanggil setiap ada perubahan state (filter, watermark, dsb).
 */
function renderPreview() {
  if (!state.workingSource) return;

  const photo = buildProcessedPhoto(PREVIEW_MAX_DIM);
  state.renderScale = photo.scale;

  const finalCanvas = composeFinalCanvas(photo);
  const targetCtx = dom.mainCanvas.getContext('2d');

  dom.mainCanvas.width = finalCanvas.width;
  dom.mainCanvas.height = finalCanvas.height;
  targetCtx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);
  targetCtx.drawImage(finalCanvas, 0, 0);

  updateFloatingHitboxPosition();
  updateDimensionInfo();
}

/**
 * Menggabungkan foto yang telah diproses dengan watermark menjadi satu
 * canvas akhir, sesuai mode posisi watermark yang dipilih.
 * @param {{canvas: HTMLCanvasElement, width:number, height:number}} photo
 * @returns {HTMLCanvasElement}
 */
function composeFinalCanvas(photo) {
  const wm = state.watermark;
  const opacity = state.filters.opacity / 100;

  // Jika watermark disembunyikan total -> hanya foto saja
  if (wm.hideWatermark) {
    const out = makeCanvas(photo.width, photo.height);
    const ctx = out.getContext('2d');
    ctx.globalAlpha = opacity;
    ctx.drawImage(photo.canvas, 0, 0);
    ctx.globalAlpha = 1;
    return out;
  }

  const barHeight = Math.round(photo.height * WATERMARK_HEIGHT_RATIO * (wm.sizeScale / 100));

  if (wm.verticalMode === 'center') {
    // --- MODE FLOATING: bar mengambang opaque di atas foto, bisa di-drag ---
    const out = makeCanvas(photo.width, photo.height);
    const ctx = out.getContext('2d');
    ctx.globalAlpha = opacity;
    ctx.drawImage(photo.canvas, 0, 0);
    ctx.globalAlpha = 1;

    const barWidth = photo.width; // bar tetap full width agar proporsi teks konsisten
    const baseY = (photo.height - barHeight) / 2;
    const offsetX = wm.floatOffsetX * photo.width;
    const offsetY = wm.floatOffsetY * photo.height;
    const barX = 0 + offsetX;
    const barY = clamp(baseY + offsetY, 0, photo.height - barHeight);

    drawWatermarkBar(ctx, barX, barY, barWidth, barHeight);
    return out;
  }

  // --- MODE ATTACHED: bar menempel di tepi (bottom/top), memperluas kanvas ---
  const out = makeCanvas(photo.width, photo.height + barHeight);
  const ctx = out.getContext('2d');

  if (wm.verticalMode === 'top') {
    drawWatermarkBar(ctx, 0, 0, photo.width, barHeight);
    ctx.globalAlpha = opacity;
    ctx.drawImage(photo.canvas, 0, barHeight);
    ctx.globalAlpha = 1;
  } else {
    // default: bottom
    ctx.globalAlpha = opacity;
    ctx.drawImage(photo.canvas, 0, 0);
    ctx.globalAlpha = 1;
    drawWatermarkBar(ctx, 0, photo.height, photo.width, barHeight);
  }

  return out;
}

function updateDimensionInfo() {
  if (!dom.dimensionInfo) return;
  const wm = state.watermark;
  const rotated = getRotatedDims(state.workingWidth, state.workingHeight, state.rotation);
  let h = rotated.h;
  if (!wm.hideWatermark && wm.verticalMode !== 'center') {
    h += Math.round(rotated.h * WATERMARK_HEIGHT_RATIO * (wm.sizeScale / 100));
  }
  dom.dimensionInfo.textContent = `Dimensi: ${rotated.w} x ${h} px`;
}


/* ================================================================
   7. FILTER PIXEL-LEVEL
   (temperature, tint, shadow, highlight, sharpen)
   ================================================================
   Filter ini tidak tersedia sebagai CSS filter bawaan canvas, sehingga
   diproses manual per-piksel melalui ImageData.
   ================================================================ */

function applyPixelLevelFilters(ctx, canvas, f) {
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const temp = f.temperature; // -100..100
  const tint = f.tint;        // -100..100
  const shadow = f.shadow;    // -100..100
  const highlight = f.highlight; // -100..100

  // Faktor konversi ke skala 0-255 untuk pergeseran warna
  const tempShift = (temp / 100) * 40;  // maksimum ±40 di channel R/B
  const tintShift = (tint / 100) * 40;  // maksimum ±40 di channel G vs R/B

  const shadowFactor = (shadow / 100) * 60;
  const highlightFactor = (highlight / 100) * 60;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // --- Temperature: geser R naik & B turun untuk hangat, sebaliknya untuk dingin ---
    r += tempShift;
    b -= tempShift;

    // --- Tint: geser G vs magenta (R & B) ---
    g += tintShift;
    r -= tintShift * 0.3;
    b -= tintShift * 0.3;

    // --- Shadow & Highlight berbasis luminance ---
    const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255; // 0..1
    const shadowWeight = 1 - luminance;   // makin gelap piksel, makin besar bobot
    const highlightWeight = luminance;    // makin terang piksel, makin besar bobot

    r += shadowFactor * shadowWeight - shadowFactor * 0.15 * highlightWeight;
    g += shadowFactor * shadowWeight - shadowFactor * 0.15 * highlightWeight;
    b += shadowFactor * shadowWeight - shadowFactor * 0.15 * highlightWeight;

    r += highlightFactor * highlightWeight;
    g += highlightFactor * highlightWeight;
    b += highlightFactor * highlightWeight;

    data[i] = clamp(r, 0, 255);
    data[i + 1] = clamp(g, 0, 255);
    data[i + 2] = clamp(b, 0, 255);
  }

  ctx.putImageData(imageData, 0, 0);

  // --- Sharpen: convolution kernel (unsharp-mask sederhana) ---
  if (f.sharpen > 0) {
    applySharpenConvolution(ctx, canvas, f.sharpen / 100);
  }
}

/**
 * Menerapkan efek sharpen melalui convolution kernel 3x3 dengan
 * intensitas 'amount' (0..1), dicampur (blend) dengan gambar asli
 * agar efeknya bisa diatur secara halus melalui slider.
 */
function applySharpenConvolution(ctx, canvas, amount) {
  const w = canvas.width;
  const h = canvas.height;
  const srcData = ctx.getImageData(0, 0, w, h);
  const src = srcData.data;
  const outData = ctx.createImageData(w, h);
  const out = outData.data;

  // Kernel sharpen standar
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        // Piksel tepi: salin langsung (hindari out-of-bounds)
        out[idx] = src[idx];
        out[idx + 1] = src[idx + 1];
        out[idx + 2] = src[idx + 2];
        out[idx + 3] = src[idx + 3];
        continue;
      }

      let rSum = 0, gSum = 0, bSum = 0;
      let k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nIdx = ((y + ky) * w + (x + kx)) * 4;
          const weight = kernel[k++];
          rSum += src[nIdx] * weight;
          gSum += src[nIdx + 1] * weight;
          bSum += src[nIdx + 2] * weight;
        }
      }

      // Blend antara hasil sharpen penuh dan piksel asli sesuai 'amount'
      out[idx] = clamp(src[idx] * (1 - amount) + rSum * amount, 0, 255);
      out[idx + 1] = clamp(src[idx + 1] * (1 - amount) + gSum * amount, 0, 255);
      out[idx + 2] = clamp(src[idx + 2] * (1 - amount) + bSum * amount, 0, 255);
      out[idx + 3] = src[idx + 3];
    }
  }

  ctx.putImageData(outData, 0, 0);
}


/* ================================================================
   8. WATERMARK: PENGGAMBARAN BAR & METADATA
   ================================================================
   Layout meniru gaya kamera flagship (OPPO x Hasselblad):
   - Kiri  : Nama brand/kamera (bold, huruf besar)
   - Kanan : Logo bulat placeholder + baris metadata teknis
   - Background putih solid, tidak transparan, tidak blur.
   ================================================================ */

function drawWatermarkBar(ctx, x, y, width, height) {
  const wm = state.watermark;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  // --- Background putih solid (tidak transparan) ---
  ctx.fillStyle = WM_COLOR_BG;
  ctx.fillRect(x, y, width, height);

  // Skala proporsional terhadap tinggi bar referensi (agar padding & font
  // konsisten secara visual di berbagai resolusi/ukuran watermark)
  const s = height / WM_REFERENCE_BAR_HEIGHT;

  const padLeft = WM_PADDING_LEFT * s;
  const padRight = WM_PADDING_RIGHT * s;
  const padTop = WM_PADDING_TOP * s;
  const padBottom = WM_PADDING_BOTTOM * s;

  const contentTop = y + padTop;
  const contentBottom = y + height - padBottom;
  const contentHeight = contentBottom - contentTop;
  const contentMidY = y + height / 2;

  // Tentukan sisi kiri/kanan (bisa ditukar via mirrorSides)
  const leftSideX = wm.mirrorSides ? (x + width - padRight) : (x + padLeft);
  const rightSideX = wm.mirrorSides ? (x + padLeft) : (x + width - padRight);
  const leftAlign = wm.mirrorSides ? 'right' : 'left';
  const rightAlign = wm.mirrorSides ? 'left' : 'right';

  ctx.textBaseline = 'alphabetic';

  // ---------------- SISI TEKS BRAND (kiri secara default) ----------------
  if (!wm.hideCameraName) {
    const brandFontSize = Math.round(28 * s);
    const lensFontSize = Math.round(15 * s);
    const gap = 6 * s;

    ctx.textAlign = leftAlign;

    // Brand name (bold, besar)
    ctx.font = `700 ${brandFontSize}px Inter, Roboto, 'Segoe UI', -apple-system, sans-serif`;
    ctx.fillStyle = WM_COLOR_TEXT;
    const brandText = (wm.brand || '').toUpperCase();

    // Lens name (kecil, abu-abu, sebagai sub-label di bawah brand)
    const hasLens = !!(wm.lens && wm.lens.trim());
    if (hasLens) {
      const brandY = contentMidY - gap / 2;
      ctx.fillText(brandText, leftSideX, brandY);

      ctx.font = `italic 600 ${lensFontSize}px Inter, Roboto, 'Segoe UI', -apple-system, sans-serif`;
      ctx.fillStyle = WM_COLOR_META;
      const lensY = brandY + lensFontSize + gap;
      ctx.fillText(wm.lens, leftSideX, lensY);
    } else {
      // Tanpa lens, brand di tengah vertikal konten
      ctx.fillText(brandText, leftSideX, contentMidY + brandFontSize * 0.32);
    }
  }

  // ---------------- SISI KANAN: LOGO + METADATA ----------------
  const metaLines = [];
  if (!wm.hideMetadata) {
    const specParts = [wm.focal, wm.aperture, wm.shutter, wm.iso].filter(Boolean);
    if (specParts.length) metaLines.push(specParts.join('  '));

    const extra = [];
    if (wm.showDate && wm.date) extra.push(formatDateReadable(wm.date));
    if (wm.showTime && wm.time) extra.push(wm.time);
    if (extra.length) metaLines.push(extra.join('   '));

    if (wm.showGps && (wm.lat || wm.lng)) {
      metaLines.push(`${wm.lat || '0.0000'}, ${wm.lng || '0.0000'}`);
    }
  }

  const logoRadius = wm.hideLogo ? 0 : Math.round(20 * s);
  const logoGap = 14 * s;
  const metaFontSize = Math.round(14 * s);
  const metaLineGap = 5 * s;

  // Hitung lebar blok metadata untuk penempatan dari kanan
  ctx.font = `600 ${metaFontSize}px Inter, Roboto, 'Segoe UI', -apple-system, sans-serif`;
  let maxMetaWidth = 0;
  metaLines.forEach((line) => {
    const w = ctx.measureText(line).width;
    if (w > maxMetaWidth) maxMetaWidth = w;
  });

  const totalRightBlockWidth = (wm.hideLogo ? 0 : (logoRadius * 2 + logoGap)) + maxMetaWidth;
  let cursorX = rightSideX;

  if (rightAlign === 'right') {
    cursorX = rightSideX - totalRightBlockWidth;
  }

  // --- Logo bulat placeholder (atau logo kustom milik user) ---
  let metaBlockX = cursorX;
  if (!wm.hideLogo) {
    const logoCenterX = cursorX + logoRadius;
    const logoCenterY = contentMidY;

    if (wm.logoImage) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(logoCenterX, logoCenterY, logoRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        wm.logoImage,
        logoCenterX - logoRadius, logoCenterY - logoRadius,
        logoRadius * 2, logoRadius * 2
      );
      ctx.restore();
    } else {
      drawPlaceholderLogo(ctx, logoCenterX, logoCenterY, logoRadius);
    }
    metaBlockX = cursorX + logoRadius * 2 + logoGap;
  }

  // --- Baris metadata (focal/aperture/shutter/iso, tanggal/jam, gps) ---
  if (metaLines.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = WM_COLOR_META;
    ctx.font = `600 ${metaFontSize}px Inter, Roboto, 'Segoe UI', -apple-system, sans-serif`;

    const totalTextHeight = metaLines.length * metaFontSize + (metaLines.length - 1) * metaLineGap;
    let lineY = contentMidY - totalTextHeight / 2 + metaFontSize * 0.8;

    metaLines.forEach((line) => {
      ctx.fillText(line, metaBlockX, lineY);
      lineY += metaFontSize + metaLineGap;
    });
  }

  ctx.restore();
}

/** Menggambar logo placeholder berbentuk lingkaran sederhana (SVG-style via canvas). */
function drawPlaceholderLogo(ctx, cx, cy, radius) {
  ctx.save();
  // Lingkaran luar
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = WM_COLOR_TEXT;
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.stroke();

  // Lingkaran tengah
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = WM_COLOR_TEXT;
  ctx.lineWidth = Math.max(1, radius * 0.1);
  ctx.stroke();

  // Titik pusat
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = WM_COLOR_TEXT;
  ctx.fill();
  ctx.restore();
}

function formatDateReadable(isoDateStr) {
  // isoDateStr format: YYYY-MM-DD (dari <input type="date">)
  const parts = isoDateStr.split('-');
  if (parts.length !== 3) return isoDateStr;
  const [y, m, d] = parts;
  const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const mi = parseInt(m, 10) - 1;
  return `${parseInt(d, 10)} ${bulan[mi] || m} ${y}`;
}


/* ================================================================
   9. MODE FLOATING WATERMARK: DRAG DENGAN POINTER
   ================================================================
   Saat mode posisi = 'center' (floating), pengguna dapat menyeret
   watermark bar langsung di atas foto menggunakan mouse/sentuhan.
   Sebuah "hitbox" transparan ditempatkan tepat di atas posisi bar
   watermark hasil render, mengikuti ukuran tampilan canvas di layar.
   ================================================================ */

function initWatermarkDrag() {
  const hitbox = dom.wmDragHitbox;
  let dragging = false;
  let startClientX = 0, startClientY = 0;
  let startOffsetX = 0, startOffsetY = 0;

  hitbox.addEventListener('pointerdown', (e) => {
    if (state.watermark.verticalMode !== 'center') return;
    dragging = true;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startOffsetX = state.watermark.floatOffsetX;
    startOffsetY = state.watermark.floatOffsetY;
    hitbox.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });

  hitbox.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.stopPropagation();
    const rect = dom.mainCanvas.getBoundingClientRect();
    const dxRatio = (e.clientX - startClientX) / (rect.width || 1);
    const dyRatio = (e.clientY - startClientY) / (rect.height || 1);
    state.watermark.floatOffsetX = clamp(startOffsetX + dxRatio, -0.4, 0.4);
    state.watermark.floatOffsetY = clamp(startOffsetY + dyRatio, -0.4, 0.4);
    scheduleRender();
  });

  const endDrag = (e) => { dragging = false; };
  hitbox.addEventListener('pointerup', endDrag);
  hitbox.addEventListener('pointercancel', endDrag);
}

/** Menyesuaikan posisi & ukuran hitbox drag agar selalu pas di atas bar watermark pada layar. */
function updateFloatingHitboxPosition() {
  const hitbox = dom.wmDragHitbox;
  if (!state.workingSource) { hitbox.classList.add('hidden'); return; }

  const wm = state.watermark;
  if (wm.verticalMode !== 'center' || wm.hideWatermark) {
    hitbox.classList.add('hidden');
    return;
  }
  hitbox.classList.remove('hidden');

  const canvasW = dom.mainCanvas.width;
  const canvasH = dom.mainCanvas.height;
  const barHeightPx = canvasH * WATERMARK_HEIGHT_RATIO * (wm.sizeScale / 100);
  const baseY = (canvasH - barHeightPx) / 2;
  const barY = clamp(baseY + wm.floatOffsetY * canvasH, 0, canvasH - barHeightPx);
  const barX = wm.floatOffsetX * canvasW;

  // Posisikan hitbox secara relatif (persen) terhadap elemen canvas
  hitbox.style.left = (barX / canvasW * 100) + '%';
  hitbox.style.top = (barY / canvasH * 100) + '%';
  hitbox.style.width = '100%';
  hitbox.style.height = (barHeightPx / canvasH * 100) + '%';
}


/* ================================================================
   10. TOOL CROP (interaktif dengan handle)
   ================================================================
   Menggunakan elemen DOM (.crop-box + .crop-handle) yang ditumpuk di
   atas canvas untuk interaksi geser & ubah ukuran. Koordinat dikonversi
   ke ruang piksel canvas kerja saat "Terapkan Crop" ditekan, lalu
   di-bake menjadi workingSource baru (rotasi/flip ikut di-bake).
   ================================================================ */

let cropBoxEl = null;
let cropHandles = {};
let cropRectNormalized = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; // relatif 0..1 terhadap canvas

function initCropTool() {
  dom.cropBtn.addEventListener('click', enterCropMode);
  dom.cancelCropBtn.addEventListener('click', exitCropMode);
  dom.applyCropBtn.addEventListener('click', applyCrop);
}

function enterCropMode() {
  if (!state.workingSource) return;
  state.isCropping = true;
  dom.canvasViewport.classList.add('cropping');
  dom.cropControls.classList.remove('hidden');

  cropRectNormalized = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
  buildCropBoxDom();
  updateCropBoxDom();
}

function exitCropMode() {
  state.isCropping = false;
  dom.canvasViewport.classList.remove('cropping');
  dom.cropControls.classList.add('hidden');
  if (cropBoxEl) {
    cropBoxEl.remove();
    cropBoxEl = null;
  }
}

function buildCropBoxDom() {
  if (cropBoxEl) cropBoxEl.remove();
  cropBoxEl = document.createElement('div');
  cropBoxEl.className = 'crop-box';

  const positions = ['nw', 'ne', 'sw', 'se'];
  cropHandles = {};
  positions.forEach((pos) => {
    const h = document.createElement('div');
    h.className = 'crop-handle';
    h.dataset.pos = pos;
    cropBoxEl.appendChild(h);
    cropHandles[pos] = h;
  });

  dom.canvasViewport.appendChild(cropBoxEl);
  attachCropBoxEvents();
}

function updateCropBoxDom() {
  if (!cropBoxEl) return;
  const rect = dom.mainCanvas.getBoundingClientRect();
  const viewportRect = dom.canvasViewport.getBoundingClientRect();

  const left = (rect.left - viewportRect.left) + cropRectNormalized.x * rect.width;
  const top = (rect.top - viewportRect.top) + cropRectNormalized.y * rect.height;
  const w = cropRectNormalized.w * rect.width;
  const h = cropRectNormalized.h * rect.height;

  cropBoxEl.style.left = left + 'px';
  cropBoxEl.style.top = top + 'px';
  cropBoxEl.style.width = w + 'px';
  cropBoxEl.style.height = h + 'px';

  const half = 7;
  cropHandles.nw.style.left = -half + 'px'; cropHandles.nw.style.top = -half + 'px';
  cropHandles.ne.style.left = (w - half) + 'px'; cropHandles.ne.style.top = -half + 'px';
  cropHandles.sw.style.left = -half + 'px'; cropHandles.sw.style.top = (h - half) + 'px';
  cropHandles.se.style.left = (w - half) + 'px'; cropHandles.se.style.top = (h - half) + 'px';
}

function attachCropBoxEvents() {
  // Geser seluruh kotak crop
  let mode = null; // 'move' | 'nw' | 'ne' | 'sw' | 'se'
  let startX = 0, startY = 0;
  let startRect = null;

  function onDown(e, m) {
    mode = m;
    startX = e.clientX;
    startY = e.clientY;
    startRect = { ...cropRectNormalized };
    e.stopPropagation();
    e.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  cropBoxEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('crop-handle')) return;
    onDown(e, 'move');
  });
  Object.keys(cropHandles).forEach((pos) => {
    cropHandles[pos].addEventListener('pointerdown', (e) => onDown(e, pos));
  });

  function onMove(e) {
    if (!mode) return;
    const rect = dom.mainCanvas.getBoundingClientRect();
    const dxN = (e.clientX - startX) / rect.width;
    const dyN = (e.clientY - startY) / rect.height;

    let { x, y, w, h } = startRect;

    if (mode === 'move') {
      x = clamp(startRect.x + dxN, 0, 1 - startRect.w);
      y = clamp(startRect.y + dyN, 0, 1 - startRect.h);
    } else {
      if (mode.includes('w')) { x = clamp(startRect.x + dxN, 0, startRect.x + startRect.w - 0.05); w = startRect.w - (x - startRect.x); }
      if (mode.includes('e')) { w = clamp(startRect.w + dxN, 0.05, 1 - startRect.x); }
      if (mode.includes('n')) { y = clamp(startRect.y + dyN, 0, startRect.y + startRect.h - 0.05); h = startRect.h - (y - startRect.y); }
      if (mode.includes('s')) { h = clamp(startRect.h + dyN, 0.05, 1 - startRect.y); }
    }

    cropRectNormalized = { x, y, w, h };
    updateCropBoxDom();
  }

  function onUp() {
    mode = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
}

/** Membakukan (bake) rotasi + flip + crop menjadi workingSource baru. */
function applyCrop() {
  const photo = buildProcessedPhoto(null); // proses di resolusi PENUH agar crop presisi
  const { x, y, w, h } = cropRectNormalized;

  const cropX = Math.round(x * photo.width);
  const cropY = Math.round(y * photo.height);
  const cropW = Math.round(w * photo.width);
  const cropH = Math.round(h * photo.height);

  const newCanvas = makeCanvas(cropW, cropH);
  newCanvas.getContext('2d').drawImage(photo.canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Foto yang sudah di-crop menjadi dasar baru; reset transformasi karena sudah di-bake.
  // Catatan: filter warna TIDAK ikut di-bake (tetap dapat diatur ulang / dilanjutkan)
  // agar histori edit lebih fleksibel — namun karena filter sudah "terpanggang" di photo
  // (buildProcessedPhoto menyertakan filter), kita reset slider filter ke netral supaya
  // tidak diterapkan dua kali pada workingSource yang baru.
  state.workingSource = newCanvas;
  state.workingWidth = cropW;
  state.workingHeight = cropH;
  state.rotation = 0;
  state.flipH = false;
  state.flipV = false;

  Object.assign(state.filters, {
    brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
    shadow: 0, highlight: 0, sharpen: 0, blur: 0,
  });
  syncFilterInputsFromState();

  exitCropMode();
  scheduleRender();
  showToast('Crop diterapkan');
}


/* ================================================================
   11. BINDING KONTROL UI (slider, tombol, input)
   ================================================================ */

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

function initAdjustControls() {
  // Helper generik untuk slider filter: mengikat input range ke state.filters[key]
  function bindSlider(sliderEl, valueEl, key, suffix = '') {
    sliderEl.addEventListener('input', () => {
      state.filters[key] = parseInt(sliderEl.value, 10);
      valueEl.textContent = sliderEl.value + suffix;
      scheduleRender();
    });
  }

  bindSlider(dom.brightnessSlider, dom.brightnessValue, 'brightness');
  bindSlider(dom.contrastSlider, dom.contrastValue, 'contrast');
  bindSlider(dom.saturationSlider, dom.saturationValue, 'saturation');
  bindSlider(dom.temperatureSlider, dom.temperatureValue, 'temperature');
  bindSlider(dom.tintSlider, dom.tintValue, 'tint');
  bindSlider(dom.shadowSlider, dom.shadowValue, 'shadow');
  bindSlider(dom.highlightSlider, dom.highlightValue, 'highlight');
  bindSlider(dom.sharpenSlider, dom.sharpenValue, 'sharpen');
  bindSlider(dom.blurSlider, dom.blurValue, 'blur');
  bindSlider(dom.opacitySlider, dom.opacityValue, 'opacity');

  // --- Transformasi ---
  dom.rotateLeftBtn.addEventListener('click', () => {
    state.rotation = (state.rotation + 270) % 360;
    scheduleRender();
  });
  dom.rotateRightBtn.addEventListener('click', () => {
    state.rotation = (state.rotation + 90) % 360;
    scheduleRender();
  });
  dom.flipHBtn.addEventListener('click', () => {
    state.flipH = !state.flipH;
    scheduleRender();
  });
  dom.flipVBtn.addEventListener('click', () => {
    state.flipV = !state.flipV;
    scheduleRender();
  });
  dom.resetAdjustBtn.addEventListener('click', () => {
    state.rotation = 0;
    state.flipH = false;
    state.flipV = false;
    Object.assign(state.filters, {
      brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
      shadow: 0, highlight: 0, sharpen: 0, blur: 0, opacity: 100,
    });
    syncFilterInputsFromState();
    scheduleRender();
    showToast('Penyesuaian direset');
  });
}

function initWatermarkControls() {
  const wm = state.watermark;

  function bindText(el, key) {
    el.addEventListener('input', () => {
      wm[key] = el.value;
      scheduleRender();
    });
  }
  bindText(dom.brandInput, 'brand');
  bindText(dom.lensInput, 'lens');
  bindText(dom.focalInput, 'focal');
  bindText(dom.apertureInput, 'aperture');
  bindText(dom.shutterInput, 'shutter');
  bindText(dom.isoInput, 'iso');
  bindText(dom.latInput, 'lat');
  bindText(dom.lngInput, 'lng');

  dom.dateInput.addEventListener('input', () => { wm.date = dom.dateInput.value; scheduleRender(); });
  dom.timeInput.addEventListener('input', () => { wm.time = dom.timeInput.value; scheduleRender(); });

  function bindCheckToggleField(checkEl, key, fieldRowEl) {
    checkEl.addEventListener('change', () => {
      wm[key] = checkEl.checked;
      if (fieldRowEl) fieldRowEl.style.display = checkEl.checked ? '' : 'none';
      scheduleRender();
    });
  }
  bindCheckToggleField(dom.showDateCheck, 'showDate', dom.dateFieldRow);
  bindCheckToggleField(dom.showTimeCheck, 'showTime', dom.timeFieldRow);
  bindCheckToggleField(dom.showGpsCheck, 'showGps', dom.gpsFieldRow);

  // Isi default tanggal/jam dengan waktu saat ini agar langsung terlihat saat dicentang
  const now = new Date();
  dom.dateInput.value = now.toISOString().slice(0, 10);
  dom.timeInput.value = now.toTimeString().slice(0, 5);
  wm.date = dom.dateInput.value;
  wm.time = dom.timeInput.value;

  function bindHideCheck(checkEl, key) {
    checkEl.addEventListener('change', () => {
      wm[key] = checkEl.checked;
      scheduleRender();
    });
  }
  bindHideCheck(dom.hideLogoCheck, 'hideLogo');
  bindHideCheck(dom.hideCameraNameCheck, 'hideCameraName');
  bindHideCheck(dom.hideMetadataCheck, 'hideMetadata');
  bindHideCheck(dom.hideWatermarkCheck, 'hideWatermark');

  // --- Logo kustom ---
  dom.logoUpload.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        wm.logoImage = img;
        scheduleRender();
        showToast('Logo kustom diterapkan');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  dom.resetLogoBtn.addEventListener('click', () => {
    wm.logoImage = null;
    scheduleRender();
    showToast('Kembali ke logo placeholder');
  });

  // --- Posisi watermark ---
  const posButtons = document.querySelectorAll('.pos-btn[data-pos]');
  posButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const pos = btn.dataset.pos;

      if (pos === 'top' || pos === 'bottom' || pos === 'center') {
        wm.verticalMode = pos;
        document.querySelectorAll('.pos-btn[data-pos="top"], .pos-btn[data-pos="bottom"], .pos-btn[data-pos="center"]')
          .forEach((b) => b.classList.toggle('active', b === btn));
        wm.floatOffsetX = 0;
        wm.floatOffsetY = 0;
      } else if (pos === 'left' || pos === 'right') {
        wm.mirrorSides = (pos === 'right');
        document.querySelectorAll('.pos-btn[data-pos="left"], .pos-btn[data-align="stretch"], .pos-btn[data-pos="right"]')
          .forEach((b) => b.classList.toggle('active', b === btn));
      }
      scheduleRender();
    });
  });
  // Tombol "Full Width" (data-align=stretch) hanya menonaktifkan mirror
  document.querySelector('.pos-btn[data-align="stretch"]').addEventListener('click', function () {
    wm.mirrorSides = false;
    document.querySelectorAll('.pos-btn[data-pos="left"], .pos-btn[data-align="stretch"], .pos-btn[data-pos="right"]')
      .forEach((b) => b.classList.toggle('active', b === this));
    scheduleRender();
  });

  // --- Ukuran watermark ---
  dom.sizeSlider.addEventListener('input', () => {
    wm.sizeScale = parseInt(dom.sizeSlider.value, 10);
    dom.sizeValue.textContent = wm.sizeScale + '%';
    scheduleRender();
  });
}

function initExportControls() {
  const formatBtns = document.querySelectorAll('.format-btn');
  formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      formatBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.exportFormat = btn.dataset.format;
    });
  });

  dom.exportBtn.addEventListener('click', exportImage);

  dom.newPhotoBtn.addEventListener('click', () => {
    dom.canvasWrapper.classList.add('hidden');
    dom.emptyState.classList.remove('hidden');
    state.originalImage = null;
    state.workingSource = null;
  });
}


/* ================================================================
   12. EXPORT GAMBAR (PNG/JPG/WEBP, RESOLUSI PENUH)
   ================================================================
   Menjalankan ulang seluruh pipeline (transform + filter + watermark)
   pada RESOLUSI ASLI (tanpa batas PREVIEW_MAX_DIM) agar hasil unduhan
   memiliki kualitas 100% dan resolusi gambar sumber tetap terjaga.
   ================================================================ */

function exportImage() {
  if (!state.workingSource) {
    showToast('Unggah foto terlebih dahulu');
    return;
  }

  showToast('Memproses gambar penuh resolusi…');

  // Beri jeda 1 frame agar toast sempat tampil sebelum proses berat berjalan
  requestAnimationFrame(() => {
    setTimeout(() => {
      const photo = buildProcessedPhoto(null); // null = resolusi penuh, tanpa downscale
      const finalCanvas = composeFinalCanvas(photo);

      const format = state.exportFormat;
      let mimeType = 'image/png';
      let quality = 1.0;
      let ext = 'png';

      if (format === 'jpg') { mimeType = 'image/jpeg'; ext = 'jpg'; }
      if (format === 'webp') { mimeType = 'image/webp'; ext = 'webp'; }

      finalCanvas.toBlob((blob) => {
        if (!blob) {
          showToast('Gagal membuat file ekspor');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `pro-watermark-${timestamp}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast('Berhasil diunduh: ' + a.download);
      }, mimeType, quality);
    }, 30);
  });
}


/* ================================================================
   13. SERVICE WORKER REGISTRATION (PWA)
   ================================================================ */

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.warn('Registrasi Service Worker gagal:', err);
      });
    });
  }
}


/* ================================================================
   14. INISIALISASI APLIKASI
   ================================================================ */

function cacheDomReferences() {
  dom = {
    // Splash & header
    splashScreen: document.getElementById('splashScreen'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIconMoon: document.getElementById('themeIconMoon'),

    // Canvas area
    canvasArea: document.getElementById('canvasArea'),
    emptyState: document.getElementById('emptyState'),
    canvasWrapper: document.getElementById('canvasWrapper'),
    canvasViewport: document.getElementById('canvasViewport'),
    mainCanvas: document.getElementById('mainCanvas'),
    fileInput: document.getElementById('fileInput'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    resetViewBtn: document.getElementById('resetViewBtn'),

    // Adjust tab
    rotateLeftBtn: document.getElementById('rotateLeftBtn'),
    rotateRightBtn: document.getElementById('rotateRightBtn'),
    flipHBtn: document.getElementById('flipHBtn'),
    flipVBtn: document.getElementById('flipVBtn'),
    cropBtn: document.getElementById('cropBtn'),
    resetAdjustBtn: document.getElementById('resetAdjustBtn'),
    cropControls: document.getElementById('cropControls'),
    applyCropBtn: document.getElementById('applyCropBtn'),
    cancelCropBtn: document.getElementById('cancelCropBtn'),

    brightnessSlider: document.getElementById('brightnessSlider'),
    brightnessValue: document.getElementById('brightnessValue'),
    contrastSlider: document.getElementById('contrastSlider'),
    contrastValue: document.getElementById('contrastValue'),
    saturationSlider: document.getElementById('saturationSlider'),
    saturationValue: document.getElementById('saturationValue'),
    temperatureSlider: document.getElementById('temperatureSlider'),
    temperatureValue: document.getElementById('temperatureValue'),
    tintSlider: document.getElementById('tintSlider'),
    tintValue: document.getElementById('tintValue'),
    shadowSlider: document.getElementById('shadowSlider'),
    shadowValue: document.getElementById('shadowValue'),
    highlightSlider: document.getElementById('highlightSlider'),
    highlightValue: document.getElementById('highlightValue'),
    sharpenSlider: document.getElementById('sharpenSlider'),
    sharpenValue: document.getElementById('sharpenValue'),
    blurSlider: document.getElementById('blurSlider'),
    blurValue: document.getElementById('blurValue'),
    opacitySlider: document.getElementById('opacitySlider'),
    opacityValue: document.getElementById('opacityValue'),

    // Watermark tab
    brandInput: document.getElementById('brandInput'),
    lensInput: document.getElementById('lensInput'),
    focalInput: document.getElementById('focalInput'),
    apertureInput: document.getElementById('apertureInput'),
    shutterInput: document.getElementById('shutterInput'),
    isoInput: document.getElementById('isoInput'),
    showDateCheck: document.getElementById('showDateCheck'),
    dateFieldRow: document.getElementById('dateFieldRow'),
    dateInput: document.getElementById('dateInput'),
    showTimeCheck: document.getElementById('showTimeCheck'),
    timeFieldRow: document.getElementById('timeFieldRow'),
    timeInput: document.getElementById('timeInput'),
    showGpsCheck: document.getElementById('showGpsCheck'),
    gpsFieldRow: document.getElementById('gpsFieldRow'),
    latInput: document.getElementById('latInput'),
    lngInput: document.getElementById('lngInput'),
    logoUpload: document.getElementById('logoUpload'),
    resetLogoBtn: document.getElementById('resetLogoBtn'),
    hideLogoCheck: document.getElementById('hideLogoCheck'),
    hideCameraNameCheck: document.getElementById('hideCameraNameCheck'),
    hideMetadataCheck: document.getElementById('hideMetadataCheck'),
    hideWatermarkCheck: document.getElementById('hideWatermarkCheck'),
    sizeSlider: document.getElementById('sizeSlider'),
    sizeValue: document.getElementById('sizeValue'),

    // Export tab
    exportBtn: document.getElementById('exportBtn'),
    newPhotoBtn: document.getElementById('newPhotoBtn'),
    dimensionInfo: document.getElementById('dimensionInfo'),

    // Toast
    toast: document.getElementById('toast'),
  };
}

function createWatermarkDragHitbox() {
  const hitbox = document.createElement('div');
  hitbox.className = 'wm-drag-hitbox';
  hitbox.style.position = 'absolute';
  hitbox.style.cursor = 'move';
  hitbox.style.touchAction = 'none';
  hitbox.style.background = 'transparent';
  dom.canvasViewport.appendChild(hitbox);
  dom.wmDragHitbox = hitbox;
}

function initApp() {
  cacheDomReferences();
  createWatermarkDragHitbox();

  initTheme();
  initFileUpload();
  initViewInteractions();
  initTabs();
  initAdjustControls();
  initWatermarkControls();
  initCropTool();
  initWatermarkDrag();
  initExportControls();
  registerServiceWorker();

  // Sembunyikan splash screen setelah aplikasi siap
  setTimeout(() => {
    if (dom.splashScreen) dom.splashScreen.style.display = 'none';
  }, 1300);
}

// Mulai aplikasi setelah DOM siap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
