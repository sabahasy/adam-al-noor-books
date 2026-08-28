export default async function handler(req, res) {
try {
// ==============================
// 1. POST فقط
// ==============================
if (req.method !== "POST") {
return res.status(405).json({
error: "Method not allowed"
});
}

// ==============================
// 2. قراءة السلة
// ==============================
const { items } = req.body || {};

if (!Array.isArray(items) || items.length === 0) {
  return res.status(400).json({
    error: "السلة فارغة"
  });
}

// ==============================
// 3. مفتاح Wayl
// ==============================
const WAYL_API_KEY = process.env.WAYL_API_KEY;

if (!WAYL_API_KEY) {
  return res.status(500).json({
    error: "WAYL_API_KEY غير موجود في Vercel"
  });
}

// ==============================
// 4. تحويل USD إلى IQD
// ==============================
const USD_TO_IQD = 1310;

// ==============================
// 5. إنشاء lineItem
// ==============================
const lineItem = [];

for (const book of items) {
  const priceUSD = Number(book.price);

  if (!Number.isFinite(priceUSD) || priceUSD <= 0) {
    return res.status(400).json({
      error: "سعر الكتاب غير صحيح",
      title: book.title || "كتاب"
    });
  }

  const amountIQD = Math.round(
    priceUSD * USD_TO_IQD
  );

  lineItem.push({
    label: String(book.title || "كتاب"),
    amount: amountIQD,
    type: "increase"
  });
}

// ==============================
// 6. حساب الإجمالي من lineItem
// ==============================
const totalIQD = lineItem.reduce(
  (sum, item) => sum + item.amount,
  0
);

if (!Number.isInteger(totalIQD) || totalIQD <= 0) {
  return res.status(400).json({
    error: "إجمالي الطلب غير صحيح",
    totalIQD: totalIQD
  });
}

// ==============================
// 7. رقم طلب فريد
// ==============================
const referenceId =
  "adam-" +
  Date.now() +
  "-" +
  Math.random()
    .toString(36)
    .substring(2, 10);

// ==============================
// 8. رابط العودة
// ==============================
const siteUrl =
  "https://project-akmpg.vercel.app";

// ==============================
// 9. بيانات Wayl
// ==============================
const requestBody = {
  env: "test",

  referenceId: referenceId,

  total: totalIQD,

  currency: "IQD",

  customParameter: "",

  lineItem: lineItem,

  redirectionUrl: siteUrl
};

// لا نطبع المفتاح السري في Logs
console.log(
  "WAYL REQUEST BODY:",
  JSON.stringify(requestBody)
);

// ==============================
// 10. إرسال الطلب إلى Wayl
// ==============================
const waylResponse = await fetch(
  "https://api.thewayl.com/api/v1/links",
  {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "X-WAYL-AUTHENTICATION": WAYL_API_KEY
    },

    body: JSON.stringify(requestBody)
  }
);

// ==============================
// 11. قراءة الرد كنص
// ==============================
const rawText =
  await waylResponse.text();

console.log(
  "WAYL STATUS:",
  waylResponse.status
);

console.log(
  "WAYL RAW RESPONSE:",
  rawText
);

// ==============================
// 12. تحويل JSON
// ==============================
let waylData = null;

try {
  waylData =
    rawText
      ? JSON.parse(rawText)
      : null;
} catch (parseError) {

  console.error(
    "WAYL RETURNED NON JSON:",
    rawText
  );

  return res.status(502).json({
    error: "Wayl أرسل استجابة غير JSON",
    waylStatus: waylResponse.status,
    rawResponse: rawText
  });
}

// ==============================
// 13. Wayl رفض الطلب
// ==============================
if (!waylResponse.ok) {

  console.error(
    "WAYL REJECTED:",
    waylResponse.status,
    waylData
  );

  return res.status(502).json({
    error: "Wayl رفض طلب الدفع",

    waylStatus:
      waylResponse.status,

    message:
      waylData?.message ||
      waylData?.error ||
      "Wayl رفض الطلب",

    errors:
      waylData?.errors ||
      null,

    details:
      waylData
  });
}

// ==============================
// 14. استخراج رابط الدفع
// ==============================
const paymentUrl =
  waylData?.data?.url;

if (!paymentUrl) {

  console.error(
    "WAYL URL MISSING:",
    waylData
  );

  return res.status(502).json({
    error:
      "Wayl لم يُرجع رابط الدفع",

    details:
      waylData
  });
}

// ==============================
// 15. نجاح
// ==============================
console.log(
  "WAYL PAYMENT LINK CREATED:",
  paymentUrl
);

return res.status(200).json({
  success: true,

  referenceId:
    referenceId,

  total:
    totalIQD,

  currency:
    "IQD",

  paymentUrl:
    paymentUrl
});

} catch (error) {

console.error(
  "CREATE PAYMENT SERVER ERROR:",
  error
);

return res.status(500).json({
  error:
    "حدث خطأ في خادم الدفع",

  message:
    error?.message ||
    "Unknown server error"
});

}
}
