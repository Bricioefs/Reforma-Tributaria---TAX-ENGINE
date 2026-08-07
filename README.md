# Reforma-Tributaria---TAX-ENGINE

Motor de cálculo tributário para a Reforma Tributária brasileira (EC
132/2023 e LC 214/2025) — apura IBS, CBS e Imposto Seletivo operação a
operação, ano a ano, do início da transição (2026) até o sistema pleno
(2033), com auditoria completa de cada cálculo.

---

## O que este projeto faz

Dado um lançamento (uma venda, compra, importação, remessa etc. — manual
ou importado em lote de uma planilha), o sistema:

- Identifica automaticamente qual **regime tributário** se aplica
  (14 regimes: cesta básica, Simples Nacional, Zona Franca de Manaus,
  administração pública, combustíveis, serviços financeiros, e outros),
  respeitando uma ordem de precedência explícita para os casos em que
  mais de um regime poderia se aplicar.
- Busca automaticamente **benefícios fiscais** por NCM, NBS, CEST, CFOP
  ou CNAE, numa base real de ~2.281 códigos (Conformidade Fácil +
  Anexo VIII oficial).
- Calcula a **alíquota efetiva de IBS e CBS já considerando o
  cronograma de transição** — 2026 em alíquota-teste, CBS plena a
  partir de 2027, IBS subindo gradualmente de 2029 a 2033.
- Trata as regras específicas de crédito para compras de fornecedores
  optantes pelo **Simples Nacional** (não assume crédito integral
  automaticamente).
- Também acompanha, opcionalmente, os **tributos do sistema atual**
  (PIS, COFINS, ICMS, ISS, IPI) aplicando o cronograma de
  extinção/redução de cada um — dando uma previsão da carga tributária
  **total**, não só do que a reforma introduz.
- Gera **apuração, projeção anual, dashboard e exportação** (Excel com
  gráficos nativos e PDF) prontos para análise ou para levar a um
  cliente.

Toda regra aplicada fica registrada com base legal, parâmetros usados e
valor apurado — a auditoria de qualquer cálculo pode ser reconstruída
depois, sem depender de "confiar" no resultado.

## Por que este projeto é útil

A Reforma Tributária troca cinco tributos (PIS, COFINS, ICMS, ISS, IPI)
por três (IBS, CBS, Imposto Seletivo) ao longo de uma transição de oito
anos, com alíquotas que mudam ano a ano, dezenas de regimes e benefícios
setoriais, e regras específicas para casos como Simples Nacional,
exportação, importação e Zona Franca de Manaus. Calcular isso à mão —
ou replicar a lógica em planilha — é trabalhoso e sujeito a erro,
especialmente para quem lida com um volume real de lançamentos.

Este projeto nasceu para resolver isso: em vez de recalcular a cada
ano/regra nova, o cronograma de transição e cada regime ficam
centralizados em um único motor, testado (350+ testes automatizados) e
já validado com **planilhas reais de uma empresa em produção**
(dezenas de milhares de lançamentos de entrada e saída).

## Como começar

### Se você só quer usar o sistema (contador, escritório contábil)

Baixe o executável pronto para o seu sistema operacional — não precisa
instalar Node.js nem nada além do próprio instalador:

- **Windows**: `TaxEngine-Setup.exe` — instalador normal, abre numa
  janela própria.
- **Linux**: `TaxEngine-x86_64.AppImage` — dois cliques, não precisa
  instalar.
- **Mac**: pasta `Mac/` → `INICIAR.command` — abre pelo navegador.

Na primeira vez que abrir, o programa pede uma **chave de ativação**
(formato `AAAAA-BBBBB-CCCCC-DDDDD`) e depois um usuário/senha — veja
`scripts/gerar-chave-ativacao.js` para gerar chaves, e
`servidor-licencas/README.md` se quiser ativação online (impede a
mesma chave em dois computadores).

Os lançamentos, o histórico e as apurações ficam salvos numa pasta
`dados` ao lado do programa — sobrevivem a fechar e abrir de novo.

### Se você vai desenvolver ou rodar a partir do código-fonte

Pré-requisitos: [Node.js](https://nodejs.org) 18 ou mais recente.

```bash
npm install
npx jest                # roda a suíte de testes (350+ testes)
npm run start:dev       # sobe a API + interface web em http://localhost:3000
```

Para gerar os executáveis standalone (não precisa de Node.js instalado
em quem for usar):

```bash
npm run build:exe       # gera dist-exe/tax-engine-{linux,macos,win.exe}
```

Para empacotar o app desktop (Electron), veja `desktop-app/README.md`.

## Funcionalidades principais

- **Cálculo manual** de uma operação, com todos os campos da LC 214/2025
  (frete, seguro, despesas, desconto, base aduaneira para importação,
  CFOP, CST, etc.).
- **Importação de planilha** (Excel) em lote, com barra de progresso,
  reconhecimento automático de colunas comuns em exportações fiscais
  reais, cálculo de ISS por CFOP específico, e consulta automática (por
  CNPJ único, não por linha) de quais fornecedores/clientes são
  optantes pelo Simples Nacional.
- **Apuração automática** por competência (débitos × créditos, saldo a
  pagar ou credor) e **projeção anual** 2026-2033, incluindo a carga
  tributária total (PIS/COFINS/ICMS/ISS/IPI, não só IBS/CBS).
- **Dashboard** com indicadores relevantes para decisão: economia
  gerada por benefício fiscal, evolução do saldo, comparativo de
  entradas por regime da contraparte (Simples Nacional vs. demais).
- **Exportação** para Excel (com gráficos nativos de verdade, editáveis
  como qualquer gráfico feito à mão) e PDF resumido.
- **Alíquotas de referência configuráveis** — a LC 214/2025 ainda não
  fixa o percentual definitivo; o sistema usa um padrão (28% = 10% CBS
  + 18% IBS) que pode ser ajustado para testar outros cenários.
- **Ativação por chave de produto** (opcional, com servidor de
  licenças próprio) e login local.

## Onde conseguir ajuda

- **Como e por que cada coisa foi construída** (decisões técnicas,
  bugs corrigidos e o porquê, limitações conhecidas): veja
  [`HISTORICO-DESENVOLVIMENTO.md`](./HISTORICO-DESENVOLVIMENTO.md) — o
  registro completo e cronológico do desenvolvimento.
- **Pendências regulamentares**: pontos da lei que ainda não têm
  regulamentação definitiva (ex: alíquota de referência exata, detalhes
  de alguns regimes) estão sinalizados diretamente nos comentários do
  código onde se aplicam — procure por `PENDÊNCIA REGULAMENTAR`.
- **Hospedar o servidor de licenças / gerar chaves de ativação**: veja
  [`servidor-licencas/README.md`](./servidor-licencas/README.md).
- **Dúvidas de uso do programa pronto**: o arquivo `LEIA-ME.txt` que
  acompanha o instalador tem as perguntas mais comuns.
- Para qualquer outra dúvida, entre em contato diretamente com o
  mantenedor (abaixo).

## Quem mantém este projeto

Desenvolvido e mantido por **Fabrício Fernando Elias Silva**, contador
com mais de 20 anos de experiência em tributos federais, estaduais e
municipais.

## Aviso

Este sistema é uma ferramenta de apoio ao cálculo e à apuração — não
substitui a análise profissional de um contador para casos concretos,
especialmente enquanto a regulamentação da Reforma Tributária segue
sendo publicada. Pontos sem regulamentação definitiva na lei são
tratados com o cenário mais amplamente divulgado até o momento, e estão
sinalizados no código para revisão quando a norma definitiva sair.

