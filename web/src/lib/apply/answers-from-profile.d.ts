export function identityFromCv(cvText?: string): {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  city: string;
  country: string;
};

export function mergeIdentity(
  profile: { identity?: Record<string, string | undefined> } | null | undefined,
  cvText?: string,
): {
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  gender?: string;
};

export function latestEmployment(
  profile: unknown,
  cvText?: string,
): { employer: string; title: string };

export function phoneNationalNumber(phone: string, dial?: string): string;
export function skillsFromProfile(profile: unknown, cvText?: string): string;
export function experienceYearsFromCv(cvText?: string, profile?: unknown): string;
export function graduationYearFrom(profile: unknown, cvText?: string): string;
export function advertisedSalaryFromJd(jdText?: string): string;

export function workedAtCompany(company: string, profile: unknown, cvText?: string): boolean | null;

export function answersFromProfile(
  fields: Array<{
    id: string;
    type?: string;
    label?: string;
    nativeName?: string;
    nativeId?: string;
    placeholder?: string;
    options?: string[];
    maxLength?: number;
  }>,
  profile: unknown,
  extras?: {
    cvText?: string;
    company?: string;
    coverLetter?: string;
    jdText?: string;
    fillRemaining?: boolean;
    attemptedAiChallenge?: boolean;
    survey?: {
      howHeardNeedles?: string[];
      seenSocial?: string;
      influenceNeedles?: string[];
    };
  },
): Record<string, string>;

export function candidateFacts(
  profile: unknown,
  cvText?: string,
): {
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  employer: string;
  title: string;
  location: string;
  preferredLocation: string;
  skills: string;
  experienceYears: string;
  yearOfGraduation: string;
  phoneNational: string;
  noticePeriod: string;
  gender: string;
  currentSalary: string;
  expectedSalary: string;
};
