import { ApplyLiveWindow } from "@/components/apply/apply-live-window";

export const dynamic = "force-dynamic";

export default async function ApplyLivePage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <ApplyLiveWindow batchId={batchId} />;
}
