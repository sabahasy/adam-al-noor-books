
export default async function handler(req, res) {
  // السماح بطلبات POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { items, total } = req.body;

    // التحقق من البيانات
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "السلة فارغة"
      });
    }

    if (!total || Number(total) <= 0) {
      return res.status(400).json({
        error: "المبلغ غير صحيح"
      });
    }

    // مفتاح Wayl محفوظ في Vercel
    const WAYL_API_KEY = process.env.WAYL_API_KEY;

    if (!WAYL_API_KEY) {
      return res.status(500).json({
        error: "مفتاح Wayl غير موجود في Vercel"
      });
    }

    // رقم مرجعي فريد للطلب
    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random().toString(36).substring(2, 8);

    // تحويل عناصر السلة إلى عناصر Wayl
    const lineItem = items.map(book => ({
      label: String(book.title || "كتاب"),
      amount: Math.round(Number(book.price || 0)),
      type: "increase"
    }));

    // عنوان موقعك
    const siteUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://project-akmpg.vercel.app";

    // إنشاء رابط الدفع من Wayl
    const response = await fetch(
      "https://api.thewayl.com/api/v1/links",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-WAYL-AUTHENTICATION": WAYL_API_KEY
        },

        body: JSON.stringify({
          env: "test",

          referenceId: referenceId,

          total: Math.round(Number(total)),

          currency: "IQD",

          customParameter: "",

          lineItem: lineItem,

          redirectionUrl: siteUrl
        })
      }
    );

    const data = await response.json();

    // إذا فشل Wayl
    if (!response.ok) {
      console.error("Wayl error:", data);

      return res.status(response.status).json({
        error: "فشل إنشاء رابط الدفع",
        details: data
      });
    }

    // إرسال رابط الدفع إلى الموقع
    return res.status(200).json({
      success: true,

      referenceId: referenceId,

      paymentUrl: data?.data?.url,

      data: data
    });

  } catch (error) {

    console.error("Payment server error:", error);

    return res.status(500).json({
      error: "حدث خطأ في خادم الدفع"
    });
  }
}
