/**
 * Learning units per skill. Topics/resources switch on student status.
 * Never used as a canned 2-month vs 6-month roadmap — the scheduler picks units.
 */

export const LEARNING_PREREQS = {
  Pandas: ['Python'],
  NumPy: ['Python'],
  'scikit-learn': ['Python', 'Pandas'],
  Statistics: [],
  PyTorch: ['Python', 'scikit-learn'],
  TensorFlow: ['Python', 'scikit-learn'],
  Keras: ['Python'],
  FastAPI: ['Python'],
  Docker: [],
  Kubernetes: ['Docker'],
  MLOps: ['Docker', 'PyTorch'],
  MLflow: ['Python'],
  SQL: [],
  PostgreSQL: ['SQL'],
  NLP: ['Python'],
  LLMs: ['Python'],
  RAG: ['Python', 'LLMs'],
  AWS: [],
  Git: [],
  Linux: [],
  Networking: ['Linux'],
  'Security Fundamentals': [],
  SIEM: ['Networking'],
  Nmap: ['Networking'],
  'Burp Suite': ['Web Security'],
  OWASP: ['Web Security'],
  'Incident Response': ['Security Fundamentals'],
  'Penetration Testing': ['Networking', 'Linux'],
  'Web Security': ['Networking'],
};

export function hoursBand(status) {
  if (status === 'ALREADY HAVE') return { min: 3, max: 5 };
  if (status === 'PARTIAL') return { min: 6, max: 10 };
  return { min: 8, max: 14 };
}

const UNITS = {
  Python: {
    beginnerTopics: ['Types and functions', 'Virtualenv / venv', 'List/dict comprehensions', 'Reading CSV/JSON'],
    advancedTopics: ['Packaging a small library', 'pytest basics', 'Type hints', 'Industry data-cleaning patterns'],
    practiceBeginner: '15 Python exercises (functions, files, dicts).',
    practiceAdvanced: 'Refactor one existing script into a tested module; no beginner syntax drills.',
    interview: ['Python data model', 'Complexity of common operations', 'Debugging a pandas pipeline'],
    resources: [
      { title: 'Python official tutorial', url: 'https://docs.python.org/3/tutorial/', why: 'Canonical language reference — not a bootcamp recap.' },
      { title: 'Real Python — professional setup', url: 'https://realpython.com/python-application-layouts/', why: 'Matches how intern codebases are structured.' },
    ],
  },
  SQL: {
    beginnerTopics: ['SELECT/WHERE', 'JOINs', 'GROUP BY', 'aggregates'],
    advancedTopics: ['Subqueries', 'Window functions', 'EXPLAIN basics', 'Indexes at a glance'],
    practiceBeginner: '20 SQL problems (joins + group by).',
    practiceAdvanced: '15 problems including window functions; write 3 queries against a real CSV loaded into SQLite.',
    interview: ['JOIN types', 'GROUP BY vs window', 'How you would debug a slow query'],
    resources: [
      { title: 'SQLite documentation — Query Language', url: 'https://www.sqlite.org/lang.html', why: 'You can practice locally with zero setup.' },
      { title: 'Mode SQL tutorial', url: 'https://mode.com/sql-tutorial/', why: 'Short, intern-interview oriented examples.' },
    ],
  },
  Pandas: {
    beginnerTopics: ['DataFrame/Series', 'read_csv', 'groupby', 'missing values'],
    advancedTopics: ['merge/join', 'datetime indexes', 'leakage-aware splits', 'tidy outputs for models'],
    practiceBeginner: 'Load a public CSV and produce 5 summary tables.',
    practiceAdvanced: 'Build a reproducible cleaning notebook with an explicit train/test split.',
    interview: ['groupby vs SQL GROUP BY', 'Handling leakage', 'Why copy vs view matters'],
    resources: [
      { title: 'pandas User Guide', url: 'https://pandas.pydata.org/docs/user_guide/index.html', why: 'Official API — internships expect the real library, not a cheat sheet only.' },
    ],
  },
  NumPy: {
    beginnerTopics: ['ndarray', 'broadcasting', 'vectorization'],
    advancedTopics: ['Random seeds', 'Numeric stability', 'When to stay in NumPy vs pandas'],
    practiceBeginner: '10 vectorized replacements for Python loops.',
    practiceAdvanced: 'Implement train/val split and standardization without pandas.',
    interview: ['Broadcasting rules', 'Why vectorize'],
    resources: [{ title: 'NumPy quickstart', url: 'https://numpy.org/doc/stable/user/quickstart.html', why: 'Official, short, sufficient for intern ML work.' }],
  },
  'scikit-learn': {
    beginnerTopics: ['Pipeline', 'train_test_split', 'Logistic regression', 'metrics'],
    advancedTopics: ['ColumnTransformer', 'calibration', 'precision/recall/F1', 'cross-validation without leakage'],
    practiceBeginner: 'Fit one baseline classifier and report accuracy + F1.',
    practiceAdvanced: 'Compare 2 models in a Pipeline; document why the metric matches the problem.',
    interview: ['Leakage', 'Why Pipeline', 'Precision vs recall'],
    resources: [
      { title: 'scikit-learn User Guide', url: 'https://scikit-learn.org/stable/user_guide.html', why: 'The library internships actually import.' },
    ],
  },
  Statistics: {
    beginnerTopics: ['Mean/variance', 'Distributions at a glance', 'Train/test vs population'],
    advancedTopics: ['Bias-variance', 'Confidence intervals intuition', 'Hypothesis tests you might be asked'],
    practiceBeginner: 'Compute summary stats on one dataset and write 5 sentences interpreting them.',
    practiceAdvanced: 'Explain one A/B-style question and one classification metric choice in writing.',
    interview: ['p-value in one sentence', 'Why F1 not accuracy', 'Overfitting'],
    resources: [
      { title: 'Khan Academy — Probability and statistics (select units)', url: 'https://www.khanacademy.org/math/statistics-probability', why: 'Free, skip units you already have from coursework.' },
    ],
  },
  PyTorch: {
    beginnerTopics: ['Tensors', 'autograd', 'nn.Module', 'DataLoader'],
    advancedTopics: ['Train/eval modes', 'Saving checkpoints', 'A small CNN or MLP on a real dataset', 'GPU optional'],
    practiceBeginner: 'Train a tiny MLP on a tabular or MNIST-scale set; log loss.',
    practiceAdvanced: 'Train, evaluate precision/recall/F1, save a checkpoint, write a 1-page experiment note.',
    interview: ['Forward vs backward', 'Why zero_grad', 'Overfitting a net'],
    resources: [
      { title: 'PyTorch official 60-min blitz', url: 'https://pytorch.org/tutorials/beginner/deep_learning_60min_blitz.html', why: 'Written by the PyTorch team; internships name this stack in JDs.' },
      { title: 'PyTorch docs — nn.Module', url: 'https://pytorch.org/docs/stable/nn.html', why: 'You will read this when debugging.' },
    ],
  },
  TensorFlow: {
    beginnerTopics: ['Tensors', 'Keras Sequential', 'compile/fit'],
    advancedTopics: ['Callbacks', 'Saving models', 'tf.data at a glance'],
    practiceBeginner: 'Fit a Keras model on a small dataset.',
    practiceAdvanced: 'Save/load a model and report F1 on a held-out set.',
    interview: ['Sequential vs Functional', 'Overfitting'],
    resources: [{ title: 'TensorFlow Keras guide', url: 'https://www.tensorflow.org/guide/keras', why: 'Official; use only if the market sample actually asks for TensorFlow.' }],
  },
  Docker: {
    beginnerTopics: ['Images vs containers', 'Dockerfile', 'port mapping'],
    advancedTopics: ['Multi-stage optional', 'dockerignore', 'Running an API locally'],
    practiceBeginner: 'Containerize a Hello API.',
    practiceAdvanced: 'Containerize YOUR trained-model API and run it with one documented command.',
    interview: ['Image vs container', 'Why pin a base image'],
    resources: [
      { title: 'Docker Get Started', url: 'https://docs.docker.com/get-started/', why: 'Official workflow internships expect you to have touched.' },
    ],
  },
  FastAPI: {
    beginnerTopics: ['Path operations', 'Pydantic models', 'uvicorn'],
    advancedTopics: ['A /predict endpoint', 'Input validation', 'OpenAPI docs'],
    practiceBeginner: 'One GET and one POST endpoint with tests skipped if timeboxed.',
    practiceAdvanced: 'POST /predict that loads a saved model and returns JSON.',
    interview: ['Why validate input', 'How you would version a model'],
    resources: [{ title: 'FastAPI official tutorial', url: 'https://fastapi.tiangolo.com/tutorial/', why: 'The docs are the course.' }],
  },
  Git: {
    beginnerTopics: ['clone/add/commit/push', 'branch', '.gitignore'],
    advancedTopics: ['PR description', 'README that a recruiter can run'],
    practiceBeginner: 'Initialize a repo and make 5 meaningful commits.',
    practiceAdvanced: 'Write a README with setup, results, and limitations.',
    interview: ['What goes in a commit message', 'How you would revert'],
    resources: [{ title: 'Git official book — Getting Started', url: 'https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control', why: 'Short official intro; skip if Git is already attested.' }],
  },
  Kubernetes: {
    beginnerTopics: ['Pod vs Deployment vs Service'],
    advancedTopics: ['A local kind/minikube apply of the Dockerized API (optional)'],
    practiceBeginner: 'Explain the three objects in a README diagram.',
    practiceAdvanced: 'Only if Docker project exists — deploy the same API manifest.',
    interview: ['Why not start here before a model exists'],
    resources: [{ title: 'Kubernetes official concepts', url: 'https://kubernetes.io/docs/concepts/', why: 'Use only when the market sample actually lists Kubernetes.' }],
  },
  AWS: {
    beginnerTopics: ['IAM at a glance', 'S3', 'What EC2 is'],
    advancedTopics: ['Where a model artifact would live', 'Cost awareness'],
    practiceBeginner: 'Write a 1-page architecture of how you WOULD host the API (no paid account required).',
    practiceAdvanced: 'Optional: push an artifact description, not secrets.',
    interview: ['S3 vs EBS in one sentence'],
    resources: [{ title: 'AWS S3 user guide (intro)', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html', why: 'Official; do not buy courses unless the JD sample is cloud-heavy.' }],
  },
  MLOps: {
    beginnerTopics: ['What a model registry is', 'Reproducibility (seeds, versions)'],
    advancedTopics: ['Logging metrics', 'A frozen requirements.txt'],
    practiceBeginner: 'Pin dependency versions and log metrics to a file.',
    practiceAdvanced: 'Add a one-command reproduce.md to the project.',
    interview: ['How you would retrain', 'What you would monitor'],
    resources: [{ title: 'Made With ML — MLOps (overview)', url: 'https://madewithml.com/', why: 'Practical, skip chapters you do not need.' }],
  },
  'Machine Learning': {
    beginnerTopics: ['Supervised vs unsupervised', 'Train/test split', 'Overfitting', 'Precision/recall/F1'],
    advancedTopics: ['Leakage', 'Baselines before fancy models', 'Error analysis', 'When not to use deep learning'],
    practiceBeginner: 'Train one sklearn baseline and write why the metric matches the problem.',
    practiceAdvanced: 'Compare two models in a Pipeline and document one failure mode.',
    interview: ['Bias-variance in one minute', 'Why F1 not accuracy', 'A leakage example'],
    resources: [
      { title: 'scikit-learn User Guide — supervised learning', url: 'https://scikit-learn.org/stable/supervised_learning.html', why: 'This is what intern ML work looks like before PyTorch.' },
    ],
  },
  'Deep Learning': {
    beginnerTopics: ['Tensors', 'Loss + optimizer', 'Train vs eval', 'Overfitting a net'],
    advancedTopics: ['Transfer learning', 'Checkpoints', 'When a CNN/MLP is enough'],
    practiceBeginner: 'Train a tiny network and plot loss.',
    practiceAdvanced: 'Save a checkpoint and report F1 on a held-out set.',
    interview: ['Forward vs backward', 'Why zero_grad'],
    resources: [
      { title: 'PyTorch official 60-min blitz', url: 'https://pytorch.org/tutorials/beginner/deep_learning_60min_blitz.html', why: 'The intern-level deep-learning starting point.' },
    ],
  },
  NLP: {
    beginnerTopics: ['Tokenization', 'Bag-of-words vs embeddings'],
    advancedTopics: ['A small classifier on a text dataset'],
    practiceBeginner: 'Train a sklearn text baseline.',
    practiceAdvanced: 'Compare baseline vs a simple PyTorch encoder if PyTorch is in the plan.',
    interview: ['Train/test leakage in NLP'],
    resources: [{ title: 'Hugging Face course — chapter 1 (if transformers appear in JDs)', url: 'https://huggingface.co/learn/nlp-course', why: 'Official HF; include only when NLP/Transformers appear in the sample.' }],
  },
  LLMs: {
    beginnerTopics: ['Prompt vs weights', 'Hallucination'],
    advancedTopics: ['RAG sketch', 'Evaluation is not vibes'],
    practiceBeginner: 'Document 5 failure cases of a public LLM on a task you define.',
    practiceAdvanced: 'A tiny RAG notebook over YOUR project README — no fake benchmarks.',
    interview: ['When not to use an LLM'],
    resources: [{ title: 'Hugging Face LLM course (intro)', url: 'https://huggingface.co/learn', why: 'Use only if LLMs/RAG appear in analyzed postings.' }],
  },
  Communication: {
    beginnerTopics: ['STAR stories from YOUR projects'],
    advancedTopics: ['Explaining a metric to a non-ML manager'],
    practiceBeginner: 'Write 3 STAR bullets from attested work.',
    practiceAdvanced: 'Record one 3-minute project walkthrough outline.',
    interview: ['Tell me about a project', 'A disagreement'],
    resources: [{ title: 'STAR method (university career-centre style)', url: 'https://cdc.dasa.ncsu.edu/star-method/', why: 'Behavioral intern interviews almost always use this shape.' }],
  },
  Linux: {
    beginnerTopics: ['Filesystem', 'users/permissions', 'logs', 'ssh'],
    advancedTopics: ['systemd at a glance', 'tcpdump/ss', 'hardening a lab VM'],
    practiceBeginner: 'Use a Linux VM: create users, inspect logs, capture 10 commands you actually ran.',
    practiceAdvanced: 'Document a small hardening checklist you applied to YOUR lab.',
    interview: ['How you inspect logs', 'What you would do after a suspicious process'],
    resources: [{ title: 'Linux man pages / DigitalOcean Linux basics', url: 'https://www.digitalocean.com/community/tags/linux-basics', why: 'Official-style labs beat a slideshow.' }],
  },
  Networking: {
    beginnerTopics: ['OSI vs TCP/IP in one page', 'ports', 'DNS', 'HTTP vs HTTPS'],
    advancedTopics: ['Packet capture reading', 'subnetting you can explain'],
    practiceBeginner: 'Draw the path of a packet from your laptop to a website.',
    practiceAdvanced: 'Capture a lab session in Wireshark and explain 5 packets.',
    interview: ['What happens when you type a URL', 'TCP vs UDP'],
    resources: [{ title: 'Cloudflare Learning — Networking basics', url: 'https://www.cloudflare.com/learning/network-layer/what-is-a-computer-network/', why: 'Short, accurate, not a bootcamp recap.' }],
  },
  'Security Fundamentals': {
    beginnerTopics: ['CIA triad', 'authn vs authz', 'least privilege', 'patching'],
    advancedTopics: ['Threat vs vulnerability vs risk', 'a simple control mapping'],
    practiceBeginner: 'Write a 1-page threat model for a toy web app.',
    practiceAdvanced: 'Map 5 controls you would apply to that app and why.',
    interview: ['CIA triad with an example', 'A control you would add first'],
    resources: [{ title: 'NIST glossary (select terms)', url: 'https://csrc.nist.gov/glossary', why: 'Use the words employers use.' }],
  },
  SIEM: {
    beginnerTopics: ['What a log source is', 'what an alert is', 'false positives'],
    advancedTopics: ['A detection idea with a field list', 'an incident timeline'],
    practiceBeginner: 'Load a public log sample and write 3 questions you can answer from it.',
    practiceAdvanced: 'Write 3 detections and one false-positive note.',
    interview: ['How you triage an alert', 'What you escalate'],
    resources: [{ title: 'Splunk Search Tutorial (free)', url: 'https://docs.splunk.com/Documentation/Splunk/latest/SearchTutorial/Aboutthesearchtutorial', why: 'Hands-on SIEM thinking without inventing a product preference.' }],
  },
  Nmap: {
    beginnerTopics: ['Host discovery', 'port scan types', 'service detection'],
    advancedTopics: ['NSE at a glance', 'writing what you found, not a flag dump'],
    practiceBeginner: 'Scan a lab VM you own and save the command + output.',
    practiceAdvanced: 'Explain why you chose those flags and what you would scan next.',
    interview: ['SYN vs connect scan in one sentence', 'How you stay in scope'],
    resources: [{ title: 'Official Nmap reference', url: 'https://nmap.org/book/man.html', why: 'The man page is the course.' }],
  },
  'Burp Suite': {
    beginnerTopics: ['Proxy', 'repeater', 'what intercepting means'],
    advancedTopics: ['Mapping an app', 'one OWASP-class issue with evidence'],
    practiceBeginner: 'Proxy a lab app (Juice Shop/DVWA) and screenshot Repeater.',
    practiceAdvanced: 'Document one finding with repro steps.',
    interview: ['How you stay in scope', 'How you would retest a fix'],
    resources: [{ title: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', why: 'Free labs that match junior pentest ads.' }],
  },
  OWASP: {
    beginnerTopics: ['Top 10 as a thinking tool, not a memorization list'],
    advancedTopics: ['Pick 3 classes and show how you would test them in a lab'],
    practiceBeginner: 'Map Juice Shop findings to OWASP classes.',
    practiceAdvanced: 'Write remediation notes a developer could use.',
    interview: ['Injection vs XSS in one minute', 'How you prioritize'],
    resources: [{ title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/', why: 'The document employers name.' }],
  },
  'Incident Response': {
    beginnerTopics: ['Identify, contain, eradicate, recover', 'what a timeline is'],
    advancedTopics: ['A short incident note from a lab alert'],
    practiceBeginner: 'Write an incident timeline for a fictional (labeled) alert using a template.',
    practiceAdvanced: 'Do the same from logs you actually inspected.',
    interview: ['First 15 minutes of an incident', 'What you would not do'],
    resources: [{ title: 'NIST SP 800-61 (overview)', url: 'https://csrc.nist.gov/publications/detail/sp/800-61/rev-2/final', why: 'The process language SOC interviews use.' }],
  },
  'Penetration Testing': {
    beginnerTopics: ['Scope', 'recon', 'enumeration', 'report'],
    advancedTopics: ['One full lab finding with impact and evidence'],
    practiceBeginner: 'Write a rules-of-engagement paragraph for a lab you own.',
    practiceAdvanced: 'Complete one legal lab box and a 2-page report.',
    interview: ['How you handle out-of-scope data', 'How you would rate severity'],
    resources: [{ title: 'OWASP Testing Guide', url: 'https://owasp.org/www-project-web-security-testing-guide/', why: 'Methodology over tool lists.' }],
  },
  'Web Security': {
    beginnerTopics: ['HTTP', 'cookies/sessions', 'what XSS and injection look like'],
    advancedTopics: ['Auth flaws', 'how you would test with Burp in a lab'],
    practiceBeginner: 'Map a lab app and list 5 inputs you would test.',
    practiceAdvanced: 'One finding with evidence on a legal lab.',
    interview: ['Same-origin policy in one sentence'],
    resources: [{ title: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', why: 'Free labs.' }],
  },
  'Data Structures': {
    beginnerTopics: ['Arrays vs hash maps', 'stacks/queues', 'when to pick which'],
    advancedTopics: ['Walk through a function in YOUR project using Big-O', 'trees at a glance'],
    practiceBeginner: 'Solve 8 array/hash-map problems and commit the solutions.',
    practiceAdvanced: 'Rewrite one slow loop in YOUR API and note the complexity.',
    interview: ['Time vs space of a function you wrote', 'An edge case you would test'],
    resources: [{ title: 'Python collections docs', url: 'https://docs.python.org/3/library/collections.html', why: 'The structures internships actually import.' }],
  },
  'REST APIs': {
    beginnerTopics: ['GET vs POST', 'status codes', 'JSON request/response'],
    advancedTopics: ['Validation', 'idempotency at a glance', 'error payloads'],
    practiceBeginner: 'Write two endpoints and hit them with curl.',
    practiceAdvanced: 'Add validation and one automated test for a failure path.',
    interview: ['How you would design a POST endpoint', 'What you would log'],
    resources: [{ title: 'MDN HTTP overview', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview', why: 'Canonical HTTP vocabulary.' }],
  },
  JavaScript: {
    beginnerTopics: ['let/const', 'functions', 'arrays/objects', 'async/await at a glance'],
    advancedTopics: ['Modules', 'error handling', 'when you would pick TS'],
    practiceBeginner: 'Build a small script that fetches JSON and prints 3 fields.',
    practiceAdvanced: 'Add tests around one function in YOUR project.',
    interview: ['== vs ===', 'How you handle a rejected promise'],
    resources: [{ title: 'MDN JavaScript guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', why: 'Official language reference.' }],
  },
  OOP: {
    beginnerTopics: ['Class vs function', 'encapsulation', 'a constructor you would actually write'],
    advancedTopics: ['Where you put error handling', 'when not to add inheritance'],
    practiceBeginner: 'Model one real object from YOUR project as a class.',
    practiceAdvanced: 'Refactor a dump of functions into a small class with tests.',
    interview: ['A class you wrote and why', 'A time inheritance would have been a mistake'],
    resources: [{ title: 'Python classes tutorial', url: 'https://docs.python.org/3/tutorial/classes.html', why: 'Official, short, enough for intern interviews.' }],
  },
};

export function unitFor(skill) {
  return UNITS[skill] || {
    beginnerTopics: [`Core ${skill} concepts used in intern postings`],
    advancedTopics: [`Apply ${skill} on a small attested-style task`],
    practiceBeginner: `Complete a short official tutorial for ${skill}.`,
    practiceAdvanced: `Use ${skill} inside the current portfolio project.`,
    interview: [`How you used ${skill}`, `A limitation of ${skill}`],
    resources: [
      {
        title: `${skill} — official documentation (search)`,
        url: `https://devdocs.io/#q=${encodeURIComponent(skill)}`,
        why: 'No percentage was invented; this skill appeared in analyzed postings so the official docs are the default resource.',
      },
    ],
  };
}

export function topicsFor(skill, status) {
  const unit = unitFor(skill);
  if (status === 'ALREADY HAVE' || status === 'PARTIAL') return unit.advancedTopics;
  return unit.beginnerTopics;
}

export function practiceFor(skill, status) {
  const unit = unitFor(skill);
  if (status === 'ALREADY HAVE' || status === 'PARTIAL') return unit.practiceAdvanced;
  return unit.practiceBeginner;
}

export function resourcesFor(skill, limit = 2) {
  return (unitFor(skill).resources || []).slice(0, limit);
}

export function interviewFor(skill) {
  return unitFor(skill).interview || [];
}

export function prereqsFor(skill) {
  return LEARNING_PREREQS[skill] || [];
}
