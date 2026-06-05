/**
 * ═══════════════════════════════════════════════════════════
 *  api.js — Camada de comunicação com o backend (Apps Script)
 * ═══════════════════════════════════════════════════════════
 *
 *  GET: fetch com query params (redirect: follow).
 *  POST: fetch com Content-Type text/plain (evita preflight CORS).
 *  Retry: até 2 tentativas em falhas de rede/5xx, com backoff.
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Indica sucesso ou falha.
 * @property {*} data - Payload de dados.
 * @property {string} message - Mensagem descritiva.
 */

/**
 * Número máximo de tentativas para requisições com falha transitória.
 * @const {number}
 */
const MAX_RETRIES = 2;

/**
 * Tempo base de espera entre retries em ms.
 * @const {number}
 */
const RETRY_DELAY_MS = 1000;

/**
 * Pausa a execução por um tempo determinado.
 * @param {number} ms - Milissegundos.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Executa uma requisição GET ao backend.
 * @param {string} action - Nome da ação (query param).
 * @param {Object<string, string>} [params={}] - Parâmetros adicionais.
 * @returns {Promise<ApiResponse>} Resposta do backend.
 */
const apiGet = async (action, params = {}) => {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      if (attempt > 0) {
        console.info(`[API] Retry GET ${action} (tentativa ${attempt + 1})`);
        await sleep(RETRY_DELAY_MS * attempt);
      }

      const response = await fetch(url.toString(), { redirect: 'follow' });
      const data = await response.json();
      return data;
    } catch (err) {
      lastError = err;
      console.warn(`[API] GET ${action} falhou:`, err.message);
    }
  }

  return { success: false, data: null, message: lastError?.message || 'Erro de conexão.' };
};

/**
 * Executa uma requisição POST ao backend.
 * Content-Type: text/plain para evitar preflight CORS com Apps Script.
 * @param {Object} body - Corpo da requisição (será JSON.stringify).
 * @returns {Promise<ApiResponse>} Resposta do backend.
 */
const apiPost = async (body) => {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      if (attempt > 0) {
        console.info(`[API] Retry POST ${body.action} (tentativa ${attempt + 1})`);
        await sleep(RETRY_DELAY_MS * attempt);
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
      });

      const data = await response.json();
      return data;
    } catch (err) {
      lastError = err;
      console.warn(`[API] POST ${body.action} falhou:`, err.message);
    }
  }

  return { success: false, data: null, message: lastError?.message || 'Erro de conexão.' };
};

// ─── Métodos de alto nível ────────────────────────────────

/**
 * Busca a lista pública de profissionais.
 * @returns {Promise<ApiResponse>}
 */
const fetchPublicList = () => apiGet('publicList');

/**
 * Busca a lista de áreas com cores.
 * @returns {Promise<ApiResponse>}
 */
const fetchAreas = () => apiGet('areas');

/**
 * Realiza login de admin com Google ID Token.
 * @param {string} idToken - Token JWT do Google Identity Services.
 * @returns {Promise<ApiResponse>}
 */
const loginAdmin = (idToken) => apiPost({ action: 'login', idToken });

/**
 * Encerra sessão de admin.
 * @param {string} sessionToken - Token de sessão.
 * @returns {Promise<ApiResponse>}
 */
const logoutAdmin = (sessionToken) => apiPost({ action: 'logout', sessionToken });

/**
 * Busca lista de profissionais para o admin.
 * @param {string} sessionToken - Token de sessão.
 * @returns {Promise<ApiResponse>}
 */
const fetchAdminList = (sessionToken) => apiPost({ action: 'adminList', sessionToken });

/**
 * Cria um novo profissional.
 * @param {string} sessionToken - Token de sessão.
 * @param {Object} data - Dados do profissional.
 * @returns {Promise<ApiResponse>}
 */
const createProf = (sessionToken, data) => apiPost({ action: 'create', sessionToken, data });

/**
 * Atualiza um profissional existente.
 * @param {string} sessionToken - Token de sessão.
 * @param {string} id - ID do profissional.
 * @param {Object} data - Dados atualizados.
 * @returns {Promise<ApiResponse>}
 */
const updateProf = (sessionToken, id, data) => apiPost({
  action: 'update', sessionToken, id, data,
});

/**
 * Desativa um profissional.
 * @param {string} sessionToken - Token de sessão.
 * @param {string} id - ID do profissional.
 * @returns {Promise<ApiResponse>}
 */
const deleteProf = (sessionToken, id) => apiPost({ action: 'delete', sessionToken, id });

/**
 * Faz upload de foto para o Google Drive.
 * @param {string} sessionToken - Token de sessão.
 * @param {string} base64 - Dados da imagem em base64.
 * @param {string} mimeType - Tipo MIME da imagem.
 * @param {string} profNome - Nome do profissional.
 * @returns {Promise<ApiResponse>}
 */
const uploadPhoto = (sessionToken, base64, mimeType, profNome) => apiPost({
  action: 'uploadPhoto', sessionToken, base64, mimeType, profNome,
});
