export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "السلة فارغة"
      });
    }

    const WAYL_API_KEY = process.env.WAYL_API_KEY;

    if (!WAYL_API_KEY) {
      return res.status(500).json({
        error: "WAYL_API_KEY غير موجود في Vercel"
      });
    }

    const USD_TO_IQD = 1310;

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

    const totalIQD = lineItem.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    if (!Number.isInteger(totalIQD) || totalIQD <= 0) {
      return res.status(400).json({
        error: "إجمالي الطلب غير صحيح",
        totalIQD
      });
    }

    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 10);

    const siteUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://project-akmpg.vercel.app";

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

    const rawText = await response.text();

    console.log(
      "WAYL STATUS:",
      response.status
    );

    console.log(
      "WAYL RESPONSE:",
      rawText
    );

    let waylData = null;

    try {
      waylData = JSON.parse(rawText);
    } catch {
      waylData = {
        raw: rawText
      };
    }

    if (!response.ok) {
      return res.status(400).json({
        error: "Wayl رفض طلب الدفع",
        waylStatus: response.status,

        message:
          waylData?.message ||
          waylData?.error ||
          "لم يرسل Wayl رسالة واضحة",

        errors:
          waylData?.errors ||
          null,

        details: waylData
      });
    }

    const paymentUrl =
      waylData?.data?.url;

    if (!paymentUrl) {
      return res.status(502).json({
        error: "Wayl لم يُرجع رابط الدفع",

        message:
          waylData?.message ||
          "الرابط غير موجود في data.url",

        details: waylData
      });
    }

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
