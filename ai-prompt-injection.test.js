/**
 * ai-prompt-injection.test.js
 *
 * F30: /api/rebuttal embedded raw, unvalidated user-supplied strings
 * (merchantName, excuse) directly into a single prompt string with no
 * separation from the fixed instructions — a classic prompt-injection
 * shape ("Merchant X says: <untrusted text>. <instructions>"). The output
 * is advisory text only (no tool use, no money movement), so this is a
 * hardening measure, not a critical fix, but there was no defense at all.
 *
 * checkAi 503s the whole route when GEMINI_API_KEY isn't configured (true
 * in this test environment), so the AI call itself can't be exercised
 * end-to-end here. This verifies two things statically instead:
 *   1. the fixed instructions are passed via `config.systemInstruction`,
 *      not concatenated into the same string as user-supplied content
 *      (the SDK-recommended mitigation — the model treats systemInstruction
 *      with more authority than inline conversational text); and
 *   2. free-text user input has a length cap, bounding the blast radius of
 *      any injection payload.
 */
import fs from 'fs';

const src = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

const extractRoute = (routePath) => {
  const start = src.indexOf(`app.post('${routePath}'`);
  const end = src.indexOf("\napp.", start + 1);
  return end > start ? src.slice(start, end) : src.slice(start);
};

describe('/api/rebuttal — prompt injection hardening', () => {
  const routeSrc = extractRoute('/api/rebuttal');

  test('fixed instructions are passed via config.systemInstruction, not string-concatenated with user input', () => {
    expect(routeSrc).toContain('systemInstruction');
  });

  test('the untrusted excuse text is not directly interpolated into an instruction-bearing template string', () => {
    // The old shape: `Merchant ${merchantName} says: "${excuse}". Firm professional rebuttal...`
    // — instructions and user data in the same template literal.
    expect(routeSrc).not.toMatch(/says:.*\$\{excuse\}.*rebuttal/s);
  });

  test('excuse has a length cap (bounds the size of any injection payload)', () => {
    expect(routeSrc).toMatch(/excuse['"]?\).*\.isLength/);
  });
});

describe('/api/risk-briefing — prompt injection hardening', () => {
  const routeSrc = extractRoute('/api/risk-briefing');

  test('fixed instructions are passed via config.systemInstruction, not string-concatenated with request data', () => {
    expect(routeSrc).toContain('systemInstruction');
  });
});
