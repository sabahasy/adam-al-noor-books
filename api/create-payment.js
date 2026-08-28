export default async function handler(req, res) {
// السماح بطلبات POST فقط
if (req.method !== "POST") {
return res.status(405).json({
error: "Method not allowed"
});
}

try {
const { items } = req.body || {};

// التحقق من السلة
if (!Array.isArray(items) || items.length === 0) {
  return res.status(400).json({
    error: "السلة فارغة"
  });
}

// مفتاح Wayl من Environment Variables في Vercel
const WAYL_API_KEY = process.env.WAYL_API_KEY;

if (!WAYL_API_KEY) {
  return res.status(500).json({
    error: "WAYL_API_KEY غير موجود في Vercel"
  });
}

// سعر التحويل المستخدم في المتجر
const USD_TO_IQD = 1310;

// إنشاء عناصر الطلب
const lineItem = items.map((book) => {
  const priceUSD = Number(book.price);

  if (!Number.isFinite(priceUSD) || priceUSD <= 0) {
    throw new Error(
      `سعر الكتاب غير صحيح: ${book.title || "كتاب"}`
    );
  }

  return {
    label: String(book.title || "كتاب"),
    amount: Math.round(priceUSD * USD_TO_IQD),
    type: "increase"
  };
});

// حساب الإجمالي
const totalIQD = lineItem.reduce(
  (sum, item) => sum + item.amount,
  0
);

if (!Number.isInteger(totalIQD) || totalIQD <= 0) {
  return res.status(400).json({
    error: "إجمالي الطلب غير صحيح"
  });
}

// رقم مرجعي فريد للطلب
const referenceId =
  "adam-" +
  Date.now() +
  "-" +
  Math.random()
    .toString(36)
    .substring(2, 10);

// رابط الموقع
const siteUrl =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://project-akmpg.vercel.app";

// بيانات طلب Wayl
const requestBody = {
  env: "test",
  referenceId: referenceId,
  total: totalIQD,
  currency: "IQD",
  customParameter: "",
  lineItem: lineItem,
  redirectionUrl: siteUrl
};

console.log(
  "WAYL REQUEST:",
  JSON.stringify(requestBody)
);

// إرسال الطلب إلى Wayl
const response = await fetch(
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

// قراءة الرد كنص أولًا
const rawText = await response.text();

console.log("WAYL STATUS:", response.status);
console.log("WAYL RESPONSE:", rawText);

// تحويل الرد إلى JSON إذا كان صالحًا
let waylData = null;

try {
  waylData = rawText
    ? JSON.parse(rawText)
    : null;
} catch (parseError) {
  console.error(
    "WAYL RESPONSE IS NOT JSON:",
    rawText
  );

  return res.status(502).json({
    error: "Wayl أرسل استجابة غير صالحة",
    waylStatus: response.status
  });
}

// إذا رفض Wayl الطلب
if (!response.ok) {
  console.error(
    "WAYL PAYMENT ERROR:",
    response.status,
    waylData
  );

  return res.status(response.status).json({
    error: "Wayl رفض طلب الدفع",

    waylStatus: response.status,

    message:
      waylData?.message ||
      waylData?.error ||
      "لم يرسل Wayl رسالة واضحة",

    errors:
      waylData?.errors ||
      null
  });
}

// استخراج رابط الدفع
const paymentUrl =
  waylData?.data?.url ||
  waylData?.url ||
  waylData?.paymentUrl;

// التحقق من وجود الرابط
if (!paymentUrl) {
  console.error(
    "PAYMENT URL NOT FOUND:",
    waylData
  );

  return res.status(502).json({
    error: "Wayl لم يُرجع رابط الدفع",

    message:
      waylData?.message ||
      "لم يتم العثور على رابط الدفع في استجابة Wayl"
  });
}

// إرسال النجاح إلى الموقع
return res.status(200).json({
  success: true,

  referenceId: referenceId,

  total: totalIQD,

  currency: "IQD",

  paymentUrl: paymentUrl
});

} catch (error) {

console.error(
  "CREATE PAYMENT ERROR:",
  error
);

return res.status(500).json({
  error: "حدث خطأ في خادم الدفع",

  message:
    error?.message ||
    "Unknown error"
});

}
}
