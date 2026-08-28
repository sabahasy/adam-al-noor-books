import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {

  // =====================================================
  // POST فقط
  // =====================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {

    // =====================================================
    // SUPABASE
    // =====================================================

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Supabase service role key missing",
      });
    }

    const supabaseAdmin =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      );

    // =====================================================
    // WEBHOOK SECRET
    // =====================================================

    const secret =
      process.env.WAYL_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).json({
        error: "Webhook secret missing",
      });
    }

    // =====================================================
    // قراءة RAW BODY
    // =====================================================

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

    // =====================================================
    // توقيع Wayl
    // =====================================================

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

    // =====================================================
    // التحقق من التوقيع
    // =====================================================

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(rawBody)
        .digest("hex");

    let receivedBuffer;
    let expectedBuffer;

    try {

      receivedBuffer =
        Buffer.from(
          receivedSignature,
          "hex"
        );

      expectedBuffer =
        Buffer.from(
          expectedSignature,
          "hex"
        );

    }
    catch (error) {

      console.error(
        "WAYL SIGNATURE BUFFER ERROR:",
        error
      );

      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {

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

    // =====================================================
    // JSON
    // =====================================================

    let data;

    try {

      data =
        JSON.parse(
          rawBody.toString("utf8")
        );

    }
    catch (error) {

      console.error(
        "WAYL INVALID JSON:",
        error
      );

      return res.status(400).json({
        error: "Invalid JSON",
      });
    }

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    // =====================================================
    // بيانات الدفع
    // =====================================================

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
      "WAYL PAYMENT DATA:",
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

    // =====================================================
    // التحقق من نجاح الدفع
    // =====================================================

    const paymentIsSuccessful =
      paymentStatus === "Paid" &&
      (
        webhookEvent === "payment.success" ||
        event === "order.created"
      );

    if (!paymentIsSuccessful) {

      console.log(
        "WAYL PAYMENT NOT SUCCESSFUL"
      );

      return res.status(200).json({
        success: true,
        received: true,
        paymentSuccessful: false,
      });
    }

    // =====================================================
    // استخراج Order ID
    // =====================================================

    const orderId =
      Number(customParameter);

    if (
      !Number.isInteger(orderId) ||
      orderId <= 0
    ) {

      console.error(
        "INVALID ORDER ID:",
        customParameter
      );

      return res.status(400).json({
        error: "Invalid order ID",
      });
    }

    // =====================================================
    // البحث عن الطلب
    // =====================================================

    const {
      data: order,
      error: orderFindError
    } =
      await supabaseAdmin
        .from("orders")
        .select(
          "id,user_id,total_amount,status"
        )
        .eq(
          "id",
          orderId
        )
        .single();

    if (
      orderFindError ||
      !order
    ) {

      console.error(
        "ORDER NOT FOUND:",
        {
          orderId,
          error:
            orderFindError
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

    // =====================================================
    // منع تكرار معالجة الطلب
    // =====================================================

    if (
      order.status === "paid" ||
      order.status === "completed"
    ) {

      console.log(
        "ORDER ALREADY PROCESSED:",
        order.id
      );

      return res.status(200).json({
        success: true,
        received: true,
        alreadyProcessed: true,
      });
    }

    // =====================================================
    // التأكد من مبلغ الطلب
    // =====================================================

    const webhookTotal =
      Number(total);

    const orderTotal =
      Number(order.total_amount);

    if (
      Number.isFinite(webhookTotal) &&
      Number.isFinite(orderTotal) &&
      webhookTotal !== orderTotal
    ) {

      console.error(
        "AMOUNT MISMATCH:",
        {
          webhookTotal,
          orderTotal,
          orderId
        }
      );

      return res.status(400).json({
        error: "Payment amount does not match order",
      });
    }

    // =====================================================
    // جلب كتب الطلب
    // =====================================================

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
        "ORDER ITEMS ERROR:",
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
        "ORDER HAS NO ITEMS:",
        order.id
      );

      return res.status(500).json({
        error: "Order has no items",
      });
    }

    // =====================================================
    // تحديث الطلب إلى Paid
    // =====================================================

    const {
      error: orderUpdateError
    } =
      await supabaseAdmin
        .from("orders")
        .update({
          status: "paid",
        })
        .eq(
          "id",
          order.id
        );

    if (orderUpdateError) {

      console.error(
        "ORDER UPDATE ERROR:",
        orderUpdateError
      );

      return res.status(500).json({
        error: "Could not update order",
      });
    }

    // =====================================================
    // إضافة الكتب إلى المكتبة
    // =====================================================

    for (const item of orderItems) {

      // ---------------------------------------------------
      // التحقق هل الكتاب موجود بالفعل
      // ---------------------------------------------------

      const {
        data: existing,
        error: existingError
      } =
        await supabaseAdmin
          .from("library")
          .select("id")
          .eq(
            "user_id",
            order.user_id
          )
          .eq(
            "book_id",
            item.book_id
          )
          .eq(
            "order_id",
            order.id
          )
          .limit(1);

      if (existingError) {

        console.error(
          "LIBRARY CHECK ERROR:",
          existingError
        );

        return res.status(500).json({
          error: "Could not check library",
        });
      }

      // ---------------------------------------------------
      // الكتاب موجود بالفعل
      // ---------------------------------------------------

      if (
        Array.isArray(existing) &&
        existing.length > 0
      ) {

        console.log(
          "LIBRARY ITEM ALREADY EXISTS:",
          {
            orderId:
              order.id,

            bookId:
              item.book_id
          }
        );

        continue;
      }

      // ---------------------------------------------------
      // إضافة الكتاب
      // ---------------------------------------------------

      const {
        error: libraryInsertError
      } =
        await supabaseAdmin
          .from("library")
          .insert({

            user_id:
              order.user_id,

            book_id:
              item.book_id,

            order_id:
              order.id,

            purchased_at:
              new Date().toISOString()
          });

      if (libraryInsertError) {

        console.error(
          "LIBRARY INSERT ERROR:",
          libraryInsertError
        );

        return res.status(500).json({
          error:
            "Could not add book to library",
        });
      }

      console.log(
        "BOOK ADDED TO LIBRARY:",
        {
          userId:
            order.user_id,

          bookId:
            item.book_id,

          orderId:
            order.id
        }
      );
    }

    // =====================================================
    // حفظ معلومات Wayl إن كانت الأعمدة موجودة
    // =====================================================

    try {

      const {
        error: paymentInfoError
      } =
        await supabaseAdmin
          .from("orders")
          .update({

            wayl_reference_id:
              referenceId,

            wayl_payment_id:
              paymentId,

            wayl_payment_status:
              paymentStatus,

            wayl_payment_method:
              paymentMethod,

            wayl_payment_processor:
              paymentProcessor,

            wayl_code:
              code

          })
          .eq(
            "id",
            order.id
          );

      if (paymentInfoError) {

        console.log(
          "WAYL EXTRA COLUMNS NOT SAVED:",
          paymentInfoError.message
        );

      }

    }
    catch (error) {

      console.log(
        "WAYL EXTRA SAVE SKIPPED:",
        error?.message
      );
    }

    // =====================================================
    // النجاح
    // =====================================================

    console.log(
      "========================================"
    );

    console.log(
      "WAYL PAYMENT COMPLETED"
    );

    console.log(
      {
        orderId:
          order.id,

        userId:
          order.user_id,

        referenceId:
          referenceId,

        paymentId:
          paymentId,

        total:
          total
      }
    );

    console.log(
      "========================================"
    );

    return res.status(200).json({

      success:
        true,

      received:
        true,

      paymentSuccessful:
        true,

      orderId:
        order.id
    });

  }
  catch (error) {

    console.error(
      "WAYL WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Webhook server error",

      message:
        error?.message ||
        "Unknown error"
    });
  }
}
