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
    await loadGallery();
    document.querySelector(".gallery-section").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    statusEl.textContent = "പിശക്: " + err.message;
  } finally {
    publishBtn.disabled = false;
  }
});

// ---------- Gallery ----------
async function loadGallery() {
  try {
    const res = await fetch("/api/photos");
    const { photos } = await res.json();
    gallery.innerHTML = "";
    galleryEmpty.hidden = photos.length > 0;

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

      card.append(label, img, meta);
      gallery.appendChild(card);
    });
  } catch {
    galleryEmpty.hidden = false;
    galleryEmpty.textContent = "റിപ്പോർട്ടുകൾ ലഭ്യമല്ല. പിന്നീട് ശ്രമിക്കുക.";
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadGallery();
