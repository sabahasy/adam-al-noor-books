export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const token =
      req.headers.authorization
        ?.replace("Bearer ", "")
        .trim();

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    let filePath =
      String(
        body?.filePath || ""
      ).trim();

    const mode =
      String(
        body?.mode || "view"
      ).trim();

    if (!filePath) {
      return res.status(400).json({
        error: "filePath is required"
      });
    }


    /*
     * إذا كان pdf_url رابط Supabase كامل
     * نستخرج منه مسار الملف فقط.
     */
    if (
      /^https?:\/\//i.test(filePath)
    ) {

      try {

        const url =
          new URL(filePath);

        const match =
          url.pathname.match(
            /\/storage\/v1\/object\/(?:sign|public)\/books\/(.+)$/i
          );

        if (match?.[1]) {

          filePath =
            decodeURIComponent(
              match[1]
            );

        }

      } catch (error) {

        console.error(
          "PDF URL PARSE ERROR:",
          error
        );

      }

    }


    /*
     * تنظيف مسار الملف
     */
    const cleanPath =
      filePath
        .replace(/^\/+/, "")
        .replace(/^books\//i, "")
        .split("?")[0];


    if (!cleanPath) {

      return res.status(400).json({
        error: "Invalid PDF path"
      });

    }


    /*
     * ترميز كل جزء من المسار
     */
    const encodedPath =
      cleanPath
        .split("/")
        .map(
          segment =>
            encodeURIComponent(
              segment
            )
        )
        .join("/");


    /*
     * إنشاء Signed URL جديد
     */
    const storageUrl =
      `${process.env.SUPABASE_URL}` +
      `/storage/v1/object/sign/books/${encodedPath}`;


    console.log(
      "LIBRARY PDF PATH:",
      cleanPath
    );


    const response =
      await fetch(
        storageUrl,
        {

          method: "POST",

          headers: {

            apikey:
              process.env
                .SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              `Bearer ${
                process.env
                  .SUPABASE_SERVICE_ROLE_KEY
              }`,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({
              expiresIn: 3600
            })

        }
      );


    const text =
      await response.text();


    if (!response.ok) {

      console.error(
        "SUPABASE SIGNED URL ERROR:",
        response.status,
        text
      );

      return res.status(
        response.status
      ).json({

        error:
          "Could not create signed URL",

        details:
          text

      });

    }


    let data;

    try {

      data =
        JSON.parse(text);

    } catch {

      return res.status(500).json({
        error:
          "Invalid response from Supabase"
      });

    }


    const signedURL =
      data?.signedURL ||
      data?.signedUrl ||
      data?.signed_url;


    if (!signedURL) {

      return res.status(500).json({
        error:
          "No signed URL returned"
      });

    }


    const finalUrl =
      signedURL.startsWith("http")
        ? signedURL
        : `${process.env.SUPABASE_URL}/storage/v1${signedURL}`;


    /*
     * ============================
     * فتح الكتاب
     * ============================
     */
    if (mode !== "download") {

      return res.status(200).json({
        url:
          finalUrl
      });

    }


    /*
     * ============================
     * تحميل الكتاب
     * ============================
     *
     * نضيف download إلى رابط Supabase
     * حتى يطلب من Storage تنزيل الملف.
     */
    const downloadUrl =
      new URL(finalUrl);

    const fileName =
      cleanPath
        .split("/")
        .pop() ||
        "book.pdf";


    downloadUrl.searchParams.set(
      "download",
      fileName
    );


    /*
     * نجلب الملف من Supabase
     */
    const pdfResponse =
      await fetch(
        downloadUrl.toString()
      );


    if (!pdfResponse.ok) {

      const errorText =
        await pdfResponse.text();

      console.error(
        "PDF DOWNLOAD ERROR:",
        pdfResponse.status,
        errorText
      );

      return res.status(
        pdfResponse.status
      ).json({

        error:
          "تعذر تحميل الكتاب"

      });

    }


    const pdfBuffer =
      Buffer.from(
        await pdfResponse.arrayBuffer()
      );


    if (!pdfBuffer.length) {

      return res.status(500).json({
        error:
          "ملف الكتاب فارغ"
      });

    }


    /*
     * اسم الملف
     */
    const safeFileName =
      fileName
        .replace(/["\r\n]/g, "")
        .trim() ||
        "book.pdf";


    /*
     * إرسال PDF للمتصفح كتحميل
     */
    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFileName}"`
    );

    res.setHeader(
      "Content-Length",
      pdfBuffer.length
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );


    return res
      .status(200)
      .send(pdfBuffer);


  } catch (error) {

    console.error(
      "LIBRARY PDF API ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "Internal server error"

    });

  }

}
