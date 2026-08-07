import { Injectable } from '@nestjs/common';
import { RegistroMemoriaCalculo } from '../interfaces/tax-engine.interfaces';
import { lerJson, escreverJson, escreverJsonAsync } from '../persistencia/armazenamento-arquivo.util';

type RegistroAuditoria = { operacaoId: string; memoria: RegistroMemoriaCalculo };

const ARQUIVO = 'memoria-calculo.json';

/**
 * Serviço de Auditoria — mantém a memória de cálculo completa de cada
 * tributo apurado, conforme exigido pela LC 214/2025: regra aplicada,
 * artigo/inciso/alínea/parágrafo, parâmetros usados, benefício aplicado,
 * alíquota utilizada, data de vigência e versão da regra.
 *
 * Persiste em `dados/memoria-calculo.json` (ver `armazenamento-arquivo.util.ts`)
 * — sobrevive a fechar e reabrir o programa, sem precisar de banco de
 * dados configurado. Em produção com Prisma conectado, substituir por
 * `PrismaMemoriaCalculoRepository` (Event Sourcing: cada cálculo é um
 * evento imutável, permitindo reconstrução histórica e resposta a
 * fiscalizações) — ver `HISTORICO-DESENVOLVIMENTO.md`.
 *
 * NOTA: registros recarregados do arquivo trazem os campos `Decimal`
 * (`aliquotaUtilizada`, `baseCalculo`, `valorApurado`) já como `string`
 * (resultado do `JSON.stringify`/`JSON.parse`), não mais como instâncias
 * de `Decimal`. Isso é seguro porque `Decimal.plus()`/`.times()` aceitam
 * `string` como argumento normalmente (usado em `DashboardService`), mas
 * qualquer código novo que espere chamar métodos de `Decimal` direto
 * nesses campos após um recarregamento precisa envolver com `new Decimal(...)`.
 */
@Injectable()
export class AuditoriaService {
  private readonly registros: RegistroAuditoria[];
  private escritaAutomaticaSuspensa = false;

  constructor() {
    this.registros = lerJson<RegistroAuditoria[]>(ARQUIVO, []);
  }

  registrar(operacaoId: string, memoria: RegistroMemoriaCalculo): void {
    this.registros.push({ operacaoId, memoria });
    if (!this.escritaAutomaticaSuspensa) escreverJson(ARQUIVO, this.registros);
  }

  /**
   * Mesmo mecanismo de `LancamentosService` — suspende a gravação em disco
   * a cada `registrar()`. Ainda mais importante aqui: cada OPERAÇÃO gera 3
   * registros (um por tributo — IBS estadual, IBS municipal, CBS), então
   * numa importação de planilha o volume de gravações é o TRIPLO do de
   * `LancamentosService` se não for agrupado em lote.
   */
  suspenderEscritaAutomatica(): void {
    this.escritaAutomaticaSuspensa = true;
  }

  retomarEscritaAutomatica(): void {
    this.escritaAutomaticaSuspensa = false;
    this.persistir();
  }

  persistir(): void {
    escreverJson(ARQUIVO, this.registros);
  }

  /** Ver `escreverJsonAsync()` — usada pela importação de planilha para não bloquear o envio dos eventos SSE de progresso durante uma gravação grande. */
  async persistirAsync(): Promise<void> {
    await escreverJsonAsync(ARQUIVO, this.registros);
  }

  obterMemoriaDaOperacao(operacaoId: string): RegistroMemoriaCalculo[] {
    return this.registros.filter((r) => r.operacaoId === operacaoId).map((r) => r.memoria);
  }

  /** Usado por relatórios de fechamento e por dashboards de "economia obtida por benefícios". */
  listarTodos(): RegistroAuditoria[] {
    return [...this.registros];
  }
}
