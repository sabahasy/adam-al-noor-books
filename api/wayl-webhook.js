import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const secret =
      process.env.WAYL_WEBHOOK_SECRET;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Supabase service role key missing",
      });
    }

    if (!secret) {
      return res.status(500).json({
        error: "Webhook secret missing",
      });
    }

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // Wayl signs the exact raw request body.
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    }

    const rawBody = Buffer.concat(chunks);

    const signatureHeader =
      req.headers["x-wayl-signature-256"];

    const receivedSignature = String(
      signatureHeader || ""
    )
      .trim()
      .replace(/^sha256=/i, "");

    if (!/^[0-9a-f]{64}$/i.test(receivedSignature)) {
      console.error(
        "WAYL WEBHOOK: invalid signature format"
      );

      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const receivedBuffer = Buffer.from(
      receivedSignature,
      "hex"
    );

    const expectedBuffer = Buffer.from(
      expectedSignature,
      "hex"
    );

    if (
      receivedBuffer.length !==
      expectedBuffer.length ||
      !crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      console.error(
        "WAYL WEBHOOK: invalid signature"
      );

      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    let data;

    try {
      data = JSON.parse(
        rawBody.toString("utf8")
      );
    } catch (error) {
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

    const referenceId =
      data?.referenceId || null;

    const customParameter =
      data?.customParameter || null;

    const paymentStatus = String(
      data?.paymentStatus || ""
    ).trim().toLowerCase();

    const paymentMethod =
      data?.paymentMethod || null;

    const paymentProcessor =
      data?.paymentProcessor || null;

    const total =
      data?.total ?? null;

    const paymentId =
      data?.id || null;

    const event =
      data?.event || null;

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
      }
    );

    // Wayl's webhook vocabulary uses paymentStatus="Paid".
    // Do not require a particular event name: status changes can be
    // delivered with different event metadata.
    if (paymentStatus !== "paid") {
      return res.status(200).json({
        success: true,
        received: true,
        paymentSuccessful: false,
      });
    }

    let orderQuery = supabaseAdmin
      .from("orders")
      .select(
        "id,user_id,total_amount,status,wayl_reference_id"
      );

    let orderResult;

    const customOrderId = Number(
      customParameter
    );

    if (
      Number.isInteger(customOrderId) &&
      customOrderId > 0
    ) {
      orderResult = await orderQuery
        .eq("id", customOrderId)
        .maybeSingle();
    } else if (referenceId) {
      orderResult = await orderQuery
        .eq("wayl_reference_id", referenceId)
        .maybeSingle();
    } else {
      return res.status(400).json({
        error: "Missing order reference",
      });
    }

    const {
      data: order,
      error: orderFindError,
    } = orderResult || {};

    if (orderFindError) {
      console.error(
        "ORDER LOOKUP ERROR:",
        orderFindError
      );

      return res.status(500).json({
        error: "Could not find order",
      });
    }

    if (!order && referenceId && customOrderId > 0) {
      const fallback = await supabaseAdmin
        .from("orders")
        .select(
          "id,user_id,total_amount,status,wayl_reference_id"
        )
        .eq("wayl_reference_id", referenceId)
        .maybeSingle();

      if (fallback.error) {
        console.error(
          "ORDER REFERENCE LOOKUP ERROR:",
          fallback.error
        );

        return res.status(500).json({
          error: "Could not find order",
        });
      }

      orderResult = fallback;
    }

    const resolvedOrder =
      orderResult?.data || order;

    if (!resolvedOrder) {
      console.error(
        "ORDER NOT FOUND:",
        {
          customParameter,
          referenceId,
        }
      );

      return res.status(404).json({
        error: "Order not found",
      });
    }

    const webhookTotal = Number(total);
    const orderTotal = Number(
      resolvedOrder.total_amount
    );

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
          orderId: resolvedOrder.id,
        }
      );

      return res.status(400).json({
        error: "Payment amount does not match order",
      });
    }

    const {
      data: orderItems,
      error: orderItemsError,
    } = await supabaseAdmin
      .from("order_items")
      .select(
        "id,order_id,book_id,price,quantity"
      )
      .eq("order_id", resolvedOrder.id);

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
        resolvedOrder.id
      );

      return res.status(500).json({
        error: "Order has no items",
      });
    }

    // Make webhook retries safe. The library table already has a
    // unique(user_id, book_id) constraint, so only missing books are inserted.
    const bookIds = orderItems.map(item =>
      Number(item.book_id)
    );

    const {
      data: existingLibrary,
      error: libraryReadError,
    } = await supabaseAdmin
      .from("library")
      .select("id,book_id")
      .eq("user_id", resolvedOrder.user_id)
      .in("book_id", bookIds);

    if (libraryReadError) {
      console.error(
        "LIBRARY READ ERROR:",
        libraryReadError
      );

      return res.status(500).json({
        error: "Could not check library",
      });
    }

    const existingBookIds = new Set(
      (existingLibrary || []).map(item =>
        Number(item.book_id)
      )
    );

    const missingLibraryRows =
      orderItems
        .filter(item =>
          !existingBookIds.has(
            Number(item.book_id)
          )
        )
        .map(item => ({
          user_id:
            resolvedOrder.user_id,
          book_id:
            Number(item.book_id),
          order_id:
            resolvedOrder.id,
          purchased_at:
            new Date().toISOString(),
        }));

    if (missingLibraryRows.length > 0) {
      const {
        error: libraryInsertError,
      } = await supabaseAdmin
        .from("library")
        .insert(missingLibraryRows);

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
    }

    // Update the order only after every purchased book is safely in the library.
    const {
      error: orderUpdateError,
    } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        wayl_reference_id:
          referenceId ||
          resolvedOrder.wayl_reference_id ||
          null,
        wayl_payment_id:
          paymentId,
        payment_status: "Paid",
        payment_method:
          paymentMethod,
        payment_processor:
          paymentProcessor,
        paid_at:
          new Date().toISOString(),
      })
      .eq("id", resolvedOrder.id);

    if (orderUpdateError) {
      console.error(
        "ORDER UPDATE ERROR:",
        orderUpdateError
      );

      return res.status(500).json({
        error: "Could not update order",
      });
    }

    console.log(
      "WAYL PAYMENT COMPLETED:",
      {
        orderId:
          resolvedOrder.id,
        userId:
          resolvedOrder.user_id,
        referenceId,
        paymentId,
        total,
        event,
      }
    );

    return res.status(200).json({
      success: true,
      received: true,
      paymentSuccessful: true,
      orderId: resolvedOrder.id,
    });
  } catch (error) {
    console.error(
      "WAYL WEBHOOK ERROR:",
      error
    );

    return res.status(500).json({
      error: "Webhook server error",
      message:
        error?.message ||
        "Unknown error",
    });
  }
}
