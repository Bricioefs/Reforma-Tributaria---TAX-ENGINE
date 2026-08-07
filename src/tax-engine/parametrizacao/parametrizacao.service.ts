import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { obterAliquotaCbsPlena, obterAliquotaIbsPlena, definirAliquotasPlenas, restaurarAliquotasPlenasPadrao } from '../regimes/cronograma-transicao';
import { lerJson, escreverJson } from '../persistencia/armazenamento-arquivo.util';

const ARQUIVO = 'parametrizacao.json';

interface AliquotasPlenasPersistidas {
  cbs: string;
  ibs: string;
}

/**
 * Alíquotas de referência PLENAS configuráveis pelo usuário — a LC
 * 214/2025 ainda não fixa o percentual definitivo (depende de cálculo do
 * TCU/Resolução do Senado), então o sistema usa um padrão (CBS 10% + IBS
 * 18%) que o usuário pode substituir para testar cenários com premissas
 * diferentes. A mudança é aplicada em `cronograma-transicao.ts`
 * (`definirAliquotasPlenas()`) — TODO cálculo/projeção feito a partir daí
 * (cálculo de operação, apuração, exportação) já usa o novo valor, sem
 * precisar reiniciar o programa. Lançamentos JÁ salvos mantêm o valor
 * calculado na época (não são recalculados retroativamente) — só a
 * PROJEÇÃO para outros anos, que sempre recalcula a partir do valor de
 * referência atual, reflete a mudança imediatamente.
 *
 * Persistido em `dados/parametrizacao.json` — sobrevive a fechar o
 * programa. Ao iniciar, `carregarDoDisco()` é chamado uma vez (ver
 * `main.ts`) para restaurar a última configuração salva.
 */
@Injectable()
export class ParametrizacaoService {
  obterAliquotasPlenas(): { cbs: string; ibs: string } {
    return { cbs: obterAliquotaCbsPlena().toString(), ibs: obterAliquotaIbsPlena().toString() };
  }

  definirAliquotasPlenas(cbs: string, ibs: string): { cbs: string; ibs: string } {
    const cbsDecimal = new Decimal(cbs);
    const ibsDecimal = new Decimal(ibs);
    definirAliquotasPlenas(cbsDecimal, ibsDecimal);
    escreverJson(ARQUIVO, { cbs: cbsDecimal.toString(), ibs: ibsDecimal.toString() } as AliquotasPlenasPersistidas);
    return this.obterAliquotasPlenas();
  }

  restaurarPadrao(): { cbs: string; ibs: string } {
    restaurarAliquotasPlenasPadrao();
    escreverJson(ARQUIVO, { cbs: obterAliquotaCbsPlena().toString(), ibs: obterAliquotaIbsPlena().toString() } as AliquotasPlenasPersistidas);
    return this.obterAliquotasPlenas();
  }

  /** Chamado uma vez na inicialização do programa (`main.ts`) para restaurar a última configuração salva em disco, se houver. */
  carregarDoDisco(): void {
    const salvo = lerJson<AliquotasPlenasPersistidas | null>(ARQUIVO, null);
    if (salvo) {
      try {
        definirAliquotasPlenas(new Decimal(salvo.cbs), new Decimal(salvo.ibs));
      } catch {
        // valor salvo inválido/corrompido — mantém o padrão do sistema em vez de travar a inicialização
      }
    }
  }
}
