/** OpenAI Responses API transport shared by the Sites request handlers. */
export async function createResponse(env, body, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!env.OPENAI_API_KEY) throw Object.assign(new Error('AI inference is not configured for this deployment.'), { status: 503 });
  const payload = { model: env.OPENAI_MODEL || 'gpt-6-luna', store: false, ...body };
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
      });
    } catch {
      if (attempt < 2) { await sleep(250 * 2 ** attempt); continue; }
      throw Object.assign(new Error('The AI service is temporarily unavailable. Please try again.'), { status: 503 });
    }
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error('The AI service returned an invalid response. Please try again.'), { status: 502 }); }
    if (response.ok) {
      if (data.status === 'incomplete' || data.status === 'failed') throw Object.assign(new Error('The AI response was incomplete. Please try again.'), { status: 502 });
      return data;
    }
    const retryable = response.status === 429 || response.status === 500 || response.status === 503;
    const header = response.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    if (retryable && attempt < 2 && (!Number.isFinite(seconds) || seconds <= 2) && data?.error?.code !== 'insufficient_quota') {
      await sleep(Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 250 * 2 ** attempt);
      continue;
    }
    if (response.status === 429) throw Object.assign(new Error('The AI service is busy or its quota is exhausted. Please try again later.'), { status: 429 });
    throw Object.assign(new Error('The AI service could not complete this request. Please try again later.'), { status: 502 });
  }
}

export function responseText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = (data.output || []).flatMap(item => item.content || []);
  if (parts.some(part => part.type === 'refusal')) throw Object.assign(new Error('The AI service declined this request.'), { status: 422 });
  const text = parts.filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
  if (!text.trim()) throw Object.assign(new Error('The AI service returned an empty response. Please try again.'), { status: 502 });
  return text;
}
