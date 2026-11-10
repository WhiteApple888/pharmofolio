# Pharmfolio deployment

Sites serves the authenticated application with a Cloudflare Worker. `worker/index.js` routes requests and performs DFP mapping, `worker/hosted-backend.js` implements the D1/R2-backed API and coaching, and `worker/openai-client.js` calls the OpenAI Responses API. The API key is never sent to the browser.

The `/api/map` endpoint produces structured mappings, gaps and coaching in one model request. The results are developmental and non-final; the Worker does not apply an automatic confidence or sensitivity review gate. Chat requests include the pharmacist’s selected gaps as focus areas. Summaries use the selected gaps and conversation separately.

The hosting manifest binds `DB` to D1 and `FILES` to R2. Configure `OPENAI_API_KEY` as a Sites secret; optionally set `OPENAI_MODEL` and `DFP_MAPPING_PROMPT`. Run `npm run build` to build the Worker and use the Sites workflow to publish. Check `/health` for the database and object-storage bindings.

Only send evidence after the in-app privacy review is confirmed. Remove patient identifiers and confidential details whenever possible. The application is not a formal competency assessment.
