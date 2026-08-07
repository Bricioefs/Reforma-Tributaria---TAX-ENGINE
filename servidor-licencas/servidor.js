#!/usr/bin/env node
/**
 * Servidor central de ATIVAÇÃO e ATUALIZAÇÃO do Tax Engine IBS/CBS/IS.
 *
 * Por que isso existe: o app cliente (rodando no computador de cada
 * usuário) só consegue, sozinho, perceber "esta chave já foi usada NESTE
 * computador" — sem um lugar central, ele não tem como saber se a MESMA
 * chave já está em uso em OUTRO computador em algum lugar do mundo. Este
 * servidor é esse lugar central: guarda qual fingerprint de máquina cada
 * chave já usou, e recusa uma segunda máquina diferente tentando usar a
 * mesma chave.
 *
 * ZERO dependências externas de propósito — só usa os módulos nativos do
 * Node.js (`http`, `fs`, `crypto`) — então hospedar isto é só:
 *   1. Instalar o Node.js no servidor (qualquer VPS, Railway, Render, etc.)
 *   2. Copiar esta pasta "servidor-licencas" inteira pra lá
 *   3. `node servidor.js` (ou usar PM2/systemd pra manter rodando)
 * Nenhum "npm install" necessário.
 *
 * Endpoints:
 *   POST /ativar     { chave, fingerprint }              → ativa OU confirma reativação na mesma máquina
 *   GET  /versao                                          → { versao, notas, urlDownload, dataLancamento }
 *   POST /admin/definir-versao  (com cabeçalho Authorization: Bearer SEGREDO_ADMIN) → atualiza a versão mais recente anunciada
 *   GET  /                                                → health-check simples
 *
 * Configuração via variáveis de ambiente (opcionais, têm padrão):
 *   PORT             — porta HTTP (padrão 4000)
 *   SEGREDO_ADMIN    — senha para POST /admin/definir-versao (padrão "troque-isto")
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { validarFormatoEChecksumDaChave, normalizarChave } = require('./algoritmo-chave');

const PORTA = process.env.PORT || 4000;
const SEGREDO_ADMIN = process.env.SEGREDO_ADMIN || 'troque-isto';
const ARQUIVO_ATIVACOES = path.join(__dirname, 'dados', 'ativacoes.json');
const ARQUIVO_VERSAO = path.join(__dirname, 'versao-atual.json');

function lerJson(caminho, padrao) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf-8'));
  } catch {
    return padrao;
  }
}

function escreverJson(caminho, dados) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf-8');
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (pedaco) => { dados += pedaco; });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function responderJson(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(corpo));
}

/**
 * Registro de ativações: { "AAAAA-BBBBB-CCCCC-DDDDD": { fingerprint, primeiraAtivacao, ultimaVerificacao } }
 * Uma linha por chave — cada chave só pode estar vinculada a UM fingerprint.
 */
function ativar(chaveBruta, fingerprint) {
  const chave = normalizarChave(chaveBruta);

  if (!fingerprint || typeof fingerprint !== 'string') {
    return { sucesso: false, mensagem: 'Identificação da máquina ausente.' };
  }
  if (!validarFormatoEChecksumDaChave(chave)) {
    return { sucesso: false, mensagem: 'Chave de ativação inválida.' };
  }

  const registro = lerJson(ARQUIVO_ATIVACOES, {});
  const existente = registro[chave];

  if (!existente) {
    registro[chave] = { fingerprint, primeiraAtivacao: new Date().toISOString(), ultimaVerificacao: new Date().toISOString() };
    escreverJson(ARQUIVO_ATIVACOES, registro);
    return { sucesso: true, mensagem: 'Ativado com sucesso.' };
  }

  if (existente.fingerprint === fingerprint) {
    existente.ultimaVerificacao = new Date().toISOString();
    escreverJson(ARQUIVO_ATIVACOES, registro);
    return { sucesso: true, mensagem: 'Ativação confirmada.' };
  }

  return { sucesso: false, mensagem: 'Esta chave de ativação já está em uso em outro computador.' };
}

const servidor = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/' && req.method === 'GET') {
      return responderJson(res, 200, { servico: 'Tax Engine — servidor de licenças', status: 'no ar' });
    }

    if (url.pathname === '/ativar' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const resultado = ativar(corpo.chave, corpo.fingerprint);
      return responderJson(res, resultado.sucesso ? 200 : 403, resultado);
    }

    if (url.pathname === '/versao' && req.method === 'GET') {
      const versao = lerJson(ARQUIVO_VERSAO, { versao: '0.0.0', notas: '', urlDownload: '', dataLancamento: null });
      return responderJson(res, 200, versao);
    }

    if (url.pathname === '/admin/definir-versao' && req.method === 'POST') {
      const autorizacao = req.headers['authorization'] || '';
      if (autorizacao !== `Bearer ${SEGREDO_ADMIN}`) {
        return responderJson(res, 401, { sucesso: false, mensagem: 'Não autorizado.' });
      }
      const corpo = await lerCorpo(req);
      if (!corpo.versao) {
        return responderJson(res, 400, { sucesso: false, mensagem: 'Informe ao menos o campo "versao".' });
      }
      const novaVersao = {
        versao: corpo.versao,
        notas: corpo.notas || '',
        urlDownload: corpo.urlDownload || '',
        dataLancamento: new Date().toISOString(),
      };
      escreverJson(ARQUIVO_VERSAO, novaVersao);
      return responderJson(res, 200, { sucesso: true, versaoPublicada: novaVersao });
    }

    return responderJson(res, 404, { mensagem: 'Rota não encontrada.' });
  } catch (erro) {
    return responderJson(res, 500, { mensagem: 'Erro interno: ' + erro.message });
  }
});

servidor.listen(PORTA, () => {
  console.log(`Servidor de licenças no ar em http://localhost:${PORTA}`);
  console.log(`Admin (definir nova versão) protegido por SEGREDO_ADMIN=${SEGREDO_ADMIN === 'troque-isto' ? '"troque-isto" (PADRÃO — troque antes de expor publicamente!)' : '(customizado)'}`);
});
