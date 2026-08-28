import crypto from "crypto";

export default async function handler(req, res) {
  // Wayl يجب أن يرسل POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const secret = process.env.WAYL_WEBHOOK_SECRET;

    if (!secret) {
      console.error(
        "WAYL_WEBHOOK_SECRET غير موجود في Vercel"
      );

      return res.status(500).json({
        error: "Webhook secret غير موجود"
      });
    }

    // =====================================================
    // قراءة جسم الطلب
    // =====================================================

    const body =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body || {});

    // =====================================================
    // قراءة توقيع Wayl
    // =====================================================

    const signature =
      req.headers["x-wayl-signature-256"];

    if (!signature) {
      console.error(
        "WAYL WEBHOOK: signature missing"
      );

      return res.status(401).json({
        error: "Webhook signature missing"
      });
    }

    // =====================================================
    // إنشاء التوقيع المتوقع
    // =====================================================

    const expectedSignature =
      "sha256=" +
      crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");

    // =====================================================
    // مقارنة التوقيع بأمان
    // =====================================================

    const received =
      String(signature);

    const expected =
      String(expectedSignature);

    if (
      received.length !==
      expected.length
    ) {
      console.error(
        "WAYL WEBHOOK: invalid signature"
      );

      return res.status(401).json({
        error: "Invalid webhook signature"
      });
    }

    const valid =
      crypto.timingSafeEqual(
        Buffer.from(received),
        Buffer.from(expected)
      );

    if (!valid) {
      console.error(
        "WAYL WEBHOOK: invalid signature"
      );

      return res.status(401).json({
        error: "Invalid webhook signature"
      });
    }

    // =====================================================
    // قراءة بيانات Wayl
    // =====================================================

    let data;

    try {
      data =
        typeof req.body === "object"
          ? req.body
          : JSON.parse(body);
    } catch (error) {
      console.error(
        "WAYL WEBHOOK: invalid JSON"
      );

      return res.status(400).json({
        error: "Invalid JSON"
      });
    }

    // =====================================================
    // تسجيل إشعار Wayl بدون إظهار السر
    // =====================================================

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    // =====================================================
    // استخراج البيانات المهمة
    // =====================================================

    const referenceId =
      data?.referenceId ||
      data?.data?.referenceId ||
      null;

    const status =
      data?.status ||
      data?.data?.status ||
      null;

    const paymentId =
      data?.paymentId ||
      data?.data?.paymentId ||
      null;

    // =====================================================
    // عرض معلومات العملية في Logs
    // =====================================================

    console.log(
      "WAYL PAYMENT UPDATE:",
      {
        referenceId,
        status,
        paymentId
      }
    );

    // =====================================================
    // نجاح استقبال Webhook
    // =====================================================

    return res.status(200).json({
      success: true,
      received: true
    });

  } catch (error) {

    console.error(
      "WAYL WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      error: "Webhook server error"
    });
  }
}
