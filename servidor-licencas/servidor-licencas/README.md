SERVIDOR DE LICENÇAS — COMO HOSPEDAR
=======================================

Isto é uma peça SEPARADA do programa que seus clientes usam — este
servidor precisa ficar rodando 24 horas por dia, em algum lugar
acessível pela internet, controlado por VOCÊ (não pelo cliente). Sem
ele rodando, o app volta sozinho para o modo offline de sempre (chave
só verificada localmente).


OPÇÃO MAIS FÁCIL: RAILWAY OU RENDER (GRÁTIS PRA COMEÇAR)
------------------------------------------------------------
1. Crie uma conta em https://railway.app ou https://render.com
2. Crie um novo serviço "Node.js" / "Web Service"
3. Suba esta pasta "servidor-licencas" (ou conecte a um repositório Git
   com ela dentro)
4. Comando de start: node servidor.js
5. Nenhuma configuração de build necessária (não tem "npm install" —
   zero dependências externas)
6. Nas variáveis de ambiente do serviço, defina:
     SEGREDO_ADMIN = uma senha forte, só sua
7. Depois de publicado, você recebe uma URL tipo
   https://seu-servico.up.railway.app — essa é a URL que vai usar no
   passo de configuração do app cliente, mais abaixo.


OPÇÃO ALTERNATIVA: SUA PRÓPRIA VPS (DIGITALOCEAN, CONTABO, ETC.)
------------------------------------------------------------------------
1. Instale o Node.js no servidor (https://nodejs.org)
2. Copie esta pasta "servidor-licencas" inteira pro servidor
3. Rode: node servidor.js
   (para manter rodando mesmo se o servidor reiniciar, use PM2:
   npm install -g pm2 && pm2 start servidor.js && pm2 save && pm2 startup)
4. Configure um domínio/subdomínio apontando pro servidor, com HTTPS
   (ex: usando Nginx + Certbot na frente) — não é obrigatório pra
   funcionar, mas é mais seguro que HTTP puro


CONFIGURANDO O APP CLIENTE PRA USAR SEU SERVIDOR
------------------------------------------------------
Depois de ter a URL do seu servidor (ex: https://licencas.suaempresa.com.br),
configure em CADA instalação do app cliente — duas formas:

  Opção A — arquivo de configuração (mais fácil, não precisa saber
  mexer em variável de ambiente): crie o arquivo
      dados/config-servidor.json
  (na mesma pasta "dados" onde os lançamentos ficam salvos) com este
  conteúdo:
      { "urlServidorLicencas": "https://licencas.suaempresa.com.br" }

  Opção B — variável de ambiente (se você já tem experiência com isso):
      URL_SERVIDOR_LICENCAS=https://licencas.suaempresa.com.br

Sem NENHUMA das duas configuradas, o app funciona no modo offline de
sempre (não é obrigatório usar o servidor).


TROCANDO O SEGREDO DA CHAVE (MUITO IMPORTANTE ANTES DE DISTRIBUIR)
--------------------------------------------------------------------------
O algoritmo de chave usa uma "senha mestra" (SEGREDO_CHECKSUM) que
precisa ser IDÊNTICA em 3 lugares:
  1. algoritmo-chave.js (este arquivo, dentro de servidor-licencas)
  2. gerar-chave-ativacao.js (na raiz do pacote entregue)
  3. src/tax-engine/ativacao/chave-ativacao.util.ts (no código-fonte
     do app cliente — precisa gerar um novo executável depois de trocar)
Troque os 3 pro MESMO valor novo antes de gerar chaves de verdade —
do jeito que vem, é só um exemplo público que qualquer pessoa com
acesso a este pacote consegue usar pra gerar chaves "válidas" sozinha.


PUBLICANDO UMA NOVA VERSÃO (PRA APARECER O AVISO PROS USUÁRIOS)
------------------------------------------------------------------------
Toda vez que você distribuir uma versão nova do app:

  1. Suba o número em src/versao.ts (VERSAO_APP) e em package.json
     ("version"), gere os executáveis novos
  2. Avise o servidor de licenças da nova versão:

     curl -X POST https://seu-servidor.com/admin/definir-versao \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer SEU_SEGREDO_ADMIN" \
       -d '{"versao":"0.2.0","notas":"Corrigido bug X","urlDownload":"https://link-para-baixar.com"}'

  3. Pronto — todo usuário com o servidor configurado vê um aviso na
     tela, na próxima vez que abrir o programa (ou fizer login), com
     um botão pra baixar a versão nova.


LIMITAÇÃO HONESTA (a mesma de sempre, mas menor com o servidor ligado)
------------------------------------------------------------------------
Com o servidor de licenças configurado, a mesma chave NÃO PODE mais
ser usada em dois computadores — o servidor central impede de verdade,
testado e confirmado. O que ainda não está aqui: revogar uma chave
manualmente (ex: cliente parou de pagar), múltiplos administradores,
painel visual de gestão de chaves — tudo isso são extensões possíveis
do mesmo `dados/ativacoes.json`, mas ficaram fora desta primeira
versão por escopo.
