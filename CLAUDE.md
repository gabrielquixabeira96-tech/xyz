# Residência Max — contexto do projeto

Plataforma de estudo de Cirurgia Geral para internos e residentes. Reúne o
material que o autor já produziu (ebook, apresentações, aulas-atlas em HTML,
simulados e deck de repetição espaçada) numa navegação de dois níveis:
**matéria → tema → conteúdo**.

## Como rodar

Não há build, bundler nem dependências. É HTML/CSS/JS puro.

```bash
python3 -m http.server 8000   # http://localhost:8000
```

`index.html` também abre direto do disco (`file://`), porque o conteúdo é
carregado por `<script>` e não por `fetch`.

## Arquitetura

| Caminho | O que é |
| --- | --- |
| `index.html` | shell da página; só carrega o dataset e a aplicação |
| `assets/css/app.css` | design system completo (tokens, shell desktop e mobile) |
| `assets/js/app.js` | a aplicação inteira: roteamento por hash, telas, progresso |
| `assets/data/conteudo.js` | **gerado** — `window.RM_DADOS`. Nunca edite à mão |
| `assets/img/` | 44 placas antigas (reserva) e `quadros/`, uma pintura por matéria |
| `assets/interativas/` | aulas-atlas em HTML do autor, servidas em iframe |
| `content-src/` | o material bruto das fontes |
| `tools/taxonomia.py` | matérias, temas e palavras-chave de classificação |
| `tools/build_content.py` | pipeline de ingestão → `assets/data/conteudo.js` |
| `tools/build_bundle.py` | empacota tudo num HTML único em `dist/` (placas, quadros e dados; os atlas em iframe ficam de fora) |

## Fluxo de trabalho

Para mudar **conteúdo**, edite `content-src/` ou `tools/taxonomia.py` e rode:

```bash
python3 tools/build_content.py    # imprime totais e a quarentena
python3 tools/build_bundle.py     # opcional: dist/residencia-max.html
```

Para mudar **a aplicação**, edite `assets/js/app.js` e `assets/css/app.css`
diretamente — não há etapa de compilação.

## Convenções que o código segue

- **O pipeline transporta conteúdo, não o reescreve.** Enunciados, comentários,
  cartões e slides entram literalmente como estão na fonte. Nada é resumido,
  corrigido, traduzido ou completado na importação. O que não puder ser lido vai
  para `quarentena` e aparece na tela **Acervo** — perda silenciosa é falha do
  build, e o build hoje termina com zero itens em quarentena.
- **Classificação usa conteúdo, não rótulo.** Uma questão é classificada pelo
  enunciado, pelo comentário e pela alternativa correta — nunca pelos
  distratores, que são construídos sobre temas vizinhos de propósito. O rótulo
  do arquivo de origem é só desempate e continua visível na questão.
- **Palavras-chave curtas são perigosas.** A classificação casa substring sem
  acento; `"pia"` casava dentro de "terapia" e `"ecn"` dentro de "técnica". Ao
  acrescentar termos em `taxonomia.py`, prefira expressões de 7+ caracteres e
  confira a distribuição impressa pelo build.
- **Estética Grand Hotel** (skill `estetica-grand-hotel`): o salão de um hotel
  europeu ao entardecer — luxo discreto, claro-escuro, cantos sempre retos,
  nada de pílula, emoji ou cor saturada.
  - *Paleta:* carvão `#0E0D0B` e petróleo `#1C2A2E` / veludo `#1F3A44` nas
    sombras; madeira `#3A2418`; latão `#B08D57` e âmbar `#E2B66E` na luz
    (rampa `--accent*`); marfim `#EDE6D6`; branco-gelo `#F4F1EA` no texto. O
    petróleo só aparece em sombras e superfícies — o destaque é sempre
    latão/âmbar.
  - *Fontes* (um `<link>` com preconnect no `index.html`; o
    `tools/build_bundle.py` repete o mesmo endereço no `dist/` — ao trocar uma
    fonte, mude nos dois): Bodoni Moda nos letreiros (h1/h2), Cormorant SC em
    versalete real nos rótulos, botões e navegação, Cormorant Garamond nos
    subtítulos, Lora no corpo. Títulos longos hifenizam (`hyphens:auto`, o
    `<html>` é `lang="pt-BR"`); confira 390 px ao mexer no tamanho.
  - *Materiais:* molduras douradas com rosetas (`.quadro`), cantoneiras e
    filetes duplos nos cartões (`--cantos`, `--filetes`), placas de latão
    gravadas (`.placa-latao`, `.btn-primary`, a marca e a barra lateral),
    separadores art déco (`--orn`). Fundo com vinheta, luz de lustre, papel de
    parede e grão — tudo no `background`, nunca por cima do iframe do atlas.
  - *Luz:* hover e foco acendem (brilho âmbar), sem saltos; a entrada de tela
    é só um fade com leve deslocamento.
- **Quadros por matéria.** Uma pintura de estilo renascentista por matéria em
  `assets/img/quadros/<slug>.webp` (slugs de `AREAS` em `tools/taxonomia.py`).
  Aparece emoldurada nos ladrilhos, nos cabeçalhos de matéria e tema, nos
  cartões de atlas e no "continuar"; os temas usam a pintura da matéria, cada
  um num recorte de detalhe diferente. Se o arquivo faltar, a `<img>` volta
  sozinha para a placa antiga de `assets/img/` (`data-fb`). Não há manifesto:
  basta o arquivo existir com o nome do slug. A origem e a licença de cada obra
  estão em `assets/img/quadros/creditos.md`. O `build_bundle.py` embute os
  `.webp` em `RM_IMG` (chave `assets/img/quadros/<slug>.webp`), então o `dist/`
  também mostra os quadros.
- **Sem dependências externas** além das fontes do Google Fonts. Nada de npm.
- **O progresso vive no `localStorage`** deste navegador, sob a chave
  `residencia-max/v1`. Não sincroniza entre aparelhos.

## Idioma

Código, comentários, commits e interface em português do Brasil.
