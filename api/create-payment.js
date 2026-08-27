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
