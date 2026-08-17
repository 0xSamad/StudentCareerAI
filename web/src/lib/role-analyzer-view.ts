export type MarketScope = "ALL" | "PAKISTAN" | "INTERNATIONAL";

export type SkillRow = {
  skill: string;
  category?: string;
  percent?: number;
  count?: number;
  total?: number;
  frequencyPercent?: number;
  postingCount?: number;
  postingTotal?: number;
  mandatoryCount?: number;
  status?: string;
  priority?: string;
  priorityLabel?: string;
  importance?: string;
  source?: string;
  reason?: string;
  marketPercent?: number;
  pakistanPercent?: number | null;
  internationalPercent?: number | null;
  pakistanCount?: number | null;
  pakistanTotal?: number | null;
  internationalCount?: number | null;
  internationalTotal?: number | null;
  evidence?: string | null;
  prerequisites?: string[];
  estimatedEffort?: { min?: number; max?: number; label?: string };
  kind?: string;
};

export type AnalyzedJob = {
  jobTitle: string;
  company: string;
  location: string;
  country?: string;
  market: string;
  url: string;
  source: string;
  dateDiscovered?: string | null;
};

export type ScoreBlock = {
  score?: number | null;
  percent?: number | null;
  have?: number;
  total?: number;
  postingCount?: number;
  explanation?: string;
  kind?: string;
};

export type IntelligenceReport = {
  recommendedPathway?: string;
  positionNarrative?: string;
  strengths?: Array<{
    skill: string;
    marketPercent?: number | null;
    marketCount?: number;
    marketTotal?: number;
    evidence?: string;
    evidenceLevel?: string;
    why?: string;
  }>;
  rankedGaps?: Array<{
    rank: number;
    skill: string;
    priority?: string;
    importance?: string;
    status?: string;
    demandPercent?: number | null;
    demandCount?: number;
    demandTotal?: number;
    evidence?: string;
    evidenceLevel?: string;
    why?: string;
    howToClose?: string;
    whatToLearn?: string[];
    impact?: number;
  }>;
  youVsMarket?: Array<{
    skill: string;
    marketPercent?: number | null;
    marketCount?: number;
    marketTotal?: number;
    youPercent?: number;
    youLabel?: string;
    status?: string;
  }>;
  pakistanInternational?: {
    ok: boolean;
    pakistanCount?: number;
    internationalCount?: number;
    message?: string | null;
    rows?: Array<{
      skill: string;
      pakistanPercent?: number | null;
      internationalPercent?: number | null;
    }>;
  };
  dimensions?: Array<{ id: string; label: string; percent: number; skills?: string[] }>;
  next7Days?: Array<{ day: number; title: string; work: string }>;
  interviewPrep?: {
    role?: string;
    domain?: string;
    note?: string;
    sections?: Array<{ id: string; title: string; items: string[] }>;
    fromGaps?: string[];
  };
  careerActionPlan?: string[];
  scores?: {
    skillReadiness?: ScoreBlock | null;
    marketMatch?: ScoreBlock | null;
    jobCompetitiveness?: ScoreBlock | null;
  };
};

export type AnalysisResult = {
  role: string;
  rawRole?: string;
  domain?: string;
  seniority?: string;
  employment_type?: string;
  search_type?: string;
  total_postings?: number;
  pakistan_postings?: number;
  international_postings?: number;
  unknown_postings?: number;
  last_updated?: string;
  sources?: string[];
  data_quality?: { warning?: boolean; message?: string; level?: string };
  readiness_score?: ScoreBlock;
  market_match_score?: ScoreBlock;
  job_competitiveness_score?: ScoreBlock;
  searchedTitles: string[];
  analyzedJobs: AnalyzedJob[];
  pakistan: { postingCount: number; skillDemand: SkillRow[] };
  international: { postingCount: number; skillDemand: SkillRow[] };
  skillDemand: SkillRow[];
  demandByCategory: Record<string, SkillRow[]>;
  skillGaps: SkillRow[];
  pakistanMatch?: { percent: number | null };
  internationalMatch?: { percent: number | null };
  profileMatch?: { namedSkills?: string[]; projectCount?: number };
  readinessScore: {
    score: number | null;
    explanation: string;
    components: Record<string, { percent?: number | null; note?: string }>;
  };
  metadata: {
    lastAnalyzedLabel?: string;
    researchedAt?: string;
    analyzedAt?: string;
    dataAge?: string | null;
    postingCount: number;
    pakistanCount: number;
    internationalCount: number;
    unknownCount: number;
    sources: string[];
    unavailableSources: Array<{ source?: string; reason?: string }>;
    sampleQuality: { warning: boolean; message: string; level?: string };
    servedFromCache?: boolean;
    marketScope?: string;
  };
  roadmap?: RoadmapPayload;
};

export type RoadmapWeek = {
  week: number;
  phase?: string;
  phaseName?: string;
  phaseGoal?: string;
  objective: string;
  skills: string[];
  learn?: string[];
  topics: string[];
  practice?: string[];
  practicalTasks: string[];
  build?: string | null;
  projectWork?: string | null;
  resources: Array<{ title: string; url?: string; why?: string }>;
  interview?: string[];
  interviewPreparation: string[];
  deliverable?: string[];
  deliverables: string[];
  estimatedHours: string;
  successCriteria?: string;
  milestone: string;
};

export type RoadmapProject = {
  id: string;
  title: string;
  problem: string;
  demonstrates?: string[];
  skillsDemonstrated?: string[];
  stack: string[];
  features: string[];
  difficulty: string;
  level?: number;
  levelLabel?: string;
  weeks?: number;
  estimatedDuration?: string;
  phases?: Array<{ name: string; work: string }>;
  portfolioValue: string;
  github: string[];
  interviewAngle: string;
};

export type CoachReport = {
  actionPlan?: string[];
  executiveSummary?: {
    readiness?: number | null;
    target?: string;
    market?: { postingCount?: number; pakistanCount?: number; internationalCount?: number; sampleQuality?: { message?: string; warning?: boolean } };
    diagnosis?: string;
    biggestProblem?: string;
    strongestAdvantage?: string;
    nextStep?: string;
    headline?: string;
  };
  currentPosition?: {
    alreadyHave?: string[];
    partial?: string[];
    missing?: string[];
    academic?: string[];
    summary?: string;
  };
  marketExpects?: {
    top?: Array<{ skill: string; importance?: string; demand?: number | null; pakistan?: number | null; international?: number | null; status?: string }>;
  };
  biggestGaps?: Array<{
    skill: string;
    priority?: string;
    importance?: string;
    status?: string;
    why?: string;
    whatToLearn?: string[];
    whatToBuild?: string;
    evidenceRequired?: string;
    marketPercent?: number | null;
  }>;
  strategy?: { steps?: string[]; why?: string };
  jobReady?: string[];
  applicationStrategy?: {
    now?: string[];
    afterPhase2?: string[];
    afterPhase3?: string[];
    why?: { goodFit?: string; stretch?: string; notYet?: string };
    note?: string;
  };
  nextAction?: { today?: string[]; thisWeek?: string[]; month1?: string[] };
  phases?: Array<{ id: string; name: string; goal: string; start: number; end: number }>;
  intelligence?: IntelligenceReport;
};

export type RoadmapPayload = {
  role: string;
  durationMonths: number;
  weekCount: number;
  weeklyHours: { min: number; max: number; label: string };
  skillGaps: SkillRow[];
  priorities?: {
    critical?: string[];
    high?: string[];
    medium?: string[];
    maintain?: string[];
    highestImpact?: string[];
  };
  projects: RoadmapProject[];
  roadmaps: {
    weeks: RoadmapWeek[];
    phases?: Array<{ id: string; name: string; goal: string; start: number; end: number }>;
    interviewStartsWeek?: number;
  };
  readiness: {
    current: number | null;
    explanation: string | null;
    constraint?: string | null;
    advantage?: string | null;
    breakdown?: Array<{ label: string; percent: number | null; note?: string }>;
    components?: Record<string, { percent?: number | null; note?: string; label?: string }>;
    projections: {
      kind: string;
      current: number | null;
      checkpoints: Array<{
        afterMonths: number;
        afterPhase?: string;
        score: number | null;
        label: string;
        because?: string[];
      }>;
      disclaimer: string;
    };
  };
  jobTargets: {
    now: string[];
    after2Months: string[];
    after4Months: string[];
    after6Months?: string[];
    afterRoadmap: string[];
    goodFit?: string[];
    stretch?: string[];
    notYet?: string[];
    why?: { goodFit?: string; stretch?: string; notYet?: string };
    note?: string;
  };
  resources: Array<{ title: string; url?: string; why?: string; week?: number }>;
  interviewPlan: {
    phases: Array<{ phase: string; when: string; focus: string }>;
    weekCount: number;
    sections?: Array<{ id?: string; title: string; items: string[] }>;
    note?: string;
    fromGaps?: string[];
  };
  dataQuality?: { warning?: boolean; message?: string };
  coach?: CoachReport;
  narrative?: { summary?: string | null };
};

export type SavedRun = {
  id: string;
  role: string;
  marketScope?: string;
  saved?: boolean;
  durationMonths?: number | null;
  readiness?: number | null;
  postingCount?: number | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

export function analysisStepsFor(searchType?: string | null) {
  const intern = searchType === 'internships' || searchType === 'Internship';
  const noun = intern ? 'internships' : 'jobs';
  return [
    { id: 'search', label: intern ? 'Searching internships' : 'Searching jobs' },
    { id: 'existing', label: intern ? 'Reading internships we already have' : 'Reading jobs we already have' },
    { id: 'research', label: intern ? 'Searching live internships' : 'Searching live jobs' },
    { id: 'extract', label: `Listing the skills those ${noun} ask for` },
    { id: 'compare', label: 'Comparing that with your profile' },
    { id: 'gaps', label: 'Finding what you still need' },
    { id: 'roadmap', label: 'Writing your week-by-week plan' },
  ] as const;
}

export const ANALYSIS_STEPS = analysisStepsFor('jobs');

export const ROLE_EXAMPLES = [
  "AI Intern",
  "Cybersecurity Intern",
  "Cybersecurity Specialist",
  "SOC Analyst",
  "Penetration Tester",
  "ML Engineer",
  "Data Scientist",
  "Software Engineer",
] as const;

export const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "programming", label: "Programming", cats: ["Programming Languages", "Frameworks"] },
  { id: "ml", label: "ML/AI", cats: ["Machine Learning", "Deep Learning", "AI", "NLP", "Computer Vision", "Libraries"] },
  { id: "data", label: "Data", cats: ["Data Science", "Data Engineering", "Databases", "Statistics", "Mathematics"] },
  { id: "security", label: "Security", cats: ["Security Fundamentals", "Networking", "Web Security", "Offensive Security", "Defensive Security", "Identity & Access", "Cloud Security", "Security Tools"] },
  { id: "cloud", label: "Cloud", cats: ["Cloud"] },
  { id: "devops", label: "DevOps", cats: ["DevOps", "MLOps"] },
  { id: "tools", label: "Tools", cats: ["Tools", "Version Control", "Operating Systems"] },
  { id: "other", label: "Other", cats: [] },
] as const;

const KNOWN_CATS = new Set<string>(CATEGORY_FILTERS.flatMap((f) => ("cats" in f ? [...f.cats] : [])));

export function demandPercent(row: SkillRow): number | null {
  const n = row.frequencyPercent ?? row.percent ?? row.marketPercent;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function demandCounts(row: SkillRow) {
  return {
    count: row.postingCount ?? row.count ?? 0,
    total: row.postingTotal ?? row.total ?? 0,
  };
}

export function matchesCategory(row: SkillRow, filterId: string) {
  if (filterId === "all") return true;
  const cat = row.category || "";
  const filter = CATEGORY_FILTERS.find((f) => f.id === filterId);
  if (!filter || filter.id === "all") return true;
  if (filter.id === "other") return Boolean(cat) && !KNOWN_CATS.has(cat);
  return filter.cats.includes(cat as never);
}

export function formatLongDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
      const parsed = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      }
    }
    return iso;
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function resourceType(resource: { title?: string; url?: string }) {
  const blob = `${resource.title || ""} ${resource.url || ""}`.toLowerCase();
  if (/docs\.|documentation|official/.test(blob)) return "Official documentation";
  if (/course|khan|learn\//.test(blob)) return "Course";
  if (/book/.test(blob)) return "Book";
  if (/leetcode|hackerrank|mode\.com\/sql|exercism/.test(blob)) return "Practice platform";
  return "Tutorial";
}

export function safeHttpUrl(url?: string | null) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    /* ignore */
  }
  return "";
}

export function resourceSource(resource: { url?: string; title?: string }) {
  try {
    if (resource.url) return new URL(resource.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  return "Recommended";
}

export function groupWeeksByMonth(weeks: RoadmapWeek[]) {
  const months: Array<{ month: number; weeks: RoadmapWeek[] }> = [];
  for (const week of weeks) {
    const month = Math.ceil(week.week / 4);
    const last = months[months.length - 1];
    if (!last || last.month !== month) months.push({ month, weeks: [week] });
    else last.weeks.push(week);
  }
  return months;
}

export function learnPathFor(gap: SkillRow) {
  if (gap.status === "ALREADY HAVE") {
    return "You already have this. Keep a recent example you can talk about in interviews.";
  }
  if (gap.status === "PARTIAL") {
    return "You have a start. Finish one small project that uses it, then write interview answers from that work.";
  }
  return "Learn the basics, build one project with it, then practice talking about that project.";
}

export function statusMark(status?: string) {
  if (status === "ALREADY HAVE") return { glyph: "✓", label: "Have", tone: "good" as const };
  if (status === "PARTIAL") return { glyph: "◐", label: "Partial", tone: "warn" as const };
  if (status === "MISSING") return { glyph: "✕", label: "Missing", tone: "bad" as const };
  return { glyph: "?", label: status || "Unknown", tone: "muted" as const };
}

export function analysisFromPayload(raw: Record<string, unknown> | null | undefined): AnalysisResult | null {
  if (!raw || typeof raw !== "object") return null;
  const nested = raw.analysis;
  if (nested && typeof nested === "object") {
    const analysis = nested as AnalysisResult;
    return { ...analysis, roadmap: (raw.roadmap as RoadmapPayload) || analysis.roadmap };
  }
  return raw as unknown as AnalysisResult;
}

export function broaderRoleHints(role: string, searchedTitles: string[] = []) {
  const extras = searchedTitles.filter((t) => t.toLowerCase() !== role.toLowerCase());
  return [...new Set(extras)].slice(0, 4);
}
