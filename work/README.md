# Pharmofolio

Pharmofolio is a pharmacist-development workspace for mapping evidence to the Singapore MOH Development Framework for Pharmacists (DFP) 2024 v2.0, reviewing assessments, and keeping coaching and development plans. AI results support development and are not formal assessments.

## Architecture

Sites serves the HTML, CSS and JavaScript frontend and a Cloudflare Worker. The Worker handles authenticated requests, stores records in D1 and files in R2, and calls the OpenAI Responses API. It keeps the OpenAI key server-side.

- `worker/index.js`: Sites entry point and structured DFP mapping inference.
- `worker/hosted-backend.js`: authenticated API, assessment and coaching flows.
- `worker/openai-client.js`: OpenAI transport and retry handling.
- `db/schema.ts` and `drizzle/`: D1 schema and migrations.
- `app.js`, `index.html`, `styles.css`: browser interface.

The mapping call generates activities, mappings, gaps and coaching suggestions in a single structured response. The Worker does not apply an automatic confidence or sensitivity review gate. Assessment values retain pharmacist and reporting-officer inputs separately from AI proposals.

Chat requests include the signed-in pharmacist’s assessment context, conversation, and current checked gaps. Selected gaps are also sent when generating a summary.

## Build and test

Install Node.js and dependencies with `npm install`, then run:

```sh
npm run test:hosted
node --test tests/openai-client.test.mjs tests/gap-domains.test.mjs
npm run build
```

The build creates `dist/` with the Worker, browser assets, D1 migrations and Sites manifest. Configure `OPENAI_API_KEY` as a Sites secret; `OPENAI_MODEL` and `DFP_MAPPING_PROMPT` are optional. See [SITES_DEPLOY.md](SITES_DEPLOY.md).
