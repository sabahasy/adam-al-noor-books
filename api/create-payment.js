const WAYL_API_URL = "https://api.thewayl.com/api/v1/links";
const USD_TO_IQD = 1310;

module.exports = async function handler(req, res) {
  try {
    // POST فقط
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    // قراءة البيانات
    const body = req.body || {};
    const items = body.items;

    // التحقق من السلة
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "السلة فارغة"
      });
    }

    // قراءة مفتاح Wayl من Vercel
    const WAYL_API_KEY = process.env.WAYL_API_KEY;

    if (!WAYL_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "مفتاح Wayl غير موجود في Vercel. تأكد أن اسم المتغير هو WAYL_API_KEY."
      });
    }

    // إنشاء عناصر الدفع
    const lineItem = [];

    for (const book of items) {
      const priceUSD = Number(book.price);

      if (!Number.isFinite(priceUSD) || priceUSD <= 0) {
        return res.status(400).json({
          success: false,
          error: "يوجد كتاب بسعر غير صحيح."
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

    // حساب الإجمالي من العناصر
    const totalIQD = lineItem.reduce(
      (total, item) => total + item.amount,
      0
    );

    if (!Number.isInteger(totalIQD) || totalIQD <= 0) {
      return res.status(400).json({
        success: false,
        error: "إجمالي الطلب غير صحيح."
      });
    }

    // رقم طلب فريد
    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 8);

    // عنوان العودة بعد الدفع
    const siteUrl =
      process.env.VERCEL_URL
        ? "https://" + process.env.VERCEL_URL
        : "https://project-akmpg.vercel.app";

    // بيانات الطلب حسب توثيق Wayl
    const paymentBody = {
      env: "test",

      referenceId: referenceId,

      total: totalIQD,

      currency: "IQD",

      customParameter: "",

      lineItem: lineItem,

      redirectionUrl: siteUrl
    };

    console.log(
      "Creating Wayl payment:",
      {
        referenceId,
        total: totalIQD,
        currency: "IQD",
        items: lineItem.length
      }
    );

    // الاتصال بـ Wayl
    const waylResponse = await fetch(
      WAYL_API_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-WAYL-AUTHENTICATION": WAYL_API_KEY
        },

        body: JSON.stringify(paymentBody)
      }
    );

    // قراءة الرد
    const responseText =
      await waylResponse.text();

    let waylData;

    try {
      waylData =
        responseText
          ? JSON.parse(responseText)
          : {};
    } catch {
      waylData = {
        rawResponse: responseText
      };
    }

    console.log(
      "Wayl response status:",
      waylResponse.status
    );

    // Wayl رفض الطلب
    if (!waylResponse.ok) {
      console.error(
        "Wayl rejected payment:",
        waylData
      );

      return res.status(502).json({
        success: false,
        error: "Wayl رفض إنشاء رابط الدفع.",
        waylStatus: waylResponse.status,
        details: waylData
      });
    }

    // استخراج رابط الدفع
    const paymentUrl =
      waylData &&
      waylData.data &&
      waylData.data.url;

    if (!paymentUrl) {
      console.error(
        "Wayl did not return payment URL:",
        waylData
      );

      return res.status(502).json({
        success: false,
        error: "تم الاتصال بـ Wayl، لكن لم يتم استلام رابط الدفع.",
        details: waylData
      });
    }

    // نجاح
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
      success: false,
      error: "حدث خطأ داخل خادم الدفع.",
      message: error && error.message
        ? error.message
        : "Unknown server error"
    });
  }
};
