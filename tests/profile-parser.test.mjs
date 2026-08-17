import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { heuristicExtract, normalizeParsedProfile } from "../lib/profile-parser.mjs";

describe("profile parser honesty", () => {
  it("heuristicExtract never fabricates university or GPA when absent", () => {
    const parsed = heuristicExtract(`# Jane Doe

jane@example.com
Built small projects in React and Node.js.`);

    assert.equal(parsed.identity.name, "Jane Doe");
    assert.equal(parsed.education.length, 0);
    assert.equal(parsed.projects.length, 0);
    assert.equal(parsed.experience.internships.length, 0);
    assert.ok(Array.isArray(parsed.warnings));
  });

  it("normalizeParsedProfile extracts university and CGPA from text", () => {
    const text = `# Ali Hassan
ali@example.com

## Education
Lahore University of Management Sciences (LUMS)
Bachelor of Science in Computer Science
CGPA: 3.67/4.00
Expected Graduation: 2026-06`;

    const parsed = normalizeParsedProfile({}, text);
    assert.equal(parsed.identity.name, "Ali Hassan");
    assert.equal(parsed.education[0].university, "Lahore University of Management Sciences (LUMS)");
    assert.equal(parsed.education[0].degree, "Bachelor of Science in Computer Science");
    assert.equal(parsed.education[0].gpa, 3.67);
    assert.equal(parsed.education[0].gpa_scale, 4);
    assert.equal(parsed.education[0].graduation_date, "2026-06");
  });

  it("normalizeParsedProfile preserves provider output but backfills missing fields honestly", () => {
    const parsed = normalizeParsedProfile(
      {
        identity: { name: "Sarah Khan", email: "sarah@example.com" },
        education: [{ degree: "BS Computer Science" }],
        skills: { programming_languages: ["Python", "Python"], ai_ml: ["PyTorch"] },
      },
      `# Sarah Khan
sarah@example.com
National University of Sciences and Technology
CGPA: 3.91/4.00`
    );

    assert.equal(parsed.identity.name, "Sarah Khan");
    assert.equal(parsed.education[0].university, "National University of Sciences and Technology");
    assert.equal(parsed.education[0].degree, "BS Computer Science");
    assert.equal(parsed.education[0].gpa, 3.91);
    assert.deepEqual(parsed.skills.programming_languages, ["Python"]);
    assert.deepEqual(parsed.skills.ai_ml, ["PyTorch"]);
  });

  it("extracts skills, location, coursework, experience, and certs from a cybersecurity student CV", () => {
    const text = `ABDUL SAMAD
Cybersecurity Intern Candidate  |  Penetration Testing Enthusiast  |  CTF Player
+92 304-1093329  |  okzsamad57@gmail.com  |  linkedin.com/in/abdulsamad57  |  Peshawar, Pakistan

PROFESSIONAL SUMMARY
BS Software Engineering student (CGPA 3.85/4.0) at IMS Peshawar with a strong foundation in cybersecurity and penetration testing. Seeking a cybersecurity internship to apply and grow practical skills in a professional environment.

TECHNICAL SKILLS
Penetration Testing: Web Application Pentesting, API Pentesting, Network Pentesting, OWASP Top 10
Vulnerabilities: IDOR, XSS, XXE, HTTP Verb Tampering, SQLi, File Upload Exploits, Open Redirect, Broken Access Control
Tools & Platforms: Burp Suite, OWASP ZAP, Nmap, Nessus, Katana, Nuclei, Wireshark, Metasploit, VirtualBox, Kali Linux
Programming & Scripting: Python, Bash, JavaScript, C/C++
Web & Dev: Flask, MySQL, Git/GitHub, REST APIs, HTML/CSS
Other: Linux Administration, OSINT, Threat Analysis, Blue Team Fundamentals, Technical Writing

WORK EXPERIENCE
Bug Bounty Researcher — HackerOne	2024 – Present
Self-Directed / Remote
•	Registered on HackerOne and actively learning bug bounty methodologies

EDUCATION
Bachelor of Science in Software Engineering	2024 – Present
Institute of Management Sciences (IMS), Peshawar  |  CGPA: 3.85 / 4.0
•	4th Semester — among top-performing students; coursework includes Cybersecurity, Databases, AI, Software Engineering, and Computer Networks
Intermediate in Computer Science (HSSC)	2022 – 2024
Government College Faqeerabad, Peshawar

ACHIEVEMENTS
•	1st Position in Computer Science across all Government Colleges in Peshawar

CERTIFICATIONS
eJPT – Junior Penetration Tester	INE Security  |  Feb – Apr 2025
PT1 – Junior Penetration Tester	TryHackMe  |  Aug 2025
Google Cybersecurity Professional Certificate	Coursera / Google  |  Aug 2023

LANGUAGES
English (Fluent)    Urdu (Fluent)    Pashto (Native)
`;

    const parsed = heuristicExtract(text);
    assert.equal(parsed.identity.name, "ABDUL SAMAD");
    assert.equal(parsed.identity.email, "okzsamad57@gmail.com");
    assert.equal(parsed.identity.city, "Peshawar");
    assert.equal(parsed.identity.country, "Pakistan");
    assert.match(String(parsed.identity.linkedin), /linkedin\.com\/in\/abdulsamad57/i);

    assert.equal(parsed.education[0].university, "Institute of Management Sciences (IMS), Peshawar");
    assert.equal(parsed.education[0].degree, "Bachelor of Science in Software Engineering");
    assert.equal(parsed.education[0].major, "Software Engineering");
    assert.equal(parsed.education[0].gpa, 3.85);
    assert.equal(parsed.education[0].graduation_date, null);
    assert.equal(parsed.education[0].period, "2024 – Present");
    assert.ok(parsed.education[0].coursework.includes("Cybersecurity"));
    assert.ok(parsed.education[0].coursework.includes("Databases"));
    assert.ok(parsed.education[0].coursework.includes("Computer Networks"));
    assert.equal(parsed.education.length, 2);
    assert.match(String(parsed.education[1].degree), /Intermediate/i);
    assert.equal(parsed.education[1].university, "Government College Faqeerabad, Peshawar");
    assert.equal(parsed.education[1].period, "2022 – 2024");
    assert.ok(parsed.education.every((row) => !/20\d{2}/.test(row.degree || "")));

    assert.ok(parsed.skills.programming_languages.includes("Python"));
    assert.ok(parsed.skills.programming_languages.includes("JavaScript"));
    assert.ok(parsed.skills.frameworks.includes("Flask"));
    assert.ok(parsed.skills.databases.includes("MySQL"));
    assert.ok(parsed.skills.tools.includes("Burp Suite"));
    assert.ok(parsed.skills.tools.includes("Nmap"));
    assert.ok(parsed.skills.tools.includes("Kali Linux"));
    assert.ok(parsed.skills.programming_languages.length + parsed.skills.tools.length > 10);

    assert.equal(parsed.experience.internships.length, 1);
    assert.equal(parsed.experience.internships[0].company, "HackerOne");
    assert.match(parsed.experience.internships[0].role, /Bug Bounty Researcher/i);

    assert.ok(parsed.certifications.some((c) => /eJPT/i.test(c.name)));
    assert.ok(parsed.certifications.some((c) => /Google Cybersecurity/i.test(c.name)));
    assert.ok(parsed.achievements.some((a) => /1st Position/i.test(a)));
    assert.ok(parsed.languages.some((l) => /English/i.test(l)));
    assert.ok(parsed.target_roles.some((role) => /cybersecurity intern/i.test(role)));

    const normalized = normalizeParsedProfile({}, text);
    assert.ok(normalized.skills.programming_languages.includes("Python"));
    assert.equal(normalized.identity.city, "Peshawar");
  });

  it("dedupes glued education dates and keeps bachelor then college order", () => {
    const text = `ABDUL SAMAD
okzsamad57@gmail.com

EDUCATION
Bachelor of Science in Software Engineering2024 – Present
Institute of Management Sciences (IMS), Peshawar  |  CGPA: 3.85 / 4.0
Intermediate in Computer Science (HSSC)2022 – 2024
Government College Faqeerabad, Peshawar
Diploma in Information Technology2022 – 2023
Apex Institute and College of Computer Science
Matriculation — Science (SSC)2020 – 2022
New Islamia Public High School, Peshawar
`;

    const parsed = normalizeParsedProfile(
      {
        education: [
          {
            degree: "Bachelor of Science in Software Engineering2024 — Present",
            university: "Institute of Management Sciences (IMS), Peshawar",
          },
          {
            degree: "Intermediate in Computer Science (HSSC)2022 —",
            university: "Government College Faqeerabad, Peshawar",
          },
          {
            degree: "Diploma in Information Technology2022 —",
            university: "Apex Institute and College of Computer Science",
          },
          {
            degree: "Matriculation — Science (SSC)2020 —",
            university: "New Islamia Public High School, Peshawar",
          },
        ],
      },
      text
    );

    assert.equal(parsed.education.length, 4);
    assert.equal(parsed.education[0].degree, "Bachelor of Science in Software Engineering");
    assert.equal(parsed.education[1].degree, "Intermediate in Computer Science (HSSC)");
    assert.equal(parsed.education[2].degree, "Diploma in Information Technology");
    assert.match(String(parsed.education[3].degree), /Matriculation/i);
    assert.equal(parsed.education[0].period, "2024 – Present");
    assert.equal(parsed.education[1].period, "2022 – 2024");
    assert.ok(parsed.education.every((row) => !/20\d{2}/.test(row.degree || "")));
  });
});
