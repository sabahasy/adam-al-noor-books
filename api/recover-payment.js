import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      "https://smsqjmgbrkgxyhkaitao.supabase.co";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
      return res.status(500).json({ error: "خدمة استعادة الدفع غير مهيأة." });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({ error: "يجب تسجيل الدخول أولًا." });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } =
      await admin.auth.getUser(accessToken);

    if (authError || !authData?.user) {
      return res.status(401).json({ error: "جلسة تسجيل الدخول غير صالحة." });
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: order, error } = await admin
      .from("orders")
      .select("id,total_amount,wayl_payment_url,created_at")
      .eq("user_id", authData.user.id)
      .eq("status", "pending")
      .not("wayl_payment_url", "is", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("PAYMENT RECOVERY LOOKUP ERROR:", error);
      return res.status(500).json({ error: "تعذر التحقق من رابط الدفع." });
    }

    if (!order?.wayl_payment_url) {
      return res.status(404).json({ error: "لم أجد رابط دفع محفوظًا لطلب حديث." });
    }

    if (!/^https:\/\/checkout\.thewayl\.com\//i.test(order.wayl_payment_url)) {
      console.error("PAYMENT RECOVERY URL REJECTED:", order.id);
      return res.status(502).json({ error: "رابط الدفع المحفوظ غير صالح." });
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      totalIQD: Number(order.total_amount),
      paymentUrl: order.wayl_payment_url
    });
  } catch (error) {
    console.error("PAYMENT RECOVERY ERROR:", error);
    return res.status(500).json({ error: "حدث خطأ أثناء استعادة رابط الدفع." });
  }
}
