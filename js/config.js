/**
 * ═══════════════════════════════════════════════════════════
 *  config.js — Configuração do frontend
 * ═══════════════════════════════════════════════════════════
 *  Substituir os valores após o setup do Apps Script e Google Cloud.
 */

/** @const {string} URL do Web App do Google Apps Script (terminada em /exec). */
const API_URL = 'https://script.google.com/macros/s/AKfycbzAbzXdR0TdLpc1PM-xcEeQz6lfOY7U9hALud2bGazXv8JpApBn7M9lS-aj7fTWgCGxjQ/exec';

/** @const {string} Client ID do Google Cloud para Sign In with Google. */
const GIS_CLIENT_ID = '970946070001-qs7qn28ariinkf77p0v951mf819pso67.apps.googleusercontent.com';

/**
 * Áreas de atuação com cores — espelho de AREAS em Config.gs.
 * Inline no frontend para eliminar o round-trip de `fetchAreas()`.
 * Ao adicionar/alterar áreas em Config.gs, manter sincronizado aqui.
 * @const {Object<string, {label: string, color: string}>}
 */
const AREAS = {
  'Clínica geral': { label: 'Clínica geral', color: '#2563eb' },
  'Dermatologia': { label: 'Dermatologia', color: '#e11d48' },
  'Ginecologia': { label: 'Ginecologia', color: '#db2777' },
  'Nutrição': { label: 'Nutrição', color: '#059669' },
  'Psicologia': { label: 'Psicologia', color: '#7c3aed' },
  'Psiquiatria': { label: 'Psiquiatria', color: '#6d28d9' },
  'Treinadores': { label: 'Treinadores', color: '#d97706' },
  'Veterinária': { label: 'Veterinária', color: '#0891b2' },
};
