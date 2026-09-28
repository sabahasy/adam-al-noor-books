import { createClient } from "@supabase/supabase-js";

const WAYL_CREATE_URL = "https://api.thewayl.com/api/v1/links";

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { text, data };
}

function getPaymentUrl(data) {
  return (
    data?.data?.url ||
    data?.url ||
    data?.data?.paymentUrl ||
    data?.paymentUrl ||
    null
  );
}

async function lookupWayl(referenceId, apiKey) {
  const response = await fetchWithTimeout(
    `${WAYL_CREATE_URL}/${encodeURIComponent(referenceId)}`,
    {
      method: "GET",
      headers: {
        "X-WAYL-AUTHENTICATION": apiKey,
        Accept: "application/json",
      },
    },
    4000
  );

  const { text, data } = await readJson(response);

  console.log("WAYL LOOKUP STATUS:", response.status);
  console.log("WAYL LOOKUP RESPONSE:", text);

  return {
    response,
    data,
    paymentUrl: getPaymentUrl(data),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let supabaseAdmin = null;
  let createdOrderId = null;
  let waylAttempted = false;
  let referenceId = null;

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";
    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    const WAYL_API_KEY = process.env.WAYL_API_KEY;
    const WAYL_WEBHOOK_SECRET = process.env.WAYL_WEBHOOK_SECRET;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "مفتاح Supabase السري غير موجود في Vercel." });
    }
    if (!WAYL_API_KEY) {
      return res.status(500).json({ error: "WAYL_API_KEY غير موجود في Vercel." });
    }
    if (!WAYL_WEBHOOK_SECRET) {
      return res.status(500).json({ error: "WAYL_WEBHOOK_SECRET غير موجود في Vercel." });
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({ error: "يجب تسجيل الدخول أولًا." });
    }

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      return res.status(401).json({ error: "جلسة تسجيل الدخول غير صالحة." });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: "السلة فارغة." });
    }

    const bookIds = items.map(item => Number(item?.id));
    if (bookIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ error: "يوجد كتاب بمعرّف غير صحيح." });
    }

    const uniqueBookIds = [...new Set(bookIds)];
    if (uniqueBookIds.length !== bookIds.length) {
      return res.status(400).json({ error: "يوجد كتاب مكرر في السلة." });
    }

    const { data: books, error: booksError } = await supabaseAdmin
      .from("books")
      .select("id,title_ar,price,is_available")
      .in("id", uniqueBookIds);

    if (booksError) {
      console.error("BOOKS ERROR:", booksError);
      return res.status(500).json({ error: "تعذر قراءة الكتب من قاعدة البيانات." });
    }

    if (!Array.isArray(books) || books.length !== uniqueBookIds.length) {
      return res.status(400).json({ error: "يوجد كتاب غير موجود في قاعدة البيانات." });
    }

    const orderedBooks = uniqueBookIds.map(id =>
      books.find(book => Number(book.id) === id)
    );

    for (const book of orderedBooks) {
      if (!book) {
        return res.status(400).json({ error: "تعذر مطابقة الكتب." });
      }
      if (book.is_available === false) {
        return res.status(400).json({ error: `الكتاب غير متاح: ${book.title_ar}` });
      }
      const priceIQD = Number(book.price);
      if (!Number.isFinite(priceIQD) || priceIQD <= 0 || !Number.isInteger(priceIQD)) {
        return res.status(400).json({
          error: `سعر الكتاب غير صحيح بالدينار العراقي: ${book.title_ar}`,
        });
      }
    }

    const lineItem = orderedBooks.map(book => ({
      label: String(book.title_ar || "كتاب"),
      amount: Number(book.price),
      type: "increase",
    }));

    const totalIQD = lineItem.reduce((sum, item) => sum + Number(item.amount), 0);
    if (!Number.isInteger(totalIQD) || totalIQD <= 0) {
      return res.status(400).json({ error: "إجمالي الطلب غير صحيح." });
    }

    referenceId = `adam-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: userData.user.id,
        total_amount: totalIQD,
        status: "pending",
      })
      .select("id,user_id,total_amount,status,created_at")
      .single();

    if (orderError) {
      console.error("ORDER INSERT ERROR:", orderError);
      return res.status(500).json({
        error: "تعذر إنشاء الطلب.",
        details: orderError.message,
      });
    }

    createdOrderId = order.id;

    const orderItems = orderedBooks.map(book => ({
      order_id: order.id,
      book_id: Number(book.id),
      price: Number(book.price),
      quantity: 1,
    }));

    const { error: orderItemsError } = await supabaseAdmin
      .from("order_items")
      .insert(orderItems);

    if (orderItemsError) {
      console.error("ORDER ITEMS ERROR:", orderItemsError);
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      return res.status(500).json({
        error: "تعذر حفظ كتب الطلب.",
        details: orderItemsError.message,
      });
    }

    const webhookUrl = "https://project-akmpg.vercel.app/api/wayl-webhook";
    const redirectionUrl = "https://project-akmpg.vercel.app";
    const waylRequest = {
      env: "live",
      referenceId,
      total: totalIQD,
      currency: "IQD",
      customParameter: String(order.id),
      lineItem,
      webhookUrl,
      webhookSecret: WAYL_WEBHOOK_SECRET,
      redirectionUrl,
    };

    console.log("WAYL REQUEST:", JSON.stringify({ ...waylRequest, webhookSecret: "[HIDDEN]" }));

    let waylResponse = null;
    let waylData = null;
    let paymentUrl = null;

    // Once the POST starts, never blindly cancel the local order.
    // Wayl may have created the link even if the response is lost/slow.
    waylAttempted = true;

    try {
      waylResponse = await fetchWithTimeout(
        WAYL_CREATE_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WAYL-AUTHENTICATION": WAYL_API_KEY,
          },
          body: JSON.stringify(waylRequest),
        },
        10000
      );

      const { text, data } = await readJson(waylResponse);
      waylData = data;

      console.log("WAYL STATUS:", waylResponse.status);
      console.log("WAYL RESPONSE:", text);

      paymentUrl = getPaymentUrl(waylData);

      // If Wayl returned an error or an incomplete response, reconcile by
      // referenceId before deciding that creation really failed.
      if (!waylResponse.ok || !paymentUrl) {
        try {
          const lookup = await lookupWayl(referenceId, WAYL_API_KEY);
          if (lookup.paymentUrl) {
            paymentUrl = lookup.paymentUrl;
            waylData = lookup.data;
            waylResponse = lookup.response;
          }
        } catch (lookupError) {
          console.error("WAYL RECONCILIATION ERROR:", lookupError);
          return res.status(504).json({
            error: "تأخر خادم الدفع. الطلب محفوظ وسيتم التحقق منه قبل إنشاء طلب جديد.",
            referenceId,
            orderId: order.id,
          });
        }
      }
    } catch (error) {
      console.warn("WAYL CREATE ERROR/TIMEOUT; checking referenceId:", referenceId, error?.name || error?.message);

      try {
        const lookup = await lookupWayl(referenceId, WAYL_API_KEY);
        if (lookup.paymentUrl) {
          paymentUrl = lookup.paymentUrl;
          waylData = lookup.data;
          waylResponse = lookup.response;
        } else if (lookup.response.status === 404) {
          return res.status(502).json({
            error: "تعذر إنشاء رابط الدفع من Wayl.",
            waylStatus: 404,
            referenceId,
            orderId: order.id,
          });
        } else {
          return res.status(504).json({
            error: "تأخر خادم الدفع. الطلب محفوظ، يرجى المحاولة بعد لحظات.",
            referenceId,
            orderId: order.id,
          });
        }
      } catch (lookupError) {
        console.error("WAYL LOOKUP ERROR:", lookupError);
        return res.status(504).json({
          error: "تأخر خادم الدفع. الطلب محفوظ ولم يتم إلغاؤه تلقائيًا.",
          referenceId,
          orderId: order.id,
        });
      }
    }

    if (!paymentUrl || !/^https?:\/\//i.test(paymentUrl)) {
      console.error("WAYL PAYMENT URL MISSING:", waylData);

      if (waylResponse && waylResponse.status >= 400 && waylResponse.status < 500) {
        await supabaseAdmin
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", order.id)
          .eq("status", "pending");
      }

      return res.status(502).json({
        error: "Wayl لم يُرجع رابط الدفع.",
        message: waylData?.message || "لم يتم العثور على رابط الدفع.",
        referenceId,
        orderId: order.id,
      });
    }

    const { error: waylSaveError } = await supabaseAdmin
      .from("orders")
      .update({
        wayl_reference_id: referenceId,
        wayl_payment_url: paymentUrl,
      })
      .eq("id", order.id);

    if (waylSaveError) {
      console.error("WAYL DATA SAVE ERROR:", waylSaveError);
    }

    console.log("PAYMENT CREATED:", {
      orderId: order.id,
      userId: userData.user.id,
      referenceId,
      totalIQD,
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      referenceId,
      total: totalIQD,
      currency: "IQD",
      paymentUrl,
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);

    // If the Wayl request has already started, do NOT cancel a pending order
    // because Wayl may have created a real payment link despite a lost response.
    if (supabaseAdmin && createdOrderId && !waylAttempted) {
      try {
        await supabaseAdmin
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", createdOrderId)
          .eq("status", "pending");
      } catch (cleanupError) {
        console.error("ORDER CLEANUP ERROR:", cleanupError);
      }
    }

    return res.status(500).json({
      error: "حدث خطأ في خادم الدفع.",
      message: error?.message || "Unknown error",
      referenceId,
      orderId: createdOrderId,
    });
  }
}
