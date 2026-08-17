/**
 * Skill taxonomy for role-readiness analysis.
 *
 * Reuses skill-extract.mjs (canonical Python/PostgreSQL/PyTorch, …) and adds
 * analyzer-only tokens (Git, Linux, Statistics, …) without umbrella-merging
 * unrelated tech. Related groups are used only for PARTIAL — never as aliases.
 */

import { canonicalize, extractSkills } from '../../../skill-extract.mjs';

export const CATEGORIES = {
  'Programming Languages': ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'SQL', 'R', 'Scala', 'PHP', 'Kotlin', 'Swift'],
  Frameworks: ['React', 'Next.js', 'Django', 'Flask', 'FastAPI', 'Spring', 'Node.js', 'Angular', 'Vue.js', 'Rails', 'Laravel'],
  Libraries: ['Pandas', 'NumPy', 'scikit-learn', 'OpenCV', 'Hugging Face', 'LangChain', 'Keras'],
  'Machine Learning': ['Machine Learning', 'scikit-learn', 'XGBoost', 'MLflow', 'MLOps'],
  'Deep Learning': ['Deep Learning', 'PyTorch', 'TensorFlow', 'Keras'],
  AI: ['LLMs', 'RAG', 'Prompt Engineering', 'Fine-tuning', 'LangChain', 'LlamaIndex'],
  NLP: ['NLP', 'Hugging Face', 'Transformers'],
  'Computer Vision': ['Computer Vision', 'OpenCV'],
  'Data Science': ['Pandas', 'NumPy', 'Tableau', 'Power BI', 'Looker', 'Statistics', 'Jupyter'],
  'Data Engineering': ['Spark', 'Airflow', 'dbt', 'Kafka', 'Snowflake', 'BigQuery', 'Databricks'],
  Databases: ['SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra'],
  Cloud: ['AWS', 'GCP', 'Azure'],
  DevOps: ['Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'Helm', 'Ansible'],
  MLOps: ['MLOps', 'MLflow'],
  'Version Control': ['Git', 'GitHub', 'GitLab'],
  'Operating Systems': ['Linux', 'Windows', 'Bash', 'PowerShell'],
  'Security Fundamentals': ['Security Fundamentals', 'OWASP', 'Vulnerability Assessment', 'Security Reporting'],
  Networking: ['Networking', 'TCP/IP', 'DNS', 'Firewalls'],
  'Web Security': ['Web Security', 'OWASP', 'Burp Suite'],
  'Offensive Security': ['Penetration Testing', 'Privilege Escalation', 'Metasploit', 'Nmap'],
  'Defensive Security': ['SIEM', 'SOC', 'Incident Response', 'Threat Detection', 'Splunk'],
  'Identity & Access': ['Active Directory', 'IAM'],
  'Cloud Security': ['Cloud Security', 'IAM'],
  'Security Tools': ['Wireshark', 'Nmap', 'Burp Suite', 'Metasploit'],
  Tools: ['Git', 'Docker', 'Jupyter', 'Excel', 'Postman'],
  'Soft Skills': ['Communication', 'Problem Solving', 'Teamwork'],
  Mathematics: ['Linear Algebra', 'Calculus', 'Probability'],
  Statistics: ['Statistics', 'Probability'],
  Certifications: [],
  Education: [],
  Experience: [],
  Projects: [],
};

const EXTRA_TOKENS = [
  'GitHub', 'GitLab', 'Linux', 'Bash', 'PowerShell', 'Windows', 'Jupyter', 'Keras', 'OpenCV', 'Excel',
  'XGBoost', 'Transformers', 'Statistics', 'Probability', 'Communication',
  'Teamwork', 'Postman', 'SQLite', 'Nmap', 'Wireshark', 'Metasploit', 'Splunk',
  'SIEM', 'SOC', 'OWASP', 'IAM',
];

const EXTRA_PHRASES = [
  [/\blinear algebra\b/i, 'Linear Algebra'],
  [/\bproblem solving\b/i, 'Problem Solving'],
  [/\bprompt engineering\b/i, 'Prompt Engineering'],
  [/\bmachine learning\b/i, 'Machine Learning'],
  [/\bdeep learning\b/i, 'Deep Learning'],
  [/\bsecurity fundamentals?\b/i, 'Security Fundamentals'],
  [/\binformation security\b/i, 'Security Fundamentals'],
  [/\bcia triad\b/i, 'Security Fundamentals'],
  [/\b(?:computer )?networking\b/i, 'Networking'],
  [/\btcp\/?ip\b/i, 'TCP/IP'],
  [/\bweb security\b/i, 'Web Security'],
  [/\bburp suite\b/i, 'Burp Suite'],
  [/\bpenetration test(?:ing|er)?s?\b/i, 'Penetration Testing'],
  [/\bpentest(?:ing)?\b/i, 'Penetration Testing'],
  [/\bvulnerability assessment\b/i, 'Vulnerability Assessment'],
  [/\bincident response\b/i, 'Incident Response'],
  [/\bthreat detection\b/i, 'Threat Detection'],
  [/\bactive directory\b/i, 'Active Directory'],
  [/\bcloud security\b/i, 'Cloud Security'],
  [/\bprivilege escalation\b/i, 'Privilege Escalation'],
  [/\bsecurity reporting\b/i, 'Security Reporting'],
  [/\bdata structures?\b/i, 'Data Structures'],
  [/\brest(?:ful)? apis?\b/i, 'REST APIs'],
];

const EXTRA_PATTERN = new RegExp('(?<!\\w)(?:' + EXTRA_TOKENS.join('|') + ')(?!\\w)', 'gi');
const GIT_PATTERN = /(?<!\w)Git(?![\w])/;

const EXTRA_CANON = {
  github: 'GitHub',
  gitlab: 'GitLab',
  git: 'Git',
  linux: 'Linux',
  bash: 'Bash',
  jupyter: 'Jupyter',
  keras: 'Keras',
  opencv: 'OpenCV',
  excel: 'Excel',
  xgboost: 'XGBoost',
  transformers: 'Transformers',
  statistics: 'Statistics',
  probability: 'Probability',
  communication: 'Communication',
  teamwork: 'Teamwork',
  postman: 'Postman',
  sqlite: 'SQLite',
  'linear algebra': 'Linear Algebra',
  'problem solving': 'Problem Solving',
  'machine learning': 'Machine Learning',
  'deep learning': 'Deep Learning',
  powershell: 'PowerShell',
  windows: 'Windows',
  nmap: 'Nmap',
  wireshark: 'Wireshark',
  metasploit: 'Metasploit',
  splunk: 'Splunk',
  siem: 'SIEM',
  soc: 'SOC',
  owasp: 'OWASP',
  iam: 'IAM',
  'security fundamentals': 'Security Fundamentals',
  'web security': 'Web Security',
  'burp suite': 'Burp Suite',
  'penetration testing': 'Penetration Testing',
  pentest: 'Penetration Testing',
  'vulnerability assessment': 'Vulnerability Assessment',
  'incident response': 'Incident Response',
  'threat detection': 'Threat Detection',
  'active directory': 'Active Directory',
  'cloud security': 'Cloud Security',
  'privilege escalation': 'Privilege Escalation',
  'security reporting': 'Security Reporting',
  networking: 'Networking',
  'tcp/ip': 'TCP/IP',
  'data structures': 'Data Structures',
  'rest apis': 'REST APIs',
};

export function canonicalizeAnalyzerSkill(token) {
  const key = String(token || '').toLowerCase().trim();
  if (EXTRA_CANON[key]) return EXTRA_CANON[key];
  return canonicalize(token);
}

export function extractAnalyzerSkills(text = '') {
  const found = new Set(extractSkills(text));
  const blob = String(text || '');
  for (const [re, name] of EXTRA_PHRASES) {
    if (re.test(blob)) found.add(name);
  }
  for (const m of blob.matchAll(EXTRA_PATTERN)) {
    found.add(canonicalizeAnalyzerSkill(m[0]));
  }
  if (GIT_PATTERN.test(blob)) found.add('Git');
  return found;
}

/** Sibling skills — having one is PARTIAL for another, never the same skill. */
export const RELATED_GROUPS = [
  ['PyTorch', 'TensorFlow', 'Keras'],
  ['AWS', 'GCP', 'Azure'],
  ['PostgreSQL', 'MySQL', 'SQLite'],
  ['React', 'Angular', 'Vue.js'],
  ['NLP', 'Hugging Face', 'Transformers'],
  ['Nmap', 'Wireshark', 'Burp Suite'],
  ['SIEM', 'Splunk', 'SOC'],
  ['Linux', 'Bash'],
  ['Windows', 'Active Directory', 'PowerShell'],
];

/** Having the child implies the parent is covered. */
export const IMPLIES_PARENT = {
  Pandas: ['Python'],
  NumPy: ['Python'],
  TensorFlow: ['Python'],
  Keras: ['Python'],
  'scikit-learn': ['Python', 'Machine Learning'],
  'Machine Learning': ['Python'],
  'Deep Learning': ['Python', 'Machine Learning'],
  PyTorch: ['Python', 'Deep Learning', 'Machine Learning'],
  FastAPI: ['Python'],
  Django: ['Python'],
  Flask: ['Python'],
  React: ['JavaScript'],
  'Next.js': ['JavaScript', 'React'],
  PostgreSQL: ['SQL'],
  MySQL: ['SQL'],
  SQLite: ['SQL'],
  'Burp Suite': ['Web Security'],
  Nmap: ['Networking'],
  Splunk: ['SIEM'],
  Metasploit: ['Penetration Testing'],
  SOC: ['SIEM', 'Incident Response'],
  'Active Directory': ['Windows'],
  PowerShell: ['Windows'],
  Bash: ['Linux'],
  IAM: ['Cloud Security'],
};

export function impliedParents(skill) {
  return IMPLIES_PARENT[skill] || [];
}

export function relatedSkills(skill) {
  const out = new Set();
  for (const group of RELATED_GROUPS) {
    if (group.includes(skill)) group.filter((s) => s !== skill).forEach((s) => out.add(s));
  }
  return [...out];
}

export function categoryFor(skill) {
  for (const [cat, skills] of Object.entries(CATEGORIES)) {
    if (skills.includes(skill)) return cat;
  }
  return 'Tools';
}

const MANDATORY_NEAR = /(?:required|must[- ]have|mandatory|minimum qualifications?)/i;

/**
 * A skill is mandatory in a posting only when the JD text actually says so.
 * Never inferred from frequency.
 */
export function skillLooksMandatory(description, skill) {
  const text = String(description || '');
  if (!text || !skill) return false;
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const near = new RegExp(
    `(?:${MANDATORY_NEAR.source})[\\s\\S]{0,120}${escaped}|${escaped}[\\s\\S]{0,40}(?:required|must|mandatory)`,
    'i'
  );
  return near.test(text);
}
