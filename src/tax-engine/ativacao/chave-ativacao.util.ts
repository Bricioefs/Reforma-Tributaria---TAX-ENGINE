import * as crypto from 'crypto';
import * as os from 'os';

/**
 * Alfabeto sem caracteres visualmente ambíguos (sem 0/O, 1/I/L) — reduz
 * erro de digitação ao transcrever a chave de um e-mail/papel pro campo.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 caracteres

/**
 * Segredo usado para calcular o checksum de cada chave (HMAC-SHA256).
 *
 * IMPORTANTE — leia antes de distribuir isto: como o programa roda
 * inteiramente na máquina do usuário (não há servidor central validando
 * nada), esse segredo PRECISA estar embutido no próprio código para a
 * validação funcionar offline — e qualquer pessoa com acesso ao código-
 * fonte (ou disposta a descompilar o executável) consegue lê-lo e gerar
 * chaves válidas por conta própria. Isto é uma limitação de QUALQUER
 * sistema de ativação client-side puro, não desta implementação em
 * particular — o mesmo vale, em princípio, para o Windows (por isso
 * ativações piratas existem). Troque este valor por algo seu antes de
 * distribuir de verdade, e trate-o como o "cadeado da porta da frente":
 * impede o acesso casual, não um invasor determinado.
 */
const SEGREDO_CHECKSUM = 'TAX-ENGINE-IBS-CBS-IS-2026-TROQUE-ESTE-SEGREDO-ANTES-DE-DISTRIBUIR';

function hmacParaAlfabeto(texto: string, quantidadeCaracteres: number): string {
  const hash = crypto.createHmac('sha256', SEGREDO_CHECKSUM).update(texto).digest();
  let resultado = '';
  for (let i = 0; i < quantidadeCaracteres; i++) {
    resultado += ALFABETO[hash[i] % ALFABETO.length];
  }
  return resultado;
}

/**
 * Gera uma chave de ativação nova e válida — formato AAAAA-BBBBB-CCCCC-DDDDD.
 * Os 3 primeiros grupos (15 caracteres) são aleatórios; o 4º grupo é um
 * checksum calculado a partir deles (`hmacParaAlfabeto`) — por isso a
 * validação não depende de consultar uma lista fixa de chaves: qualquer
 * chave cujo 4º grupo bata com o checksum recalculado dos 3 primeiros é
 * válida. Rode este gerador quantas vezes quiser para emitir novas
 * chaves (ver `scripts/gerar-chave-ativacao.js` na raiz do projeto).
 */
export function gerarChaveAtivacao(): string {
  const payload = Array.from({ length: 15 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
  const checksum = hmacParaAlfabeto(payload, 5);
  return `${payload.slice(0, 5)}-${payload.slice(5, 10)}-${payload.slice(10, 15)}-${checksum}`;
}

/** Valida o FORMATO e o CHECKSUM de uma chave — não confirma se ela já foi usada em outra máquina (isso é responsabilidade do `AtivacaoService`, que vincula a chave ao computador no momento da ativação). */
export function validarFormatoEChecksumDaChave(chaveBruta: string): boolean {
  const chave = (chaveBruta ?? '').trim().toUpperCase();
  if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(chave)) return false;

  const grupos = chave.split('-');
  const payload = grupos[0] + grupos[1] + grupos[2];
  const checksumEsperado = hmacParaAlfabeto(payload, 5);
  return grupos[3] === checksumEsperado;
}

/** Normaliza a chave digitada (maiúsculas, sem espaços) — usado tanto na validação quanto ao persistir, para duas chaves "equivalentes" (com espaços a mais, minúsculas) sempre virarem o mesmo valor salvo. */
export function normalizarChave(chaveBruta: string): string {
  return (chaveBruta ?? '').trim().toUpperCase();
}

/**
 * Identifica esta máquina de forma razoavelmente estável (mesmo hostname
 * + plataforma + arquitetura + memória total + modelo de CPU tendem a se
 * manter iguais entre reinicializações do MESMO computador, mas mudam ao
 * copiar a pasta de dados para outro computador) — usado para vincular
 * uma ativação a um único computador sem precisar de uma biblioteca
 * externa de acesso a hardware (evita dependência nativa compilada, que
 * já causou problema de compatibilidade com o empacotamento `pkg` neste
 * projeto antes — ver README, seção de exportação com gráficos nativos).
 *
 * NÃO é um identificador de hardware à prova de falsificação (ex: não
 * lê o número de série da placa-mãe) — é suficiente para o objetivo aqui
 * (perceber quando a pasta "dados" foi copiada para outra máquina),
 * não para um sistema de DRM robusto contra um usuário técnico.
 */
export function obterFingerprintMaquina(): string {
  const partes = [os.hostname(), os.platform(), os.arch(), String(os.totalmem()), os.cpus()?.[0]?.model ?? ''].join('|');
  return crypto.createHash('sha256').update(partes).digest('hex').slice(0, 32);
}
