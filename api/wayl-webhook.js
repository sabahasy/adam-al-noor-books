import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {

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
        error: "SUPABASE_SERVICE_ROLE_KEY غير موجود."
      });
    }

    const supabaseAdmin =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      );

    // =====================================================
    // تسجيل الدخول
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
      !userData ||
      !userData.user
    ) {
      return res.status(401).json({
        error: "جلسة تسجيل الدخول غير صالحة."
      });
    }

    const user =
      userData.user;

    // =====================================================
    // السلة
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

    const bookIds =
      items.map(item =>
        Number(item?.id)
      );

    if (
      bookIds.some(
        id =>
          !Number.isSafeInteger(id) ||
          id <= 0
      )
    ) {
      return res.status(400).json({
        error: "يوجد كتاب بمعرّف غير صحيح."
      });
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
    // الإعدادات
    // =====================================================

    const USD_TO_IQD = 1310;

    const webhookUrl =
      "https://project-akmpg.vercel.app/api/wayl-webhook";

    const redirectionUrl =
      "https://project-akmpg.vercel.app";

    // =====================================================
    // الكتب
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
