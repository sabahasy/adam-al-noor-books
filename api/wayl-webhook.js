import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {

  /* =====================================================
     Wayl Webhook
  ===================================================== */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {

    const secret =
      process.env.WAYL_WEBHOOK_SECRET;

    if (!secret) {

      console.error(
        "WAYL WEBHOOK: WAYL_WEBHOOK_SECRET missing"
      );

      return res.status(500).json({
        error: "Webhook secret missing",
      });
    }

    /* =====================================================
       قراءة الـ RAW BODY كما أرسله Wayl
    ===================================================== */

    const chunks = [];

    for await (const chunk of req) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    }

    const rawBody =
      Buffer.concat(chunks);

    /* =====================================================
       قراءة التوقيع
    ===================================================== */

    const signatureHeader =
      req.headers["x-wayl-signature-256"];

    if (!signatureHeader) {

      console.error(
        "WAYL WEBHOOK: signature missing"
      );

      return res.status(401).json({
        error: "Webhook signature missing",
      });
    }

    const receivedSignature =
      String(signatureHeader)
        .trim()
        .replace(/^sha256=/i, "");

    /* =====================================================
       إنشاء HMAC
       Wayl يستخدم:
       HMAC-SHA256(raw body, webhookSecret)
    ===================================================== */

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(rawBody)
        .digest("hex");

    /* =====================================================
       مقارنة آمنة
    ===================================================== */

    const receivedBuffer =
      Buffer.from(
        receivedSignature,
        "hex"
      );

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "hex"
      );

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {

      console.error(
        "WAYL WEBHOOK: invalid signature length"
      );

      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    const valid =
      crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      );

    if (!valid) {

      console.error(
        "WAYL WEBHOOK: invalid signature"
      );

      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    /* =====================================================
       الآن فقط نحلل JSON
    ===================================================== */

    let data;

    try {

      data =
        JSON.parse(
          rawBody.toString("utf8")
        );

    } catch (error) {

      console.error(
        "WAYL WEBHOOK: invalid JSON",
        error
      );

      return res.status(400).json({
        error: "Invalid JSON",
      });
    }

    /* =====================================================
       تسجيل البيانات
       بدون تسجيل الـ secret
    ===================================================== */

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    /* =====================================================
       بيانات Wayl الرسمية
    ===================================================== */

    const referenceId =
      data?.referenceId ||
      null;

    const paymentStatus =
      data?.paymentStatus ||
      null;

    const paymentMethod =
      data?.paymentMethod ||
      null;

    const paymentProcessor =
      data?.paymentProcessor ||
      null;

    const total =
      data?.total ||
      null;

    const code =
      data?.code ||
      null;

    const paymentId =
      data?.id ||
      null;

    const event =
      data?.event ||
      null;

    console.log(
      "WAYL PAYMENT UPDATE:",
      {
        referenceId,
        paymentStatus,
        paymentMethod,
        paymentProcessor,
        total,
        code,
        paymentId,
        event,
      }
    );

    /* =====================================================
       مهم:
       في هذه المرحلة نؤكد لـ Wayl أن Webhook تم استلامه
    ===================================================== */

    return res.status(200).json({
      success: true,
      received: true,
    });

  } catch (error) {

    console.error(
      "WAYL WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      error: "Webhook server error",
    });
  }
}
