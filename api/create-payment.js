export default async function handler(req, res) {
  // السماح بـ POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // قراءة السلة
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "السلة فارغة"
      });
    }

    // =====================================================
    // مفاتيح Wayl من Vercel
    // =====================================================

    const WAYL_API_KEY = process.env.WAYL_API_KEY;

    const WAYL_WEBHOOK_SECRET =
      process.env.WAYL_WEBHOOK_SECRET;

    if (!WAYL_API_KEY) {
      return res.status(500).json({
        error: "WAYL_API_KEY غير موجود في Vercel"
      });
    }

    if (!WAYL_WEBHOOK_SECRET) {
      return res.status(500).json({
        error: "WAYL_WEBHOOK_SECRET غير موجود في Vercel"
      });
    }

    // =====================================================
    // إعدادات المتجر
    // =====================================================

    const USD_TO_IQD = 1310;

    // رابط الـ Webhook
    const webhookUrl =
      "https://project-akmpg.vercel.app/api/wayl-webhook";

    // رابط العودة بعد الدفع
    const redirectionUrl =
      "https://project-akmpg.vercel.app";

    // =====================================================
    // إنشاء عناصر الطلب
    // =====================================================

    const lineItem = items.map((book) => {
      const priceUSD = Number(book.price);

      if (
        !Number.isFinite(priceUSD) ||
        priceUSD <= 0
      ) {
        throw new Error(
          `سعر الكتاب غير صحيح: ${
            book.title || "كتاب"
          }`
        );
      }

      return {
        label: String(
          book.title || "كتاب"
        ),

        amount: Math.round(
          priceUSD * USD_TO_IQD
        ),

        type: "increase"
      };
    });

    // =====================================================
    // حساب الإجمالي
    // =====================================================

    const totalIQD = lineItem.reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0
    );

    if (
      !Number.isInteger(totalIQD) ||
      totalIQD <= 0
    ) {
      return res.status(400).json({
        error: "إجمالي الطلب غير صحيح",
        totalIQD
      });
    }

    // =====================================================
    // رقم مرجعي فريد
    // =====================================================

    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 10);

    // =====================================================
    // بيانات طلب Wayl
    // =====================================================

    const requestBody = {
      env: "test",

      referenceId: referenceId,

      total: totalIQD,

      currency: "IQD",

      customParameter: "",

      lineItem: lineItem,

      webhookUrl: webhookUrl,

      webhookSecret: WAYL_WEBHOOK_SECRET,

      redirectionUrl: redirectionUrl
    };

    console.log(
      "WAYL REQUEST BODY:",
      JSON.stringify({
        ...requestBody,

        // لا نطبع السر الحقيقي في Logs
        webhookSecret: "[HIDDEN]"
      })
    );

    // =====================================================
    // إرسال الطلب إلى Wayl
    // =====================================================

    const response = await fetch(
      "https://api.thewayl.com/api/v1/links",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          "X-WAYL-AUTHENTICATION":
            WAYL_API_KEY
        },

        body: JSON.stringify(
          requestBody
        )
      }
    );

    // =====================================================
    // قراءة رد Wayl
    // =====================================================

    const rawText =
      await response.text();

    console.log(
      "WAYL STATUS:",
      response.status
    );

    console.log(
      "WAYL RAW RESPONSE:",
      rawText
    );

    let waylData;

    try {
      waylData =
        JSON.parse(rawText);
    } catch {
      waylData = {
        raw: rawText
      };
    }

    // =====================================================
    // Wayl رفض الطلب
    // =====================================================

    if (!response.ok) {
      console.error(
        "WAYL REJECTED:",
        response.status,
        waylData
      );

      return res.status(
        response.status
      ).json({
        error:
          "Wayl رفض طلب الدفع",

        waylStatus:
          response.status,

        message:
          waylData?.message ||
          waylData?.error ||
          "لم يرسل Wayl رسالة واضحة",

        errors:
          waylData?.errors ||
          null
      });
    }

    // =====================================================
    // استخراج رابط الدفع
    // =====================================================

    const paymentUrl =
      waylData?.data?.url ||
      waylData?.url ||
      waylData?.data?.paymentUrl;

    if (!paymentUrl) {
      console.error(
        "WAYL NO PAYMENT URL:",
        waylData
      );

      return res.status(502).json({
        error:
          "Wayl لم يُرجع رابط الدفع",

        message:
          waylData?.message ||
          "لم يتم العثور على data.url",

        details: waylData
      });
    }

    // =====================================================
    // نجاح
    // =====================================================

    console.log(
      "WAYL PAYMENT CREATED:",
      {
        referenceId,
        totalIQD,
        paymentUrl
      }
    );

    return res.status(200).json({
      success: true,

      referenceId:

        referenceId,

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
      error:
        "حدث خطأ في خادم الدفع",

      message:
        error?.message ||
        "Unknown error"
    });
  }
}
