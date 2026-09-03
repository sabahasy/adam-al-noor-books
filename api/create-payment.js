import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {

  // =====================================================
  // POST فقط
  // =====================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
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
        error: "مفتاح Supabase السري غير موجود في Vercel."
      });
    }

    const supabaseAdmin =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      );

    // =====================================================
    // التحقق من المستخدم
    // =====================================================

    const authHeader =
      req.headers.authorization || "";

    const accessToken =
      authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "يجب تسجيل الدخول أولًا."
      });
    }

    const {
      data: userData,
      error: userError
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      userError ||
      !userData?.user
    ) {
      return res.status(401).json({
        error: "جلسة تسجيل الدخول غير صالحة."
      });
    }

    const user =
      userData.user;

    // =====================================================
    // قراءة السلة
    // =====================================================

    const body =
      req.body || {};

    const items =
      Array.isArray(body.items)
        ? body.items
        : [];

    if (items.length === 0) {
      return res.status(400).json({
        error: "السلة فارغة."
      });
    }

    // =====================================================
    // IDs
    // =====================================================

    const bookIds = [];

    for (const item of items) {

      const id =
        Number(item?.id);

      if (
        !Number.isSafeInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          error: "يوجد كتاب بمعرّف غير صحيح.",
          bookId: String(item?.id ?? "")
        });
      }

      bookIds.push(id);
    }

    const uniqueBookIds =
      [...new Set(bookIds)];

    if (
      uniqueBookIds.length !==
      bookIds.length
    ) {
      return res.status(400).json({
        error: "يوجد كتاب مكرر في السلة."
      });
    }

    // =====================================================
    // WAYL
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
    // إعدادات Wayl
    // السعر في قاعدة البيانات = دينار عراقي مباشرة
    // =====================================================

    const webhookUrl =
      "https://project-akmpg.vercel.app/api/wayl-webhook";

    const redirectionUrl =
      "https://project-akmpg.vercel.app";

    // =====================================================
    // قراءة الكتب من Supabase
    // =====================================================

    const {
      data: books,
      error: booksError
    } =
      await supabaseAdmin
        .from("books")
        .select(
          "id,title_ar,price,is_available"
        )
        .in(
          "id",
          uniqueBookIds
        );

    if (booksError) {
      console.error(
        "BOOKS ERROR:",
        booksError
      );

      return res.status(500).json({
        error: "تعذر قراءة الكتب من قاعدة البيانات."
      });
    }

    if (
      !Array.isArray(books) ||
      books.length !== uniqueBookIds.length
    ) {
      return res.status(400).json({
        error: "يوجد كتاب غير موجود في قاعدة البيانات."
      });
    }

    // =====================================================
    // ترتيب الكتب
    // =====================================================

    const orderedBooks =
      uniqueBookIds.map(id =>
        books.find(
          book =>
            Number(book.id) === Number(id)
        )
      );

    if (
      orderedBooks.some(
        book => !book
      )
    ) {
      return res.status(400).json({
        error: "تعذر مطابقة الكتب."
      });
    }

    // =====================================================
    // التحقق من الكتب والأسعار
    // =====================================================

    for (const book of orderedBooks) {

      if (
        book.is_available === false
      ) {
        return res.status(400).json({
          error:
            `الكتاب غير متاح: ${book.title_ar}`
        });
      }

      const priceIQD =
        Number(book.price);

      if (
        !Number.isFinite(priceIQD) ||
        priceIQD <= 0
      ) {
        return res.status(400).json({
          error:
            `سعر الكتاب غير صحيح: ${book.title_ar}`
        });
      }

      if (
        !Number.isInteger(priceIQD)
      ) {
        return res.status(400).json({
          error:
            `سعر الكتاب يجب أن يكون رقمًا صحيحًا بالدينار العراقي: ${book.title_ar}`
        });
      }
    }

    // =====================================================
    // عناصر Wayl
    // السعر = IQD مباشرة
    // =====================================================

    const lineItem =
      orderedBooks.map(book => {

        const amountIQD =
          Number(book.price);

        return {
          label:
            String(
              book.title_ar || "كتاب"
            ),

          amount:
            amountIQD,

          type:
            "increase"
        };
      });

    // =====================================================
    // الإجمالي بالدينار العراقي
    // =====================================================

    const totalIQD =
      lineItem.reduce(
        (sum, item) =>
          sum + Number(item.amount),
        0
      );

    if (
      !Number.isInteger(totalIQD) ||
      totalIQD <= 0
    ) {
      return res.status(400).json({
        error: "إجمالي الطلب غير صحيح."
      });
    }

    // =====================================================
    // Reference
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
    } =
      await supabaseAdmin
        .from("orders")
        .insert({
          user_id:
            user.id,

          total_amount:
            totalIQD,

          status:
            "pending"
        })
        .select(
          "id,user_id,total_amount,status,created_at"
        )
        .single();

    if (orderError) {

      console.error(
        "ORDER INSERT ERROR:",
        orderError
      );

      return res.status(500).json({
        error: "تعذر إنشاء الطلب.",
        details:
          orderError.message
      });
    }

    // =====================================================
    // حفظ عناصر الطلب
    // =====================================================

    const orderItems =
      orderedBooks.map(book => ({
        order_id:
          order.id,

        book_id:
          Number(book.id),

        price:
          Number(book.price),

        quantity:
          1
      }));

    const {
      error: orderItemsError
    } =
      await supabaseAdmin
        .from("order_items")
        .insert(
          orderItems
        );

    if (orderItemsError) {

      console.error(
        "ORDER ITEMS ERROR:",
        orderItemsError
      );

      await supabaseAdmin
        .from("orders")
        .delete()
        .eq(
          "id",
          order.id
        );

      return res.status(500).json({
        error: "تعذر حفظ كتب الطلب.",
        details:
          orderItemsError.message
      });
    }

    // =====================================================
    // طلب Wayl
    // =====================================================

    const waylRequest = {

      env:
        "live",

      referenceId:
        referenceId,

      total:
        totalIQD,

      currency:
        "IQD",

      customParameter:
        String(order.id),

      lineItem:
        lineItem,

      webhookUrl:
        webhookUrl,

      webhookSecret:
        WAYL_WEBHOOK_SECRET,

      redirectionUrl:
        redirectionUrl
    };

    console.log(
      "WAYL REQUEST:",
      JSON.stringify({
        ...waylRequest,
        webhookSecret: "[HIDDEN]"
      })
    );

    // =====================================================
    // الاتصال بـ Wayl
    // =====================================================

    const waylResponse =
      await fetch(
        "https://api.thewayl.com/api/v1/links",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-WAYL-AUTHENTICATION":
              WAYL_API_KEY
          },

          body:
            JSON.stringify(
              waylRequest
            )
        }
      );

    const rawText =
      await waylResponse.text();

    console.log(
      "WAYL STATUS:",
      waylResponse.status
    );

    console.log(
      "WAYL RESPONSE:",
      rawText
    );

    let waylData;

    try {
      waylData =
        JSON.parse(rawText);
    }
    catch {
      waylData = {
        raw: rawText
      };
    }

    // =====================================================
    // Wayl رفض الطلب
    // =====================================================

    if (!waylResponse.ok) {

      console.error(
        "WAYL REJECTED:",
        waylResponse.status,
        waylData
      );

      await supabaseAdmin
        .from("orders")
        .update({
          status:
            "failed"
        })
        .eq(
          "id",
          order.id
        );

      return res.status(
        waylResponse.status
      ).json({

        error:
          "Wayl رفض طلب الدفع.",

        waylStatus:
          waylResponse.status,

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
      waylData?.data?.paymentUrl ||
      waylData?.paymentUrl;

    if (
      typeof paymentUrl !== "string" ||
      !/^https?:\/\//i.test(
        paymentUrl
      )
    ) {

      console.error(
        "WAYL PAYMENT URL MISSING:",
        waylData
      );

      await supabaseAdmin
        .from("orders")
        .update({
          status:
            "failed"
        })
        .eq(
          "id",
          order.id
        );

      return res.status(502).json({
        error:
          "Wayl لم يُرجع رابط الدفع.",

        message:
          waylData?.message ||
          "لم يتم العثور على رابط الدفع.",

        details:
          waylData
      });
    }

    // =====================================================
    // حفظ بيانات Wayl في orders
    // =====================================================

    const waylOrderUpdate = {

      wayl_reference_id:
        referenceId,

      wayl_payment_url:
        paymentUrl
    };

    const {
      error: waylSaveError
    } =
      await supabaseAdmin
        .from("orders")
        .update(
          waylOrderUpdate
        )
        .eq(
          "id",
          order.id
        );

    if (waylSaveError) {

      console.error(
        "WAYL DATA SAVE ERROR:",
        waylSaveError
      );

      console.log(
        "تم إنشاء رابط Wayl بنجاح، وسيتم الاعتماد على customParameter/referenceId."
      );
    }

    // =====================================================
    // النجاح
    // =====================================================

    console.log(
      "PAYMENT CREATED:",
      {
        orderId:
          order.id,

        userId:
          user.id,

        referenceId:
          referenceId,

        totalIQD:
          totalIQD
      }
    );

    return res.status(200).json({

      success:
        true,

      orderId:
        order.id,

      referenceId:
        referenceId,

      total:
        totalIQD,

      currency:
        "IQD",

      paymentUrl:
        paymentUrl
    });

  }
  catch (error) {

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
