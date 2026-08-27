export default async function handler(req, res) {

  // السماح بطلبات POST فقط
  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Method not allowed"
    });

  }


  try {

    const {
      items,
      totalUSD,
      totalIQD
    } = req.body || {};


    // التحقق من السلة
    if (
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {

      return res.status(400).json({
        error: "السلة فارغة"
      });

    }


    // التحقق من المبلغ
    const amountIQD =
      Math.round(Number(totalIQD));


    if (
      !Number.isInteger(amountIQD) ||
      amountIQD <= 0
    ) {

      return res.status(400).json({
        error: "المبلغ غير صحيح"
      });

    }


    // مفتاح Wayl من Vercel فقط
    const WAYL_API_KEY =
      process.env.WAYL_API_KEY;


    if (!WAYL_API_KEY) {

      console.error(
        "WAYL_API_KEY is missing"
      );

      return res.status(500).json({
        error:
          "مفتاح Wayl غير موجود في Vercel. تأكد أن اسم المتغير هو WAYL_API_KEY."
      });

    }


    // إنشاء رقم مرجعي فريد
    const referenceId =
      "adam-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 10);


    /*
       إنشاء عناصر الدفع.

       Wayl يشترط أن يكون مجموع lineItem
       مساويًا للمبلغ الكلي.

       لذلك نرسل كل كتاب كعنصر مستقل
       بعد تحويل سعره إلى IQD.
    */

    const lineItems =
      items.map(book => {

        const usdPrice =
          Number(book.price || 0);

        const iqdPrice =
          Math.round(
            usdPrice * 1310
          );

        return {

          label:
            String(
              book.title || "كتاب إلكتروني"
            ),

          amount:
            iqdPrice,

          type:
            "increase"

        };

      });


    /*
       التأكد من أن مجموع العناصر
       يساوي المبلغ الذي أرسله الموقع.
    */

    const calculatedTotal =
      lineItems.reduce(
        (sum, item) =>
          sum + Number(item.amount || 0),
        0
      );


    if (
      calculatedTotal !== amountIQD
    ) {

      console.error(
        "Total mismatch",
        {
          calculatedTotal,
          amountIQD,
          items
        }
      );

      return res.status(400).json({
        error:
          "يوجد اختلاف بين مجموع الكتب وإجمالي الطلب."
      });

    }


    /*
       عنوان المتجر بعد النشر على Vercel
    */

    const siteUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://project-akmpg.vercel.app";


    /*
       إنشاء رابط الدفع من Wayl

       نستخدم test حاليًا للاختبار.
       بعد نجاح الاختبار يمكن تغييره إلى live.
    */

    const WAYL_ENV =
      process.env.WAYL_ENV || "test";


    const response =
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
            JSON.stringify({

              env:
                WAYL_ENV,

              referenceId:
                referenceId,

              total:
                amountIQD,

              currency:
                "IQD",

              customParameter:
                "adam-al-noor-books",

              lineItem:
                lineItems,

              redirectionUrl:
                `${siteUrl}/?payment=return&referenceId=${encodeURIComponent(referenceId)}`

            })

        }
      );


    const data =
      await response.json();


    console.log(
      "Wayl response:",
      JSON.stringify(data)
    );


    /*
       إذا رفض Wayl الطلب
    */

    if (!response.ok) {

      return res.status(response.status).json({

        error:
          data?.message ||
          data?.error ||
          "فشل إنشاء رابط الدفع من Wayl",

        details:
          data

      });

    }


    /*
       استخراج رابط الدفع
    */

    const paymentUrl =
      data?.data?.url;


    if (!paymentUrl) {

      return res.status(502).json({

        error:
          "Wayl لم يعُد برابط دفع صالح.",

        details:
          data

      });

    }


    /*
       إرسال الرابط للموقع
    */

    return res.status(200).json({

      success:
        true,

      referenceId:
        referenceId,

      totalUSD:
        Number(totalUSD || 0),

      totalIQD:
        amountIQD,

      paymentUrl:
        paymentUrl,

      status:
        data?.data?.status || null

    });


  } catch (error) {

    console.error(
      "Payment server error:",
      error
    );


    return res.status(500).json({

      error:
        "حدث خطأ في خادم الدفع."

    });

  }

}
