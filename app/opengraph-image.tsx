import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "KI Video Studio – Videos, Songs und Bilder mit KI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #07070b 0%, #17102f 52%, #09243b 100%)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          padding: "72px",
          textAlign: "center",
          width: "100%",
        }}
      >
        <div style={{ color: "#c4b5fd", display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: 5, textTransform: "uppercase" }}>
          KI Video Studio
        </div>
        <div style={{ display: "flex", fontSize: 68, fontWeight: 750, lineHeight: 1.08, marginTop: 30, maxWidth: 1000 }}>
          Videos, Songs und Bilder mit KI erstellen
        </div>
        <div style={{ color: "#b4b4bd", display: "flex", fontSize: 28, marginTop: 32 }}>
          Deine Idee. Dein individuelles Ergebnis.
        </div>
      </div>
    ),
    size,
  );
}
