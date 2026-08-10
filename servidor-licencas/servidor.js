#!/usr/bin/env node
/**
 * Servidor central de LICENÇAS e ATUALIZAÇÃO do Tax Engine IBS/CBS/IS.
 *
 * Modelo de licenciamento (vinculado a CNPJ, com painel administrativo):
 *   1. Você (fornecedor) GERA a licença no painel (`GET /admin`), associando
 *      um CNPJ/CPF do cliente — a licença nasce com status ATIVA e SEM
 *      máquina vinculada ainda.
 *   2. O cliente digita a chave no app. Na primeira ativação, o app manda
 *      o "fingerprint" da máquina dele — o servidor vincula a licença a
 *      essa máquina (só a essa, a partir de agora).
 *   3. Reaberturas seguintes do app revalidam com o mesmo fingerprint —
 *      OK. Uma tentativa de usar a MESMA chave numa máquina diferente é
 *      recusada ("já em uso em outro computador").
 *   4. Troca de computador / formatação: no painel, "Liberar" a licença —
 *      isso limpa a máquina vinculada, permitindo uma nova ativação (na
 *      máquina nova) sem precisar gerar uma chave nova.
 *   5. Cliente inadimplente: "Bloquear" no painel — a licença para de
 *      validar em qualquer máquina até ser desbloqueada.
 *   6. Validade opcional por licença — expira automaticamente na data.
 *
 * Sem dependências externas — só módulos nativos do Node (`http`, `fs`,
 * `crypto`) — hospedar é só `node servidor.js`, sem "npm install".
 *
 * Endpoints PÚBLICOS (o app cliente usa):
 *   POST /ativar   { chave, fingerprint }  → ativa OU confirma revalidação
 *   GET  /versao                            → { versao, notas, urlDownload, dataLancamento }
 *
 * Endpoints ADMINISTRATIVOS (painel em GET /admin; todos exigem
 * cabeçalho Authorization: Bearer SEGREDO_ADMIN):
 *   GET    /admin/licencas                  → lista todas as licenças
 *   POST   /admin/licencas                  { cnpj, validade? } → gera uma licença nova
 *   POST   /admin/licencas/:chave/liberar   → limpa a máquina vinculada (troca de computador/formatação)
 *   POST   /admin/licencas/:chave/bloquear
 *   POST   /admin/licencas/:chave/desbloquear
 *   POST   /admin/licencas/:chave/validade  { validade }  → "" remove a validade (licença sem prazo)
 *   POST   /admin/definir-versao            { versao, notas?, urlDownload? }
 *
 * Configuração via variáveis de ambiente (opcionais, têm padrão):
 *   PORT             — porta HTTP (padrão 4000)
 *   SEGREDO_ADMIN    — senha do painel e dos endpoints /admin/* (padrão "troque-isto")
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { validarFormatoEChecksumDaChave, normalizarChave, gerarChaveAtivacao } = require('./algoritmo-chave');

const PORTA = process.env.PORT || 4000;
const SEGREDO_ADMIN = process.env.SEGREDO_ADMIN || 'troque-isto';
const ARQUIVO_LICENCAS = path.join(__dirname, 'dados', 'licencas.json');
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

function autorizado(req) {
  return (req.headers['authorization'] || '') === `Bearer ${SEGREDO_ADMIN}`;
}

/**
 * Registro de licenças: { "AAAAA-BBBBB-CCCCC-DDDDD": { cnpj, fingerprint,
 * status, dataGeracao, dataAtivacao, ultimaVerificacao, validade } }
 * `fingerprint` fica `null` até a primeira ativação. `status` é "ATIVA"
 * ou "BLOQUEADA". `validade` é uma data ISO ou `null` (sem prazo).
 */
function ativar(chaveBruta, fingerprint) {
  const chave = normalizarChave(chaveBruta);

  if (!fingerprint || typeof fingerprint !== 'string') {
    return { sucesso: false, mensagem: 'Identificação da máquina ausente.' };
  }

  const registro = lerJson(ARQUIVO_LICENCAS, {});
  const licenca = registro[chave];

  if (!licenca) {
    return { sucesso: false, mensagem: 'Licença não reconhecida — confira a chave, ou solicite ao fornecedor uma licença gerada para você.' };
  }

  if (licenca.status === 'BLOQUEADA') {
    return { sucesso: false, mensagem: 'Licença bloqueada. Entre em contato com o fornecedor.' };
  }

  if (licenca.validade && new Date(licenca.validade).getTime() < Date.now()) {
    return { sucesso: false, mensagem: `Licença expirada em ${new Date(licenca.validade).toLocaleDateString('pt-BR')}. Entre em contato com o fornecedor.` };
  }

  if (!licenca.fingerprint) {
    licenca.fingerprint = fingerprint;
    licenca.dataAtivacao = new Date().toISOString();
    licenca.ultimaVerificacao = new Date().toISOString();
    escreverJson(ARQUIVO_LICENCAS, registro);
    return { sucesso: true, mensagem: 'Ativado com sucesso.' };
  }

  if (licenca.fingerprint === fingerprint) {
    licenca.ultimaVerificacao = new Date().toISOString();
    escreverJson(ARQUIVO_LICENCAS, registro);
    return { sucesso: true, mensagem: 'Ativação confirmada.' };
  }

  return { sucesso: false, mensagem: 'Licença já utilizada em outro equipamento. Solicite ao fornecedor a liberação ou uma nova licença.' };
}

function gerarLicenca(cnpj, validade) {
  let chave;
  const registro = lerJson(ARQUIVO_LICENCAS, {});
  do {
    chave = gerarChaveAtivacao();
  } while (registro[chave]);

  registro[chave] = {
    cnpj: (cnpj || '').trim() || null,
    fingerprint: null,
    status: 'ATIVA',
    dataGeracao: new Date().toISOString(),
    dataAtivacao: null,
    ultimaVerificacao: null,
    validade: validade || null,
  };
  escreverJson(ARQUIVO_LICENCAS, registro);
  return { chave, ...registro[chave] };
}

function paginaAdmin() {
  return fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf-8');
}

const servidor = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const partes = url.pathname.split('/').filter(Boolean);

  try {
    if (url.pathname === '/' && req.method === 'GET') {
      return responderJson(res, 200, { servico: 'Tax Engine — servidor de licenças', status: 'no ar' });
    }

    if (url.pathname === '/admin' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaAdmin());
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

    if (partes[0] === 'admin') {
      if (!autorizado(req)) {
        return responderJson(res, 401, { sucesso: false, mensagem: 'Não autorizado.' });
      }

      if (partes.length === 2 && partes[1] === 'licencas' && req.method === 'GET') {
        const registro = lerJson(ARQUIVO_LICENCAS, {});
        const lista = Object.entries(registro).map(([chave, dados]) => ({ chave, ...dados }));
        lista.sort((a, b) => (b.dataGeracao || '').localeCompare(a.dataGeracao || ''));
        return responderJson(res, 200, lista);
      }

      if (partes.length === 2 && partes[1] === 'licencas' && req.method === 'POST') {
        const corpo = await lerCorpo(req);
        const nova = gerarLicenca(corpo.cnpj, corpo.validade);
        return responderJson(res, 200, { sucesso: true, licenca: nova });
      }

      if (partes.length === 4 && partes[1] === 'licencas' && req.method === 'POST') {
        const chave = normalizarChave(decodeURIComponent(partes[2]));
        const acao = partes[3];
        const registro = lerJson(ARQUIVO_LICENCAS, {});
        const licenca = registro[chave];
        if (!licenca) return responderJson(res, 404, { sucesso: false, mensagem: 'Licença não encontrada.' });

        if (acao === 'liberar') {
          licenca.fingerprint = null;
          licenca.dataAtivacao = null;
        } else if (acao === 'bloquear') {
          licenca.status = 'BLOQUEADA';
        } else if (acao === 'desbloquear') {
          licenca.status = 'ATIVA';
        } else if (acao === 'validade') {
          const corpo = await lerCorpo(req);
          licenca.validade = corpo.validade || null;
        } else {
          return responderJson(res, 404, { sucesso: false, mensagem: 'Ação não reconhecida.' });
        }

        escreverJson(ARQUIVO_LICENCAS, registro);
        return responderJson(res, 200, { sucesso: true, licenca: { chave, ...licenca } });
      }

      if (partes.length === 2 && partes[1] === 'definir-versao' && req.method === 'POST') {
        const corpo = await lerCorpo(req);
        if (!corpo.versao) return responderJson(res, 400, { sucesso: false, mensagem: 'Informe ao menos o campo "versao".' });
        const novaVersao = { versao: corpo.versao, notas: corpo.notas || '', urlDownload: corpo.urlDownload || '', dataLancamento: new Date().toISOString() };
        escreverJson(ARQUIVO_VERSAO, novaVersao);
        return responderJson(res, 200, { sucesso: true, versaoPublicada: novaVersao });
      }
    }

    return responderJson(res, 404, { mensagem: 'Rota não encontrada.' });
  } catch (erro) {
    return responderJson(res, 500, { mensagem: 'Erro interno: ' + erro.message });
  }
});

servidor.listen(PORTA, () => {
  console.log(`Servidor de licenças no ar em http://localhost:${PORTA}`);
  console.log(`Painel administrativo em http://localhost:${PORTA}/admin`);
  console.log(`SEGREDO_ADMIN=${SEGREDO_ADMIN === 'troque-isto' ? '"troque-isto" (PADRÃO — troque antes de expor publicamente!)' : '(customizado)'}`);
});
