import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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

    /* =====================================================
       مفاتيح Supabase
    ===================================================== */

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_SERVICE_ROLE_KEY) {

      console.error(
        "WAYL WEBHOOK: SUPABASE_SERVICE_ROLE_KEY missing"
      );

      return res.status(500).json({
        error: "Supabase service role key missing",
      });
    }

    const supabaseAdmin =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      );

    /* =====================================================
       Wayl Secret
    ===================================================== */

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
       قراءة RAW BODY
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
       قراءة توقيع Wayl
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

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(rawBody)
        .digest("hex");

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
       تحليل JSON
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
       تسجيل إشعار Wayl
    ===================================================== */

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    /* =====================================================
       بيانات الدفع
    ===================================================== */

    const referenceId =
      data?.referenceId ||
      null;

    const customParameter =
      data?.customParameter ||
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

    const webhookEvent =
      data?.webhookEvent ||
      null;

    console.log(
      "WAYL PAYMENT UPDATE:",
      {
        referenceId,
        customParameter,
        paymentStatus,
        paymentMethod,
        paymentProcessor,
        total,
        code,
        paymentId,
        event,
        webhookEvent,
      }
    );

    /* =====================================================
       التأكد من نجاح الدفع
    ===================================================== */

    const paymentIsSuccessful =
      paymentStatus === "Paid" &&
      (
        webhookEvent === "payment.success" ||
        event === "order.created"
      );

    if (!paymentIsSuccessful) {

      console.log(
        "WAYL PAYMENT NOT SUCCESSFUL:",
        {
          paymentStatus,
          webhookEvent,
          event,
        }
      );

      return res.status(200).json({
        success: true,
        received: true,
        paymentSuccessful: false,
      });

    }

    /* =====================================================
       استخراج رقم الطلب
       
       create-payment.js يرسل:
       customParameter = order.id
    ===================================================== */

    const orderId =
      Number(customParameter);

    if (
      !Number.isInteger(orderId) ||
      orderId <= 0
    ) {

      console.error(
        "WAYL WEBHOOK: invalid order ID",
        customParameter
      );

      return res.status(400).json({
        error: "Invalid order ID",
      });

    }

    /* =====================================================
       البحث عن الطلب
    ===================================================== */

    const {
      data: order,
      error: orderFindError
    } =
      await supabaseAdmin
        .from("orders")
        .select(
          "id,user_id,total_amount,status"
        )
        .eq("id", orderId)
        .single();

    if (orderFindError || !order) {

      console.error(
        "WAYL WEBHOOK: ORDER NOT FOUND",
        {
          orderId,
          error: orderFindError,
        }
      );

      return res.status(404).json({
        error: "Order not found",
      });

    }

    console.log(
      "WAYL ORDER FOUND:",
      order
    );

    /* =====================================================
       منع التكرار
       
       إذا كان الطلب مكتملًا بالفعل،
       لا ننشئ كتبًا في المكتبة مرة ثانية.
    ===================================================== */

    if (
      order.status === "paid" ||
      order.status === "completed"
    ) {

      console.log(
        "WAYL ORDER ALREADY PROCESSED:",
        order.id
      );

      return res.status(200).json({
        success: true,
        received: true,
        alreadyProcessed: true,
      });

    }

    /* =====================================================
       تحديث الطلب إلى Paid
    ===================================================== */

    const {
      error: orderUpdateError
    } =
      await supabaseAdmin
        .from("orders")
        .update({
          status: "paid",
        })
        .eq("id", order.id);

    if (orderUpdateError) {

      console.error(
        "WAYL WEBHOOK: ORDER UPDATE ERROR",
        orderUpdateError
      );

      return res.status(500).json({
        error: "Could not update order",
      });

    }

    /* =====================================================
       جلب كتب الطلب
    ===================================================== */

    const {
      data: orderItems,
      error: orderItemsError
    } =
      await supabaseAdmin
        .from("order_items")
        .select(
          "id,order_id,book_id,price,quantity"
        )
        .eq(
          "order_id",
          order.id
        );

    if (orderItemsError) {

      console.error(
        "WAYL WEBHOOK: ORDER ITEMS ERROR",
        orderItemsError
      );

      return res.status(500).json({
        error: "Could not load order items",
      });

    }

    if (
      !Array.isArray(orderItems) ||
      orderItems.length === 0
    ) {

      console.error(
        "WAYL WEBHOOK: ORDER HAS NO ITEMS",
        order.id
      );

      return res.status(500).json({
        error: "Order has no items",
      });

    }

    /* =====================================================
       إنشاء عناصر المكتبة
    ===================================================== */

    const libraryItems =
      orderItems.map(item => ({
        user_id:
          order.user_id,

        book_id:
          item.book_id,

        order_id:
          order.id,

        purchased_at:
          new Date().toISOString(),
      }));

    /* =====================================================
       إدخال الكتب في Library
       
       نحاول منع التكرار عن طريق فحص الكتب
       الموجودة للمستخدم في نفس الطلب.
    ===================================================== */

    for (const item of libraryItems) {

      const {
        data: existingLibraryItem,
        error: existingError
      } =
        await supabaseAdmin
          .from("library")
          .select("id")
          .eq(
            "user_id",
            item.user_id
          )
          .eq(
            "book_id",
            item.book_id
          )
          .eq(
            "order_id",
            item.order_id
          )
          .limit(1);

      if (existingError) {

        console.error(
          "WAYL WEBHOOK: LIBRARY CHECK ERROR",
          existingError
        );

        return res.status(500).json({
          error: "Could not check library",
        });

      }

      if (
        existingLibraryItem &&
        existingLibraryItem.length > 0
      ) {

        console.log(
          "WAYL LIBRARY ITEM ALREADY EXISTS:",
          item
        );

        continue;

      }

      const {
        error: libraryInsertError
      } =
        await supabaseAdmin
          .from("library")
          .insert(item);

      if (libraryInsertError) {

        console.error(
          "WAYL WEBHOOK: LIBRARY INSERT ERROR",
          libraryInsertError
        );

        return res.status(500).json({
          error: "Could not add book to library",
        });

      }

      console.log(
        "WAYL LIBRARY BOOK ADDED:",
        item
      );

    }

    /* =====================================================
       نجاح العملية
    ===================================================== */

    console.log(
      "WAYL PAYMENT COMPLETED SUCCESSFULLY:",
      {
        orderId: order.id,
        userId: order.user_id,
        paymentId,
        referenceId,
        total,
      }
    );

    return res.status(200).json({
      success: true,
      received: true,
      paymentSuccessful: true,
      orderId: order.id,
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
