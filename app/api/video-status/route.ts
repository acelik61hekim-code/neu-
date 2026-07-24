import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "../../../lib/store";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId fehlt" }, { status: 400 });
  }

  const job = jobStore.get(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    videoUrl: job.videoUrl,
    errorMessage: job.errorMessage,
  });
}
