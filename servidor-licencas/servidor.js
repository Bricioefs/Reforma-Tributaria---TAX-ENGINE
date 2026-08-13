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
 * Armazenamento: arquivo local por padrão (zero configuração), ou
 * PostgreSQL de verdade se `DATABASE_URL` estiver definida — ver
 * `armazenamento.js` e o README.md ("MUITO IMPORTANTE") para quando isso
 * importa (hospedagem com disco efêmero, como o plano grátis do Render).
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
 * Configuração via variáveis de ambiente (todas opcionais, têm padrão):
 *   PORT             — porta HTTP (padrão 4000)
 *   SEGREDO_ADMIN    — senha do painel e dos endpoints /admin/* (padrão "troque-isto")
 *   DATABASE_URL     — string de conexão PostgreSQL (ex: postgres://usuario:senha@host:5432/banco).
 *                       Sem ela, usa arquivo local (comportamento de sempre).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { validarFormatoEChecksumDaChave, normalizarChave, gerarChaveAtivacao } = require('./algoritmo-chave');
const armazenamento = require('./armazenamento');

const PORTA = process.env.PORT || 4000;
// .trim() nos dois lados — evita um mismatch silencioso se um espaço ou
// quebra de linha grudar sem querer ao colar a senha no campo de
// variável de ambiente (comum em algumas plataformas de hospedagem).
const SEGREDO_ADMIN = (process.env.SEGREDO_ADMIN || 'troque-isto').trim();

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
  return (req.headers['authorization'] || '').trim() === `Bearer ${SEGREDO_ADMIN}`;
}

/**
 * Registro de uma licença: { cnpj, fingerprint, status, dataGeracao,
 * dataAtivacao, ultimaVerificacao, validade }. `fingerprint` fica `null`
 * até a primeira ativação. `status` é "ATIVA" ou "BLOQUEADA". `validade`
 * é uma data ISO ou `null` (sem prazo).
 */
async function ativar(chaveBruta, fingerprint) {
  const chave = normalizarChave(chaveBruta);

  if (!fingerprint || typeof fingerprint !== 'string') {
    return { sucesso: false, mensagem: 'Identificação da máquina ausente.' };
  }

  const licenca = await armazenamento.obterLicenca(chave);

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
    await armazenamento.salvarLicenca(chave, licenca);
    return { sucesso: true, mensagem: 'Ativado com sucesso.' };
  }

  if (licenca.fingerprint === fingerprint) {
    licenca.ultimaVerificacao = new Date().toISOString();
    await armazenamento.salvarLicenca(chave, licenca);
    return { sucesso: true, mensagem: 'Ativação confirmada.' };
  }

  return { sucesso: false, mensagem: 'Licença já utilizada em outro equipamento. Solicite ao fornecedor a liberação ou uma nova licença.' };
}

async function gerarLicenca(cnpj, validade) {
  let chave;
  do {
    chave = gerarChaveAtivacao();
  } while (await armazenamento.obterLicenca(chave));

  const dados = {
    cnpj: (cnpj || '').trim() || null,
    fingerprint: null,
    status: 'ATIVA',
    dataGeracao: new Date().toISOString(),
    dataAtivacao: null,
    ultimaVerificacao: null,
    validade: validade || null,
  };
  await armazenamento.salvarLicenca(chave, dados);
  return { chave, ...dados };
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
      return responderJson(res, 200, { servico: 'Tax Engine — servidor de licenças', status: 'no ar', armazenamento: armazenamento.usandoBancoDeDados ? 'banco de dados' : 'arquivo local' });
    }

    if (url.pathname === '/admin' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaAdmin());
    }

    if (url.pathname === '/ativar' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const resultado = await ativar(corpo.chave, corpo.fingerprint);
      return responderJson(res, resultado.sucesso ? 200 : 403, resultado);
    }

    if (url.pathname === '/versao' && req.method === 'GET') {
      const versao = await armazenamento.obterVersao();
      return responderJson(res, 200, versao);
    }

    if (partes[0] === 'admin') {
      if (!autorizado(req)) {
        return responderJson(res, 401, { sucesso: false, mensagem: 'Não autorizado.' });
      }

      if (partes.length === 2 && partes[1] === 'licencas' && req.method === 'GET') {
        const registro = await armazenamento.listarLicencas();
        const lista = Object.entries(registro).map(([chave, dados]) => ({ chave, ...dados }));
        lista.sort((a, b) => (b.dataGeracao || '').localeCompare(a.dataGeracao || ''));
        return responderJson(res, 200, lista);
      }

      if (partes.length === 2 && partes[1] === 'licencas' && req.method === 'POST') {
        const corpo = await lerCorpo(req);
        const nova = await gerarLicenca(corpo.cnpj, corpo.validade);
        return responderJson(res, 200, { sucesso: true, licenca: nova });
      }

      if (partes.length === 4 && partes[1] === 'licencas' && req.method === 'POST') {
        const chave = normalizarChave(decodeURIComponent(partes[2]));
        const acao = partes[3];
        const licenca = await armazenamento.obterLicenca(chave);
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

        await armazenamento.salvarLicenca(chave, licenca);
        return responderJson(res, 200, { sucesso: true, licenca: { chave, ...licenca } });
      }

      if (partes.length === 2 && partes[1] === 'definir-versao' && req.method === 'POST') {
        const corpo = await lerCorpo(req);
        if (!corpo.versao) return responderJson(res, 400, { sucesso: false, mensagem: 'Informe ao menos o campo "versao".' });
        const novaVersao = { versao: corpo.versao, notas: corpo.notas || '', urlDownload: corpo.urlDownload || '', dataLancamento: new Date().toISOString() };
        await armazenamento.salvarVersao(novaVersao);
        return responderJson(res, 200, { sucesso: true, versaoPublicada: novaVersao });
      }
    }

    return responderJson(res, 404, { mensagem: 'Rota não encontrada.' });
  } catch (erro) {
    return responderJson(res, 500, { mensagem: 'Erro interno: ' + erro.message });
  }
});

async function iniciar() {
  await armazenamento.inicializar();

  servidor.listen(PORTA, async () => {
    console.log(`Servidor de licenças no ar em http://localhost:${PORTA}`);
    console.log(`Painel administrativo em http://localhost:${PORTA}/admin`);
    console.log(`SEGREDO_ADMIN=${SEGREDO_ADMIN === 'troque-isto' ? '"troque-isto" (PADRÃO — troque antes de expor publicamente!)' : '(customizado)'}`);
    console.log(`Armazenamento: ${armazenamento.usandoBancoDeDados ? 'PostgreSQL (DATABASE_URL configurada)' : 'arquivo local (dados/licencas.json)'}`);

    // Aviso visível a CADA reinício — ajuda a perceber na hora se o
    // plano grátis do Render (ou qualquer hospedagem sem disco
    // persistente) apagou as licenças já geradas: se o arquivo/banco
    // vier vazio logo depois de já ter tido licenças cadastradas, é bem
    // provável que seja isso, não um bug. Ver "MUITO IMPORTANTE" no
    // README.md desta pasta. Com `DATABASE_URL` configurada, este risco
    // não existe mais — o aviso só faz sentido no modo arquivo.
    const registroAtual = await armazenamento.listarLicencas();
    const totalLicencas = Object.keys(registroAtual).length;
    console.log(`Licenças carregadas neste início: ${totalLicencas}`);
    if (totalLicencas === 0 && !armazenamento.usandoBancoDeDados) {
      console.log('AVISO: nenhuma licença encontrada no arquivo local. Se você já tinha gerado licenças antes, ' +
        'e está hospedando no plano GRÁTIS do Render (ou outra hospedagem sem disco persistente), ' +
        'é bem provável que os dados tenham sido apagados no último reinício/spin-down — configure ' +
        'DATABASE_URL para resolver de vez (ver "MUITO IMPORTANTE" no README.md).');
    }
  });
}

iniciar().catch((erro) => {
  console.error('Erro ao iniciar o servidor:', erro);
  process.exit(1);
});
