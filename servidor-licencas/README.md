SERVIDOR DE LICENÇAS — COMO HOSPEDAR E USAR
==============================================

Isto é uma peça SEPARADA do programa que seus clientes usam — este
servidor precisa ficar rodando 24 horas por dia, em algum lugar
acessível pela internet, controlado por VOCÊ (não pelo cliente). Sem
ele rodando, o app volta sozinho para o modo offline de sempre (chave
só verificada localmente, sem vínculo a CNPJ nem painel).


COMO O LICENCIAMENTO FUNCIONA (MODELO VINCULADO A CNPJ)
------------------------------------------------------------
1. O cliente compra o sistema.
2. Você GERA a licença no painel administrativo (`/admin`), associando
   o CNPJ (ou CPF) do cliente — a licença nasce ATIVA, mas sem nenhum
   computador vinculado ainda.
3. Você envia a chave gerada pro cliente.
4. Na primeira vez que o cliente digita a chave no app, o sistema
   identifica o computador dele e avisa o servidor — a licença fica
   vinculada A ESSE computador.
5. Toda vez que o app abre depois, ele revalida com o servidor. Se o
   cliente tentar usar a MESMA chave em outro computador, o servidor
   recusa: "Licença já utilizada em outro equipamento."

IMPORTANTE: diferente da versão anterior deste servidor, uma chave só
funciona se você a tiver gerado pelo painel PRIMEIRO — não basta mais
"qualquer chave com formato válido" se autoativar sozinha. Isso é o
que garante que só licenças que você realmente vendeu funcionam.

SITUAÇÕES ESPECIAIS — o painel já cobre as três:
  • Troca de computador / formatação: no painel, clique em "Liberar
    (troca de PC)" na licença do cliente — isso remove o vínculo com o
    computador antigo, e a MESMA chave pode ser ativada de novo, no
    computador novo, sem precisar gerar uma chave nova.
  • Cliente parou de pagar: clique em "Bloquear" — o acesso para
    imediatamente (a próxima vez que o programa dele tentar revalidar,
    é bloqueado), sem precisar desinstalar nada na máquina do cliente.
    "Desbloquear" reverte.
  • Licença com prazo (opcional): defina uma data de validade ao gerar
    a licença — depois dela, a ativação/revalidação é recusada
    automaticamente, sem você precisar fazer nada manualmente.


COMO USAR O PAINEL ADMINISTRATIVO
------------------------------------
Depois do servidor no ar, acesse `SUA-URL/admin` no navegador — por
exemplo, `https://seu-servico.up.railway.app/admin`. Faça login com o
`SEGREDO_ADMIN` que você configurou (veja abaixo). De lá, você:
  • Gera novas licenças (CNPJ/CPF + validade opcional)
  • Vê todas as licenças: situação (ativa/bloqueada/expirada/não
    ativada ainda), qual computador está usando, quando foi gerada e
    ativada
  • Libera uma licença para o cliente trocar de computador
  • Bloqueia/desbloqueia uma licença

Não existe cadastro de administrador com usuário/senha individual
nesta primeira versão — é uma senha única (`SEGREDO_ADMIN`) compartilhada
por quem tiver acesso ao painel. Se isso for um problema (mais de uma
pessoa gerenciando licenças, querendo saber QUEM bloqueou o quê), é
uma extensão possível do mesmo modelo — avise se precisar.


OPÇÃO MAIS FÁCIL DE HOSPEDAR: RAILWAY OU RENDER (GRÁTIS PRA COMEÇAR)
------------------------------------------------------------------------
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
   passo de configuração do app cliente, mais abaixo, e também pra
   acessar o painel em /admin.


OPÇÃO ALTERNATIVA: SUA PRÓPRIA VPS (DIGITALOCEAN, CONTABO, ETC.)
------------------------------------------------------------------------
1. Instale o Node.js no servidor (https://nodejs.org)
2. Copie esta pasta "servidor-licencas" inteira pro servidor
3. Rode: node servidor.js
   (para manter rodando mesmo se o servidor reiniciar, use PM2:
   npm install -g pm2 && pm2 start servidor.js && pm2 save && pm2 startup)
4. Configure um domínio/subdomínio apontando pro servidor, com HTTPS
   (ex: usando Nginx + Certbot na frente) — não é obrigatório pra
   funcionar, mas é mais seguro que HTTP puro, especialmente porque o
   painel /admin não tem nenhuma outra proteção além do HTTPS + senha


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
sempre (qualquer chave com checksum válido ativa — sem vínculo a
CNPJ, sem painel, sem impedir duas máquinas). Não é obrigatório usar
o servidor — mas sem ele, você perde justamente a garantia de "uma
licença, um computador" que motivou construir tudo isso.


GERANDO A PRIMEIRA CHAVE SEM O SERVIDOR CONFIGURADO (MODO OFFLINE)
------------------------------------------------------------------------
Se você só quer testar o programa rapidamente, sem subir o servidor
ainda: use `node gerar-chave-ativacao.js` (na raiz do pacote entregue)
— gera uma chave que ativa direto, sem precisar de servidor nenhum.
Essa chave NÃO aparece no painel (porque o painel só existe quando o
servidor está configurado) e NÃO impede uso em duas máquinas — é só
pra destravar o programa rapidamente. Pra clientes de verdade, use o
painel (`/admin`), que é o fluxo com CNPJ e vínculo de máquina real.


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
acesso a este pacote consegue usar pra gerar chaves "válidas" sozinha
no MODO OFFLINE (sem servidor). Com o servidor configurado e o
cliente apontando pra ele, isso importa menos — mesmo uma chave com
checksum válido é recusada se não tiver sido gerada pelo painel.


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


LIMITAÇÃO HONESTA
--------------------
Com o servidor de licenças configurado, a mesma chave NÃO PODE mais
ser usada em dois computadores — o servidor central impede de verdade,
testado e confirmado (inclusive os cenários de troca de computador e
bloqueio por inadimplência, todos automatizados em teste). O que
ainda não está aqui: múltiplos administradores com login próprio
(hoje é uma senha única compartilhada), notificação automática por
e-mail quando uma licença expira, e faturamento/cobrança — tudo isso
são extensões possíveis do mesmo modelo, fora do escopo desta versão.
