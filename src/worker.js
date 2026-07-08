const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    if (url.pathname === "/api/photos" && request.method === "GET") {
      return handleList(env);
    }

    if (url.pathname.startsWith("/img/") && request.method === "GET") {
      return handleImage(url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleUpload(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid form data" }, 400);
  }

  const file = form.get("photo");
  if (!(file instanceof File)) {
    return json({ error: "photo missing" }, 400);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: "only jpeg/png/webp allowed" }, 400);
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return json({ error: "file must be under 5 MB" }, 400);
  }

  const reporter = clean(form.get("reporter"), 60);
  const location = clean(form.get("location"), 120);
  const details = clean(form.get("details"), 300);

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `p/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { reporter, location, details },
  });

  return json({ ok: true, key });
}

async function handleList(env) {
  const photos = [];
  let cursor;
  do {
    const page = await env.PHOTOS.list({
      prefix: "p/",
      cursor,
      include: ["customMetadata"],
    });
    for (const obj of page.objects) {
      photos.push({
        key: obj.key,
        uploaded: obj.uploaded,
        reporter: obj.customMetadata?.reporter || "",
        location: obj.customMetadata?.location || "",
        details: obj.customMetadata?.details || "",
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && photos.length < 1000);

  photos.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

  return json({ photos }, 200, { "cache-control": "no-store" });
}

async function handleImage(url, env) {
  const key = decodeURIComponent(url.pathname.slice("/img/".length));
  if (!key.startsWith("p/")) return new Response("not found", { status: 404 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  return new Response(obj.body, { headers });
}

function clean(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n<>]/g, " ").trim().slice(0, maxLen);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
