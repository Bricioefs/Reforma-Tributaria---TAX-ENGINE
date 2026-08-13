/**
 * Camada de armazenamento do servidor de licenças — abstrai ONDE os dados
 * ficam guardados, pra não espalhar "se é banco ou arquivo" pelo resto do
 * código. Duas opções, escolhidas automaticamente pela presença ou não da
 * variável de ambiente `DATABASE_URL`:
 *
 *   - COM `DATABASE_URL` configurada: usa PostgreSQL de verdade — os dados
 *     sobrevivem a reinícios/spin-down do serviço, mesmo em hospedagem com
 *     disco efêmero (ex: plano grátis do Render — ver README.md, seção
 *     "MUITO IMPORTANTE"). Cria as tabelas sozinho na primeira vez que
 *     roda (`inicializar()`), não precisa migração manual.
 *   - SEM `DATABASE_URL`: continua usando arquivo local (`dados/licencas.json`),
 *     do jeito que sempre funcionou — no PADRÃO, sem exigir NENHUMA
 *     configuração extra. Adequado pra quem hospeda numa VPS própria (o
 *     disco da VPS já é persistente por natureza, sem esse problema) ou
 *     só quer testar rapidamente.
 *
 * As duas opções expõem exatamente a mesma interface (mesmas funções,
 * mesmo formato de dados) — o resto do servidor nunca precisa saber qual
 * das duas está em uso.
 */
const fs = require('fs');
const path = require('path');

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const usandoBancoDeDados = !!DATABASE_URL;

const ARQUIVO_LICENCAS = path.join(__dirname, 'dados', 'licencas.json');
const ARQUIVO_VERSAO = path.join(__dirname, 'versao-atual.json');
const VERSAO_PADRAO = { versao: '0.0.0', notas: '', urlDownload: '', dataLancamento: null };

// ---------- modo arquivo (padrão, sem configuração nenhuma) ----------

function lerJsonArquivo(caminho, padrao) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf-8'));
  } catch {
    return padrao;
  }
}

function escreverJsonArquivo(caminho, dados) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf-8');
}

// ---------- modo banco de dados (Postgres, via DATABASE_URL) ----------

let pool = null;
if (usandoBancoDeDados) {
  const { Pool } = require('pg');
  // `ssl: { rejectUnauthorized: false }` — a maioria dos provedores de
  // Postgres gratuito/gerenciado (Render, Neon, Supabase, ElephantSQL...)
  // exige SSL, mas com um certificado que o Node não reconhece por padrão
  // sem essa flag. Não é uma redução de segurança relevante aqui: a
  // conexão continua criptografada, só não valida a cadeia do certificado.
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function linhaParaLicenca(linha) {
  return {
    cnpj: linha.cnpj,
    fingerprint: linha.fingerprint,
    status: linha.status,
    dataGeracao: linha.data_geracao ? new Date(linha.data_geracao).toISOString() : null,
    dataAtivacao: linha.data_ativacao ? new Date(linha.data_ativacao).toISOString() : null,
    ultimaVerificacao: linha.ultima_verificacao ? new Date(linha.ultima_verificacao).toISOString() : null,
    validade: linha.validade ? new Date(linha.validade).toISOString() : null,
  };
}

async function inicializar() {
  if (!usandoBancoDeDados) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licencas (
      chave TEXT PRIMARY KEY,
      cnpj TEXT,
      fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'ATIVA',
      data_geracao TIMESTAMPTZ,
      data_ativacao TIMESTAMPTZ,
      ultima_verificacao TIMESTAMPTZ,
      validade TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS versao_app (
      id INTEGER PRIMARY KEY DEFAULT 1,
      versao TEXT,
      notas TEXT,
      url_download TEXT,
      data_lancamento TIMESTAMPTZ,
      CHECK (id = 1)
    )
  `);
}

/** Todas as licenças, como `{ [chave]: dadosDaLicenca }` — mesmo formato nos dois modos. */
async function listarLicencas() {
  if (usandoBancoDeDados) {
    const { rows } = await pool.query('SELECT * FROM licencas');
    const registro = {};
    for (const linha of rows) registro[linha.chave] = linhaParaLicenca(linha);
    return registro;
  }
  return lerJsonArquivo(ARQUIVO_LICENCAS, {});
}

/** Uma licença específica, ou `null` se não existir. */
async function obterLicenca(chave) {
  if (usandoBancoDeDados) {
    const { rows } = await pool.query('SELECT * FROM licencas WHERE chave = $1', [chave]);
    return rows[0] ? linhaParaLicenca(rows[0]) : null;
  }
  const registro = lerJsonArquivo(ARQUIVO_LICENCAS, {});
  return registro[chave] || null;
}

/** Cria OU atualiza uma licença por inteiro (substitui todos os campos). */
async function salvarLicenca(chave, dados) {
  if (usandoBancoDeDados) {
    await pool.query(
      `INSERT INTO licencas (chave, cnpj, fingerprint, status, data_geracao, data_ativacao, ultima_verificacao, validade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (chave) DO UPDATE SET
         cnpj = EXCLUDED.cnpj, fingerprint = EXCLUDED.fingerprint, status = EXCLUDED.status,
         data_geracao = EXCLUDED.data_geracao, data_ativacao = EXCLUDED.data_ativacao,
         ultima_verificacao = EXCLUDED.ultima_verificacao, validade = EXCLUDED.validade`,
      [chave, dados.cnpj, dados.fingerprint, dados.status, dados.dataGeracao, dados.dataAtivacao, dados.ultimaVerificacao, dados.validade],
    );
    return;
  }
  const registro = lerJsonArquivo(ARQUIVO_LICENCAS, {});
  registro[chave] = dados;
  escreverJsonArquivo(ARQUIVO_LICENCAS, registro);
}

async function obterVersao() {
  if (usandoBancoDeDados) {
    const { rows } = await pool.query('SELECT * FROM versao_app WHERE id = 1');
    if (!rows[0]) return VERSAO_PADRAO;
    return {
      versao: rows[0].versao,
      notas: rows[0].notas || '',
      urlDownload: rows[0].url_download || '',
      dataLancamento: rows[0].data_lancamento ? new Date(rows[0].data_lancamento).toISOString() : null,
    };
  }
  return lerJsonArquivo(ARQUIVO_VERSAO, VERSAO_PADRAO);
}

async function salvarVersao(dados) {
  if (usandoBancoDeDados) {
    await pool.query(
      `INSERT INTO versao_app (id, versao, notas, url_download, data_lancamento)
       VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET versao = EXCLUDED.versao, notas = EXCLUDED.notas,
         url_download = EXCLUDED.url_download, data_lancamento = EXCLUDED.data_lancamento`,
      [dados.versao, dados.notas, dados.urlDownload, dados.dataLancamento],
    );
    return;
  }
  escreverJsonArquivo(ARQUIVO_VERSAO, dados);
}

module.exports = { inicializar, listarLicencas, obterLicenca, salvarLicenca, obterVersao, salvarVersao, usandoBancoDeDados };
