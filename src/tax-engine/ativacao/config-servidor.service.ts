import { Injectable } from '@nestjs/common';
import { lerJson } from '../persistencia/armazenamento-arquivo.util';

interface ConfigServidor {
  urlServidorLicencas?: string;
}

/**
 * De onde vem a URL do servidor central de licenças/atualizações — TOTALMENTE
 * OPCIONAL: sem ela configurada, o app funciona exatamente como antes
 * (ativação só local/offline, sem checagem de atualização). Configurando,
 * a ativação passa a checar com o servidor central (impede a mesma chave
 * em duas máquinas de verdade) e o app passa a avisar quando há uma
 * versão nova.
 *
 * Duas formas de configurar (a variável de ambiente tem prioridade):
 *   1. Variável de ambiente `URL_SERVIDOR_LICENCAS` (ex: ao rodar o
 *      executável, ou definida no atalho/serviço que o inicia).
 *   2. Arquivo `dados/config-servidor.json` — `{ "urlServidorLicencas": "https://seu-servidor.com" }`
 *      — mais fácil pra quem só tem o executável e não sabe mexer em
 *      variável de ambiente do Windows.
 */
@Injectable()
export class ConfigServidorService {
  obterUrlServidorLicencas(): string | undefined {
    if (process.env.URL_SERVIDOR_LICENCAS) {
      return process.env.URL_SERVIDOR_LICENCAS.replace(/\/+$/, '');
    }
    const config = lerJson<ConfigServidor | null>('config-servidor.json', null);
    return config?.urlServidorLicencas?.replace(/\/+$/, '');
  }
}
