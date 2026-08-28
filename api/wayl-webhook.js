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

    // =====================================================
    // WAYL WEBHOOK SECRET
    // =====================================================

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
    // قراءة توقيع Wayl
    // =====================================================

    const signatureHeader =
      req.headers["x-wayl-signature-256"];

    if (!signatureHeader) {

      console.error(
        "WAYL WEBHOOK: signature missing"
      );

      return res.status(401).json({
        error:
          "Webhook signature missing",
      });
    }

    const receivedSignature =
      String(signatureHeader)
        .trim()
        .replace(/^sha256=/i, "");

    // =====================================================
    // حساب التوقيع المتوقع
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

    } catch {

      return res.status(401).json({
        error:
          "Invalid webhook signature",
      });

    }

    // =====================================================
    // التحقق الآمن من التوقيع
    // =====================================================

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {

      console.error(
        "WAYL WEBHOOK: invalid signature length"
      );

      return res.status(401).json({
        error:
          "Invalid webhook signature",
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
        error:
          "Invalid webhook signature",
      });
    }

    // =====================================================
    // تحليل JSON
    // =====================================================

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
        error:
          "Invalid JSON",
      });
    }

    // =====================================================
    // تسجيل Webhook
    // =====================================================

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    // =====================================================
    // استخراج بيانات Wayl
    // =====================================================

    const referenceId =
      data?.referenceId ||
      data?.data?.referenceId ||
      null;

    const customParameter =
      data?.customParameter ||
      data?.data?.customParameter ||
      null;

    const paymentStatus =
      data?.paymentStatus ||
      data?.data?.paymentStatus ||
      null;

    const paymentMethod =
      data?.paymentMethod ||
      data?.data?.paymentMethod ||
      null;

    const paymentProcessor =
      data?.paymentProcessor ||
      data?.data?.paymentProcessor ||
      null;

    const total =
      data?.total ||
      data?.data?.total ||
      null;

    const code =
      data?.code ||
      data?.data?.code ||
      null;

    const paymentId =
      data?.id ||
      data?.data?.id ||
      data?.paymentId ||
      data?.data?.paymentId ||
      null;

    const event =
      data?.event ||
      data?.data?.event ||
      null;

    const webhookEvent =
      data?.webhookEvent ||
      data?.data?.webhookEvent ||
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

    // =====================================================
    // تحديد حالة الدفع
    // =====================================================

    const normalizedStatus =
      String(
        paymentStatus || ""
      ).toLowerCase();

    const normalizedWebhookEvent =
      String(
        webhookEvent || ""
      ).toLowerCase();

    const normalizedEvent =
      String(
        event || ""
      ).toLowerCase();

    const paymentIsSuccessful =
      (
        normalizedStatus === "paid" ||
        normalizedStatus === "success" ||
        normalizedStatus === "successful" ||
        normalizedStatus === "completed"
      ) &&
      (
        normalizedWebhookEvent ===
          "payment.success" ||
        normalizedWebhookEvent ===
          "payment.paid" ||
        normalizedWebhookEvent ===
          "payment.completed" ||
        normalizedEvent ===
          "order.created" ||
        normalizedEvent ===
          "payment.success" ||
        normalizedEvent ===
          "payment.paid"
      );

    // =====================================================
    // استخراج رقم الطلب
    // =====================================================

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
        error:
          "Invalid order ID",
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
          "id,user_id,total_amount,status,payment_status,wayl_reference_id,wayl_payment_id"
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
        "WAYL WEBHOOK: ORDER NOT FOUND",
        {
          orderId,
          error:
            orderFindError,
        }
      );

      return res.status(404).json({
        error:
          "Order not found",
      });
    }

    console.log(
      "WAYL ORDER FOUND:",
      order
    );

    // =====================================================
    // التحقق من Reference ID
    // =====================================================

    if (
      referenceId &&
      order.wayl_reference_id &&
      String(referenceId) !==
        String(order.wayl_reference_id)
    ) {

      console.error(
        "WAYL WEBHOOK: REFERENCE ID MISMATCH",
        {
          received:
            referenceId,
          expected:
            order.wayl_reference_id,
          orderId:
            order.id
        }
      );

      return res.status(400).json({
        error:
          "Payment reference does not match order",
      });
    }

    // =====================================================
    // إذا لم يكن الدفع ناجحًا
    // =====================================================

    if (!paymentIsSuccessful) {

      console.log(
        "WAYL PAYMENT NOT SUCCESSFUL:",
        {
          orderId:
            order.id,
          paymentStatus,
          webhookEvent,
          event
        }
      );

      // نحفظ معلومات الدفع حتى لو لم ينجح
      await supabaseAdmin
        .from("orders")
        .update({

          payment_status:
            paymentStatus
              ? String(paymentStatus)
              : "pending",

          wayl_reference_id:
            referenceId ||
            order.wayl_reference_id,

          wayl_payment_id:
            paymentId ||
            order.wayl_payment_id

        })
        .eq(
          "id",
          order.id
        );

      return res.status(200).json({
        success:
          true,

        received:
          true,

        paymentSuccessful:
          false
      });
    }

    // =====================================================
    // منع تكرار معالجة الدفع
    // =====================================================

    if (
      order.status === "paid" ||
      order.status === "completed"
    ) {

      console.log(
        "WAYL ORDER ALREADY PROCESSED:",
        order.id
      );

      // تحديث بيانات Wayl فقط
      await supabaseAdmin
        .from("orders")
        .update({

          payment_status:
            "paid",

          wayl_reference_id:
            referenceId ||
            order.wayl_reference_id,

          wayl_payment_id:
            paymentId ||
            order.wayl_payment_id,

          payment_method:
            paymentMethod,

          payment_processor:
            paymentProcessor,

          paid_at:
            new Date().toISOString()

        })
        .eq(
          "id",
          order.id
        );

      return res.status(200).json({
        success:
          true,

        received:
          true,

        alreadyProcessed:
          true
      });
    }

    // =====================================================
    // التحقق من مبلغ الدفع
    // =====================================================

    if (
      total !== null &&
      total !== undefined
    ) {

      const receivedTotal =
        Number(total);

      const orderTotal =
        Number(order.total_amount);

      if (
        Number.isFinite(receivedTotal) &&
        Number.isFinite(orderTotal) &&
        receivedTotal !== orderTotal
      ) {

        console.error(
          "WAYL WEBHOOK: AMOUNT MISMATCH",
          {
            orderId:
              order.id,

            orderTotal:
              orderTotal,

            receivedTotal:
              receivedTotal
          }
        );

        return res.status(400).json({
          error:
            "Payment amount does not match order",
        });
      }
    }

    // =====================================================
    // تحديث الطلب إلى Paid
    // =====================================================

    const {
      data: updatedOrder,
      error: orderUpdateError
    } =
      await supabaseAdmin
        .from("orders")
        .update({

          status:
            "paid",

          payment_status:
            "paid",

          wayl_reference_id:
            referenceId ||
            order.wayl_reference_id,

          wayl_payment_id:
            paymentId ||
            order.wayl_payment_id,

          payment_method:
            paymentMethod,

          payment_processor:
            paymentProcessor,

          paid_at:
            new Date().toISOString()

        })
        .eq(
          "id",
          order.id
        )
        .select(
          "id,user_id,total_amount,status,payment_status,wayl_reference_id,wayl_payment_id,payment_method,payment_processor,paid_at"
        )
        .single();

    if (orderUpdateError) {

      console.error(
        "WAYL WEBHOOK: ORDER UPDATE ERROR",
        orderUpdateError
      );

      return res.status(500).json({
        error:
          "Could not update order",
      });
    }

    console.log(
      "WAYL ORDER UPDATED:",
      updatedOrder
    );

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
        "WAYL WEBHOOK: ORDER ITEMS ERROR",
        orderItemsError
      );

      return res.status(500).json({
        error:
          "Could not load order items",
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
        error:
          "Order has no items",
      });
    }

    // =====================================================
    // إضافة الكتب إلى المكتبة
    // =====================================================

    for (
      const item of orderItems
    ) {

      // ---------------------------------------------------
      // التحقق من وجود الكتاب مسبقًا في نفس الطلب
      // ---------------------------------------------------

      const {
        data: existingLibraryItem,
        error: existingError
      } =
        await supabaseAdmin
          .from("library")
          .select(
            "id"
          )
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
          "WAYL WEBHOOK: LIBRARY CHECK ERROR",
          existingError
        );

        return res.status(500).json({
          error:
            "Could not check library",
        });
      }

      // ---------------------------------------------------
      // موجود بالفعل
      // ---------------------------------------------------

      if (
        existingLibraryItem &&
        existingLibraryItem.length > 0
      ) {

        console.log(
          "WAYL LIBRARY ITEM ALREADY EXISTS:",
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
          "WAYL WEBHOOK: LIBRARY INSERT ERROR",
          libraryInsertError
        );

        return res.status(500).json({
          error:
            "Could not add book to library",
        });
      }

      console.log(
        "WAYL LIBRARY BOOK ADDED:",
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
    // النجاح النهائي
    // =====================================================

    console.log(
      "WAYL PAYMENT COMPLETED SUCCESSFULLY:",
      {
        orderId:
          order.id,

        userId:
          order.user_id,

        paymentId:
          paymentId,

        referenceId:
          referenceId,

        total:
          total,

        code:
          code
      }
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

  } catch (error) {

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
