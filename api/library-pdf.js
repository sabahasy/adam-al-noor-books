export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const token =
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const filePath =
      String(body?.filePath || "").trim();

    if (!filePath) {
      return res.status(400).json({
        error: "filePath is required"
      });
    }

    const cleanPath =
      filePath
        .replace(/^\/+/, "")
        .replace(/^books\//i, "");

    const response =
      await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/sign/books/${encodeURIComponent(cleanPath)}`,
        {
          method: "POST",

          headers: {
            "apikey":
              process.env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            expiresIn: 3600
          })
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Could not create signed URL",
        details: text
      });
    }

    const data =
      JSON.parse(text);

    const signedURL =
      data?.signedURL ||
      data?.signedUrl ||
      data?.signed_url;

    if (!signedURL) {
      return res.status(500).json({
        error: "No signed URL returned"
      });
    }

    const finalUrl =
      signedURL.startsWith("http")
        ? signedURL
        : `${process.env.SUPABASE_URL}/storage/v1${signedURL}`;

    return res.status(200).json({
      url: finalUrl
    });

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
