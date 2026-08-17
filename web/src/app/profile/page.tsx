"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  Award,
  UserCheck,
  GraduationCap,
  Briefcase,
  Code2,
  FolderGit2,
  ShieldCheck,
  Save,
  CheckCircle2,
  FileText,
  Upload,
  Download,
  Plus,
  Trash2,
  Sparkles,
  Bot,
  RefreshCw,
  ExternalLink,
  Layers,
  ArrowRight,
  Eye,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CandidateKnowledgePanel } from "@/components/profile/candidate-knowledge-panel";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showRawCv, setShowRawCv] = useState(false);
  const [cvDragging, setCvDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // New item inputs
  const [newSkill, setNewSkill] = useState("");
  const [skillCategory, setSkillCategory] = useState<"programming_languages" | "frameworks" | "ai_ml" | "databases" | "tools">("programming_languages");
  const [newRole, setNewRole] = useState("");
  const [newCourse, setNewCourse] = useState("");

  const [cvText, setCvText] = useState("");
  const [cvOriginal, setCvOriginal] = useState<{ filename?: string } | null>(null);
  const [profile, setProfile] = useState<any>({
    identity: {
      name: "",
      email: "",
      phone: "",
      city: "",
      country: "",
      linkedin: "",
      github: "",
      portfolio: "",
    },
    education: [],
    skills: {
      programming_languages: [],
      frameworks: [],
      ai_ml: [],
      databases: [],
      cloud: [],
      tools: [],
    },
    experience: { internships: [], jobs: [] },
    projects: [],
    certifications: [],
    achievements: [],
    languages: [],
    preferences: {
      search_mode: "internships",
      target_roles: [],
      locations: { preferred: [] },
      work_authorization: "",
      needs_sponsorship: false,
    },
    matching: {
      ai_provider: "openai",
      model: "gpt-5.6-luna",
      temperature: 0.2,
    },
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setProfile(data.profile);
        if (data.cvText) setCvText(data.cvText);
        setCvOriginal(data.cvOriginal || data.profile?.cvOriginal || null);
        if (data.warning) setStatusMessage(data.warning);
      } else if (res.status === 401) {
        setStatusMessage("Session expired — please log in again to load your saved profile.");
      }
    } catch (err) {
      console.error("Failed to load profile data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, cvText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof data.cvText === "string" && data.cvText) setCvText(data.cvText);
        setSaved(true);
        setStatusMessage(data.warning ? `✅ ${data.message} ${data.warning}` : `✅ ${data.message || "Profile & Master CV successfully saved!"}`);
        setTimeout(() => {
          setSaved(false);
          setStatusMessage(null);
        }, 3500);
      } else if (res.status === 401) {
        setStatusMessage("Session expired — please log in again, then retry saving.");
      } else {
        alert(data.error || "Failed to save profile.");
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      alert("Error saving profile.");
    } finally {
      setSaving(false);
    }
  };

  const uploadCvFile = async (file?: File | null) => {
    if (!file) return;

    setParsing(true);
    setStatusMessage("Parsing CV and extracting profile facts…");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/profile/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        if (data.profile) setProfile(data.profile);
        if (data.cvText) setCvText(data.cvText);
        setCvOriginal(data.profile?.cvOriginal || data.cvOriginal || { filename: file.name });
        setSaved(true);
        setStatusMessage(data.message || "CV imported.");
        setTimeout(() => {
          setSaved(false);
          setStatusMessage(null);
        }, 5000);
      } else {
        setStatusMessage(data.error || "Failed to process CV upload");
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      setStatusMessage("Failed to parse CV: " + (err.message || "unknown error"));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadCvFile(file);
  };

  const handleParseFromText = async () => {
    if (!cvText.trim()) {
      alert("Please paste some CV text in the editor first.");
      return;
    }

    setParsing(true);
    setStatusMessage("🤖 Analyzing Master CV text with AI...");

    try {
      const res = await fetch("/api/profile/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvText }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        if (data.profile) setProfile(data.profile);
        setSaved(true);
        setStatusMessage(`🎉 ${data.message}`);
        setTimeout(() => {
          setSaved(false);
          setStatusMessage(null);
        }, 5000);
      } else {
        alert(data.error || "Failed to parse CV");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleDownloadCv = () => {
    const element = document.createElement("a");
    const file = new Blob([cvText], { type: "text/markdown" });
    element.href = URL.createObjectURL(file);
    element.download = "cv.md";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const addSkill = () => {
    if (!newSkill.trim()) return;
    const cat = skillCategory;
    const current = profile.skills?.[cat] || [];
    if (!current.includes(newSkill.trim())) {
      setProfile({
        ...profile,
        skills: {
          ...profile.skills,
          [cat]: [...current, newSkill.trim()],
        },
      });
    }
    setNewSkill("");
  };

  const removeSkill = (cat: string, skill: string) => {
    setProfile({
      ...profile,
      skills: {
        ...profile.skills,
        [cat]: (profile.skills?.[cat] || []).filter((s: string) => s !== skill),
      },
    });
  };

  const addTargetRole = () => {
    if (!newRole.trim()) return;
    const current = profile.preferences?.target_roles || [];
    if (!current.includes(newRole.trim())) {
      setProfile({
        ...profile,
        preferences: {
          ...profile.preferences,
          target_roles: [...current, newRole.trim()],
        },
      });
    }
    setNewRole("");
  };

  const removeTargetRole = (role: string) => {
    setProfile({
      ...profile,
      preferences: {
        ...profile.preferences,
        target_roles: (profile.preferences?.target_roles || []).filter((r: string) => r !== role),
      },
    });
  };

  const addCoursework = () => {
    if (!newCourse.trim()) return;
    const eduList = [...(profile.education || [])];
    if (eduList.length === 0) return;
    const current = eduList[0].coursework || [];
    if (!current.includes(newCourse.trim())) {
      eduList[0].coursework = [...current, newCourse.trim()];
      setProfile({ ...profile, education: eduList });
    }
    setNewCourse("");
  };

  const removeCoursework = (course: string) => {
    const eduList = [...(profile.education || [])];
    if (eduList.length === 0) return;
    eduList[0].coursework = (eduList[0].coursework || []).filter((c: string) => c !== course);
    setProfile({ ...profile, education: eduList });
  };

  const addProject = () => {
    const newProj = {
      name: "New Project",
      description: "Project description and key technical details.",
      technologies: ["Python", "FastAPI"],
      achievements: ["Key impact and measurable results"],
    };
    setProfile({
      ...profile,
      projects: [...(profile.projects || []), newProj],
    });
  };

  const deleteProject = (index: number) => {
    setProfile({
      ...profile,
      projects: (profile.projects || []).filter((_: any, i: number) => i !== index),
    });
  };

  const addInternship = () => {
    const newExp = {
      company: "Company Name",
      role: "Software Engineering Intern",
      start_date: "2025-06",
      end_date: "2025-08",
      description: "Internship responsibilities and projects.",
      achievements: ["Optimized system latency and throughput"],
    };
    const currentInternships = profile.experience?.internships || [];
    setProfile({
      ...profile,
      experience: {
        ...profile.experience,
        internships: [...currentInternships, newExp],
      },
    });
  };

  const deleteInternship = (index: number) => {
    const currentInternships = profile.experience?.internships || [];
    setProfile({
      ...profile,
      experience: {
        ...profile.experience,
        internships: currentInternships.filter((_: any, i: number) => i !== index),
      },
    });
  };

  const totalSkillsCount = Object.values(profile.skills || {}).reduce(
    (acc: number, list: any) => acc + (Array.isArray(list) ? list.length : 0),
    0
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full mb-4"></div>
          <p className="text-muted">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8 max-sm:pb-24">
      {/* Sticky Header with Master Save */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-soft text-brand px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider">
              Student Master Record
            </span>
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
              Ground Truth & Zero-Fabrication
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-display text-foreground mt-2 tracking-tight flex items-center gap-2.5">
            <UserCheck className="size-7 text-brand" />
            Candidate Profile & Master CV
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            Upload your CV once and keep your profile accurate, reviewable, and ready for matching. You can edit any section before using it in applications.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRawCv(!showRawCv)}
            className="px-3.5 py-2.5 bg-surface hover:bg-surface-hover text-foreground text-xs font-semibold rounded-xl border border-border transition-colors flex items-center gap-1.5"
          >
            <Eye className="size-4 text-brand" />
            {showRawCv ? "Hide Raw CV (cv.md)" : "View Raw CV (cv.md)"}
          </button>

          <button
            onClick={handleSave}
            disabled={saving || parsing}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs md:text-sm font-semibold shadow-sm transition-all",
              saved
                ? "bg-brand text-brand-foreground"
                : "bg-brand hover:bg-brand-200 text-brand-foreground active:scale-95"
            )}
          >
            {saved ? (
              <>
                <CheckCircle2 className="size-4" /> Changes Saved!
              </>
            ) : saving ? (
              <>
                <RefreshCw className="size-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="size-4" /> Save Profile & CV
              </>
            )}
          </button>
        </div>
      </div>

      {/* Real-time Status Toast Banner */}
      {statusMessage && (
        <div className="p-4 bg-brand-soft border border-brand/20 rounded-2xl flex items-center justify-between gap-3 text-foreground text-sm animate-fade-in">
          <div className="flex items-center gap-2.5">
            <Sparkles className="size-5 text-brand shrink-0" />
            <span>{statusMessage}</span>
          </div>
        </div>
      )}

      {/* HERO SECTION: 1-CLICK CV UPLOAD DROPZONE */}
      <div
        className={cn(
          "rounded-3xl border-2 border-dashed bg-surface p-6 md:p-8 shadow-sm transition-all",
          cvDragging ? "border-brand bg-brand/5" : "border-border"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setCvDragging(true);
        }}
        onDragLeave={() => setCvDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setCvDragging(false);
          void uploadCvFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3.5 bg-brand-soft rounded-2xl text-brand shrink-0">
              <Upload className="size-8" />
            </div>
            <div>
              <h2 className="text-xl font-display text-foreground flex items-center gap-2">
                CV Import
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-surface-hover text-muted">
                  Assisted Setup
                </span>
              </h2>
              <p className="text-sm text-muted mt-1 max-w-xl leading-relaxed">
                Drop a CV here or use Upload. Accepts <code className="text-brand font-mono">.pdf</code>, <code className="text-brand font-mono">.docx</code>, <code className="text-brand font-mono">.md</code>, or <code className="text-brand font-mono">.txt</code>. The app extracts education, skills, and projects so you can review them.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-start md:justify-end">
            <input
              id="profile-cv-upload"
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf,.docx,.doc,.md,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              disabled={parsing}
              className="sr-only"
            />
            <label
              htmlFor="profile-cv-upload"
              className={cn(
                "flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-5 py-3 bg-brand hover:bg-brand-200 text-brand-foreground font-semibold text-xs md:text-sm rounded-xl shadow-sm transition-all cursor-pointer",
                parsing && "opacity-60 pointer-events-none"
              )}
            >
              {parsing ? (
                <>
                  <RefreshCw className="size-4 animate-spin" /> Analyzing CV...
                </>
              ) : (
                <>
                  <Upload className="size-4" /> Upload CV File
                </>
              )}
            </label>

            <button
              type="button"
              onClick={handleDownloadCv}
              className="inline-flex items-center gap-1.5 px-4 py-3 bg-surface hover:bg-surface-hover text-foreground text-xs md:text-sm font-semibold rounded-xl border border-border transition-colors"
            >
              <Download className="size-4" /> Download cv.md
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-border">
          <div className="p-3 bg-surface-hover rounded-xl border border-border">
            <p className="text-[10px] uppercase font-semibold text-faint">Master CV Status</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">
              {cvOriginal?.filename ? "Original uploaded" : cvText ? "ATS CV generated" : "No CV yet"}
            </p>
          </div>

          <div className="p-3 bg-surface-hover rounded-xl border border-border">
            <p className="text-[10px] uppercase font-semibold text-faint">Verified Skills</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{totalSkillsCount} skills saved</p>
          </div>

          <div className="p-3 bg-surface-hover rounded-xl border border-border">
            <p className="text-[10px] uppercase font-semibold text-faint">Projects Ready</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{(profile.projects || []).length} saved</p>
          </div>

          <div className="p-3 bg-surface-hover rounded-xl border border-border">
            <p className="text-[10px] uppercase font-semibold text-faint">Target Roles</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{(profile.preferences?.target_roles || []).length} tracked</p>
          </div>
        </div>
      </div>

      <CandidateKnowledgePanel onProfilePatched={loadData} />

      {/* OPTIONAL RAW CV MARKDOWN EDITOR (EXPANDABLE) */}
      {showRawCv && (
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                <FileText className="size-4 text-brand" />
                Raw Master CV Text (cv.md)
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Direct markdown representation. Editing here will update your master ground-truth document.
              </p>
            </div>

            <button
              onClick={handleParseFromText}
              disabled={parsing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-200 text-brand-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <Sparkles className="size-3.5" /> Re-Parse Profile from Text
            </button>
          </div>

          <textarea
            value={cvText}
            onChange={(e) => setCvText(e.target.value)}
            placeholder="# Your Name&#10;&#10;## Summary&#10;Computer Science student at LUMS...&#10;&#10;## Education&#10;...&#10;&#10;## Experience&#10;...&#10;&#10;## Projects&#10;...&#10;&#10;## Skills&#10;..."
            rows={14}
            className="w-full font-mono text-xs bg-surface-hover text-foreground border border-border rounded-xl p-3 focus:outline-none focus:border-brand resize-y leading-relaxed"
          />
        </div>
      )}

      {/* SECTION 1: IDENTITY & ACADEMIC CREDENTIALS */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Identity Card */}
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
            <UserCheck className="size-4 text-brand" />
            Profile Identity
          </h3>
          <p className="text-xs text-muted">
            This info is used for matching and for generating applications. Fill the basics first; everything else is optional.
          </p>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-muted block mb-1 font-medium">Full Name</label>
              <input
                type="text"
                value={profile.identity?.name || ""}
                autoComplete="name"
                placeholder="e.g. Ali Hassan"
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    identity: { ...profile.identity, name: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted block mb-1 font-medium">Email Address</label>
                <input
                  type="email"
                  value={profile.identity?.email || ""}
                  autoComplete="off"
                  placeholder="you@example.com"
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, email: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-muted block mb-1 font-medium">Phone</label>
                <input
                  type="text"
                  value={profile.identity?.phone || ""}
                  placeholder="+92 ..."
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, phone: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted block mb-1 font-medium">City</label>
                <input
                  type="text"
                  value={profile.identity?.city || ""}
                  placeholder="e.g. Lahore"
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, city: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-muted block mb-1 font-medium">Country</label>
                <input
                  type="text"
                  value={profile.identity?.country || ""}
                  placeholder="e.g. Pakistan"
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, country: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted block mb-1 font-medium">LinkedIn URL</label>
                <input
                  type="text"
                  value={profile.identity?.linkedin || ""}
                  placeholder="https://linkedin.com/in/..."
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, linkedin: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-muted block mb-1 font-medium">GitHub URL</label>
                <input
                  type="text"
                  value={profile.identity?.github || ""}
                  placeholder="https://github.com/..."
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      identity: { ...profile.identity, github: e.target.value },
                    })
                  }
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Academic Card */}
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
            <GraduationCap className="size-4 text-brand" />
            University & Academic Credentials
          </h3>
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-muted block mb-1 font-medium">University / College</label>
              <input
                type="text"
                value={profile.education?.[0]?.university || ""}
                onChange={(e) => {
                  const eduList = [...(profile.education || [])];
                  if (!eduList[0]) eduList[0] = {};
                  eduList[0].university = e.target.value;
                  setProfile({ ...profile, education: eduList });
                }}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted block mb-1 font-medium">Degree Title</label>
                <input
                  type="text"
                  value={profile.education?.[0]?.degree || ""}
                  onChange={(e) => {
                    const eduList = [...(profile.education || [])];
                    if (!eduList[0]) eduList[0] = {};
                    eduList[0].degree = e.target.value;
                    setProfile({ ...profile, education: eduList });
                  }}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-muted block mb-1 font-medium">Major</label>
                <input
                  type="text"
                  value={profile.education?.[0]?.major || ""}
                  onChange={(e) => {
                    const eduList = [...(profile.education || [])];
                    if (!eduList[0]) eduList[0] = {};
                    eduList[0].major = e.target.value;
                    setProfile({ ...profile, education: eduList });
                  }}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted block mb-1 font-medium">Cumulative GPA</label>
                <input
                  type="number"
                  step="0.01"
                  value={Number.isFinite(Number(profile.education?.[0]?.gpa)) ? profile.education[0].gpa : ""}
                  onChange={(e) => {
                    const eduList = [...(profile.education || [])];
                    if (!eduList[0]) eduList[0] = {};
                    const next = e.target.value.trim();
                    eduList[0].gpa = next === "" ? null : Number(next);
                    if (eduList[0].gpa != null && !Number.isFinite(eduList[0].gpa)) eduList[0].gpa = null;
                    setProfile({ ...profile, education: eduList });
                  }}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-muted block mb-1 font-medium">Expected Graduation (YYYY-MM)</label>
                <input
                  type="text"
                  value={profile.education?.[0]?.graduation_date || ""}
                  placeholder="YYYY-MM if stated on the CV"
                  onChange={(e) => {
                    const eduList = [...(profile.education || [])];
                    if (!eduList[0]) eduList[0] = {};
                    eduList[0].graduation_date = e.target.value;
                    setProfile({ ...profile, education: eduList });
                  }}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            {/* Coursework Tags */}
            <div className="pt-2">
              <label className="text-muted block mb-1.5 font-medium">Relevant Coursework</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(profile.education?.[0]?.coursework || []).map((course: string, i: number) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-hover text-foreground text-[11px] border border-border"
                  >
                    {course}
                    <button
                      onClick={() => removeCoursework(course)}
                      className="text-faint hover:text-red-500 ml-1 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCoursework()}
                  placeholder="Add coursework (e.g. Distributed Systems)..."
                  className="flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                />
                <button
                  onClick={addCoursework}
                  className="px-3 py-1.5 bg-surface hover:bg-surface-hover text-foreground text-xs font-semibold rounded-xl border border-border"
                >
                  Add
                </button>
              </div>
            </div>

            {(profile.education || []).slice(1).length > 0 && (
              <div className="pt-3 space-y-2">
                <label className="text-muted block font-medium">Earlier education</label>
                {(profile.education || []).slice(1).map((row: any, idx: number) => (
                  <div key={`edu-extra-${idx}`} className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-xs text-foreground">
                    <p className="font-semibold">{row.degree || "Credential"}</p>
                    <p className="text-muted">{[row.university, row.period || row.graduation_date].filter(Boolean).join(" · ")}</p>
                  </div>
                ))}
              </div>
            )}

            {(profile.languages || []).length > 0 && (
              <div className="pt-3">
                <label className="text-muted block mb-1.5 font-medium">Languages</label>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.languages || []).map((lang: string, i: number) => (
                    <span key={i} className="px-2.5 py-1 rounded-lg bg-surface-hover text-foreground text-[11px] border border-border">
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: VERIFIED SKILLS BANK */}
      <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Code2 className="size-4 text-brand" />
              Verified Skills Repository ({totalSkillsCount} Skills Active)
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Only skills saved here will be highlighted in tailored resumes. Click the <code className="text-red-400">×</code> to remove, or add new ones below.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              value={skillCategory}
              onChange={(e) => setSkillCategory(e.target.value as any)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
            >
              <option value="programming_languages">Programming Languages</option>
              <option value="frameworks">Frameworks & Libraries</option>
              <option value="ai_ml">AI & Machine Learning</option>
              <option value="databases">Databases</option>
              <option value="tools">Cloud & Developer Tools</option>
            </select>

            <input
              type="text"
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSkill()}
              placeholder="Enter skill name (e.g. PyTorch)..."
              className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none min-w-[160px]"
            />

            <button
              onClick={addSkill}
              className="px-4 py-2 bg-brand hover:bg-brand-200 text-brand-foreground font-semibold text-xs rounded-xl transition-colors"
            >
              <Plus className="size-3.5 inline mr-1" /> Add Skill
            </button>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pt-2">
          {/* Programming Languages */}
          <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-faint flex items-center justify-between">
              <span>Programming Languages</span>
              <span className="text-[10px] font-mono text-faint">
                {(profile.skills?.programming_languages || []).length}
              </span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {(profile.skills?.programming_languages || []).map((lang: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface text-foreground text-xs border border-border"
                >
                  {lang}
                  <button onClick={() => removeSkill("programming_languages", lang)} className="text-faint hover:text-red-500 font-bold">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* AI & Machine Learning */}
          <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-brand flex items-center justify-between">
              <span>AI & Machine Learning</span>
              <span className="text-[10px] font-mono text-brand/80">
                {(profile.skills?.ai_ml || []).length}
              </span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {(profile.skills?.ai_ml || []).map((skill: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-brand-soft text-brand text-xs border border-brand/20"
                >
                  {skill}
                  <button onClick={() => removeSkill("ai_ml", skill)} className="text-brand hover:text-red-500 font-bold">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Frameworks */}
          <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center justify-between">
              <span>Frameworks & Backend</span>
              <span className="text-[10px] font-mono text-faint">
                {(profile.skills?.frameworks || []).length}
              </span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {(profile.skills?.frameworks || []).map((f: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface text-foreground text-xs border border-border"
                >
                  {f}
                  <button onClick={() => removeSkill("frameworks", f)} className="text-faint hover:text-red-500 font-bold">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Databases */}
          <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center justify-between">
              <span>Databases</span>
              <span className="text-[10px] font-mono text-faint">
                {(profile.skills?.databases || []).length}
              </span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {(profile.skills?.databases || []).map((db: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface text-foreground text-xs border border-border"
                >
                  {db}
                  <button onClick={() => removeSkill("databases", db)} className="text-faint hover:text-red-500 font-bold">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Tools & Cloud */}
          <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center justify-between">
              <span>Developer Tools & Cloud</span>
              <span className="text-[10px] font-mono text-faint">
                {[...(profile.skills?.tools || []), ...(profile.skills?.cloud || [])].length}
              </span>
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...(profile.skills?.tools || []), ...(profile.skills?.cloud || [])])].map((t: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface text-foreground text-xs border border-border"
                >
                  {t}
                  <button
                    onClick={() => {
                      if ((profile.skills?.tools || []).includes(t)) removeSkill("tools", t);
                      if ((profile.skills?.cloud || []).includes(t)) removeSkill("cloud", t);
                    }}
                    className="text-faint hover:text-red-500 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(profile.certifications?.length > 0 || profile.achievements?.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6 space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
              <Award className="size-4 text-brand" />
              Certifications ({(profile.certifications || []).length})
            </h3>
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {(profile.certifications || []).map((cert: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground">{typeof cert === "string" ? cert : cert.name}</p>
                  {typeof cert === "object" && (
                    <p className="text-muted">{[cert.issuer, cert.date].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
              ))}
              {(profile.certifications || []).length === 0 && (
                <p className="text-xs text-muted">No certifications extracted yet. Re-upload your CV to fill this list.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
              <Award className="size-4 text-brand" />
              Achievements ({(profile.achievements || []).length})
            </h3>
            <ul className="space-y-2 text-xs text-foreground list-disc pl-4">
              {(profile.achievements || []).map((item: string, idx: number) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* SECTION 3: PROJECTS & WORK HISTORY */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Projects Bank */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderGit2 className="size-4 text-emerald-400" />
              Projects Bank ({(profile.projects || []).length})
            </h3>
            <button
              onClick={addProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              <Plus className="size-3.5" /> Add Project
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {(profile.projects || []).map((proj: any, idx: number) => (
              <div key={idx} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={proj.name}
                    onChange={(e) => {
                      const projs = [...profile.projects];
                      projs[idx].name = e.target.value;
                      setProfile({ ...profile, projects: projs });
                    }}
                    placeholder="Project Name"
                    className="font-bold text-sm text-white bg-transparent border-b border-slate-700 pb-0.5 focus:border-emerald-500 focus:outline-none flex-1 mr-2"
                  />
                  <button
                    onClick={() => deleteProject(idx)}
                    className="text-slate-500 hover:text-red-400 text-xs p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <input
                  type="text"
                  value={proj.description}
                  onChange={(e) => {
                    const projs = [...profile.projects];
                    projs[idx].description = e.target.value;
                    setProfile({ ...profile, projects: projs });
                  }}
                  placeholder="Project summary and architecture..."
                  className="w-full text-xs text-slate-300 bg-transparent border border-slate-800 rounded-lg p-2 focus:border-emerald-500 focus:outline-none"
                />

                <div className="text-xs">
                  <input
                    type="text"
                    value={(proj.technologies || []).join(", ")}
                    onChange={(e) => {
                      const projs = [...profile.projects];
                      projs[idx].technologies = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setProfile({ ...profile, projects: projs });
                    }}
                    placeholder="Technologies (e.g. Python, PyTorch, FastAPI)"
                    className="w-full text-xs text-slate-400 bg-transparent border border-slate-800/80 rounded-lg p-1.5 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Experience Bank */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Briefcase className="size-4 text-emerald-400" />
              Prior Internships & Work History
            </h3>
            <button
              onClick={addInternship}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              <Plus className="size-3.5" /> Add Experience
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {(profile.experience?.internships || []).map((exp: any, idx: number) => (
              <div key={idx} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    <input
                      type="text"
                      value={exp.company}
                      onChange={(e) => {
                        const exps = [...profile.experience.internships];
                        exps[idx].company = e.target.value;
                        setProfile({ ...profile, experience: { ...profile.experience, internships: exps } });
                      }}
                      placeholder="Company Name"
                      className="font-bold text-sm text-white bg-transparent border-b border-slate-700 pb-0.5 focus:border-emerald-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={exp.role}
                      onChange={(e) => {
                        const exps = [...profile.experience.internships];
                        exps[idx].role = e.target.value;
                        setProfile({ ...profile, experience: { ...profile.experience, internships: exps } });
                      }}
                      placeholder="Role (e.g. Intern)"
                      className="text-sm text-slate-300 bg-transparent border-b border-slate-700 pb-0.5 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => deleteInternship(idx)}
                    className="text-slate-500 hover:text-red-400 text-xs p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <input
                  type="text"
                  value={exp.description}
                  onChange={(e) => {
                    const exps = [...profile.experience.internships];
                    exps[idx].description = e.target.value;
                    setProfile({ ...profile, experience: { ...profile.experience, internships: exps } });
                  }}
                  placeholder="Key responsibilities and achievements..."
                  className="w-full text-xs text-slate-300 bg-transparent border border-slate-800 rounded-lg p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 4: TARGETING & AI CONFIGURATION */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Targeting */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <ShieldCheck className="size-4 text-emerald-400" />
            Targeting & Search Preferences
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1.5 font-medium">Search Mode</label>
              <select
                value={profile.preferences?.search_mode || "internships"}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    preferences: { ...profile.preferences, search_mode: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="internships">Internships Only (Recommended for Students)</option>
                <option value="jobs">Full-Time Jobs Only</option>
                <option value="both">Both Internships & Jobs</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1.5 font-medium">Target Job Titles</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(profile.preferences?.target_roles || []).map((role: string, i: number) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20"
                  >
                    {role}
                    <button onClick={() => removeTargetRole(role)} className="text-emerald-500 hover:text-red-400 font-bold">
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTargetRole()}
                  placeholder="Add target role (e.g. AI Research Intern)..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  onClick={addTargetRole}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* AI Provider Config */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Bot className="size-4 text-emerald-400" />
            AI Provider & Zero-Fabrication Safety
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1.5 font-medium">AI Provider</label>
              <select
                value={profile.matching?.ai_provider || "openai"}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    matching: { ...profile.matching, ai_provider: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="openai">OpenAI (GPT-5.6 Luna)</option>
                <option value="gemini">Google Gemini (fallback)</option>
                <option value="ollama">Ollama (Local Offline LLM)</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1.5 font-medium">Model Identifier</label>
              <input
                type="text"
                value={profile.matching?.model || "gpt-5.6-luna"}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    matching: { ...profile.matching, model: e.target.value },
                  })
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs flex items-start gap-2.5">
              <ShieldCheck className="size-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Zero-Fabrication Guarantee Active:</strong> The AI will only tailor existing verified facts from your Master CV and Profile. Missing skills will never be invented.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
