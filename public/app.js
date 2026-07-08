// ---------- Dateline ----------
document.getElementById("dateline").textContent = new Date().toLocaleDateString("ml-IN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

// ---------- Elements ----------
const fileInput = document.getElementById("file-input");
const modal = document.getElementById("crop-modal");
const viewport = document.getElementById("crop-viewport");
const cropImg = document.getElementById("crop-img");
const zoomSlider = document.getElementById("zoom");
const publishBtn = document.getElementById("publish-btn");
const cancelBtn = document.getElementById("cancel-btn");
const statusEl = document.getElementById("upload-status");
const gallery = document.getElementById("gallery");
const galleryEmpty = document.getElementById("gallery-empty");

// ---------- Crop state ----------
let natW = 0, natH = 0;   // natural image size
let minScale = 1, scale = 1;
let x = 0, y = 0;         // image top-left within viewport
let objectUrl = null;

function viewportSize() {
  return viewport.clientWidth;
}

function clamp() {
  const V = viewportSize();
  x = Math.min(0, Math.max(V - natW * scale, x));
  y = Math.min(0, Math.max(V - natH * scale, y));
}

function render() {
  cropImg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function openCropper(file) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  cropImg.onload = () => {
    natW = cropImg.naturalWidth;
    natH = cropImg.naturalHeight;
    cropImg.style.width = natW + "px";
    const V = viewportSize();
    minScale = V / Math.min(natW, natH);
    scale = minScale;
    zoomSlider.value = 100;
    x = (V - natW * scale) / 2;
    y = (V - natH * scale) / 2;
    render();
  };
  cropImg.src = objectUrl;
  statusEl.textContent = "";
  modal.hidden = false;
}

function closeCropper() {
  modal.hidden = true;
  fileInput.value = "";
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    alert("ഫയൽ വളരെ വലുതാണ് (പരമാവധി 15 MB)");
    fileInput.value = "";
    return;
  }
  openCropper(file);
});

cancelBtn.addEventListener("click", closeCropper);

// ---------- Drag ----------
let dragging = false, startX = 0, startY = 0, originX = 0, originY = 0;

viewport.addEventListener("pointerdown", (e) => {
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  originX = x;
  originY = y;
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  x = originX + (e.clientX - startX);
  y = originY + (e.clientY - startY);
  clamp();
  render();
});

viewport.addEventListener("pointerup", () => { dragging = false; });
viewport.addEventListener("pointercancel", () => { dragging = false; });

// ---------- Zoom (around viewport center) ----------
zoomSlider.addEventListener("input", () => {
  const V = viewportSize();
  const newScale = minScale * (Number(zoomSlider.value) / 100);
  const cx = (V / 2 - x) / scale;
  const cy = (V / 2 - y) / scale;
  scale = newScale;
  x = V / 2 - cx * scale;
  y = V / 2 - cy * scale;
  clamp();
  render();
});

// ---------- Crop + compress + upload ----------
const TARGET_BYTES = 300 * 1024; // final upload stays under ~300 KB

function drawCrop(size) {
  const V = viewportSize();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cropImg, -x / scale, -y / scale, V / scale, V / scale, 0, 0, size, size);
  return canvas;
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function cropToBlob() {
  // walk down quality, then resolution, until under target size
  const attempts = [
    [800, 0.88], [800, 0.75], [800, 0.6],
    [640, 0.6], [512, 0.55],
  ];
  let blob = null;
  for (const [size, quality] of attempts) {
    blob = await toBlob(drawCrop(size), quality);
    if (blob && blob.size <= TARGET_BYTES) return blob;
  }
  return blob; // worst case: 512px @ 0.55, essentially always < 300 KB
}

publishBtn.addEventListener("click", async () => {
  if (!natW) return;
  publishBtn.disabled = true;
  statusEl.textContent = "അച്ചടിക്കുന്നു…";
  try {
    const blob = await cropToBlob();
    statusEl.textContent = `അച്ചടിക്കുന്നു… (${Math.round(blob.size / 1024)} KB)`;
    const form = new FormData();
    form.append("photo", blob, "kurup.jpg");
    form.append("reporter", document.getElementById("reporter").value);
    form.append("location", document.getElementById("location").value);
    form.append("details", document.getElementById("details").value);

    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "upload failed");

    closeCropper();
    document.getElementById("reporter").value = "";
    document.getElementById("location").value = "";
    document.getElementById("details").value = "";
    const photos = await loadGallery();
    if (photos.length) await showPoster(photos[0], photos.length);
  } catch (err) {
    statusEl.textContent = "പിശക്: " + err.message;
  } finally {
    publishBtn.disabled = false;
  }
});

// ---------- Evidence poster (Instagram story 1080x1920) ----------
const SITE_LINK = "kurup.radr.in";
const posterModal = document.getElementById("poster-modal");
const posterPreview = document.getElementById("poster-preview");
const posterShareBtn = document.getElementById("poster-share-btn");
const posterDownloadBtn = document.getElementById("poster-download-btn");
let posterBlob = null;

document.getElementById("poster-close-btn").addEventListener("click", () => {
  posterModal.hidden = true;
});

function breakLongWord(ctx, word, maxWidth) {
  // hard-break a word that alone exceeds the line width
  const parts = [];
  let piece = "";
  for (const ch of word) {
    if (ctx.measureText(piece + ch).width > maxWidth && piece) {
      parts.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) parts.push(piece);
  return parts;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).flatMap((w) =>
    ctx.measureText(w).width > maxWidth ? breakLongWord(ctx, w, maxWidth) : [w]
  );
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function clampLines(ctx, lines, maxLines, maxWidth) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(last + "…").width > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = last + "…";
  return kept;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// manual sepia so iOS Safari (no canvas filter support) renders identically
function sepiaSquare(img, size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gr = px[i + 1], b = px[i + 2];
    px[i] = Math.min(255, r * 0.72 + gr * 0.55 + b * 0.14);
    px[i + 1] = Math.min(255, r * 0.42 + gr * 0.62 + b * 0.12);
    px[i + 2] = Math.min(255, r * 0.28 + gr * 0.40 + b * 0.33);
  }
  g.putImageData(d, 0, 0);
  return c;
}

const POSTER_FONT = '"Noto Serif Malayalam"';

async function ensurePosterFonts() {
  const styles = ["800 64px", "800 52px", "800 76px", "italic 400 44px", "600 44px", "600 40px", "800 54px"];
  try {
    await Promise.all(styles.map((s) => document.fonts.load(`${s} ${POSTER_FONT}`, "കുറുപ്പ് ഉണ്ടോ?")));
  } catch { /* fall back to whatever is available */ }
  await document.fonts.ready;
}

async function makePoster(p, number) {
  await ensurePosterFonts();
  const W = 1080, H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // every text draw sets its full state; nothing depends on leftover ctx state
  function text(str, x, y, font, color, align = "center") {
    ctx.font = `${font} ${POSTER_FONT}, serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(str, x, y);
  }
  function measureLines(str, font, maxWidth) {
    ctx.font = `${font} ${POSTER_FONT}, serif`;
    return wrapText(ctx, str, maxWidth);
  }
  function rule(y, weight) {
    ctx.strokeStyle = "#2b251c";
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(140, y);
    ctx.lineTo(W - 140, y);
    ctx.stroke();
  }

  // aged paper background
  ctx.fillStyle = "#e8ddc4";
  ctx.fillRect(0, 0, W, H);
  const stains = [[90, 120, 260, "rgba(120,85,40,.14)"], [1000, 1800, 320, "rgba(110,78,35,.16)"], [950, 260, 150, "rgba(122,84,36,.10)"], [160, 1700, 190, "rgba(120,85,40,.12)"]];
  for (const [sx, sy, sr, color] of stains) {
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // double frame: solid outer, dashed inner
  ctx.strokeStyle = "#2b251c";
  ctx.setLineDash([]);
  ctx.lineWidth = 5;
  ctx.strokeRect(45, 45, W - 90, H - 90);
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 2;
  ctx.strokeRect(72, 72, W - 144, H - 144);
  ctx.setLineDash([]);

  // masthead
  text("കുറുപ്പ് ഉണ്ടോ?", W / 2, 150, "800 56px", "#1e1a14");
  rule(182, 3);
  rule(190, 3);

  // evidence header
  text(`തെളിവ് നം. ${number}`, W / 2, 262, "800 48px", "#7a1f1f");
  text("ഇയാളെ കണ്ടിട്ടുണ്ടോ?", W / 2, 352, "800 64px", "#1e1a14");

  // photo, sepia, framed
  const img = await loadImage("/img/" + encodeURIComponent(p.key));
  const P = 520, px = (W - P) / 2, py = 400;
  ctx.drawImage(sepiaSquare(img, P), px, py);
  ctx.strokeStyle = "#2b251c";
  ctx.lineWidth = 5;
  ctx.strokeRect(px, py, P, P);
  ctx.lineWidth = 2;
  ctx.strokeRect(px - 12, py - 12, P + 24, P + 24);

  // details quote + meta, clamped with ellipsis so nothing escapes the frame
  let y = py + P + 75;
  if (p.details) {
    const quoteLines = clampLines(ctx, measureLines(`"${p.details}"`, "italic 400 40px", 860), 3, 860);
    for (const line of quoteLines) {
      text(line, W / 2, y, "italic 400 40px", "#1e1a14");
      y += 56;
    }
    y += 14;
  }
  const date = new Date(p.uploaded).toLocaleDateString("ml-IN", { day: "numeric", month: "long", year: "numeric" });
  const metaLines = [];
  if (p.location) metaLines.push(`സ്ഥലം: ${p.location}`);
  if (p.reporter) metaLines.push(`സാക്ഷി: ${p.reporter}`);
  metaLines.push(date);
  for (const line of metaLines) {
    const [sub] = clampLines(ctx, measureLines(line, "600 40px", 860), 1, 860);
    text(sub, W / 2, y, "600 40px", "#4a4238");
    y += 52;
  }

  // footer with site link
  rule(H - 190, 3);
  text("നിങ്ങളും കണ്ടോ? തെളിവ് സമർപ്പിക്കുക", W / 2, H - 125, "600 38px", "#1e1a14");
  text(SITE_LINK, W / 2, H - 62, "800 50px", "#7a1f1f");

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function showPoster(p, number) {
  try {
    posterBlob = await makePoster(p, number);
    const url = URL.createObjectURL(posterBlob);
    posterPreview.src = url;
    posterDownloadBtn.href = url;
    posterDownloadBtn.download = `kurup-evidence-${number}.jpg`;
    posterModal.hidden = false;
  } catch (err) {
    alert("പോസ്റ്റർ ഉണ്ടാക്കാനായില്ല: " + err.message);
  }
}

posterShareBtn.addEventListener("click", async () => {
  if (!posterBlob) return;
  const file = new File([posterBlob], "kurup-evidence.jpg", { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `നിങ്ങൾ സുകുമാരക്കുറുപ്പിനെ കണ്ടിട്ടുണ്ടോ? https://${SITE_LINK}` });
    } catch { /* user cancelled */ }
  } else {
    posterDownloadBtn.click();
  }
});

// ---------- Gallery ----------
async function loadGallery() {
  try {
    const res = await fetch("/api/photos");
    const { photos } = await res.json();
    gallery.innerHTML = "";
    galleryEmpty.hidden = photos.length > 0;
    renderGallery(photos);
    return photos;
  } catch {
    galleryEmpty.hidden = false;
    galleryEmpty.textContent = "റിപ്പോർട്ടുകൾ ലഭ്യമല്ല. പിന്നീട് ശ്രമിക്കുക.";
    return [];
  }
}

function renderGallery(photos) {

    photos.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "notice";

      const label = document.createElement("div");
      label.className = "notice-label";
      label.textContent = `തെളിവ് നം. ${photos.length - i}: ഇയാളെ കണ്ടിട്ടുണ്ടോ?`;

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = "/img/" + encodeURIComponent(p.key);
      img.alt = "സുകുമാരക്കുറുപ്പിനെ കണ്ടതായി സമർപ്പിച്ച തെളിവ്";

      const meta = document.createElement("div");
      meta.className = "notice-meta";
      const date = new Date(p.uploaded).toLocaleDateString("ml-IN", { day: "numeric", month: "short", year: "numeric" });
      const det = p.details ? `<em class="notice-details">"${escapeHtml(p.details)}"</em>` : "";
      const loc = p.location ? `<strong>സ്ഥലം:</strong> ${escapeHtml(p.location)}<br>` : "";
      const rep = p.reporter ? `<strong>സാക്ഷി:</strong> ${escapeHtml(p.reporter)}<br>` : "";
      meta.innerHTML = `${det}${loc}${rep}${date}`;

      const posterBtn = document.createElement("button");
      posterBtn.className = "notice-poster-btn";
      posterBtn.type = "button";
      posterBtn.textContent = "🗞️ പോസ്റ്റർ";
      posterBtn.addEventListener("click", () => showPoster(p, photos.length - i));

      card.append(label, img, meta, posterBtn);
      gallery.appendChild(card);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadGallery();
