import { readFileSync } from 'fs';
import { join } from 'path';
import Decimal from 'decimal.js';

/** Um registro individual do asset já processado (um NBS por linha). */
export interface RegistroAnexoViii {
  nbs: string;
  descricaoNbs: string | null;
  cClassTrib: string;
  nomeCClassTrib: string | null;
  pRedIBS: number | null;
  pRedCBS: number | null;
  baseLegal: string | null;
}

/** Um grupo de NBS que compartilham o mesmo cClassTrib (mesmo percentual de redução). */
export interface GrupoAnexoViii {
  codigo: string;
  cClassTrib: string;
  baseLegal: string;
  percentualReducaoIbs: Decimal;
  percentualReducaoCbs: Decimal;
  nbs: string[];
}

/**
 * cClassTrib que este importador DELIBERADAMENTE não converte em regime
 * automático:
 *
 * - `000001` ("Situações tributadas integralmente") — reduções 0%/0%,
 *   equivalente a "sem benefício"; incluir seria um no-op (mesmo
 *   resultado do regime padrão), só adicionaria volume sem mudar nada.
 * - `400001` ("transporte público coletivo rodoviário e metroviário") —
 *   a planilha mostra 0%/0% de redução para este código específico, o
 *   que PARECE contradizer o tratamento uniforme de alíquota zero para
 *   transporte coletivo já confirmado por outra fonte oficial
 *   (Conformidade Fácil, `codigos-nbs-reais.ts`, `NBS_TRANSPORTE_COLETIVO`).
 *   Prefere-se manter o tratamento já validado (zero) a sobrescrevê-lo
 *   com um valor que pode representar apenas "este campo não se aplica
 *   a este mecanismo" em vez de "0% de benefício real" — evita regressão
 *   por ambiguidade de interpretação do dado bruto.
 * - `820xxx` ("Documento com informações de fornecimento de...") — são
 *   classificações de TIPO DE DOCUMENTO fiscal para fins de emissão de
 *   nota, não benefícios tributários em si (não têm percentual de
 *   redução real associado — os poucos que aparecem com 0%/0% são
 *   metadados, não mecânica de cálculo).
 */
const CCLASSTRIB_IGNORADOS = new Set(['000001', '400001']);

function ehClassificacaoDeDocumento(cClassTrib: string): boolean {
  return cClassTrib.startsWith('820');
}

/**
 * Carrega e agrupa a tabela oficial "Anexo VIII — Correlação item NBS x
 * INDOP x cClassTrib" (gov.br/nfse), empacotada em
 * `assets/anexo-viii-nbs.json` — 731 códigos NBS únicos, cada um já
 * vinculado ao seu cClassTrib e percentual de redução oficial de IBS/CBS
 * (evita ter que adivinhar o percentual a partir de texto livre, como foi
 * necessário para os dados do Conformidade Fácil).
 *
 * Retorna um grupo por cClassTrib (todos os NBS daquele cClassTrib
 * compartilham o mesmo percentual) — pronto para virar uma instância de
 * `RegimeReducaoSetorialStrategy` por grupo.
 */
export function carregarGruposAnexoViii(): GrupoAnexoViii[] {
  const caminho = join(__dirname, '..', '..', 'assets', 'anexo-viii-nbs.json');
  const conteudo = readFileSync(caminho, 'utf-8');
  const registros: RegistroAnexoViii[] = JSON.parse(conteudo);
  return agruparPorCClassTrib(registros);
}

export function agruparPorCClassTrib(registros: RegistroAnexoViii[]): GrupoAnexoViii[] {
  const grupos = new Map<string, GrupoAnexoViii>();

  for (const r of registros) {
    if (CCLASSTRIB_IGNORADOS.has(r.cClassTrib) || ehClassificacaoDeDocumento(r.cClassTrib)) continue;
    if (r.pRedIBS === null || r.pRedCBS === null) continue; // "#N/A" — sem percentual definido (ex: serviços financeiros, base por margem)

    let grupo = grupos.get(r.cClassTrib);
    if (!grupo) {
      grupo = {
        codigo: `ANEXOVIII_${r.cClassTrib}`,
        cClassTrib: r.cClassTrib,
        baseLegal: `Anexo VIII (gov.br/nfse), cClassTrib ${r.cClassTrib} — ${r.nomeCClassTrib ?? ''}`.trim(),
        percentualReducaoIbs: new Decimal(r.pRedIBS),
        percentualReducaoCbs: new Decimal(r.pRedCBS),
        nbs: [],
      };
      grupos.set(r.cClassTrib, grupo);
    }
    grupo.nbs.push(r.nbs);
  }

  return [...grupos.values()];
}
