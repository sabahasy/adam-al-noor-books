import { createClient } from "@supabase/supabase-js";

const STORE_URL = "https://project-akmpg.vercel.app/";

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || "https://smsqjmgbrkgxyhkaitao.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير موجود.");
  return createClient(url, key);
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return cleanText(value)
    .replace(/[\u0640]/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase();
}

function makeCaption(book) {
  const title = cleanText(book.title_ar || book.title || "كتاب جديد");
  const description = cleanText(book.description_ar || book.description || "");
  const short = description ? description.slice(0, 420) : "كتاب إلكتروني مميز من متجر آدم النور، اختره الآن وابدأ القراءة مباشرة.";
  return `📚 ${title}

${short}

✨ متوفر الآن في متجر آدم النور للكتب الإلكترونية.
🛒 اطلب نسختك واستمتع بالقراءة من هاتفك بسهولة.

🔗 ${STORE_URL}

#آدم_النور #كتب_إلكترونية #كتب #قراءة #ثقافة`;
}

export async function findBook(title) {
  const sb = supabaseAdmin();
  const q = cleanText(title);
  const normalizedQuery = normalizeSearchText(q);
  if (!q) throw new Error("اكتب اسم الكتاب بعد أمر النشر.");

  // عناوين المتجر قد تحتوي على تطويل عربي (مثل: كوالــيس العقــل).
  // لذلك نطبّع العنوان ثم نبحث داخل النتائج بدل الاعتماد على ilike مباشرة.
  const { data, error } = await sb
    .from("books")
    .select("*")
    .eq("is_available", true)
    .order("id", { ascending: false })
    .limit(500);

  if (error) throw new Error("تعذر البحث عن الكتاب: " + error.message);

  const matches = (data || []).filter(book => {
    const normalizedTitle = normalizeSearchText(book.title_ar || book.title || "");
    return normalizedTitle.includes(normalizedQuery);
  });

  if (!matches.length) throw new Error("لم أجد كتابًا يطابق: " + q);
  return matches[0];
}

async function graph(path, options = {}) {
  const version = process.env.META_GRAPH_VERSION || "v24.0";
  const url = `https://graph.facebook.com/${version}/${path}`;
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error?.message || `Meta API error ${response.status}`);
  return data;
}

export async function publishFacebook(caption, imageUrl) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) return { ok:false, platform:"facebook", message:"Facebook غير موصول بعد." };

  if (imageUrl) {
    const data = await graph(`${pageId}/photos?access_token=${encodeURIComponent(token)}&url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&published=true`, { method:"POST" });
    return { ok:true, platform:"facebook", id:data.id || data.post_id || "" };
  }

  const body = new URLSearchParams({ message:caption, access_token:token });
  const data = await graph(`${pageId}/feed`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body });
  return { ok:true, platform:"facebook", id:data.id || "" };
}

export async function publishInstagram(caption, imageUrl) {
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!igId || !token) return { ok:false, platform:"instagram", message:"Instagram غير موصول بعد." };
  if (!imageUrl) return { ok:false, platform:"instagram", message:"Instagram يحتاج رابط صورة عامة للمنشور." };

  const createBody = new URLSearchParams({
    image_url:imageUrl,
    caption,
    access_token:token
  });
  const created = await graph(`${igId}/media`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:createBody });
  const publishBody = new URLSearchParams({ creation_id:created.id, access_token:token });
  const published = await graph(`${igId}/media_publish`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:publishBody });
  return { ok:true, platform:"instagram", id:published.id || "" };
}

export async function listPublishDestinations() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("publish_destinations")
    .select("id,name,url,kind,enabled,created_at")
    .eq("enabled", true)
    .order("id", { ascending: true });
  if (error) throw new Error("تعذر تحميل أماكن النشر: " + error.message);
  return data || [];
}

export async function addPublishDestination(name, url = "", kind = "facebook") {
  const sb = supabaseAdmin();
  const cleanName = cleanText(name);
  const cleanUrl = cleanText(url);
  if (!cleanName) throw new Error("اكتب اسم المكان.");
  const { data, error } = await sb
    .from("publish_destinations")
    .insert({ name: cleanName, url: cleanUrl || null, kind: cleanText(kind) || "facebook", enabled: true })
    .select("id,name,url,kind,enabled")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("هذا المكان مضاف مسبقًا.");
    throw new Error("تعذر إضافة المكان: " + error.message);
  }
  return data;
}

export async function removePublishDestination(id) {
  const sb = supabaseAdmin();
  const destinationId = Number(id);
  if (!Number.isInteger(destinationId)) throw new Error("رقم المكان غير صحيح.");
  const { error } = await sb.from("publish_destinations").delete().eq("id", destinationId);
  if (error) throw new Error("تعذر حذف المكان: " + error.message);
  return { ok: true, id: destinationId };
}

export async function publishTelegram(caption, imageUrl) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = String(process.env.TELEGRAM_TARGET_CHAT_IDS || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (!token || !chatIds.length) return { ok:false, platform:"telegram", message:"Telegram غير موصول بعد." };

  const results = [];
  for (const chatId of chatIds) {
    let url = `https://api.telegram.org/bot${token}/sendMessage`;
    let body = { chat_id:chatId, text:caption, disable_web_page_preview:false };
    if (imageUrl) {
      url = `https://api.telegram.org/bot${token}/sendPhoto`;
      body = { chat_id:chatId, photo:imageUrl, caption:caption };
    }
    const r = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d?.description || "Telegram API error");
    results.push(chatId);
  }
  return { ok:true, platform:"telegram", targets:results };
}

export async function publishTikTok() {
  return {
    ok:false,
    platform:"tiktok",
    message:"TikTok يحتاج ربط Content Posting API وموافقة الحساب أولًا؛ سأفعّله بعد ربط حسابك."
  };
}

export async function publishBook(book, platforms = ["telegram","facebook","instagram","tiktok"]) {
  const caption = makeCaption(book);
  const imageUrl = book.cover_url || book.image_url || book.cover || book.thumbnail_url || null;
  const results = [];

  for (const platform of platforms) {
    try {
      if (platform === "telegram") results.push(await publishTelegram(caption, imageUrl));
      else if (platform === "facebook") results.push(await publishFacebook(caption, imageUrl));
      else if (platform === "instagram") results.push(await publishInstagram(caption, imageUrl));
      else if (platform === "tiktok") results.push(await publishTikTok());
    } catch (error) {
      results.push({ ok:false, platform, message:error?.message || "فشل النشر" });
    }
  }

  return { book, caption, results };
}
