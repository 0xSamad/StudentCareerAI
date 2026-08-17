"use client";

import React, { useEffect, useState } from "react";

export default function AdminHealthPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch health telemetry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full mb-4"></div>
          <p className="text-slate-400">Loading System Health Telemetry...</p>
        </div>
      </div>
    );
  }

  const isHealthy = data?.status === "HEALTHY";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">System Observability & Health</h1>
              <span
                className={`px-3 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${
                  isHealthy ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                }`}
              >
                {data?.status || "UNKNOWN"}
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">Real-time health telemetry, worker heartbeats, and error alerts</p>
          </div>
          <button
            onClick={fetchHealth}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition-colors border border-slate-700 flex items-center gap-2 self-start"
          >
            Refresh Telemetry
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            Telemetry Error: {error}
          </div>
        )}

        {/* Alerts Section */}
        {data?.alerts && data.alerts.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-400">Active System Alerts</h2>
            <div className="space-y-2">
              {data.alerts.map((a: any) => (
                <div
                  key={a.id}
                  className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                    a.severity === "CRITICAL"
                      ? "bg-red-500/10 border-red-500/30 text-red-200"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-200"
                  }`}
                >
                  <div>
                    <h3 className="font-semibold text-sm">{a.title}</h3>
                    <p className="text-xs opacity-90 mt-0.5">{a.message}</p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 uppercase">{a.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl">
            <p className="text-xs text-slate-400 uppercase font-medium">Uptime</p>
            <p className="text-2xl font-bold text-white mt-1">{data?.liveness?.uptimeSeconds || 0}s</p>
            <p className="text-xs text-slate-500 mt-1">PID {data?.liveness?.pid} • {data?.liveness?.memoryUsageMb} MB RSS</p>
          </div>

          <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl">
            <p className="text-xs text-slate-400 uppercase font-medium">Application Success Rate</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {data?.telemetry?.applications?.successRatePercent ?? 100}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {data?.telemetry?.applications?.succeeded || 0} succeeded / {data?.telemetry?.applications?.attempts || 0} attempts
            </p>
          </div>

          <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl">
            <p className="text-xs text-slate-400 uppercase font-medium">Active Workers & Queue</p>
            <p className="text-2xl font-bold text-white mt-1">
              {data?.workerHealth?.healthyCount || 0} active
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {data?.queue?.queued || 0} queued • {data?.queue?.processing || 0} processing • {data?.queue?.deadLetter || 0} DLQ
            </p>
          </div>

          <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl">
            <p className="text-xs text-slate-400 uppercase font-medium">API Latency (p95)</p>
            <p className="text-2xl font-bold text-sky-400 mt-1">
              {data?.telemetry?.apiLatency?.p95Ms || 0} ms
            </p>
            <p className="text-xs text-slate-500 mt-1">
              p50: {data?.telemetry?.apiLatency?.p50Ms || 0}ms • p99: {data?.telemetry?.apiLatency?.p99Ms || 0}ms
            </p>
          </div>
        </div>

        {/* Subsystem Health Status */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
          <h2 className="text-base font-semibold text-white">Subsystem Readiness Checks</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data?.readiness?.checks &&
              Object.entries(data.readiness.checks).map(([name, status]: [string, any]) => (
                <div key={name} className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg flex items-center justify-between">
                  <span className="capitalize text-sm text-slate-300">{name}</span>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      status === "HEALTHY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {status}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
