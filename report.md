# CREATE project report: Pharmofolio (PharmPath)

> **Draft for team review.** Bracketed fields need information from the project team. Testing by approximately five team members has been reported, but the details and findings still need to be documented. Replace or remove all placeholders before submission. The reviewer notes after the four report sections are for preparation and can be removed from the final submission.

## 1. Project details

| Field | Details |
| --- | --- |
| Project title | Pharmofolio (the application interface is labelled PharmPath) |
| Intended users | TTSH pharmacist reportees and their reporting officers, using Singapore's Ministry of Health Development Framework for Pharmacists (DFP) to support performance assessment and professional development. |
| Team name | [Team name, or not applicable] |
| Report date | 9 November 2026 |
| Contact | [Name and email] |
| App link or source ZIP | [Accessible app URL and access instructions, or final source ZIP filename and setup instructions] |
| Video | [Link or filename for a video of no more than three minutes] |

**Problem and solution.** As TTSH adopts the DFP for pharmacist performance assessment, reportees and reporting officers need to learn how projects and contributions relate to its competency standards and use that evidence in development discussions. Pharmofolio uses a large language model (LLM) to propose evidence-to-framework mappings and provide a coaching assistant; reportees review the suggestions, while reporting officers are expected to review the assessment, provide advice and work with reportees on development actions. AI suggestions support human judgement and are not themselves a formal assessment. This need is the project's rationale; its scale and educational impact have not yet been measured.

**Coaching visibility.** Authorised reporting officers and division viewers can view coaching conversation history in the current prototype. The app provides tools for officer review and advice, but does not automatically require an officer to complete every step.

## 2. Implementation and next steps

| Field | Brief entry |
| --- | --- |
| **Stage** | Prototype tested with intended users; development is continuing. A complete live journey was not independently verified during the repository review. |
| **Testing or use** | Approximately five intended users, who were hackathon participants and project team members, tried the app using simulated contributions based on previous years' work. Testing date and whether use was one-off or repeated: [add if known]. Findings and changes: [add when available]. Three Node test files also completed in a local run with mocked services; these checks do not establish mapping accuracy or learning outcomes. |
| **Resources** | Development time: [estimate if readily known, otherwise unknown]. Sponsored credits used: [amount and currency, or unknown]. Personal or departmental spending: [amount and currency, or unknown]. |
| **Next step** | Conduct a facilitated session with pharmacist reportees and reporting officers using a shared fictional contribution. Ask reportees to explain a DFP mapping and propose a development action, then have officers review both; compare responses with and without the app using an agreed rubric, record usability difficulties and check AI suggestions against the source. Support needed: participants' time, a suitable rubric and a safe demonstration environment. |

### Longer-term production consideration

If the evaluation supports further use and TTSH decides to scale the application, assess a more robust production architecture with its IT, information security and governance teams. One option is **Next.js** for the frontend, using server-side actions where appropriate and carefully scoped caching; another component to assess is **Convex** for backend functions, data storage and integration with an approved authentication provider. These are options for evaluation, not a committed migration or a claim that the current prototype uses them. Compare them with hardening the existing Cloudflare-based deployment, taking account of institutional requirements, operating costs, maintainability and migration effort. See the official [Next.js production guidance](https://nextjs.org/docs/app/guides/production-checklist) and [Convex authentication guidance](https://docs.convex.dev/auth/overview).

Before production, define and test access by reportees, reporting officers and authorised division viewers; clarify who can see coaching conversations; and agree requirements for data residency, retention, backups, audit logs, incident response and institutional identity integration. Apply authorisation checks to every relevant backend operation and avoid shared caching of sensitive, user-specific records. Validate AI mappings against the framework and source evidence, retain human review, and monitor performance and costs as use grows. These measures require organisational review and implementation regardless of the technology chosen.

## 3. Reflection

**1. Educational design.** The learning goal is for reportees and reporting officers to apply the new DFP to real work: explain how a contribution relates to a standard, recognise an evidence or development gap, and agree a practical next action. The app presents an AI-proposed mapping with an evidence excerpt and rationale, then asks the reportee for a confidence rating and written response. The reporting officer can review the assessment separately, add advice and record development actions. A coaching assistant helps the reportee explore selected gaps and prepare for that discussion; it supports rather than replaces the officer's mentoring and judgement.

**2. Development and judgement.** [Describe one actual AI-generated output the team checked, rejected or changed; state what changed and why. For example, if true, identify a specific incorrect mapping or generated implementation and how you verified and corrected it.] The current design retains AI suggestions separately from pharmacist and reporting-officer responses; that feature alone does not prove how the team judged AI-generated development work.

**3. Evidence and limitations.** About five intended users from the project team tried the app with simulated contributions from previous years. Their testing shows that the prototype has been tried, but a specific finding, any resulting change and its effect on learning have not yet been documented. Local automated tests use mocked services; they do not establish mapping accuracy. The hosted mapper asks for evidence excerpts but has no automatic review gate for uncertain or sensitive outputs. A key uncertainty is whether users can identify unsupported suggestions and agree useful development actions. [Add a specific observed finding and change when available.]

**4. Learning from others.** [Name a teammate, peer or facilitator; describe one specific insight and how it changed the project. If no such learning occurred, state “None to report.”]

**5. Enablers and barriers.** The DFP gives the team a common structure for designing a realistic development task. A barrier to judging educational benefit is that testing findings and learning outcomes have not yet been provided for this report; the proposed facilitated session would help address that uncertainty. [Replace or supplement with the team's actual most significant post-CREATE enabler or barrier and its effect on the work.]

## 4. Contributor roles

List every actual contributor, including all CREATE participants involved. Name, affiliation and substantive contribution must be accurate and approved by each person.

- **[Name] — [affiliation]:** [Domain expert contribution, such as defining the pharmacist learning need or reviewing framework mappings; specify what they actually did.]
- **[Name] — [affiliation]:** [Developer contribution, such as implementing and testing the evidence-to-assessment workflow; specify what they actually did.]
- **[Additional name] — [affiliation]:** [Actual contribution, if applicable.]

---

## Reviewer notes — remove before submission

These notes are a critical repository assessment, not evidence of a user study or a prediction of judges' scores. The rubric awards 90 points for project quality and reflection, plus 10 points only when at least two named people made substantive contributions.

| Rubric criterion | Current evidence and what would strengthen the submission |
| --- | --- |
| **Educational problem — 20** | A specific framework-based task is identifiable. Add one genuine observation, example or piece of user feedback showing why pharmacists find the evidence-to-development step difficult; avoid presenting an assumption as a finding. |
| **Pedagogical design — 30** | The code connects evidence review, a written learner judgement, proposed gaps and a next action. In the video, show one actual excerpt, the AI rationale, the pharmacist's own response and the resulting plan; explain how that sequence supports the learning goal. |
| **Functionality — 10** | The application contains the workflow and automated checks pass locally with mocks. Demonstrate the complete journey in the actual judging environment, including the model response and saved next step; a passing mocked test is not an end-to-end demonstration. |
| **Usability — 10** | Navigation, labels, status messages and a guided sequence are present in the interface. About five intended users on the project team tried the app, but no findings or independent usability evidence were supplied. Check that an intended user can complete the task without verbal direction, and show the instructions and feedback in the recording. |
| **Addresses the educational problem — 10** | Framework-linked evidence, rationale and gap suggestions are a plausible fit. Show a realistic, fictional example in which the suggestion is checked against its source and changes the learner's own response or plan; do not claim measured improvement without evidence. |
| **Reflection and next steps — 10** | The report proposes a feasible comparison and acknowledges uncertainty. Replace the placeholders with an actual AI judgement, a specific lesson from another person and a real enabler or barrier; include a testing finding and resulting change if one exists. |
| **Team collaboration — 10** | Domain expertise and development roles were described in the request, but names, affiliations and individual contributions were not supplied. Document at least two substantive, truthful contributions if applicable; roles alone do not establish peer learning. |

**Technical and demonstration limitations.** The hosted mapping path validates the response structure but does not independently verify that model-generated standards, excerpts or gaps are correct, and it has no automatic confidence or sensitivity review gate. The analysis approval checkbox is enforced in the browser, while the mapping endpoint accepts the request payload; review consent enforcement and source traceability before using real records. The repository includes seeded accounts and credential-verifier data. The interface calls coaching private even though authorised reporting officers and division viewers can view conversation histories; align that language with the intended privacy policy. Use fictional data, verify access controls and replace or remove demo credentials before any broader use. A model-generated confidence percentage is not proof of competency or a calibrated probability.

**Packaging and access.** The current README describes a Sites-hosted Cloudflare Worker, D1 database, R2 storage and an OpenAI API key; access and service costs must be disclosed. The existing archive in `outputs/` is labelled as a backup and has not been verified as a current submission ZIP. The standard README uses npm, which was unavailable in this review environment; the three test files were run directly with Node. This repository review did not independently verify the live API, hosted deployment, browser journey, package contents or learner evaluation. Prepare and test the final app link or source ZIP separately, excluding secrets, real personal data and installed dependencies.

**Submission checklist.** Complete the bracketed fields; verify every factual and reflective statement with the team; obtain contributors' approval; make the app and access instructions work for judges; record a fictional, complete user journey in at most three minutes; and include the report, video and app source or app-link instructions in one ZIP. The guide states the deadline is **7 January 2027, 23:59 Singapore time**, with upload at https://highway.gov.sg/public/B7hfsAKxpdid6DoY.

**Sources reviewed.** CREATE Participant Rubric and Submission Guide; CREATE Project Submission; the repository's `work/README.md`, `work/index.html`, `work/app.js`, `work/worker/`, `work/prompts/dfp_mapping.md` and test files; and the locally supplied DFP framework material. The code describes intended implementation and does not itself verify real-world impact.
