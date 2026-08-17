import { pass, fail } from './helpers.mjs';
import { classifyListingUrl, hasJobPostingPath, isCareerHubUrl, isCredibleListingUrl, isJunkListingHost, isUnresolvedAggregatorUrl, sameSite } from '../lib/saas/listing-url.mjs';
import { heuristicPageKind } from '../lib/saas/ai/page-kind.mjs';

console.log('\nlisting-url — only real job posting URLs');

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

check('Greenhouse job URL is credible', isCredibleListingUrl('https://boards.greenhouse.io/stripe/jobs/12345'), true);
check('Lever job URL is credible', isCredibleListingUrl('https://jobs.lever.co/openai/abcd-efgh'), true);
check('Rozee job URL is credible', isCredibleListingUrl('https://www.rozee.pk/job/software-intern-lahore'), true);
check('Indeed viewjob is credible', isCredibleListingUrl('https://pk.indeed.com/viewjob?jk=abc123'), true);
check('LinkedIn job view is credible', isCredibleListingUrl('https://www.linkedin.com/jobs/view/123456'), true);
check('Employer posting path is credible', isCredibleListingUrl('https://careers.example.com/jobs/software-intern-lahore'), true);

check('CrazyGames is junk', isJunkListingHost('https://www.crazygames.com/game/international-soccer'), true);
check('Gaming site is not a listing', isCredibleListingUrl('https://www.crazygames.com/game/job-simulator'), false);
check('International hub is not intern posting', hasJobPostingPath('https://zymo.com/about/international'), false);
check('Off-site gaming link from careers page is rejected', isCredibleListingUrl('https://www.miniclip.com/games', { careersUrl: 'https://careers.amazon.com' }), false);
check('Same-site job from careers page is kept', isCredibleListingUrl('https://careers.amazon.com/jobs/123-software-dev-intern', { careersUrl: 'https://careers.amazon.com' }), true);
check('ATS link from careers page is kept', isCredibleListingUrl('https://boards.greenhouse.io/acme/jobs/99', { careersUrl: 'https://acme.com/careers' }), true);

check('Adzuna land URL is unresolved', isUnresolvedAggregatorUrl('https://www.adzuna.co.uk/land/ad/123?utm=api'), true);
check('Adzuna land listing is displayable', classifyListingUrl('https://www.adzuna.com/land/ad/999').ok, true);
check('Adzuna details listing is displayable', isCredibleListingUrl('https://www.adzuna.ca/details/5841513477'), true);
check('Indeed click-tracking is not displayable', isCredibleListingUrl('https://www.indeed.com/rc/clk?jk=abc'), false);
check('Careers hub is not a posting', isCredibleListingUrl('https://careers.google.com/jobs'), false);
check('Samsung careers home is a hub', isCareerHubUrl('https://www.samsung.com/us/careers'), true);
check('Samsung careers home is not displayable', isCredibleListingUrl('https://www.samsung.com/us/careers'), false);
check('Workday tenant board is a hub', isCareerHubUrl('https://sec.wd3.myworkdayjobs.com/en-US/Samsung_Careers'), true);
check('Workday job posting is credible', isCredibleListingUrl('https://sec.wd3.myworkdayjobs.com/en-US/Samsung_Careers/job/Austin/Software-Intern_R12345'), true);
check('Jazz work-with-jazz hub is not a posting', isCredibleListingUrl('https://jobs.jazz.com.pk/work-with-jazz'), false);
check('Jazz job URL is credible', isCredibleListingUrl('https://jobs.jazz.com.pk/job/cybersecurity-intern-islamabad'), true);
check('Nayatel vacancy URL is credible', isCredibleListingUrl('https://careers.nayatel.com/vacancy/software-intern'), true);
check('Meezan careers home is a hub', isCareerHubUrl('https://www.meezanbank.com/careers/'), true);
check('Greenhouse board without job id is a hub', isCareerHubUrl('https://boards.greenhouse.io/careem'), true);
check('Bing search is not a posting', isCredibleListingUrl('https://www.bing.com/search?q=intern'), false);
check('Facebook is not a posting', isCredibleListingUrl('https://facebook.com/acme/jobs/intern'), false);
check('sameSite matches careers subdomain', sameSite('https://jobs.stripe.com/intern', 'https://stripe.com/careers'), true);
check('sameSite rejects unrelated host', sameSite('https://games.example.net/x', 'https://careers.amazon.com'), false);
check('Bain internships-programs is a hub', isCareerHubUrl('https://www.bain.com/careers/work-with-us/internships-programs/'), true);
check('AMD student-programs is a hub', isCareerHubUrl('https://www.amd.com/en/corporate/careers/student-programs.html'), true);
check('Databricks university-recruiting is a hub', isCareerHubUrl('https://www.databricks.com/company/careers/university-recruiting'), true);
check('xlsx dividend file is not a posting URL', isCredibleListingUrl('https://www.nbp.com.pk/CAREER/Final-List.xlsx'), false);
check('VentureDive intern apply URL is credible', isCredibleListingUrl('https://venturedive.applytojob.com/apply/LCa0jtbJoA/IT-Network-Support-Intern'), true);
check('page-kind marks Samsung careers as hub', heuristicPageKind('https://www.samsung.com/us/careers'), 'career_hub');
check('page-kind marks Greenhouse job as direct apply', heuristicPageKind('https://boards.greenhouse.io/stripe/jobs/12345'), 'direct_apply');
