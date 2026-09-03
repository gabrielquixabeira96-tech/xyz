# Residência Max — plataforma de estudo de Cirurgia

Site para internos e residentes de cirurgia que reúne, em um único lugar, todo o
material de estudo já produzido: as aulas do ebook, as questões com gabarito
comentado, os cartões de repetição espaçada e o blueprint da prova.

A navegação é a que foi pedida: **ícone de cada matéria → página com os ícones de
todos os temas/aulas daquela matéria → conteúdo do tema**. Tem versão desktop
(barra lateral fixa) e versão mobile (barra superior, mini-player e navegação
inferior), com o mesmo conteúdo por baixo.

## Rodar

Não há build nem dependências. Basta abrir `index.html` no navegador, ou servir
a pasta:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Publicar é copiar a pasta para qualquer host estático (GitHub Pages, Vercel,
Netlify, S3). Só há um cuidado: o CSS carrega as fontes Cormorant Garamond e
Lora do Google Fonts; sem rede, o navegador cai nas serifadas do sistema.

## O que tem dentro

| Números | |
| --- | --- |
| Matérias | 26, ordenadas pelo peso previsto para a prova |
| Temas | 131 |
| Aulas | 45 — 26 do ebook, 17 de apresentações, 2 aulas-atlas interativas |
| Questões comentadas | 194, em 5 coleções |
| Cartões | 321, com as cinco caixas de Leitner |

### As aulas vêm em três formatos

- **Ebook** — as caixas *O que cai · A pegadinha · Macete · Fixação* e as tabelas
  do *Rumo aos 100%*, preservadas.
- **Apresentações** — as reuniões científicas e aulas em slides (hérnias
  complexas, cólica reno-ureteral, TXA/POISE-3, doença renal crônica, bypass) e
  o Guia de Referência Rápida, cujas seções foram distribuídas entre as
  matérias que cada uma cobre.
- **Interativas** — as aulas-atlas em HTML (câncer de mama, tumores de
  testículo) abrem dentro da plataforma, sem alteração nenhuma no arquivo
  original, e também em tela cheia.

### As cinco coleções de questões

| Coleção | Questões | O que cada uma traz |
| --- | --- | --- |
| Simulado inédito ENARE R+ Cirurgia | 80 | questão-fonte, bibliografia, o dado alterado, distratores, lacuna |
| Simulado Esôfago de Barrett | 44 | gatilho, comentário, distrator por letra, pérola |
| Simulado Tumores neuroendócrinos do pâncreas | 42 | gatilho, fisiologia, nota por alternativa, pérola |
| Lista ENARE 2025 · R+ Cirurgia | 20 | questões reais, com o rótulo de origem preservado |
| Tumores de testículo — guia high-yield | 8 | feedback da questão |

### Telas

- **Painel** — saudação, provas no horizonte, faixa de estatísticas, matérias
  essenciais, mapa de lacunas, mapa de calor por tema e "retomar de onde parou".
- **Matérias** — a grade de ícones de todas as matérias, filtrável pelas três
  camadas do plano de ataque (núcleo, baratos, cauda).
- **Matéria** — os ícones de todos os temas/aulas daquela matéria.
- **Tema** — as aulas, os cartões e as questões comentadas vinculadas ao tema.
- **Aula** — o leitor do ebook, com as caixas *O que cai · A pegadinha · Macete ·
  Fixação* e as tabelas preservadas.
- **Prática** — campo cego, só as que errei, prova completa, por matéria ou por
  coleção; revela gabarito, gatilho, comentário integral, análise dos
  distratores, fisiologia, pérola, questão-fonte, bibliografia e lacuna testada
  — o que a fonte de cada questão trouxer. Teclado: `1`–`5` marca, `Enter`
  confirma, `→` avança.
- **Cartões** — fila de repetição espaçada (caixas de 1, 3, 7, 16 e 35 dias).
- **Buscar** — busca única sobre matérias, temas, aulas, cartões e questões.
- **Acervo** — a procedência de cada fonte importada e o relatório de quarentena.

O progresso (aulas lidas, respostas, caixas dos cartões, notas de recall) fica no
`localStorage` do navegador. Não sai dali e não sincroniza entre aparelhos.

## Estrutura

```
index.html                 shell da página
assets/css/app.css         design system (tokens, shell desktop e mobile)
assets/js/app.js           SPA: roteamento por hash, telas, progresso
assets/data/conteudo.js    dataset gerado — não edite à mão
assets/img/                44 placas de fundo dos ladrilhos
content-src/               o material bruto, como veio das fontes
  apresentacoes/           slides das aulas e reuniões científicas
  simulados-html/          questões extraídas dos HTMLs interativos
assets/interativas/        as aulas-atlas em HTML, intactas
tools/taxonomia.py         matérias, temas e as palavras-chave de classificação
tools/build_content.py     o pipeline de ingestão
```

## Reprocessar o conteúdo

```bash
python3 tools/build_content.py
```

O script lê `content-src/` e regrava `assets/data/conteudo.js`, imprimindo ao
final quantos itens entraram e quantos foram para a quarentena.

**Regra que o pipeline segue:** ele transporta conteúdo, não o reescreve. Nenhum
enunciado, comentário, cartão ou aula é resumido, corrigido, traduzido ou
completado na importação — entram literalmente como estão nos arquivos de
origem. O que não puder ser lido vai para a quarentena e aparece na tela
**Acervo**; perda silenciosa é falha do build. A organização em matérias e temas
é o único acréscimo, e é apenas um índice.

## Adicionar material novo

1. Coloque o arquivo em `content-src/`.
2. Escreva o parser correspondente em `tools/build_content.py` (um por formato,
   todos devolvendo o mesmo objeto canônico).
3. Se o material trouxer temas novos, acrescente-os em `tools/taxonomia.py` com
   as palavras-chave que os identificam.
4. Rode `python3 tools/build_content.py` e confira o resumo impresso.

## Fontes importadas

- Ebook *Rumo aos 100% — R+ Cirurgia Geral* (26 aulas em 9 módulos)
- Simulado inédito ENARE R+ Cirurgia — caderno de 80 questões
- Gabarito comentado e rastreio bibliográfico das mesmas 80 questões
- Deck ENARE de repetição espaçada (321 cartões)
- Análise de padrões ENARE 2021–2026 e previsão para 2027, que define a ordem
  das matérias e o peso exibido no painel
- Reunião científica *Hérnias Complexas da Parede Abdominal* (HGMC, 41 slides)
- *Guia de Referência Rápida em Condutas Cirúrgicas e de Emergência*
- *Abordagem da Cólica Reno-Ureteral no Pronto Atendimento*
- *Ácido Tranexâmico em Cirurgia Geral — subanálise do POISE-3*
- *Doença Renal Crônica — Parte I* (capacitação multiprofissional SES/MT)
- *Por que não consigo ganhar peso depois do bypass* (material para o paciente)
- Aulas-atlas interativas de câncer de mama e tumores de testículo
- Simulados de Esôfago de Barrett e de tumores neuroendócrinos do pâncreas
- Lista de 20 questões do ENARE 2025

### Uma nota sobre classificação

Alguns rótulos dos arquivos de origem não batem com o assunto do enunciado — na
lista do ENARE 2025, por exemplo, uma questão de bariátrica vem rotulada como
"Cirurgia Vascular". O pipeline **não corrige o arquivo**: ele classifica pelo
conteúdo (enunciado, comentário e a alternativa correta) e mantém o rótulo
original visível na questão. Distratores ficam de fora da classificação, porque
são construídos sobre temas vizinhos de propósito.
