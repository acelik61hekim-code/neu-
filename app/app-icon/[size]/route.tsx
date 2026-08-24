import { ImageResponse } from "next/og";

export const runtime = "edge";

const ALLOWED_SIZES = new Set([180, 192, 512]);

export async function GET(
  _request: Request,
  { params }: { params: { size: string } },
) {
  const requestedSize = Number(params.size);
  const size = ALLOWED_SIZES.has(requestedSize) ? requestedSize : 512;

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background:
            "linear-gradient(145deg, #9b5cff 0%, #6546ed 48%, #3d67ff 100%)",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.14)",
            border: `${Math.max(2, Math.round(size * 0.012))}px solid rgba(255,255,255,0.28)`,
            borderRadius: "27%",
            display: "flex",
            height: "62%",
            width: "62%",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 18px 50px rgba(17, 8, 46, 0.32)",
          }}
        >
          <div
            style={{
              alignItems: "center",
              border: `${Math.max(3, Math.round(size * 0.026))}px solid white`,
              borderRadius: "14%",
              display: "flex",
              height: "42%",
              justifyContent: "center",
              width: "56%",
            }}
          >
            <div
              style={{
                color: "white",
                display: "flex",
                fontFamily: "Arial, sans-serif",
                fontSize: `${Math.round(size * 0.16)}px`,
                fontWeight: 800,
                letterSpacing: "-0.06em",
              }}
            >
              KI
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
