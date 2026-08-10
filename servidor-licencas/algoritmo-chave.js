// Mesma lógica de /home/claude/tax-engine/src/tax-engine/ativacao/chave-ativacao.util.ts
// (duplicado propositalmente — este servidor roda separado do app cliente,
// sem build/TypeScript, então é JS puro copiado em vez de importado).
//
// IMPORTANTE: SEGREDO_CHECKSUM tem que ser IDÊNTICO nos 3 lugares:
//   1. src/tax-engine/ativacao/chave-ativacao.util.ts (app cliente)
//   2. scripts/gerar-chave-ativacao.js (gerador de chaves)
//   3. este arquivo (servidor de licenças)
// Troque os 3 juntos antes de distribuir de verdade.

const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SEGREDO_CHECKSUM = 'TAX-ENGINE-IBS-CBS-IS-2026-TROQUE-ESTE-SEGREDO-ANTES-DE-DISTRIBUIR';

function hmacParaAlfabeto(texto, quantidadeCaracteres) {
  const hash = crypto.createHmac('sha256', SEGREDO_CHECKSUM).update(texto).digest();
  let resultado = '';
  for (let i = 0; i < quantidadeCaracteres; i++) {
    resultado += ALFABETO[hash[i] % ALFABETO.length];
  }
  return resultado;
}

function validarFormatoEChecksumDaChave(chaveBruta) {
  const chave = (chaveBruta ?? '').trim().toUpperCase();
  if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(chave)) return false;
  const grupos = chave.split('-');
  const payload = grupos[0] + grupos[1] + grupos[2];
  return grupos[3] === hmacParaAlfabeto(payload, 5);
}

function normalizarChave(chaveBruta) {
  return (chaveBruta ?? '').trim().toUpperCase();
}

function gerarChaveAtivacao() {
  const payload = Array.from({ length: 15 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
  const checksum = hmacParaAlfabeto(payload, 5);
  return `${payload.slice(0, 5)}-${payload.slice(5, 10)}-${payload.slice(10, 15)}-${checksum}`;
}

module.exports = { validarFormatoEChecksumDaChave, normalizarChave, gerarChaveAtivacao };
