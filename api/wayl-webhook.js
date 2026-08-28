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
        error:
          "Supabase service role key missing",
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
        error:
          "Webhook secret missing",
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
        error:
          "Webhook signature missing",
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
    // JSON
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

    console.log(
      "WAYL WEBHOOK RECEIVED:",
      JSON.stringify(data)
    );

    // =====================================================
    // بيانات Wayl
    // =====================================================

    const source =
      data?.data || data;

    const referenceId =
      source?.referenceId ||
      data?.referenceId ||
      null;

    const customParameter =
      source?.customParameter ||
      data?.customParameter ||
      null;

    const paymentStatus =
      source?.paymentStatus ||
      data?.paymentStatus ||
      null;

    const paymentMethod =
      source?.paymentMethod ||
      data?.paymentMethod ||
      null;

    const paymentProcessor =
      source?.paymentProcessor ||
      data?.paymentProcessor ||
      null;

    const total =
      source?.total ??
      data?.total ??
      null;

    const paymentId =
      source?.id ||
      data?.id ||
      source?.paymentId ||
      data?.paymentId ||
      null;

    const event =
      source?.event ||
      data?.event ||
      null;

    const webhookEvent =
      source?.webhookEvent ||
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
        paymentId,
        event,
        webhookEvent,
      }
    );

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
        "WAYL WEBHOOK: INVALID ORDER ID",
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
        .select("*")
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
    // حفظ بيانات Wayl حتى لو الدفع غير ناجح
    // =====================================================

    const basicUpdate = {};

    if (referenceId) {
      basicUpdate.wayl_reference_id =
        referenceId;
    }

    if (paymentId) {
      basicUpdate.wayl_payment_id =
        paymentId;
    }

    if (paymentStatus !== null) {
      basicUpdate.payment_status =
        String(paymentStatus);
    }

    if (paymentMethod) {
      basicUpdate.payment_method =
        paymentMethod;
    }

    if (paymentProcessor) {
      basicUpdate.payment_processor =
        paymentProcessor;
    }

    if (
      Object.keys(basicUpdate).length > 0
    ) {

      const {
        error: basicUpdateError
      } =
        await supabaseAdmin
          .from("orders")
          .update(
            basicUpdate
          )
          .eq(
            "id",
            order.id
          );

      if (basicUpdateError) {

        console.error(
          "WAYL BASIC UPDATE ERROR:",
          basicUpdateError
        );

        return res.status(500).json({
          error:
            "Could not save Wayl payment data",
          details:
            basicUpdateError.message,
        });
      }
    }

    // =====================================================
    // تحديد نجاح الدفع
    // =====================================================

    const status =
      String(
        paymentStatus || ""
      ).toLowerCase();

    const eventName =
      String(
        webhookEvent ||
        event ||
        ""
      ).toLowerCase();

    const paymentIsSuccessful =
      (
        status === "paid" ||
        status === "success" ||
        status === "successful" ||
        status === "completed"
      ) &&
      (
        eventName === "payment.success" ||
        eventName === "payment.paid" ||
        eventName === "payment.completed" ||
        eventName === "order.created" ||
        eventName === ""
      );

    // =====================================================
    // الدفع غير مكتمل
    // =====================================================

    if (!paymentIsSuccessful) {

      console.log(
        "WAYL PAYMENT NOT SUCCESSFUL YET:",
        {
          orderId:
            order.id,

          paymentStatus,

          event:
            eventName
        }
      );

      return res.status(200).json({
        success:
          true,

        received:
          true,

        paymentSuccessful:
          false,

        orderId:
          order.id
      });
    }

    // =====================================================
    // منع تكرار الشراء
    // =====================================================

    if (
      order.status === "paid" ||
      order.status === "completed"
    ) {

      console.log(
        "WAYL ORDER ALREADY PROCESSED:",
        order.id
      );

      return res.status(200).json({
        success:
          true,

        received:
          true,

        alreadyProcessed:
          true,

        orderId:
          order.id
      });
    }

    // =====================================================
    // التحقق من المبلغ
    // =====================================================

    if (
      total !== null &&
      total !== undefined
    ) {

      const receivedTotal =
        Number(total);

      const orderTotal =
        Number(
          order.total_amount
        );

      if (
        Number.isFinite(receivedTotal) &&
        Number.isFinite(orderTotal) &&
        receivedTotal !== orderTotal
      ) {

        console.error(
          "WAYL AMOUNT MISMATCH:",
          {
            orderId:
              order.id,

            orderTotal,

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
      error: paidUpdateError
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
            order.wayl_reference_id ||
            null,

          wayl_payment_id:
            paymentId ||
            order.wayl_payment_id ||
            null,

          payment_method:
            paymentMethod ||
            null,

          payment_processor:
            paymentProcessor ||
            null,

          paid_at:
            new Date().toISOString()

        })
        .eq(
          "id",
          order.id
        );

    if (paidUpdateError) {

      console.error(
        "WAYL PAID UPDATE ERROR:",
        paidUpdateError
      );

      return res.status(500).json({
        error:
          "Could not mark order as paid",

        details:
          paidUpdateError.message
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
        "WAYL ORDER ITEMS ERROR:",
        orderItemsError
      );

      return res.status(500).json({
        error:
          "Could not load order items",

        details:
          orderItemsError.message
      });
    }

    if (
      !Array.isArray(orderItems) ||
      orderItems.length === 0
    ) {

      console.error(
        "WAYL ORDER HAS NO ITEMS:",
        order.id
      );

      return res.status(500).json({
        error:
          "Order has no items"
      });
    }

    // =====================================================
    // إضافة الكتب إلى المكتبة
    // =====================================================

    for (
      const item of orderItems
    ) {

      // -----------------------------------------------
      // فحص وجود الكتاب
      // -----------------------------------------------

      const {
        data: existingItem,
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
          "WAYL LIBRARY CHECK ERROR:",
          existingError
        );

        return res.status(500).json({
          error:
            "Could not check library",

          details:
            existingError.message
        });
      }

      // -----------------------------------------------
      // موجود مسبقًا
      // -----------------------------------------------

      if (
        existingItem &&
        existingItem.length > 0
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

      // -----------------------------------------------
      // إضافة الكتاب
      // -----------------------------------------------

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
          "WAYL LIBRARY INSERT ERROR:",
          libraryInsertError
        );

        return res.status(500).json({
          error:
            "Could not add book to library",

          details:
            libraryInsertError.message
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
      "WAYL PAYMENT COMPLETED:",
      {
        orderId:
          order.id,

        userId:
          order.user_id,

        referenceId,

        paymentId,

        total
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
