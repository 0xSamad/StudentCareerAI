#!/usr/bin/env node
// autonomous-runner.mjs — CLI Command Center for StudentCareer AI Autonomous Mode
// Provides CLI controls for background execution, state management, configuration, and audit logs.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  AutonomousPipeline,
  AGENT_STATES,
  DEFAULT_CONFIG,
  AutonomousPipelineError,
} from './lib/autonomous-pipeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;

function loadProfile() {
  const paths = [
    join(REPO_ROOT, 'config', 'student-profile.yml'),
    join(REPO_ROOT, 'config', 'profile.yml'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        return yaml.load(raw) || {};
      } catch {
        // continue
      }
    }
  }
  return {};
}

function loadCV() {
  const p = join(REPO_ROOT, 'cv.md');
  if (existsSync(p)) {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      return '';
    }
  }
  return '';
}

function formatStatus(status) {
  const stateColors = {
    [AGENT_STATES.RUNNING]: '\x1b[32m[RUNNING]\x1b[0m',
    [AGENT_STATES.PAUSED]:  '\x1b[33m[PAUSED]\x1b[0m',
    [AGENT_STATES.STOPPED]: '\x1b[90m[STOPPED]\x1b[0m',
    [AGENT_STATES.ERROR]:   '\x1b[31m[ERROR]\x1b[0m',
  };

  const stateStr = stateColors[status.state] || `[${status.state}]`;
  let out = `\n═══════════════════════════════════════════════════════════════\n`;
  out += `  StudentCareer AI Autonomous Agent Status: ${stateStr}\n`;
  out += `═══════════════════════════════════════════════════════════════\n\n`;

  if (status.pauseReason) {
    out += `  \x1b[33mPause Reason:\x1b[0m ${status.pauseReason}\n`;
  }
  if (status.currentJob) {
    out += `  \x1b[36mCurrent Job:\x1b[0m  ${status.currentJob}\n`;
  }
  if (status.lastRunAt) {
    out += `  \x1b[90mLast Active:\x1b[0m  ${status.lastRunAt}\n`;
  }

  out += `\n  \x1b[1mDaily Applications Quota:\x1b[0m\n`;
  out += `    Date:     ${status.dailyStats.date} (${status.dailyStats.timezone})\n`;
  out += `    Intern:   ${status.dailyStats.counts.internship || 0} / ${status.dailyStats.limits.internship} (remaining: ${status.dailyStats.remaining.internship})\n`;
  out += `    Fulltime: ${status.dailyStats.counts.job || 0} / ${status.dailyStats.limits.job} (remaining: ${status.dailyStats.remaining.job})\n`;

  if (status.queueCounts) {
    out += `\n  \x1b[1mApplication Queue:\x1b[0m\n`;
    out += `    Total:          ${status.queueCounts.total}\n`;
    out += `    Discovered:     ${status.queueCounts.discovered}\n`;
    out += `    Eligible:       ${status.queueCounts.eligible}\n`;
    out += `    Applied:        ${status.queueCounts.applied}\n`;
    out += `    Requires Input: ${status.queueCounts.requires_input}\n`;
    out += `    Failed:         ${status.queueCounts.failed}\n`;
  }

  out += `\n  \x1b[1mSafety & Operational Configuration:\x1b[0m\n`;
  for (const [k, v] of Object.entries(status.config)) {
    const valColor = v === true ? '\x1b[32mtrue\x1b[0m' : v === false ? '\x1b[31mfalse\x1b[0m' : `\x1b[36m${v}\x1b[0m`;
    out += `    ${k.padEnd(30)}: ${valColor}\n`;
  }

  out += `\n═══════════════════════════════════════════════════════════════\n`;
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const pipeline = new AutonomousPipeline({ repoRoot: REPO_ROOT });

  try {
    switch (command) {
      case 'status': {
        const jsonMode = args.includes('--json');
        const status = await pipeline.getStatus();
        if (jsonMode) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(formatStatus(status));
        }
        break;
      }

      case 'start': {
        if (args.includes('--force-enable') || args.includes('-f')) {
          pipeline.configure({ AUTONOMOUS_MODE: true });
        }
        try {
          const status = await pipeline.start();
          console.log(`\x1b[32m✓ Autonomous pipeline started in background.\x1b[0m`);
          console.log(formatStatus(status));

          if (args.includes('--loop') || args.includes('-l')) {
            console.log(`\x1b[36mRunning continuous loop (Ctrl+C to stop)...\x1b[0m`);
            const profile = loadProfile();
            const cvText = loadCV();

            let intervalSec = 15;
            const intIdx = args.findIndex(a => a === '--interval' || a === '-i');
            if (intIdx !== -1 && args[intIdx + 1]) {
              intervalSec = parseInt(args[intIdx + 1], 10) || 15;
            }

            process.on('SIGINT', async () => {
              console.log(`\n\x1b[33mInterrupted: Stopping pipeline...\x1b[0m`);
              await pipeline.stop();
              process.exit(0);
            });

            await pipeline.startContinuousLoop({
              intervalMs: intervalSec * 1000,
              profile,
              cvText,
            });
          }
        } catch (err) {
          if (err.code === 'MODE_DISABLED') {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
            console.log(`\nTo enable autonomous mode, run:\n  node autonomous-runner.mjs config AUTONOMOUS_MODE=true\nor:\n  node autonomous-runner.mjs start --force-enable\n`);
            process.exit(1);
          }
          throw err;
        }
        break;
      }

      case 'pause': {
        const reason = args.slice(1).join(' ') || 'User requested pause via CLI';
        const status = await pipeline.pause(reason);
        console.log(`\x1b[33m✓ Autonomous pipeline paused.\x1b[0m Reason: ${reason}`);
        console.log(formatStatus(status));
        break;
      }

      case 'resume': {
        if (args.includes('--force-enable') || args.includes('-f')) {
          pipeline.configure({ AUTONOMOUS_MODE: true });
        }
        try {
          const status = await pipeline.resume();
          console.log(`\x1b[32m✓ Autonomous pipeline resumed.\x1b[0m`);
          console.log(formatStatus(status));
        } catch (err) {
          if (err.code === 'MODE_DISABLED') {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
            process.exit(1);
          }
          throw err;
        }
        break;
      }

      case 'stop': {
        const status = await pipeline.stop();
        console.log(`\x1b[90m✓ Autonomous pipeline stopped.\x1b[0m`);
        console.log(formatStatus(status));
        break;
      }

      case 'restart': {
        const status = await pipeline.restart();
        console.log(`\x1b[32m✓ Autonomous pipeline restarted.\x1b[0m`);
        console.log(formatStatus(status));
        break;
      }

      case 'config': {
        const configArgs = args.slice(1);
        if (configArgs.length === 0) {
          console.log(JSON.stringify(pipeline.config, null, 2));
        } else {
          const updates = {};
          for (const arg of configArgs) {
            const [k, v] = arg.split('=');
            if (!k) continue;
            const key = k.trim().toUpperCase();
            if (!(key in DEFAULT_CONFIG)) {
              console.warn(`\x1b[33mWarning: Unknown config key "${key}"\x1b[0m`);
            }
            if (v === 'true') updates[key] = true;
            else if (v === 'false') updates[key] = false;
            else if (!isNaN(Number(v))) updates[key] = Number(v);
            else updates[key] = v;
          }
          pipeline.configure(updates);
          console.log(`\x1b[32m✓ Configuration updated:\x1b[0m`);
          console.log(JSON.stringify(pipeline.config, null, 2));
        }
        break;
      }

      case 'run-once': {
        const profile = loadProfile();
        const cvText = loadCV();
        console.log(`\x1b[36mExecuting single autonomous cycle...\x1b[0m`);
        if (!pipeline.config.AUTONOMOUS_MODE) {
          pipeline.configure({ AUTONOMOUS_MODE: true });
        }
        if (pipeline.state !== AGENT_STATES.RUNNING) {
          await pipeline.start();
        }
        const cycleRes = await pipeline.runCycle({ profile, cvText, maxItems: 5 });
        console.log(`\x1b[32m✓ Cycle complete.\x1b[0m Processed ${cycleRes.itemsProcessed} items.`);
        console.log(JSON.stringify(cycleRes, null, 2));
        break;
      }

      case 'logs': {
        let limit = 20;
        const limIdx = args.findIndex(a => a === '--limit' || a === '-n');
        if (limIdx !== -1 && args[limIdx + 1]) {
          limit = parseInt(args[limIdx + 1], 10) || 20;
        }
        const logs = await pipeline.auditLog.getLogs(limit);
        console.log(`\n═══════════════════════════════════════════════════════════════`);
        console.log(`  Autonomous Audit Logs (Last ${logs.length} events)`);
        console.log(`═══════════════════════════════════════════════════════════════\n`);
        for (const l of logs) {
          const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '';
          const typeStr = `\x1b[1m${l.type}\x1b[0m`.padEnd(30);
          console.log(`  [${time}] ${typeStr} ${JSON.stringify(l)}`);
        }
        console.log(`\n═══════════════════════════════════════════════════════════════\n`);
        break;
      }

      case 'reset': {
        await pipeline.manager.resetDailyStats();
        console.log(`\x1b[32m✓ Daily application counts reset.\x1b[0m`);
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      default: {
        console.log(`
StudentCareer AI Autonomous Background Mode CLI

Usage:
  node autonomous-runner.mjs <command> [options]

Commands:
  status [--json]                 Show agent state, daily quota & configuration
  start [--force-enable] [--loop] Start autonomous background execution
  pause [reason]                  Pause running pipeline
  resume                          Resume paused pipeline
  stop                            Stop pipeline
  restart                         Recover from error / restart pipeline
  config [KEY=VALUE ...]          View or update configuration
  run-once                        Execute a single discovery and application cycle
  logs [--limit <n>]              View persistent audit log
  reset                           Reset daily application quota counters
  help                            Show this help message

Configuration Keys:
  AUTONOMOUS_MODE                 (true/false) Default: false
  AUTO_SUBMIT                     (true/false) Default: false
  MAX_APPLICATIONS_PER_DAY        (number)     Default: 10
  MIN_MATCH_SCORE                 (number)     Default: 70
  REQUIRE_ELIGIBILITY             (true/false) Default: true
  REQUIRE_CONFIDENT_ANSWERS       (true/false) Default: true
  PAUSE_ON_ERROR                  (true/false) Default: true
  PAUSE_ON_CAPTCHA                (true/false) Default: true
  PAUSE_ON_AUTH_FAILURE           (true/false) Default: true
  PAUSE_ON_UNEXPECTED_FORM        (true/false) Default: true
  PAUSE_ON_SENSITIVE_QUESTION     (true/false) Default: true
`);
        break;
      }
    }
  } catch (err) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
