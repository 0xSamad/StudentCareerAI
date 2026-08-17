import { test } from "node:test";
import assert from "node:assert/strict";
import { guessListingFromUrl, listingUrlFromApplyUrl, normalizeApplyUrl } from "../../src/lib/apply/url-listing.mjs";

test("normalizeApplyUrl adds https and rejects junk", () => {
  assert.equal(normalizeApplyUrl("https://jobs.lever.co/acme/eng"), "https://jobs.lever.co/acme/eng");
  assert.match(normalizeApplyUrl("boards.greenhouse.io/acme/jobs/1"), /^https:\/\/boards\.greenhouse\.io\//);
  assert.equal(normalizeApplyUrl(""), "");
  assert.equal(normalizeApplyUrl("not a url %%"), "");
  assert.equal(normalizeApplyUrl("ftp://example.com/job"), "");
});

test("guessListingFromUrl reads Greenhouse / Lever / Ashby / Workday", () => {
  assert.deepEqual(guessListingFromUrl("https://boards.greenhouse.io/stripe/jobs/12345"), {
    company: "Stripe",
    role: "",
  });
  assert.deepEqual(guessListingFromUrl("https://boards.greenhouse.io/acme/jobs/software-engineer"), {
    company: "Acme",
    role: "Software Engineer",
  });
  assert.equal(guessListingFromUrl("https://jobs.lever.co/notion/backend-intern").company, "Notion");
  assert.match(guessListingFromUrl("https://jobs.lever.co/notion/backend-intern").role, /Backend Intern/i);
  assert.equal(guessListingFromUrl("https://jobs.ashbyhq.com/linear/eng-intern").company, "Linear");
  const wd = guessListingFromUrl("https://acme.wd1.myworkdayjobs.com/en-US/External/job/Software-Engineer_R-100");
  assert.equal(wd.company, "Acme");
  assert.match(wd.role, /Software Engineer/i);
});

test("guessListingFromUrl falls back to host brand", () => {
  const g = guessListingFromUrl("https://careers.ibm.com/job/123/cybersecurity-intern");
  assert.equal(g.company, "Ibm");
  assert.match(g.role, /Cybersecurity Intern/i);
});

test("listingUrlFromApplyUrl strips a trailing /apply", () => {
  assert.equal(
    listingUrlFromApplyUrl("https://techemulsion.com/careers/software-engineer/apply"),
    "https://techemulsion.com/careers/software-engineer",
  );
  assert.equal(listingUrlFromApplyUrl("https://techemulsion.com/careers/software-engineer"), "");
});
