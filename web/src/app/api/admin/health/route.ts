import { NextResponse } from "next/server";
import { getSaaSContainer } from "../../../../../../lib/saas/saas-container.mjs";
import { ServiceLifecycle } from "../../../../../../lib/saas/lifecycle/service-lifecycle.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const container = getSaaSContainer();
    const lifecycle = new ServiceLifecycle({ container });

    const liveness = lifecycle.getLiveness();
    const readiness = await lifecycle.getReadiness();
    const queueMetrics = await container.jobQueue.getQueueMetrics();
    const telemetry = container.metricsTracker.getSnapshot(queueMetrics);
    const workerHealth = container.heartbeatMonitor.getWorkerHealth();
    const alerts = container.alertManager.evaluate(telemetry, workerHealth);

    return NextResponse.json({
      status: readiness.ready ? "HEALTHY" : "DEGRADED",
      timestamp: new Date().toISOString(),
      liveness,
      readiness,
      telemetry,
      workerHealth,
      alerts,
      queue: queueMetrics,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "ERROR",
        error: err.message || "Failed to aggregate system health",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
