export const JOB_CATEGORIES = [
  "Backend",
  "Frontend",
  "Fullstack",
  "DevOps",
  "Data/AI",
  "Machine Learning",
  "QA",
  "Cyber",
  "Mobile",
  "Embedded",
  "Product",
  "UX/Design",
  "Software Architect",
  "R&D Management",
  "IT",
  "Hardware",
  "Mechanical Engineering",
  "Project Management",
  "Data Analyst",
  "Sales",
  "Marketing",
  "HR",
  "Finance",
  "Customer Success",
  "Legal",
  "Student Jobs",
  "Freelance",
  "Electrical Engineering",
  "Robotics",
  "Security Research",
  "Solution Engineering",
  "Content Writing",
  "Operations",
  "Executive Roles",
] as const

export type JobCategory = (typeof JOB_CATEGORIES)[number]

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Backend: [
    "backend", "java", "python", "node", "nodejs",
    ".net", "c#", "ruby", "php", "golang", "go",
    "spring", "django", "fastapi", "server", "api developer",
    "מפתח בקאנד", "מפתח שרת", "back-end",
  ],
  Frontend: [
    "frontend", "react", "vue", "angular", "javascript",
    "typescript", "next.js", "nextjs", "html", "css",
    "ui developer", "מפתח פרונטאנד", "web developer",
    "front-end",
  ],
  Fullstack: [
    "fullstack", "full stack", "full-stack",
    "מפתח פולסטאק", "מפתח תוכנה", "software developer",
    "software engineer",
  ],
  DevOps: [
    "devops", "dev ops", "cloud", "aws", "azure", "gcp",
    "kubernetes", "k8s", "docker", "ci/cd", "platform engineer",
    "site reliability", "sre", "infrastructure", "devsecops",
  ],
  "Data/AI": [
    "data scientist", "data engineer", "machine learning",
    "ml engineer", "ai engineer", "deep learning", "nlp",
    "computer vision", "מדען נתונים", "מהנדס נתונים",
    "artificial intelligence", "llm", "generative ai",
  ],
  "Machine Learning": [
    "machine learning", "ml", "deep learning", "neural network",
    "pytorch", "tensorflow", "mlops", "data science",
    "research scientist", "ai researcher",
  ],
  QA: [
    "qa", "quality assurance", "tester", "automation engineer",
    "sdet", "בודק תוכנה", "בקרת איכות", "test engineer",
    "quality engineer", "manual tester",
  ],
  Cyber: [
    "cyber", "security", "penetration tester", "pen test",
    "soc analyst", "information security", "infosec",
    "אבטחת מידע", "cybersecurity", "vulnerability",
    "threat intelligence", "malware",
  ],
  Mobile: [
    "mobile", "ios", "android", "swift", "kotlin",
    "react native", "flutter", "מפתח מובייל",
    "mobile developer", "app developer",
  ],
  Embedded: [
    "embedded", "firmware", "rtos", "c programmer",
    "fpga", "מפתח מוטמע", "תוכנה משובצת",
    "embedded software", "embedded linux", "bare metal",
  ],
  Product: [
    "product manager", "pm", "product owner",
    "מנהל מוצר", "product lead", "head of product",
    "group product manager", "senior product manager",
  ],
  "UX/Design": [
    "ux", "ui", "product designer", "figma",
    "user experience", "interaction designer",
    "מעצב מוצר", "graphic designer", "visual designer",
  ],
  "Software Architect": [
    "architect", "software architect", "solutions architect",
    "technical lead", "chief architect", "מארכיטקט",
    "principal engineer", "distinguished engineer",
  ],
  "R&D Management": [
    "r&d manager", "engineering manager", "vp engineering",
    "cto", "team lead", "ראש צוות", "מנהל פיתוח",
    "head of engineering", "director of engineering",
    "group manager",
  ],
  IT: [
    "it", "system administrator", "sysadmin", "helpdesk",
    "network engineer", "it support", "מנהל מערכות",
    "infrastructure", "it manager", "systems engineer",
  ],
  Hardware: [
    "hardware engineer", "pcb", "vlsi", "fpga",
    "electrical engineer", "מהנדס חומרה",
    "chip design", "asic", "rtl",
  ],
  "Mechanical Engineering": [
    "mechanical engineer", "מהנדס מכונות",
    "mechanical design", "cad", "solidworks",
    "product engineering", "manufacturing engineer",
  ],
  "Project Management": [
    "project manager", "program manager", "pmo",
    "scrum master", "agile coach", "מנהל פרויקטים",
    "delivery manager", "technical project manager",
  ],
  "Data Analyst": [
    "data analyst", "business analyst", "bi analyst",
    "power bi", "tableau", "sql analyst", "analytics",
    "business intelligence", "מנתח נתונים",
  ],
  Sales: [
    "sales", "account executive", "business development",
    "מנהל מכירות", "bdr", "sdr", "sales engineer",
    "account manager", "sales representative",
  ],
  Marketing: [
    "marketing", "growth", "seo", "sem", "content",
    "brand manager", "מנהל שיווק", "digital marketing",
    "performance marketing", "growth hacker",
  ],
  HR: [
    "hr", "human resources", "recruiter", "talent acquisition",
    "מגייס", "משאבי אנוש", "people operations",
    "hr business partner", "hrbp",
  ],
  Finance: [
    "finance", "accountant", "controller", "cfo",
    "חשבונאות", "כלכלן", "financial analyst",
    "fp&a", "treasury",
  ],
  "Customer Success": [
    "customer success", "csm", "account manager",
    "customer support", "שירות לקוחות",
    "customer experience", "cx", "support engineer",
  ],
  Legal: [
    "legal", "lawyer", "attorney", "counsel",
    "עורך דין", "paralegal", "legal counsel",
    "corporate lawyer", "ip lawyer",
  ],
  "Student Jobs": [
    "student", "intern", "internship", "entry level",
    "סטודנט", "התמחות", "junior", "graduate",
    "trainee", "associate",
  ],
  Freelance: [
    "freelance", "contractor", "consultant", "independent",
    "עצמאי", "פרילנס",
  ],
  "Electrical Engineering": [
    "electrical engineer", "מהנדס חשמל", "power electronics",
    "signal processing", "embedded systems", "pcb design",
  ],
  Robotics: [
    "robotics", "robot", "ros", "autonomous", "automation",
    "mechatronics", "רובוטיקה",
  ],
  "Security Research": [
    "security researcher", "vulnerability researcher",
    "exploit developer", "reverse engineer",
    "malware analyst", "threat researcher",
  ],
  "Solution Engineering": [
    "solution engineer", "solutions engineer",
    "pre-sales engineer", "technical account manager",
    "sales engineer", "integration engineer",
  ],
  "Content Writing": [
    "content writer", "copywriter", "technical writer",
    "content manager", "editor", "content creator",
  ],
  Operations: [
    "operations", "ops manager", "business operations",
    "revenue operations", "revops", "growth operations",
  ],
  "Executive Roles": [
    "ceo", "cto", "coo", "cfo", "vp", "director",
    "head of", "chief", "executive", "president",
    "managing director",
  ],
}

export const LOCATIONS = [
  {
    value: "center",
    label: "Center",
    keywords: [
      "tel aviv", "tel aviv-yafo", "תל אביב", "ramat gan",
      "petah tikva", "rishon lezion", "bat yam", "holon",
      "bnei brak", "givatayim", "jaffa", "bat-yam",
    ],
  },
  {
    value: "gush_dan",
    label: "Gush Dan",
    keywords: [
      "tel aviv", "herzliya", "raanana", "ra'anana",
      "kfar saba", "netanya", "hod hasharon", "petah tikva",
      "rishon lezion", "rehovot", "lod", "ramla",
    ],
  },
  {
    value: "north",
    label: "North",
    keywords: [
      "haifa", "nazareth", "acre", "tiberias", "nahariya",
      "afula", "karmiel", "yokneam", "caesarea", "kiryat",
      "upper galilee", "lower galilee",
    ],
  },
  {
    value: "south",
    label: "South",
    keywords: [
      "beer sheva", "ashdod", "ashkelon", "eilat",
      "dimona", "beersheba", "negev", "kiryat gat",
    ],
  },
  {
    value: "jerusalem",
    label: "Jerusalem Area",
    keywords: [
      "jerusalem", "ירושלים", "modiin", "modi'in",
      "beit shemesh", "mevasseret",
    ],
  },
  {
    value: "sharon",
    label: "HaSharon",
    keywords: [
      "raanana", "ra'anana", "herzliya", "netanya",
      "hod hasharon", "kfar saba", "even yehuda",
      "tel mond", "kadima",
    ],
  },
  {
    value: "haifa",
    label: "Haifa Area",
    keywords: [
      "haifa", "tirat carmel", "nesher", "yokneam",
      "kiryat ata", "kiryat bialik", "kiryat motzkin",
      "kiryat yam", "acre", "nahariya",
    ],
  },
  {
    value: "remote",
    label: "Remote",
    keywords: [
      "remote", "מרחוק", "work from home", "wfh",
      "distributed", "fully remote",
    ],
  },
]

export const SENIORITY_LEVELS = [
  {
    value: "student",
    label: "Student / Intern",
    keywords: ["intern", "internship", "student", "סטודנט", "התמחות"],
  },
  {
    value: "entry",
    label: "Entry Level",
    keywords: ["entry", "entry level", "0-1", "no experience"],
  },
  {
    value: "junior",
    label: "Junior",
    keywords: ["junior", "jr", "1-3 years", "1-2 years"],
  },
  {
    value: "mid",
    label: "Mid Level",
    keywords: ["mid", "medior", "intermediate", "3-5 years"],
  },
  {
    value: "senior",
    label: "Senior",
    keywords: ["senior", "sr", "5+ years", "experienced"],
  },
  {
    value: "lead",
    label: "Team Lead / Staff",
    keywords: ["lead", "staff", "tech lead", "team lead", "ראש צוות"],
  },
  {
    value: "director",
    label: "Director+",
    keywords: ["director", "vp", "head of", "cto", "executive", "principal", "architect"],
  },
]
