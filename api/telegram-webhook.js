import {
  findBook,
  publishBook,
  listPublishDestinations,
  addPublishDestination,
  removePublishDestination
} from "./publish-engine.js";

function replyKeyboard() {
  return {
    keyboard: [
      [{ text:"📚 نشر كتاب" }, { text:"📝 معاينة منشور" }],
      [{ text:"ℹ️ طريقة الاستخدام" }]
    ],
    resize_keyboard:true,
    is_persistent:true
  };
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN غير موجود في إعدادات Vercel.");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d?.description || "Telegram error");
  return d;
}

function adminChatId() {
  return String(process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
}

function allowed(chatId) {
  const admin = adminChatId();
  return admin && String(chatId) === admin;
}

function destinationsText(destinations) {
  if (!destinations.length) return "📋 لا توجد أماكن نشر محفوظة بعد.\n\nأضف أول مكان بهذا الشكل:\n/إضافة_مكان اسم المكان | الرابط";
  return "📋 أماكن النشر المحفوظة:\n\n" +
    destinations.map((d, i) => `${i + 1}️⃣ #${d.id} — ${d.name}${d.url ? `\n🔗 ${d.url}` : ""}`).join("\n\n");
}

function helpText() {
  return `🤖 بوت نشر آدم النور

الأوامر:

/نشر اسم الكتاب
ينشر الكتاب على المنصات المتصلة.

/معاينة اسم الكتاب
يعرض لك المنشور قبل النشر.

/المنصات
يعرض حالة المنصات المتصلة.

/الأماكن
يعرض أماكن النشر المحفوظة.

/إضافة_مكان الاسم | الرابط
يحفظ مكانًا جديدًا في قائمة النشر.

/حذف_مكان الرقم
يحذف مكانًا من القائمة.

/نشر_الأماكن اسم الكتاب
يجهز منشور الكتاب مع قائمة أماكن النشر المحفوظة لتفتحها وتنشر فيها بسرعة.

/مساعدة
يعرض هذه الرسالة.

مثال:
 /نشر كواليس العقل

⚠️ البوت لا ينشر في مجموعات أو صفحات لا تملكها أو لا تملك صلاحية النشر فيها.`;
}

function statusText() {
  const names = [
    ["📢 Facebook", !!process.env.FACEBOOK_PAGE_ID && !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN],
    ["📸 Instagram", !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID && !!(process.env.META_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN)],
    ["✈️ Telegram", !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_TARGET_CHAT_IDS],
    ["🎵 TikTok", !!process.env.TIKTOK_ACCESS_TOKEN]
  ];
  return "🔌 حالة المنصات:\n\n" + names.map(([n,ok])=>`${n}: ${ok ? "🟢 متصل" : "🔴 غير موصل"}`).join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});

  try {
    const update = req.body || {};
    const msg = update.message;
    if (!msg?.chat?.id) return res.status(200).json({ok:true});

    const chatId = msg.chat.id;

    if (!allowed(chatId)) {
      await telegram("sendMessage", { chat_id:chatId, text:"⛔ هذا البوت خاص بمالك متجر آدم النور." });
      return res.status(200).json({ok:true});
    }

    const text = String(msg.text || "").trim();
    const command = text.split(/\s+/)[0].toLowerCase();
    const argument = text.replace(/^\S+\s*/, "").trim();

    if (text === "📚 نشر كتاب") {
      await telegram("sendMessage", {chat_id:chatId,text:"✍️ اكتب الآن: /نشر ثم اسم الكتاب\nمثال: /نشر كواليس العقل",reply_markup:replyKeyboard()});
      return res.status(200).json({ok:true});
    }

    if (text === "📝 معاينة منشور") {
      await telegram("sendMessage", {chat_id:chatId,text:"✍️ اكتب: /معاينة ثم اسم الكتاب"});
      return res.status(200).json({ok:true});
    }

    if (text === "ℹ️ طريقة الاستخدام" || command === "/مساعدة" || command === "/start") {
      await telegram("sendMessage", {chat_id:chatId,text:helpText(),reply_markup:replyKeyboard()});
      return res.status(200).json({ok:true});
    }

    if (command === "/الأماكن") {
      const destinations = await listPublishDestinations();
      await telegram("sendMessage", {chat_id:chatId,text:destinationsText(destinations),reply_markup:replyKeyboard()});
      return res.status(200).json({ok:true});
    }

    if (command === "/إضافة_مكان") {
      const parts = argument.split("|");
      const name = (parts[0] || "").trim();
      const url = (parts.slice(1).join("|") || "").trim();
      const added = await addPublishDestination(name, url);
      await telegram("sendMessage", {
        chat_id:chatId,
        text:`✅ تمت إضافة مكان النشر #${added.id}\n\n📌 ${added.name}${added.url ? `\n🔗 ${added.url}` : ""}`
      });
      return res.status(200).json({ok:true});
    }

    if (command === "/حذف_مكان") {
      if (!argument) throw new Error("اكتب رقم المكان بعد /حذف_مكان.");
      await removePublishDestination(argument);
      await telegram("sendMessage", {chat_id:chatId,text:`🗑️ تم حذف مكان النشر #${argument}.`});
      return res.status(200).json({ok:true});
    }

    if (command === "/نشر_الأماكن") {
      if (!argument) throw new Error("اكتب اسم الكتاب بعد /نشر_الأماكن.");
      const book = await findBook(argument);
      const preview = await publishBook(book, []);
      const destinations = await listPublishDestinations();
      const placeText = destinations.length
        ? destinations.map(d => `• #${d.id} — ${d.name}${d.url ? `\n  🔗 ${d.url}` : ""}`).join("\n")
        : "لا توجد أماكن محفوظة بعد.";
      await telegram("sendMessage", {
        chat_id:chatId,
        text:`🚀 منشور جاهز للنشر\n\n📚 ${book.title_ar}\n\n${preview.caption}\n\n📋 أماكن النشر المحفوظة:\n${placeText}\n\n⚠️ البوت لا يسجل الدخول إلى حسابك ولا ينشر في أماكن لا تمنحه صلاحية رسمية. استخدم الروابط أعلاه للنشر اليدوي السريع.`
      });
      return res.status(200).json({ok:true});
    }

    if (command === "/المنصات") {
      await telegram("sendMessage", {chat_id:chatId,text:statusText(),reply_markup:replyKeyboard()});
      return res.status(200).json({ok:true});
    }

    if (command === "/معاينة") {
      if (!argument) throw new Error("اكتب اسم الكتاب بعد /معاينة.");
      const book = await findBook(argument);
      const preview = await publishBook(book, []);
      await telegram("sendMessage", {
        chat_id:chatId,
        text:`📝 معاينة المنشور

${preview.caption}

---
إذا أعجبك اكتب:
 /نشر ${book.title_ar}`
      });
      return res.status(200).json({ok:true});
    }

    if (command === "/نشر") {
      if (!argument) throw new Error("اكتب اسم الكتاب بعد /نشر.");
      const book = await findBook(argument);

      await telegram("sendMessage", {
        chat_id:chatId,
        text:`⏳ جاري نشر «${book.title_ar}»...
لا تغلق المحادثة.`
      });

      const result = await publishBook(book);

      const lines = result.results.map(r =>
        `${r.ok ? "✅" : "❌"} ${r.platform}: ${r.ok ? "تم" : r.message}`
      );

      await telegram("sendMessage", {
        chat_id:chatId,
        text:`🚀 انتهى النشر

📚 ${book.title_ar}

${lines.join("\n")}`,
        reply_markup:replyKeyboard()
      });

      return res.status(200).json({ok:true});
    }

    await telegram("sendMessage", {chat_id:chatId,text:helpText(),reply_markup:replyKeyboard()});
    return res.status(200).json({ok:true});
  } catch (error) {
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId && allowed(chatId)) {
        await telegram("sendMessage", {chat_id:chatId,text:"❌ " + (error?.message || "حدث خطأ أثناء تنفيذ الأمر.")});
      }
    } catch {}
    return res.status(200).json({ok:true});
  }
}
