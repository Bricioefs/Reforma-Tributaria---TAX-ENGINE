#!/usr/bin/env node
/**
 * Gera chaves de ativação válidas para o Tax Engine IBS/CBS/IS.
 *
 * Uso:
 *   node gerar-chave-ativacao.js           # gera 1 chave
 *   node gerar-chave-ativacao.js 10        # gera 10 chaves
 *
 * IMPORTANTE: este script usa O MESMO algoritmo/segredo definido em
 * src/tax-engine/ativacao/chave-ativacao.util.ts — se você trocar o
 * SEGREDO_CHECKSUM lá (recomendado antes de distribuir de verdade),
 * troque aqui também, senão as chaves geradas por este script deixam
 * de ser aceitas pelo sistema (e vice-versa).
 */
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

function gerarChaveAtivacao() {
  const payload = Array.from({ length: 15 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
  const checksum = hmacParaAlfabeto(payload, 5);
  return `${payload.slice(0, 5)}-${payload.slice(5, 10)}-${payload.slice(10, 15)}-${checksum}`;
}

const quantidade = Number(process.argv[2]) || 1;
for (let i = 0; i < quantidade; i++) {
  console.log(gerarChaveAtivacao());
}
