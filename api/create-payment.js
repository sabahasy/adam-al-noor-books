import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // السماح بـ POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =====================================================
    // قراءة المستخدم من Authorization
    // =====================================================

    const authHeader = req.headers.authorization || "";

    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "يجب تسجيل الدخول أولًا."
      });
    }

    // =====================================================
    // مفاتيح Supabase
    // =====================================================

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.error(
        "SUPABASE_SERVICE_ROLE_KEY missing"
      );

      return res.status(500).json({
        error: "مفتاح Supabase السري غير موجود في Vercel."
      });
    }

    // عميل إداري للخادم فقط
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // =====================================================
    // التحقق من المستخدم
    // =====================================================

    const {
      data: userData,
      error: userError
    } = await supabaseAdmin.auth.getUser(
      accessToken
    );

    if (
      userError ||
      !userData?.user
    ) {
      console.error(
        "SUPABASE USER ERROR:",
        userError
      );

      return res.status(401).json({
        error: "جلسة تسجيل الدخول غير صالحة. سجّل الدخول مرة أخرى."
      });
    }

    const user = userData.user;

    // =====================================================
    // قراءة السلة
    // =====================================================

    const { items } = req.body || {};

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        error: "السلة فارغة."
      });
    }

    // =====================================================
    // مفاتيح Wayl
    // =====================================================

    const WAYL_API_KEY =
      process.env.WAYL_API_KEY;

    const WAYL_WEBHOOK_SECRET =
      process.env.WAYL_WEBHOOK_SECRET;

    if (!WAYL_API_KEY) {
      return res.status(500).json({
        error: "WAYL_API_KEY غير موجود في Vercel."
      });
    }

    if (!WAYL_WEBHOOK_SECRET) {
      return res.status(500).json({
        error: "WAYL_WEBHOOK_SECRET غير موجود في Vercel."
      });
    }

    // =====================================================
    // إعدادات المتجر
    // =====================================================

    const USD_TO_IQD = 1310;

    const webhookUrl =
      "https://project-akmpg.vercel.app/api/wayl-webhook";

    const redirectionUrl =
      "https://project-akmpg.vercel.app";

    // =====================================================
    // التحقق من الكتب والأسعار من Supabase
    // =====================================================

    const bookIds = items
      .map(book => Number(book.id))
      .filter(id => Number.isInteger(id));

    if (bookIds.length !== items.length) {
      return res.status(400).json({
        error: "يوجد كتاب بمعرّف غير صحيح."
      });
    }

    const {
      data: books,
      error: booksError
    } = await supabaseAdmin
      .from("books")
      .select(
        "id,title_ar,price,is_available"
      )
      .in("id", bookIds);

    if (booksError) {
      console.error(
        "SUPABASE BOOKS ERROR:",
        booksError
      );

      return res.status(500).json({
        error: "تعذر قراءة الكتب من قاعدة البيانات."
      });
    }

    if (
      !Array.isArray(books) ||
      books.length !== items.length
    ) {
      return res.status(400).json({
        error: "يوجد كتاب غير موجود في قاعدة البيانات."
      });
    }

    // =====================================================
    // منع شراء كتاب غير متاح
    // =====================================================

    for (const book of books) {
      if (book.is_available === false) {
        return res.status(400).json({
          error:
            `الكتاب غير متاح حاليًا: ${book.title_ar}`
        });
      }
    }

    // =====================================================
    // إنشاء عناصر الطلب من أسعار Supabase
    // =====================================================

    const lineItem = books.map(book => {
      const priceUSD = Number(book.price);

      if (
        !Number.isFinite(priceUSD) ||
        priceUSD <= 0
      ) {
        throw new Error(
          `سعر الكتاب غير صحيح: ${book.title_ar}`
        );
      }

      return {
        label: String(
          book.title_ar || "كتاب"
        ),

        amount: Math.round(
          priceUSD * USD_TO_IQD
        ),

        type: "increase"
      };
    });

    // =====================================================
    // حساب الإجمالي
    // =====================================================

    const totalIQD = lineItem.reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0
    );

    const totalUSD = books.reduce(
      (sum, book) =>
        sum + Number(book.price),
      0
    );

    if (
      !Number.isInteger(totalIQD) ||
      totalIQD <= 0
    ) {
      return res.status(400).json({
        error: "إجمالي الطلب غير صحيح.",
        totalIQD
      });
    }

    // =====================================================
    // رقم مرجعي فريد
    // =====================================================

    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 10);

    // =====================================================
    // إنشاء الطلب في Supabase
    // =====================================================

    const {
      data: order,
      error: orderError
    } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        total_amount: totalIQD,
        status: "pending"
      })
      .select("id,user_id,total_amount,status,created_at")
      .single();

    if (orderError) {
      console.error(
        "SUPABASE ORDER INSERT ERROR:",
        orderError
      );

      return res.status(500).json({
        error: "تعذر إنشاء الطلب.",
        details: orderError.message
      });
    }

    // =====================================================
    // إنشاء order_items
    // =====================================================

    const orderItems = books.map(book => ({
      order_id: order.id,
      book_id: book.id,
      price: Number(book.price),
      quantity: 1
    }));

    const {
      error: orderItemsError
    } = await supabaseAdmin
      .from("order_items")
      .insert(orderItems);

    if (orderItemsError) {
      console.error(
        "SUPABASE ORDER ITEMS ERROR:",
        orderItemsError
      );

      // حذف الطلب إذا فشل إنشاء العناصر
      await supabaseAdmin
        .from("orders")
        .delete()
        .eq("id", order.id);

      return res.status(500).json({
        error: "تعذر حفظ كتب الطلب.",
        details: orderItemsError.message
      });
    }

    // =====================================================
    // إرسال طلب الدفع إلى Wayl
    // =====================================================

    const requestBody = {
      env: "test",

      referenceId,

      total: totalIQD,

      currency: "IQD",

      customParameter: String(order.id),

      lineItem,

      webhookUrl,

      webhookSecret:
        WAYL_WEBHOOK_SECRET,

      redirectionUrl
    };

    console.log(
      "WAYL REQUEST BODY:",
      JSON.stringify({
        ...requestBody,
        webhookSecret: "[HIDDEN]"
      })
    );

    // =====================================================
    // الاتصال بـ Wayl
    // =====================================================

    const response = await fetch(
      "https://api.thewayl.com/api/v1/links",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          "X-WAYL-AUTHENTICATION":
            WAYL_API_KEY
        },

        body: JSON.stringify(
          requestBody
        )
      }
    );

    const rawText =
      await response.text();

    console.log(
      "WAYL STATUS:",
      response.status
    );

    console.log(
      "WAYL RAW RESPONSE:",
      rawText
    );

    let waylData;

    try {
      waylData =
        JSON.parse(rawText);
    } catch {
      waylData = {
        raw: rawText
      };
    }

    // =====================================================
    // Wayl رفض الدفع
    // =====================================================

    if (!response.ok) {
      console.error(
        "WAYL REJECTED:",
        response.status,
        waylData
      );

      // تحديث الطلب إلى failed
      await supabaseAdmin
        .from("orders")
        .update({
          status: "failed"
        })
        .eq("id", order.id);

      return res.status(
        response.status
      ).json({
        error:
          "Wayl رفض طلب الدفع.",

        waylStatus:
          response.status,

        message:
          waylData?.message ||
          waylData?.error ||
          "لم يرسل Wayl رسالة واضحة.",

        errors:
          waylData?.errors ||
          null
      });
    }

    // =====================================================
    // استخراج رابط الدفع
    // =====================================================

    const paymentUrl =
      waylData?.data?.url ||
      waylData?.url ||
      waylData?.data?.paymentUrl;

    if (!paymentUrl) {
      console.error(
        "WAYL NO PAYMENT URL:",
        waylData
      );

      await supabaseAdmin
        .from("orders")
        .update({
          status: "failed"
        })
        .eq("id", order.id);

      return res.status(502).json({
        error:
          "Wayl لم يُرجع رابط الدفع.",

        message:
          waylData?.message ||
          "لم يتم العثور على رابط الدفع.",

        details: waylData
      });
    }

    // =====================================================
    // حفظ referenceId داخل customParameter موجود في Wayl
    // الطلب نفسه يبقى pending حتى يأتي Webhook
    // =====================================================

    console.log(
      "WAYL PAYMENT CREATED:",
      {
        orderId: order.id,
        userId: user.id,
        referenceId,
        totalUSD,
        totalIQD
      }
    );

    // =====================================================
    // النجاح
    // =====================================================

    return res.status(200).json({
      success: true,

      orderId:
        order.id,

      referenceId,

      total:
        totalIQD,

      totalUSD,

      currency:
        "IQD",

      paymentUrl
    });

  } catch (error) {

    console.error(
      "CREATE PAYMENT ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "حدث خطأ في خادم الدفع.",

      message:
        error?.message ||
        "Unknown error"
    });
  }
}
