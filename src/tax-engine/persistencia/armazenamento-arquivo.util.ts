import * as fs from 'fs';
import * as path from 'path';

/**
 * Persistência simples em arquivo JSON local — usada para que os
 * lançamentos e a memória de cálculo sobrevivam ao fechar o programa,
 * sem exigir configuração de banco de dados (ver `HISTORICO-DESENVOLVIMENTO.md`,
 * seção de banco de dados, para a alternativa com PostgreSQL/Prisma).
 *
 * Os arquivos ficam numa pasta `dados/` ao lado do executável — quando
 * rodando via `pkg` (executável empacotado), `process.pkg` existe e
 * `process.execPath` aponta para o binário real (não para o snapshot
 * virtual), então a pasta é criada no disco de verdade, ao lado do
 * `.exe`/binário. Em desenvolvimento (`npm run start:dev`), fica na raiz
 * do projeto.
 *
 * Desabilitada durante os testes automatizados (`NODE_ENV=test` ou
 * `JEST_WORKER_ID` definido, ambos setados pelo Jest) para manter os
 * testes determinísticos — cada teste começa com estado limpo, sem
 * depender de arquivos deixados por execuções anteriores.
 */

function persistenciaHabilitada(forcar?: boolean): boolean {
  if (forcar) return true;
  return process.env.NODE_ENV !== 'test' && process.env.JEST_WORKER_ID === undefined;
}

export function diretorioDados(baseOverride?: string): string {
  const base = baseOverride ?? ((process as any).pkg ? path.dirname(process.execPath) : process.cwd());
  const dir = path.join(base, 'dados');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // pasta já existe ou sem permissão de escrita — erros de leitura/escrita
    // são tratados individualmente em lerJson/escreverJson.
  }
  return dir;
}

export interface OpcoesPersistencia {
  baseDir?: string;
  forcarHabilitado?: boolean;
}

export function lerJson<T>(nomeArquivo: string, valorPadrao: T, opcoes?: OpcoesPersistencia): T {
  if (!persistenciaHabilitada(opcoes?.forcarHabilitado)) return valorPadrao;
  const caminho = path.join(diretorioDados(opcoes?.baseDir), nomeArquivo);
  try {
    if (!fs.existsSync(caminho)) return valorPadrao;
    const conteudo = fs.readFileSync(caminho, 'utf-8');
    return JSON.parse(conteudo) as T;
  } catch {
    return valorPadrao;
  }
}

export function escreverJson(nomeArquivo: string, dados: unknown, opcoes?: OpcoesPersistencia): void {
  if (!persistenciaHabilitada(opcoes?.forcarHabilitado)) return;
  const caminho = path.join(diretorioDados(opcoes?.baseDir), nomeArquivo);
  try {
    // JSON compacto (sem indentação) — mais rápido de serializar e bem
    // menor em disco para listas grandes (planilhas de dezenas de
    // milhares de linhas), o que importa em dois pontos: menos CPU gasto
    // no `JSON.stringify` em si, e menos bytes para o sistema operacional
    // (e um eventual antivírus escaneando a escrita) processar a cada
    // gravação. A leitura (`JSON.parse`) não se importa com formatação,
    // então isso não quebra nada já persistido.
    fs.writeFileSync(caminho, JSON.stringify(dados), 'utf-8');
  } catch {
    // falha de escrita (disco cheio, permissão) não deve derrubar a
    // aplicação — os dados continuam disponíveis em memória nesta sessão,
    // só não sobrevivem ao reiniciar o programa.
  }
}

/**
 * Mesma coisa que `escreverJson()`, mas assíncrona (`fs.promises.writeFile`)
 * — usada especificamente pelos pontos de gravação periódica durante uma
 * importação de planilha grande (`LINHAS_POR_GRAVACAO`). Diferença real:
 * uma gravação SÍNCRONA de um arquivo grande (a planilha real usada para
 * diagnosticar isso tem 54 mil linhas — o arquivo de lançamentos passa de
 * 100MB) BLOQUEIA o event loop inteiro pela duração da escrita — inclusive
 * o envio dos eventos SSE de progresso já enfileirados, que só saem de
 * verdade quando o event loop volta a rodar. Numa máquina com disco lento
 * ou antivírus interceptando a escrita (comum em ambientes Windows
 * corporativos), essa pausa pode ser longa o bastante para o navegador ou
 * um proxy no meio do caminho considerar a conexão morta — exatamente o
 * sintoma relatado ("Conexão com o servidor perdida durante a
 * importação"). A versão assíncrona libera o event loop durante a
 * gravação, deixando os eventos SSE pendentes saírem normalmente mesmo
 * com uma escrita grande em andamento.
 */
export async function escreverJsonAsync(nomeArquivo: string, dados: unknown, opcoes?: OpcoesPersistencia): Promise<void> {
  if (!persistenciaHabilitada(opcoes?.forcarHabilitado)) return;
  const caminho = path.join(diretorioDados(opcoes?.baseDir), nomeArquivo);
  try {
    await fs.promises.writeFile(caminho, JSON.stringify(dados), 'utf-8');
  } catch {
    // mesma tolerância a falha da versão síncrona
  }
}
