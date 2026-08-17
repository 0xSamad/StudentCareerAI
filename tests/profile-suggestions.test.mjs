import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProfileSuggestions, applyProfileSuggestions } from "../lib/saas/knowledge/profile-suggestions.mjs";

describe("profile suggestions from evidence", () => {
  it("proposes new skills, education, and experience from pasted LinkedIn text", () => {
    const text = `ABDUL SAMAD
Peshawar, Pakistan

About
BS Software Engineering student seeking a cybersecurity internship.

Experience
Bug Bounty Researcher — HackerOne	2024 – Present
Self-Directed / Remote
• Practicing web application security

Education
Bachelor of Science in Software Engineering	2024 – Present
Institute of Management Sciences (IMS), Peshawar

Skills
Python, Burp Suite, Nmap
`;

    const suggestions = buildProfileSuggestions({
      text,
      source: "linkedin",
      existingProfile: {
        skills: { programming_languages: ["Python"], tools: [], frameworks: [], ai_ml: [], databases: [], cloud: [] },
        education: [],
        experience: { internships: [] },
        projects: [],
      },
    });

    assert.equal(suggestions.empty, false);
    assert.ok(!suggestions.skills.some((s) => s.value === "Python"));
    assert.ok(suggestions.skills.some((s) => /Burp Suite/i.test(s.value)));
    assert.equal(suggestions.education[0].university, "Institute of Management Sciences (IMS), Peshawar");
    assert.match(suggestions.experience[0].company, /HackerOne/i);
  });

  it("maps verified GitHub language facts to skills and skips ones already on the profile", () => {
    const suggestions = buildProfileSuggestions({
      source: "github",
      existingProfile: {
        skills: { programming_languages: ["Python"], tools: [], frameworks: [], ai_ml: [], databases: [], cloud: [] },
        education: [],
        experience: { internships: [] },
        projects: [],
      },
      facts: [
        { factType: "skill", value: "Python", verificationStatus: "VERIFIED" },
        { factType: "technology", value: "JavaScript", verificationStatus: "VERIFIED" },
        { factType: "project", value: "port-scanner", evidence: "GitHub repository: port-scanner", verificationStatus: "VERIFIED" },
        { factType: "skill", value: "MadeUpLib", verificationStatus: "UNCERTAIN" },
      ],
    });

    assert.ok(!suggestions.skills.some((s) => s.value === "Python"));
    assert.ok(suggestions.skills.some((s) => s.value === "JavaScript" && s.selected === true));
    assert.ok(suggestions.skills.some((s) => s.value === "MadeUpLib" && s.selected === false));
    assert.ok(suggestions.projects.some((p) => p.name === "port-scanner"));
  });

  it("applyProfileSuggestions unions accepted rows without wiping existing skills", () => {
    const next = applyProfileSuggestions(
      {
        skills: { programming_languages: ["Python"], tools: ["Git"], frameworks: [], ai_ml: [], databases: [], cloud: [] },
        education: [{ university: "IMS", degree: "BS Software Engineering" }],
        experience: { internships: [] },
        projects: [],
      },
      {
        skills: [
          { value: "JavaScript", category: "programming_languages" },
          { value: "Nmap", category: "tools", selected: false },
        ],
        education: [{ university: "Government College Faqeerabad, Peshawar", degree: "Intermediate in Computer Science (HSSC)" }],
        experience: [{ company: "HackerOne", role: "Bug Bounty Researcher" }],
        projects: [{ name: "port-scanner", description: "Nmap wrapper" }],
      }
    );

    assert.deepEqual(next.skills.programming_languages, ["Python", "JavaScript"]);
    assert.deepEqual(next.skills.tools, ["Git"]);
    assert.equal(next.education.length, 2);
    assert.equal(next.experience.internships[0].company, "HackerOne");
    assert.equal(next.projects[0].name, "port-scanner");
  });
});
