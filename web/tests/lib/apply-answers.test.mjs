import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advertisedSalaryFromJd,
  answersFromProfile,
  candidateFacts,
  experienceYearsFromCv,
  identityFromCv,
  latestEmployment,
  phoneNationalNumber,
  skillsFromProfile,
} from "../../src/lib/apply/answers-from-profile.mjs";
import { defaultSurveyAnswers, tailorCoverLetter, tailorCvHtml, tailorCvText, pickMasterCv } from "../../src/lib/apply/tailor-documents.mjs";
import { classifyControlLabel } from "../../src/lib/apply/navigate.mjs";

const CV = `# ABDUL SAMAD

ABDUL SAMAD
Cybersecurity Intern Candidate
+92 304-1093329  |  okzsamad57@gmail.com  |  linkedin.com/in/abdulsamad57  |  Peshawar, Pakistan
PROFESSIONAL SUMMARY
BS Software Engineering student
WORK EXPERIENCE
Bug Bounty Researcher — HackerOne2024 – Present
Self-Directed / Remote
Registered on HackerOne
`;

test("identityFromCv reads header contact + city", () => {
  const id = identityFromCv(CV);
  assert.equal(id.name, "ABDUL SAMAD");
  assert.equal(id.email, "okzsamad57@gmail.com");
  assert.match(id.phone, /304-1093329/);
  assert.equal(id.city, "Peshawar");
  assert.equal(id.country, "Pakistan");
  assert.match(id.linkedin, /abdulsamad57/);
});

test("latestEmployment parses HackerOne line without a space before the year", () => {
  const job = latestEmployment({ experience: { internships: [] } }, CV);
  assert.equal(job.title, "Bug Bounty Researcher");
  assert.equal(job.employer, "HackerOne");
});

test("answersFromProfile fills attested fields and skips guesswork", () => {
  const fields = [
    { id: "a", label: "First Name" },
    { id: "b", label: "Last Name" },
    { id: "c", label: "Email" },
    { id: "d", label: "Location (City)", placeholder: "Locate me" },
    { id: "e", label: "Current Employer" },
    { id: "f", label: "Current Job Title" },
    { id: "g", label: "LinkedIn Profile" },
    { id: "h", label: "Have you previously worked at Careem?", options: ["Yes", "No"] },
    { id: "i", label: "How did you learn about a role at Careem?", options: ["I saw the job posting on Linkedin and decided to apply", "I saw the job posting on Careem’s Careers Page and decided to apply"] },
    { id: "j", label: "To which gender identity do you most identify:" },
    { id: "k", label: "Did you attempt the previous question?", options: ["No I did not attempt it", "Yes - Option 1"] },
    { id: "s", label: "Have you seen Careem's content on social media?", options: ["Yes", "No"] },
    { id: "inf", label: "What influenced your decision to apply for a role at Careem?", options: ["Careem’s purpose and values", "The career growth and development opportunities offered at Careem"] },
  ];
  const answers = answersFromProfile(fields, { identity: {}, experience: { internships: [] } }, {
    cvText: CV,
    company: "Careem",
    attemptedAiChallenge: false,
    survey: defaultSurveyAnswers(),
  });
  assert.equal(answers.a, "ABDUL");
  assert.equal(answers.b, "SAMAD");
  assert.equal(answers.c, "okzsamad57@gmail.com");
  assert.equal(answers.d, "Peshawar, Pakistan");
  assert.equal(answers.e, "HackerOne");
  assert.equal(answers.f, "Bug Bounty Researcher");
  assert.match(answers.g, /abdulsamad57/);
  assert.equal(answers.h, "No");
  assert.equal(answers.k, "No I did not attempt it");
  assert.match(answers.i, /Careers Page/i);
  assert.equal(answers.s, "No");
  assert.match(answers.inf, /career growth/i);
  assert.equal(answers.j, undefined);
  // Must not invent a blanket "yes" for every checkbox in the group
  assert.equal(Object.values(answers).filter((v) => v === "yes").length, 0);
});

test("answersFromProfile maps IBMid to the CV email", () => {
  const answers = answersFromProfile([{ id: "ibm", label: "IBMid" }], { identity: {} }, { cvText: CV });
  assert.equal(answers.ibm, "okzsamad57@gmail.com");
});

test("answersFromProfile never fills a password", () => {
  const answers = answersFromProfile(
    [
      { id: "e", label: "Email" },
      { id: "p", label: "Password" },
      { id: "n", label: "Create a password" },
    ],
    { identity: { email: "okzsamad57@gmail.com" } },
    { cvText: CV },
  );
  assert.equal(answers.e, "okzsamad57@gmail.com");
  assert.equal(answers.p, undefined);
  assert.equal(answers.n, undefined);
});

test("tailorCvText reorders but does not invent employers", () => {
  const out = tailorCvText({ cvText: CV, company: "Careem", role: "Senior Data Scientist II" });
  assert.match(out, /HackerOne/);
  assert.match(out, /HackerOne\s*2024/);
  assert.doesNotMatch(out, /transformer|personalization ranking|6-8 years/i);
  assert.doesNotMatch(out, /&amp;|â€/);
});

test("tailorCoverLetter stays on attested facts", () => {
  const letter = tailorCoverLetter({
    cvText: CV,
    profile: { identity: { name: "ABDUL SAMAD" }, education: [{ degree: "BS Software Engineering", university: "IMS Peshawar" }] },
    company: "Careem",
    role: "Senior Data Scientist II",
  });
  assert.match(letter, /ABDUL SAMAD/);
  assert.match(letter, /Careem/);
  assert.doesNotMatch(letter, /I led personalization|graph neural/i);
});

test("candidateFacts prefers profile city when present", () => {
  const facts = candidateFacts({ identity: { city: "Lahore", country: "Pakistan", name: "Abdul Samad" } }, CV);
  assert.equal(facts.city, "Lahore");
  assert.equal(facts.employer, "HackerOne");
});

const FULL_CV = `# ABDUL SAMAD

ABDUL SAMAD
Cybersecurity Intern Candidate | Penetration Testing Enthusiast | CTF Player
+92 304-1093329 | okzsamad57@gmail.com | linkedin.com/in/abdulsamad57 | Peshawar, Pakistan
PROFESSIONAL SUMMARY
BS Software Engineering student (CGPA 3.85/4.0) at IMS Peshawar with a strong foundation in cybersecurity and penetration testing. Hands-on experience through self-directed labs, CTF competitions, and practical study of web security concepts including IDOR, XSS, XXE, HTTP Verb Tampering, and API security. Registered on HackerOne and actively developing offensive security skills aligned with OWASP Top 10. Holder of 15+ industry certifications including PT1, eJPT, Google Cybersecurity Professional Certificate. Seeking an opportunity at Amazon (Software Dev Engineer II, Planning Intelligence) where I can apply software engineering, Python, and analytical skills.
TECHNICAL SKILLS
Penetration Testing: Web Application Pentesting, API Pentesting, Network Pentesting, OWASP Top 10
Programming & Scripting: Python, Bash, JavaScript, C/C++
Web & Dev: Flask, MySQL, Git/GitHub, REST APIs, HTML/CSS
Vulnerabilities: IDOR, XSS, XXE, HTTP Verb Tampering, SQLi, File Upload Exploits, Open Redirect, Broken Access Control
Tools & Platforms: Burp Suite, OWASP ZAP, Nmap, Nessus, Katana, Nuclei, Wireshark, Metasploit, VirtualBox, Kali Linux
WORK EXPERIENCE
Bug Bounty Researcher - HackerOne 2024 - Present
Self-Directed / Remote
Registered on HackerOne and actively learning bug bounty methodologies
EDUCATION
Bachelor of Science in Software Engineering 2024 - Present
Institute of Management Sciences (IMS), Peshawar | CGPA: 3.85 / 4.0
`;

test("tailorCvText strips a previous company's targeting sentence", () => {
  const out = tailorCvText({
    cvText: FULL_CV,
    company: "Careem",
    role: "Senior Data Scientist II",
    jdText: "Python SQL Spark Hive machine learning databases",
  });
  assert.match(out, /Careem/);
  assert.match(out, /Senior Data Scientist II/);
  assert.doesNotMatch(out, /Amazon/);
  assert.doesNotMatch(out, /Planning Intelligence/);
});

test("tailorCvText is different for different jobs", () => {
  const careem = tailorCvText({
    cvText: FULL_CV,
    company: "Careem",
    role: "Senior Data Scientist II",
    jdText: "Python SQL Spark Hive machine learning",
  });
  const amazon = tailorCvText({
    cvText: FULL_CV,
    company: "Amazon",
    role: "Software Dev Engineer II, Planning Intelligence",
    jdText: "Java Python distributed systems REST APIs",
  });
  const pentest = tailorCvText({
    cvText: FULL_CV,
    company: "Acme",
    role: "Cybersecurity Intern",
    jdText: "OWASP XSS Burp Suite penetration testing Nuclei",
  });
  assert.notEqual(careem, amazon);
  assert.notEqual(amazon, pentest);
  assert.match(careem, /Careem/);
  assert.match(amazon, /Amazon/);
  assert.match(pentest, /Acme/);
  const pentestSkills = pentest.split("TECHNICAL SKILLS")[1].split("WORK EXPERIENCE")[0];
  const dataSkills = careem.split("TECHNICAL SKILLS")[1].split("WORK EXPERIENCE")[0];
  assert.ok(pentestSkills.indexOf("Penetration Testing") < pentestSkills.indexOf("Programming"));
  assert.ok(dataSkills.indexOf("Programming") < dataSkills.indexOf("Vulnerabilities"));
});

test("classifyControlLabel never treats Apply now as submit on a JD", () => {
  assert.equal(classifyControlLabel("Apply now"), "apply");
  assert.equal(classifyControlLabel("Apply for this job"), "apply");
  assert.equal(classifyControlLabel("I'm interested"), "apply");
  assert.equal(classifyControlLabel("Create Account"), "signup-tab");
  assert.equal(classifyControlLabel("Apply as guest"), "guest");
  assert.equal(classifyControlLabel("Next"), "next");
  assert.equal(classifyControlLabel("Continue"), "next");
  assert.equal(classifyControlLabel("Continue with Google"), "sso-google");
  assert.equal(classifyControlLabel("Sign in with Google"), "sso-google");
  assert.equal(classifyControlLabel("Apply with Google"), "sso-google");
  assert.equal(classifyControlLabel("Sign up with Google"), "sso-google");
  assert.equal(classifyControlLabel("Submit"), "submit");
  assert.equal(classifyControlLabel("Submit application"), "submit");
  assert.equal(classifyControlLabel("Apply now", { hasApplicationFields: true }), "submit");
  assert.equal(classifyControlLabel("Sign in"), "other");
  assert.equal(classifyControlLabel("Find roles"), "other");
  assert.equal(classifyControlLabel("View all jobs"), "other");
  assert.equal(classifyControlLabel("Search jobs"), "other");
});

test("phoneNationalNumber strips +92 for digit-only ATS fields", () => {
  assert.equal(phoneNationalNumber("+92 304-1093329"), "3041093329");
  assert.equal(phoneNationalNumber("03041093329"), "3041093329");
});

test("skillsFromProfile reads TECHNICAL SKILLS from the CV", () => {
  const skills = skillsFromProfile({}, FULL_CV);
  assert.match(skills, /Python/);
  assert.match(skills, /JavaScript/);
  assert.doesNotMatch(skills, /React Native invent/i);
});

test("experienceYearsFromCv uses attested work dates only", () => {
  assert.equal(experienceYearsFromCv(FULL_CV, {}), String(new Date().getFullYear() - 2024));
});

test("TechEmulsion-style camelCase fields fill attested facts and skip guesses", () => {
  const fields = [
    { id: "firstName", label: "First Name", nativeName: "firstName" },
    { id: "lastName", label: "Last Name", nativeName: "lastName" },
    { id: "email", label: "Email Address", nativeName: "email", type: "email" },
    { id: "phone", label: "Phone Number", nativeName: "phone", type: "tel", placeholder: "3001234567", maxLength: 15 },
    { id: "yearOfGraduation", label: "Year of Graduation", nativeName: "yearOfGraduation", type: "number" },
    { id: "gender", label: "Gender", nativeName: "gender", options: ["Male", "Female", "Other", "Prefer not to say"] },
    { id: "experienceYears", label: "Years of Experience", nativeName: "experienceYears", type: "number" },
    { id: "currentEmployer", label: "Current Employer", nativeName: "currentEmployer" },
    { id: "currentCTC", label: "Current Salary", nativeName: "currentCTC", type: "number" },
    { id: "expectedCTC", label: "Expected Salary", nativeName: "expectedCTC", type: "number" },
    { id: "noticePeriod", label: "Notice Period", nativeName: "noticePeriod", type: "number" },
    { id: "skills", label: "Key Skills", nativeName: "skills" },
    { id: "linkedin", label: "LinkedIn Profile", nativeName: "linkedin" },
    { id: "portfolio", label: "Portfolio / GitHub", nativeName: "portfolio" },
    { id: "currentLocation", label: "Current Location", nativeName: "currentLocation" },
    { id: "preferredLocation", label: "Preferred Work Location", nativeName: "preferredLocation" },
    {
      id: "source",
      label: "How did you hear about this position?",
      nativeName: "source",
      options: ["TechEmulsion website", "LinkedIn", "Indeed", "Referral", "Other"],
    },
    { id: "coverLetter", label: "Cover Letter / Message (Optional)", nativeName: "coverLetter", type: "textarea" },
  ];
  const answers = answersFromProfile(fields, { identity: {}, experience: { internships: [] } }, {
    cvText: FULL_CV,
    company: "TechEmulsion",
    coverLetter: "I am applying for Software Engineer at TechEmulsion.",
    survey: defaultSurveyAnswers(),
  });
  assert.equal(answers.firstName, "ABDUL");
  assert.equal(answers.lastName, "SAMAD");
  assert.equal(answers.email, "okzsamad57@gmail.com");
  assert.equal(answers.phone, "3041093329");
  assert.equal(answers.currentEmployer, "HackerOne");
  assert.equal(answers.experienceYears, String(new Date().getFullYear() - 2024));
  assert.match(answers.skills, /JavaScript/);
  assert.match(answers.linkedin, /abdulsamad57/);
  assert.equal(answers.currentLocation, "Peshawar, Pakistan");
  assert.equal(answers.preferredLocation, "Peshawar, Pakistan");
  assert.equal(answers.source, "TechEmulsion website");
  assert.match(answers.coverLetter, /TechEmulsion/);
  assert.equal(answers.gender, undefined);
  assert.equal(answers.currentCTC, undefined);
  assert.equal(answers.expectedCTC, undefined);
  assert.equal(answers.noticePeriod, undefined);
  assert.equal(answers.yearOfGraduation, undefined);
  assert.equal(answers.portfolio, undefined);
});

test("attested gender, notice, zero salary, and JD expected pay", () => {
  assert.equal(advertisedSalaryFromJd("Compensation: PKR 80,000 - 100,000 per month"), "90000");
  assert.equal(advertisedSalaryFromJd("No pay mentioned, posted 2026"), "");
  const fields = [
    { id: "email", label: "Email Address", nativeName: "email", type: "email" },
    { id: "gender", label: "Gender", nativeName: "gender", options: ["Male", "Female", "Other", "Prefer not to say"] },
    { id: "currentCTC", label: "Current Salary", nativeName: "currentCTC", type: "number" },
    { id: "expectedCTC", label: "Expected Salary", nativeName: "expectedCTC", type: "number" },
    { id: "noticePeriod", label: "Notice Period", nativeName: "noticePeriod", type: "number" },
  ];
  const profile = {
    identity: { email: "okzsamad57@gmail.com", gender: "Male" },
    preferences: { notice_period_days: 10, current_salary: 0, expected_salary_from_jd: true },
  };
  const withJd = answersFromProfile(fields, profile, { jdText: "Salary PKR 70,000 to 90,000" });
  assert.equal(withJd.email, "okzsamad57@gmail.com");
  assert.equal(withJd.gender, "Male");
  assert.equal(withJd.currentCTC, "0");
  assert.equal(withJd.noticePeriod, "10");
  assert.equal(withJd.expectedCTC, "80000");
  const noJd = answersFromProfile(fields, profile, { jdText: "MERN stack engineer in Peshawar" });
  assert.equal(noJd.expectedCTC, undefined);
  const textNotice = answersFromProfile(
    [{ id: "noticePeriod", label: "Notice Period", nativeName: "noticePeriod", type: "text" }],
    profile,
  );
  assert.equal(textNotice.noticePeriod, "10 days");
});

test("VentureDive-style Recruiterbox fields use profile/CV, not the candidate name", () => {
  const fields = [
    { id: "first", label: "First name" },
    { id: "uni", label: "University Name*" },
    { id: "loc", label: "Location*", type: "select", options: ["Karachi", "Lahore", "Islamabad", "Peshawar"] },
    { id: "exp", label: "Total Experience*", type: "select", options: ["0-1 years", "1-2 years", "2-3 years", "3-5 years"] },
    { id: "qual", label: "Education Qualification*", type: "select", options: ["Matric", "Intermediate", "Bachelor", "Master"] },
    { id: "start", label: "Career Start date*", type: "date" },
    { id: "ai", label: "Have you used any AI tools to improve productivity in your professional work?*", options: ["Yes", "No"] },
    { id: "aiList", label: "If yes, please list the AI tool(s) name you have used*" },
    { id: "dis", label: "Do you have a disability or chronic condition...?*", options: ["Yes", "No", "Prefer not to say"] },
    { id: "human", label: "Human Check*" },
  ];
  const answers = answersFromProfile(fields, { identity: { gender: "Male" }, experience: { internships: [] } }, { cvText: FULL_CV });
  assert.equal(answers.first, "ABDUL");
  assert.match(answers.uni, /IMS|Institute of Management/i);
  assert.equal(answers.loc, "Peshawar");
  assert.equal(answers.exp, "1-2 years");
  assert.equal(answers.qual, "Bachelor");
  assert.match(answers.start, /^2024-/);
  assert.equal(answers.ai, "No");
  assert.equal(answers.aiList, undefined);
  assert.equal(answers.dis, "Prefer not to say");
  assert.equal(answers.human, undefined);
});

test("AI tools follow-up lists attested tools and never the person name", () => {
  const fields = [
    { id: "ai", label: "Have you used any AI tools to improve productivity in your professional work?*", options: ["Yes", "No"] },
    { id: "aiList", label: "If yes, please list the AI tool(s) name you have used*" },
  ];
  const answers = answersFromProfile(fields, { identity: { name: "ABDUL SAMAD" } }, { cvText: `${FULL_CV}\nTools: ChatGPT, GitHub Copilot` });
  assert.equal(answers.ai, "Yes");
  assert.match(answers.aiList, /ChatGPT/);
  assert.doesNotMatch(answers.aiList, /ABDUL SAMAD/);
});

test("fillRemaining completes leftover Recruiterbox questions from the profile", () => {
  const fields = [
    { id: "loc", label: "Location*", type: "select", options: ["Karachi", "Lahore", "Islamabad"] },
    { id: "notice", label: "Notice period*", type: "select", options: ["Immediate", "15 days", "30 days", "60 days"] },
    { id: "expSal", label: "Expected Salary*" },
    { id: "fintech", label: "Are you comfortable working on fintech projects?*", options: ["Yes", "No"] },
    { id: "human", label: "Human Check*" },
  ];
  const answers = answersFromProfile(fields, { identity: { city: "Peshawar", country: "Pakistan" } }, {
    cvText: FULL_CV,
    jdText: "Senior AI Engineer Karachi/ Lahore, Pakistan",
    fillRemaining: true,
  });
  assert.equal(answers.loc, "Karachi");
  assert.equal(answers.notice, "Immediate");
  assert.equal(answers.expSal, "80000");
  assert.equal(answers.fintech, "Yes");
  assert.equal(answers.human, undefined);
});

test("career start uses HackerOne year, not a future graduation date", () => {
  const answers = answersFromProfile(
    [{ id: "start", label: "Career Start Date*", type: "date" }],
    { education: [{ start: "2024", graduation_date: "2028" }] },
    { cvText: FULL_CV },
  );
  assert.match(answers.start, /^2024-/);
});

const MASTER_CV = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../cv.md"), "utf8");

test("tailorCvText keeps the master CV body for VentureDive", () => {
  const out = tailorCvText({
    cvText: MASTER_CV,
    company: "VentureDive",
    role: "Senior AI Engineer",
    jdText: "multi-agent RAG Python evaluation LLM",
  });
  assert.match(out, /HackerOne/);
  assert.match(out, /Registered on HackerOne/);
  assert.match(out, /eJPT/);
  assert.match(out, /Institute of Management Sciences/);
  assert.match(out, /Penetration Testing:/);
  assert.match(out, /Python/);
  assert.match(out, /VentureDive/);
  assert.doesNotMatch(out, /Prepared for Senior AI Engineer/);
  assert.ok(out.length > 1500);
});

test("software and AI roles drop the cybersecurity intern headline", () => {
  const ai = tailorCvText({
    cvText: MASTER_CV,
    company: "VentureDive",
    role: "Senior AI Engineer",
    jdText: "multi-agent RAG Python evaluation LLM",
  });
  const swe = tailorCvText({
    cvText: MASTER_CV,
    company: "TechEmulsion",
    role: "Software Engineer",
    jdText: "JavaScript Python REST APIs Flask Git",
  });
  const sec = tailorCvText({
    cvText: MASTER_CV,
    company: "Acme",
    role: "Cybersecurity Intern",
    jdText: "OWASP XSS Burp Suite penetration testing",
  });
  assert.match(ai, /Senior AI Engineer Candidate/);
  assert.doesNotMatch(ai, /Cybersecurity Intern Candidate/);
  assert.match(swe, /Software Engineer Candidate/);
  assert.doesNotMatch(swe, /Cybersecurity Intern Candidate/);
  assert.match(sec, /Cybersecurity Intern Candidate/);
  const aiSkills = ai.split("TECHNICAL SKILLS")[1].split("WORK EXPERIENCE")[0];
  assert.ok(aiSkills.indexOf("Programming") < aiSkills.indexOf("Penetration Testing"));
  assert.doesNotMatch(ai, /Programming and development skills include/);
  assert.doesNotMatch(ai, /CORE COMPETENCIES|career-intelligent-agent/i);
  assert.match(ai, /Introduction to Modern AI|coursework in AI/i);
  assert.doesNotMatch(ai, /strong foundation in cybersecurity and penetration testing/i);
  assert.doesNotMatch(ai, /\*\*|###/);
});

test("tailorCvHtml does not leak markdown and uses HTML emphasis", () => {
  const mdCv = MASTER_CV.replace("Penetration Testing:", "- **Penetration Testing:**").replace(
    "Bug Bounty Researcher",
    "### Bug Bounty Researcher",
  );
  const html = tailorCvHtml({
    cvText: mdCv,
    company: "VentureDive",
    role: "Senior AI Engineer",
    jdText: "Python LLM",
  });
  assert.doesNotMatch(html, /\*\*/);
  assert.doesNotMatch(html, /###/);
  assert.match(html, /Programming/);
  assert.match(html, /Senior AI Engineer Candidate|Python/);
  assert.match(html, /HackerOne/);
});

test("collapsed tailored CV is not used as the master", () => {
  const garbage = `ABDUL SAMAD
Prepared for Senior AI Engineer at VentureDive
PROFESSIONAL SUMMARY
Seeking an opportunity at VentureDive.
TECHNICAL SKILLS
WORK EXPERIENCE
EDUCATION
ACHIEVEMENTS
CERTIFICATIONS`;
  assert.equal(pickMasterCv(garbage, MASTER_CV), MASTER_CV.trim());
});

test("cover letter is a professional letter grounded in the CV", () => {
  const letter = tailorCoverLetter({
    cvText: MASTER_CV,
    profile: { identity: { name: "ABDUL SAMAD", email: "okzsamad57@gmail.com", phone: "+92 304-1093329" } },
    company: "VentureDive",
    role: "Senior AI Engineer",
    jdText: "multi-agent RAG Python evaluation",
  });
  assert.match(letter, /Dear Hiring Manager/);
  assert.match(letter, /VentureDive/);
  assert.match(letter, /Senior AI Engineer/);
  assert.match(letter, /IMS|Institute of Management/i);
  assert.match(letter, /Introduction to Modern AI|coursework in AI|Python/i);
  assert.match(letter, /Sincerely/);
  assert.doesNotMatch(letter, /I led personalization|graph neural|production multi-agent systems I built/i);
  assert.doesNotMatch(letter, /TensorFlow|PyTorch/);
  assert.doesNotMatch(letter, /eJPT|PT1/);
  assert.ok(letter.split(/\n\n/).length >= 3);
  assert.doesNotMatch(letter, /I am ABDUL SAMAD, BS Software Engineering at Institute of Management Sciences \(IMS\), Peshawar\. I am applying for\nSenior AI Engineer/);
});


