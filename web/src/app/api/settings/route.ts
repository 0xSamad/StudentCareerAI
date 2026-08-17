import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { studentCareerRoot } from "@/lib/student-career-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const root = studentCareerRoot();
  const statePath = path.join(root, "data", "autonomous-state.json");
  const studentProfilePath = path.join(root, "config", "student-profile.yml");
  const studentProfileExamplePath = path.join(root, "config", "student-profile.example.yml");
  const profilePath = path.join(root, "config", "profile.yml");

  // Read autonomous config
  let autoConfig: Record<string, any> = {
    AUTONOMOUS_MODE: false,
    AUTO_SUBMIT: false,
    MAX_APPLICATIONS_PER_DAY: 10,
    MIN_MATCH_SCORE: 70,
    SCAN_INTERVAL_MINUTES: 30,
    AUTO_SCAN_ENABLED: false,
    REQUIRE_ELIGIBILITY: true,
    REQUIRE_CONFIDENT_ANSWERS: true,
    PAUSE_ON_ERROR: true,
    PAUSE_ON_CAPTCHA: true,
    PAUSE_ON_AUTH_FAILURE: true,
    PAUSE_ON_UNEXPECTED_FORM: true,
    PAUSE_ON_SENSITIVE_QUESTION: true,
  };

  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      if (state.config) autoConfig = { ...autoConfig, ...state.config };
    }
  } catch (err) {
    console.error("Error reading autonomous-state:", err);
  }

  // Read student profile preferences
  let locations = ["Lahore, Pakistan", "Karachi, Pakistan", "Remote", "Global"];
  let remotePref = "Hybrid / Remote Preferred";
  let targetRoles = ["Software Engineer Intern", "AI/ML Intern", "Backend Engineer Intern", "Data Analyst Intern"];
  let searchMode = "internships";

  try {
    const pPath = fs.existsSync(studentProfilePath) ? studentProfilePath : fs.existsSync(studentProfileExamplePath) ? studentProfileExamplePath : profilePath;
    if (fs.existsSync(pPath)) {
      const parsed: any = yaml.load(fs.readFileSync(pPath, "utf-8"));
      if (parsed?.preferences?.target_roles) targetRoles = parsed.preferences.target_roles;
      if (parsed?.preferences?.locations?.preferred) locations = parsed.preferences.locations.preferred;
      if (parsed?.preferences?.locations?.remote) remotePref = "Remote Allowed / Preferred";
      if (parsed?.preferences?.search_mode) searchMode = parsed.preferences.search_mode;
    }
  } catch (err) {
    console.error("Error reading profile yaml:", err);
  }

  return NextResponse.json({
    autonomousMode: autoConfig.AUTONOMOUS_MODE ?? false,
    autoSubmit: autoConfig.AUTO_SUBMIT ?? false,
    applicationsPerDay: autoConfig.MAX_APPLICATIONS_PER_DAY ?? 10,
    minScore: autoConfig.MIN_MATCH_SCORE ?? 70,
    scanIntervalMinutes: autoConfig.SCAN_INTERVAL_MINUTES ?? 30,
    autoScanEnabled: autoConfig.AUTO_SCAN_ENABLED === true,
    locations,
    remote: remotePref,
    targetRoles,
    searchMode,
    safety: {
      requireEligibility: autoConfig.REQUIRE_ELIGIBILITY ?? true,
      requireConfidentAnswers: autoConfig.REQUIRE_CONFIDENT_ANSWERS ?? true,
      pauseOnError: autoConfig.PAUSE_ON_ERROR ?? true,
      pauseOnCaptcha: autoConfig.PAUSE_ON_CAPTCHA ?? true,
      pauseOnAuthFailure: autoConfig.PAUSE_ON_AUTH_FAILURE ?? true,
      pauseOnUnexpectedForm: autoConfig.PAUSE_ON_UNEXPECTED_FORM ?? true,
      pauseOnSensitiveQuestion: autoConfig.PAUSE_ON_SENSITIVE_QUESTION ?? true,
    },
  });
}

export async function POST(req: Request) {
  const root = studentCareerRoot();
  const statePath = path.join(root, "data", "autonomous-state.json");
  const studentProfilePath = path.join(root, "config", "student-profile.yml");

  try {
    const body = await req.json();

    // 1. Update autonomous state
    let stateData: any = { state: "STOPPED", config: {} };
    if (fs.existsSync(statePath)) {
      try {
        stateData = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch {
        stateData = { state: "STOPPED", config: {} };
      }
    }

    if (body.autonomousMode !== undefined) stateData.config.AUTONOMOUS_MODE = Boolean(body.autonomousMode);
    if (body.autoSubmit !== undefined) stateData.config.AUTO_SUBMIT = Boolean(body.autoSubmit);
    if (body.applicationsPerDay !== undefined) stateData.config.MAX_APPLICATIONS_PER_DAY = Number(body.applicationsPerDay);
    if (body.minScore !== undefined) stateData.config.MIN_MATCH_SCORE = Number(body.minScore);
    if (body.scanIntervalMinutes !== undefined) stateData.config.SCAN_INTERVAL_MINUTES = Number(body.scanIntervalMinutes);
    if (body.autoScanEnabled !== undefined) stateData.config.AUTO_SCAN_ENABLED = Boolean(body.autoScanEnabled);

    if (body.safety) {
      if (body.safety.requireEligibility !== undefined) stateData.config.REQUIRE_ELIGIBILITY = Boolean(body.safety.requireEligibility);
      if (body.safety.requireConfidentAnswers !== undefined) stateData.config.REQUIRE_CONFIDENT_ANSWERS = Boolean(body.safety.requireConfidentAnswers);
      if (body.safety.pauseOnError !== undefined) stateData.config.PAUSE_ON_ERROR = Boolean(body.safety.pauseOnError);
      if (body.safety.pauseOnCaptcha !== undefined) stateData.config.PAUSE_ON_CAPTCHA = Boolean(body.safety.pauseOnCaptcha);
      if (body.safety.pauseOnAuthFailure !== undefined) stateData.config.PAUSE_ON_AUTH_FAILURE = Boolean(body.safety.pauseOnAuthFailure);
      if (body.safety.pauseOnUnexpectedForm !== undefined) stateData.config.PAUSE_ON_UNEXPECTED_FORM = Boolean(body.safety.pauseOnUnexpectedForm);
      if (body.safety.pauseOnSensitiveQuestion !== undefined) stateData.config.PAUSE_ON_SENSITIVE_QUESTION = Boolean(body.safety.pauseOnSensitiveQuestion);
    }

    fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2), "utf-8");

    // 2. If targetRoles, locations or searchMode are sent, update student-profile.yml
    if (body.targetRoles || body.locations || body.searchMode) {
      let profileData: any = {};
      if (fs.existsSync(studentProfilePath)) {
        try {
          profileData = yaml.load(fs.readFileSync(studentProfilePath, "utf-8")) || {};
        } catch {
          profileData = {};
        }
      }
      if (!profileData.preferences) profileData.preferences = {};
      if (body.targetRoles) profileData.preferences.target_roles = body.targetRoles;
      if (body.locations) {
        if (!profileData.preferences.locations) profileData.preferences.locations = {};
        profileData.preferences.locations.preferred = body.locations;
      }
      if (body.searchMode) profileData.preferences.search_mode = body.searchMode;

      fs.writeFileSync(studentProfilePath, yaml.dump(profileData, { lineWidth: 100 }), "utf-8");
    }

    return NextResponse.json({ ok: true, message: "Settings saved successfully" });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
