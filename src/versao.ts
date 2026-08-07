/**
 * Versão atual deste app — mantenha IGUAL ao campo "version" de
 * package.json (não lida de lá diretamente porque não é garantido que
 * o `package.json` esteja acessível em tempo de execução dentro do
 * executável empacotado pelo `pkg`; uma constante simples é mais
 * confiável). Suba este número a cada nova versão distribuída, e
 * publique a mesma versão no servidor de licenças (`POST /admin/definir-versao`,
 * ver `servidor-licencas/README.md`) para os usuários verem o aviso de
 * atualização disponível.
 */
export const VERSAO_APP = '0.1.0';
