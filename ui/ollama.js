import { ENGINE_CONFIG } from './config.js';

function buildApiPath(endpoint) {
  const base = ENGINE_CONFIG.defaultBackendApiBase || 'api';
  const cleanBase = base.replace(/^\/+|\/+$/g, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  return `${cleanBase}/${cleanEndpoint}`;
}

export async function callLLM(prompt, systemInstruction = "", role = "default") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(buildApiPath('llm/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        systemInstruction,
        role
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM Server returned status ${response.status}`);
    }

    const data = await response.json();
    clearTimeout(timeoutId);

    return data.response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

export async function callOllama(prompt, systemInstruction = "", role = "default") {
  return callLLM(prompt, systemInstruction, role);
}

export async function testLLMConnection() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(buildApiPath('llm/status'), { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    clearTimeout(timeoutId);
    return false;
  }
}

export async function testOllamaConnection() {
  return testLLMConnection();
}