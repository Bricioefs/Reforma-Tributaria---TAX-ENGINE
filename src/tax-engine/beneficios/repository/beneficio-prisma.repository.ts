import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaClient } from '@prisma/client';
import { BeneficioCadastrado } from '../beneficios.service';

/**
 * Repositório Prisma de Benefícios — implementação de produção que
 * substitui o `SEED_BENEFICIOS` em memória usado nas Fases 1-4.
 *
 * Lê das tabelas `Beneficio` + `BeneficioClassificacao` (ver
 * `prisma/schema.prisma`) e converte para o formato consumido por
 * `BeneficiosService`. Injetar via `BeneficiosService.hidratarDoRepositorio()`
 * no bootstrap da aplicação (ver `main.ts`), assim que `DATABASE_URL`
 * estiver configurado.
 */
@Injectable()
export class BeneficioPrismaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listarVigentes(dataReferencia: Date = new Date()): Promise<BeneficioCadastrado[]> {
    const registros = await this.prisma.beneficio.findMany({
      where: {
        vigenciaInicio: { lte: dataReferencia },
        OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: dataReferencia } }],
      },
      include: { classificacoes: true },
    });

    return registros.map((r: any) => ({
      codigo: r.codigo,
      tipo: r.tipo as BeneficioCadastrado['tipo'],
      percentualReducao: r.percentualReducao ? new Decimal(r.percentualReducao.toString()) : undefined,
      baseLegal: r.baseLegal,
      cumulativo: r.cumulativo,
      vigenciaInicio: r.vigenciaInicio,
      vigenciaFim: r.vigenciaFim ?? undefined,
      criterios: {
        ncm: this.coletar(r.classificacoes, 'ncmCodigo'),
        nbs: this.coletar(r.classificacoes, 'nbsCodigo'),
        cest: this.coletar(r.classificacoes, 'cest'),
        cnae: this.coletar(r.classificacoes, 'cnaeCodigo'),
        uf: this.coletar(r.classificacoes, 'uf'),
        municipioIbge: this.coletar(r.classificacoes, 'municipioIbge'),
        tipoOperacao: this.coletar(r.classificacoes, 'tipoOperacao'),
        destinacao: this.coletar(r.classificacoes, 'destinacao'),
        finalidade: this.coletar(r.classificacoes, 'finalidade'),
      },
    }));
  }

  private coletar(itens: any[], campo: string): string[] | undefined {
    const valores = itens.map((i) => i[campo]).filter((v: unknown): v is string => typeof v === 'string');
    return valores.length > 0 ? [...new Set(valores)] : undefined;
  }
}
