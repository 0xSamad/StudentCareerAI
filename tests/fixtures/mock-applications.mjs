/**
 * Realistic mock applications used by the orchestrator DRY_RUN suite.
 * Different ATS-shaped field lists — no live network, no CAPTCHA bypass.
 */

export const MOCK_PROFILE = {
  identity: { name: "Ali Hassan", email: "ali@example.com", city: "Lahore", country: "Pakistan" },
  education: [{ university: "LUMS", degree: "BS", major: "Computer Science", gpa: 3.8, graduation_year: 2027 }],
  skills: { programming_languages: ["Python", "JavaScript"], frameworks: ["React"], tools: ["Git"] },
  experience: { internships: [{ company: "Arbisoft", role: "Software Intern", description: "Python services" }] },
  projects: [{ name: "SentimentBot", technologies: ["Python", "scikit-learn"], description: "Classified student feedback" }],
  preferences: {
    target_roles: ["Software Engineering Intern"],
    locations: { preferred: ["Lahore"], remote: true, on_site: true },
    sponsorship: { needs_sponsorship: false, visa_status: "citizen" },
  },
};

export const MOCK_CV = `# Ali Hassan
Software intern at Arbisoft. Python, JavaScript, React.
Project: SentimentBot — classified student feedback with scikit-learn.
`;

const live = async () => ({ verified: true, status: "active", reason: "Mock ATS listing is live" });

export function greenhouseOpportunity() {
  return {
    id: "mock_greenhouse",
    company: "Careem",
    title: "Software Engineering Intern",
    url: "https://boards.greenhouse.io/careem/jobs/111",
    description: "Python internship in Lahore. Remote ok. No cover letter required.",
    application_fields: [
      { label: "First Name", name: "first_name", required: true },
      { label: "Last Name", name: "last_name", required: true },
      { label: "Email", name: "email", type: "email", required: true },
      { label: "Resume", name: "resume", type: "file", required: true },
      { label: "LinkedIn Profile", name: "linkedin" },
    ],
    verifyLivenessFn: live,
  };
}

export function leverOpportunity() {
  return {
    id: "mock_lever",
    company: "Nayapay",
    title: "Backend Intern",
    url: "https://jobs.lever.co/nayapay/abc",
    description: "Python backend internship. A cover letter is required.",
    application_fields: [
      { label: "Full name", name: "name", required: true },
      { label: "Email", name: "email", required: true },
      { label: "Resume", name: "resume", type: "file" },
      { label: "Additional information / cover letter", name: "comments", required: true },
    ],
    verifyLivenessFn: live,
  };
}

export function workdayOpportunity() {
  return {
    id: "mock_workday",
    company: "Systems Limited",
    title: "Software Engineering Intern",
    url: "https://systems.wd3.myworkdayjobs.com/en-US/Careers/job/SE-Intern",
    description: "Python, React, Docker and Kubernetes internship in Lahore.",
    application_fields: [
      { label: "Legal Name", name: "legalName", required: true },
      { label: "Email", name: "email", required: true },
      { label: "Phone", name: "phone" },
      { label: "How did you hear about us?", name: "source" },
      { label: "Are you authorized to work in Pakistan?", name: "workAuth", required: true },
    ],
    verifyLivenessFn: live,
  };
}

export function genericCompanyOpportunity() {
  return {
    id: "mock_generic",
    company: "Folio3",
    title: "Python Intern",
    url: "https://folio3.com/careers/python-intern",
    description: "Python internship. Apply on our website.",
    application_fields: [
      { label: "Name", name: "name", required: true },
      { label: "Email", name: "email", required: true },
      { label: "Portfolio URL", name: "portfolio" },
      { label: "What is your favorite color?", name: "favorite_color" },
    ],
    verifyLivenessFn: live,
  };
}

export function sensitiveUnexpectedOpportunity() {
  return {
    id: "mock_sensitive",
    company: "Acme Labs",
    title: "Research Intern",
    url: "https://acmelabs.example/apply/research",
    description: "Python research internship. Cover letter not required.",
    application_fields: [
      { label: "Name", name: "name", required: true },
      { label: "Email", name: "email", required: true },
      { label: "Have you ever been convicted of a crime?", name: "criminal", required: true },
    ],
    verifyLivenessFn: live,
  };
}

export function allFiveMocks() {
  return [
    greenhouseOpportunity(),
    leverOpportunity(),
    workdayOpportunity(),
    genericCompanyOpportunity(),
    sensitiveUnexpectedOpportunity(),
  ];
}
