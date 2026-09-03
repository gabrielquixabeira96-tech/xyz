/* ==========================================================================
   Residência Max — aplicação
   SPA com roteamento por hash. Sem build, sem dependências: abre por
   file:// ou em qualquer host estático.
   ========================================================================== */
(function () {
  "use strict";

  var D = window.RM_DADOS;
  if (!D) { document.body.innerHTML = "<p style='padding:2rem'>Conteúdo não carregado.</p>"; return; }

  /* ── índices ─────────────────────────────────────────────────────────── */
  var porArea = {}, porTema = {}, aulaPorId = {}, cardPorId = {}, qPorId = {};
  D.areas.forEach(function (a) { porArea[a.slug] = a; });
  D.temas.forEach(function (t) { porTema[t.id] = t; });
  D.aulas.forEach(function (a) { aulaPorId[a.id] = a; });
  D.cards.forEach(function (c) { cardPorId[c.id] = c; });
  D.questoes.forEach(function (q) { qPorId[q.id] = q; });

  var TOTAL = {
    aulas: D.aulas.length, questoes: D.questoes.length,
    cards: D.cards.length, temas: D.temas.length, areas: D.areas.length
  };

  /* ── util ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function plural(n, um, muitos) { return n + " " + (n === 1 ? um : muitos); }
  function embaralhar(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ── progresso (local, por navegador) ────────────────────────────────── */
  var CHAVE = "residencia-max/v1";
  var P = { aulas: {}, questoes: {}, cards: {}, notas: {}, ultimo: null, streak: 0, dias: [] };
  try { var raw = localStorage.getItem(CHAVE); if (raw) P = Object.assign(P, JSON.parse(raw)); } catch (e) { }
  var salvarPendente = null;
  function salvar() {
    clearTimeout(salvarPendente);
    salvarPendente = setTimeout(function () {
      try { localStorage.setItem(CHAVE, JSON.stringify(P)); } catch (e) { }
    }, 120);
  }
  function marcarDia() {
    var hoje = new Date().toISOString().slice(0, 10);
    if (P.dias[P.dias.length - 1] !== hoje) { P.dias.push(hoje); P.dias = P.dias.slice(-400); }
    var n = 0, d = new Date();
    for (; ;) {
      var s = d.toISOString().slice(0, 10);
      if (P.dias.indexOf(s) === -1) break;
      n++; d.setDate(d.getDate() - 1);
    }
    P.streak = n; salvar();
  }
  var DIA = 864e5, INTERVALOS = [0, 1, 3, 7, 16, 35];
  function estadoCard(id) { return P.cards[id] || { caixa: 0, prox: 0, erros: 0 }; }
  function avaliarCard(id, acertou) {
    var e = estadoCard(id);
    e.caixa = acertou ? Math.min(5, (e.caixa || 0) + 1) : 1;
    if (!acertou) e.erros = (e.erros || 0) + 1;
    e.prox = Date.now() + INTERVALOS[e.caixa] * DIA;
    e.visto = Date.now();
    P.cards[id] = e; marcarDia(); salvar();
  }
  function cardsDevidos() {
    var agora = Date.now();
    return D.cards.filter(function (c) { var e = P.cards[c.id]; return !e || (e.prox || 0) <= agora; });
  }
  function registrarQuestao(id, letra, correta) {
    P.questoes[id] = { r: letra, ok: letra === correta, t: Date.now() };
    marcarDia(); salvar();
  }

  /* progresso 0..1 de um tema / de uma área */
  function progressoTema(t) {
    var total = t.aulas.length + t.questoes.length + t.cards.length, feito = 0;
    t.aulas.forEach(function (id) { if (P.aulas[id]) feito++; });
    t.questoes.forEach(function (id) { if (P.questoes[id]) feito++; });
    t.cards.forEach(function (id) { if (P.cards[id]) feito++; });
    return total ? feito / total : 0;
  }
  function progressoArea(a) {
    var total = 0, feito = 0;
    a.temas.forEach(function (id) {
      var t = porTema[id];
      total += t.aulas.length + t.questoes.length + t.cards.length;
      feito += progressoTema(t) * (t.aulas.length + t.questoes.length + t.cards.length);
    });
    return total ? feito / total : 0;
  }
  function acertoArea(a) {
    var ok = 0, n = 0;
    a.temas.forEach(function (id) {
      porTema[id].questoes.forEach(function (q) {
        var r = P.questoes[q]; if (r) { n++; if (r.ok) ok++; }
      });
    });
    return n ? { pct: Math.round(ok * 100 / n), n: n } : null;
  }

  /* ── ícones (linha, 1.6px, ~20px) ────────────────────────────────────── */
  var GLIFOS = {
    painel: ["M3 10.5 12 3l9 7.5", "M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5"],
    materias: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    pratica: ["M6 3.8h12a1 1 0 0 1 1 1v15.4a.5.5 0 0 1-.78.42L12 16.4l-6.22 4.22A.5.5 0 0 1 5 20.2V4.8a1 1 0 0 1 1-1Z"],
    cartoes: ["M3 7.5A1.5 1.5 0 0 1 4.5 6h11A1.5 1.5 0 0 1 17 7.5v9A1.5 1.5 0 0 1 15.5 18h-11A1.5 1.5 0 0 1 3 16.5Z", "M7 3h11.5A2.5 2.5 0 0 1 21 5.5V17"],
    busca: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16.2 16.2 4.3 4.3"],
    acervo: ["M3 5v14", "M7.5 5v14", "M12 5.6v12.8a.6.6 0 0 0 .92.5l9.1-6.4a.6.6 0 0 0 0-1l-9.1-6.4a.6.6 0 0 0-.92.5Z"],
    play: ["M7 4.5v15l12-7.5Z"],
    sino: ["M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],
    voltar: ["M19 12H5", "m12 19-7-7 7-7"],
    check: ["m20 6-11 11-5-5"],
    x: ["M18 6 6 18", "m6 6 12 12"],
    relogio: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7.5V12l3 2"],
    alvo: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z"],
    livro: ["M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5Z", "M8 3v18"],
    bisturi: ["M4 20 14.5 9.5", "M14 4.5 19.5 10 15 14 10 9Z"],
    seta: ["m9 5 7 7-7 7"]
  };
  function icone(nome, tam) {
    var d = GLIFOS[nome] || GLIFOS.alvo, s = tam || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      d.map(function (p) { return '<path d="' + p + '"/>'; }).join("") + "</svg>";
  }
  /* glifo característico por matéria — dá identidade ao ícone da matéria */
  var GLIFO_AREA = {
    coloproctologia: "alvo", perioperatorio: "relogio", "vias-biliares": "bisturi",
    "estomago-duodeno": "alvo", oncologia: "alvo", pancreas: "bisturi", trauma: "alvo",
    hernias: "bisturi", esofago: "bisturi", "apendice-delgado": "bisturi", figado: "alvo",
    etica: "livro", urologia: "bisturi", "endocrino-cp": "alvo", "anestesia-via-aerea": "relogio",
    "baco-transplante": "bisturi", vascular: "alvo", toracica: "bisturi",
    "pele-sarcomas": "bisturi", videolaparoscopia: "alvo", bariatrica: "bisturi",
    pediatrica: "alvo", mama: "alvo", anatomia: "livro", transversais: "livro"
  };

  /* ── ladrilho ────────────────────────────────────────────────────────── */
  function ladrilho(o) {
    var pr = Math.round((o.progresso || 0) * 100);
    return '<button class="tile" data-ir="' + esc(o.href) + '" title="' + esc(o.titulo + (o.dica ? " — " + o.dica : "")) + '">' +
      '<img class="tile-img" src="' + esc(o.img) + '" alt="" loading="lazy">' +
      '<span class="tile-scrim"></span>' +
      (o.glifo ? '<span class="tile-glyph">' + icone(o.glifo, 18) + "</span>" : "") +
      '<span class="tile-body">' +
      (o.legenda ? '<span class="tile-cap">' + esc(o.legenda) + "</span>" : "") +
      '<span class="tile-title">' + esc(o.titulo) + "</span></span>" +
      '<span class="tile-rail"><i style="width:' + pr + '%"></i></span></button>';
  }

  /* legenda curta do ladrilho: uma unidade só, para caber em tela estreita */
  function legendaTema(t) {
    if (t.aulas.length) return plural(t.aulas.length, "aula", "aulas");
    if (t.questoes.length) return plural(t.questoes.length, "questão", "questões");
    if (t.cards.length) return plural(t.cards.length, "cartão", "cartões");
    return "";
  }

  var FORMATOS = {
    ebook: "Aula do ebook", slides: "Apresentação", interativa: "Aula interativa"
  };

  function rotuloFormato(au) {
    var base = FORMATOS[au.formato || "ebook"] || "Aula";
    if ((au.formato || "ebook") === "ebook" && au.modulo) return base + " · Módulo " + au.modulo;
    if (au.formato === "slides" && au.nSlides) return base + " · " + plural(au.nSlides, "slide", "slides");
    return base;
  }

  /* de onde a questão veio, na linguagem do arquivo de origem */
  function rotuloQuestao(q) {
    return q.areaTexto || q.subtema || q.metaOriginal || (porArea[q.areaSlug] || {}).nome || "";
  }

  function contagemTema(t) {
    var p = [];
    if (t.aulas.length) p.push(plural(t.aulas.length, "aula", "aulas"));
    if (t.questoes.length) p.push(plural(t.questoes.length, "questão", "questões"));
    if (t.cards.length) p.push(plural(t.cards.length, "cartão", "cartões"));
    return p.join(" · ");
  }

  /* ── navegação ───────────────────────────────────────────────────────── */
  var NAV = [
    { chave: "painel", rotulo: "Painel", href: "#/", glifo: "painel" },
    { chave: "materias", rotulo: "Matérias", href: "#/materias", glifo: "materias" },
    { chave: "pratica", rotulo: "Prática", href: "#/pratica", glifo: "pratica" },
    { chave: "cartoes", rotulo: "Cartões", href: "#/cartoes", glifo: "cartoes" },
    { chave: "busca", rotulo: "Buscar", href: "#/busca", glifo: "busca" },
    { chave: "acervo", rotulo: "Acervo", href: "#/acervo", glifo: "acervo" }
  ];
  var secaoAtual = "painel";

  function irPara(href) {
    if (location.hash === href) render(); else location.hash = href;
  }

  /* ── shell ───────────────────────────────────────────────────────────── */
  var raiz = document.getElementById("app") || document.body;

  function montarShell() {
    raiz.innerHTML =
      '<div class="shell">' +
      '<aside class="sidebar">' +
      '<div class="brand" data-ir="#/">' +
      '<span class="brand-mark">' +
      '<svg width="11" height="12" viewBox="0 0 11 12" fill="#131211" aria-hidden="true"><path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1L1.92.7A.6.6 0 0 0 1 1.2Z"/></svg>' +
      "</span>" +
      '<span class="brand-name">Residência<span>Max</span></span></div>' +
      '<nav class="nav" id="nav-desktop" aria-label="Navegação principal"></nav>' +
      '<div class="side-block"><span class="kicker">Sequência</span>' +
      '<div class="streak"><b class="num" id="streak">0</b><span class="meta italic">dias seguidos de estudo</span></div></div>' +
      '<div class="side-user"><span class="avatar">GB</span><span class="meta">Gabriel Bezerra<br><span class="italic">R+ Cirurgia Geral</span></span></div>' +
      "</aside>" +
      '<div style="flex:1;min-width:0">' +
      '<header class="topbar">' +
      '<div class="brand" data-ir="#/" style="padding:0">' +
      '<span class="brand-mark"><svg width="11" height="12" viewBox="0 0 11 12" fill="#131211" aria-hidden="true"><path d="M1 1.2v9.6a.6.6 0 0 0 .92.5l7.6-4.8a.6.6 0 0 0 0-1L1.92.7A.6.6 0 0 0 1 1.2Z"/></svg></span>' +
      '<span class="brand-name">Residência<span>Max</span></span></div>' +
      '<div style="display:flex;align-items:center;gap:14px">' +
      '<button class="btn-ghost" style="border:0;background:none;cursor:pointer" data-ir="#/busca" aria-label="Buscar">' + icone("busca", 21) + "</button>" +
      '<span class="avatar">GB</span></div></header>' +
      '<main class="main" id="tela" tabindex="-1"></main>' +
      "</div></div>" +
      '<div class="dock"><div id="mini"></div><nav class="tabbar" id="nav-mobile" aria-label="Navegação"></nav></div>';

    document.getElementById("nav-desktop").innerHTML = NAV.map(function (n, i) {
      return '<button class="nav-item" data-nav="' + n.chave + '" data-ir="' + n.href + '">' +
        '<span class="idx num">' + ("0" + (i + 1)) + "</span>" + icone(n.glifo, 19) +
        "<span>" + n.rotulo + "</span></button>";
    }).join("");

    document.getElementById("nav-mobile").innerHTML = NAV.slice(0, 4).map(function (n) {
      return '<button data-nav="' + n.chave + '" data-ir="' + n.href + '">' +
        icone(n.glifo, 21) + "<span>" + n.rotulo + "</span></button>";
    }).join("");

    raiz.addEventListener("click", function (ev) {
      var alvo = ev.target.closest("[data-ir]");
      if (alvo) { ev.preventDefault(); irPara(alvo.getAttribute("data-ir")); }
    });
  }

  function atualizarShell() {
    document.getElementById("streak").textContent = P.streak || 0;
    Array.prototype.forEach.call(document.querySelectorAll("[data-nav]"), function (b) {
      if (b.getAttribute("data-nav") === secaoAtual) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    var mini = document.getElementById("mini");
    var u = P.ultimo;
    if (!u || secaoAtual === "pratica") { mini.innerHTML = ""; return; }
    mini.innerHTML = '<div class="miniplayer" data-ir="' + esc(u.href) + '">' +
      '<img src="' + esc(u.img) + '" alt="">' +
      '<span class="mp-t"><b>' + esc(u.titulo) + "</b><span>" + esc(u.meta) + "</span></span>" +
      '<span style="color:var(--ink);flex:none;padding-right:4px">' + icone("play", 17) + "</span></div>";
  }

  function lembrar(href, titulo, meta, img) {
    P.ultimo = { href: href, titulo: titulo, meta: meta, img: img }; salvar();
  }

  /* ── telas ───────────────────────────────────────────────────────────── */
  function saudacao() {
    var h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }

  function telaPainel() {
    secaoAtual = "painel";
    var respondidas = Object.keys(P.questoes).length;
    var certas = Object.keys(P.questoes).filter(function (k) { return P.questoes[k].ok; }).length;
    var taxa = respondidas ? Math.round(certas * 100 / respondidas) : 0;
    var devidos = cardsDevidos().length;
    var lidas = Object.keys(P.aulas).length;

    /* lacunas: áreas com pior aproveitamento, depois as menos vistas */
    var lacunas = D.areas.map(function (a) {
      var ac = acertoArea(a), pr = progressoArea(a);
      return { a: a, pct: ac ? ac.pct : null, n: ac ? ac.n : 0, pr: pr };
    }).sort(function (x, y) {
      if (x.pct === null && y.pct === null) return x.pr - y.pr || y.a.peso - x.a.peso;
      if (x.pct === null) return 1;
      if (y.pct === null) return -1;
      return x.pct - y.pct;
    }).slice(0, 5);

    var recomendados = D.areas.slice().sort(function (x, y) {
      return (progressoArea(x) - progressoArea(y)) || (y.peso - x.peso);
    }).slice(0, 6);

    var html =
      '<section class="split">' +
      "<div>" +
      '<h1 class="display">' + saudacao() + ", Gabriel.</h1>" +
      '<p class="prose narrow" style="margin-top:var(--s4)">Todo o material que você produziu está reunido aqui: ' +
      TOTAL.aulas + " aulas — do ebook, das suas apresentações e das aulas-atlas interativas —, " +
      TOTAL.questoes + " questões comentadas e " + TOTAL.cards + " cartões de repetição espaçada, " +
      "distribuídos em " + TOTAL.areas + " matérias e " + TOTAL.temas +
      " temas. A ordem das matérias segue o peso previsto para a prova de 2027 pela sua própria análise de padrões 2021–2026.</p>" +
      '<div style="display:flex;gap:var(--s3);margin-top:var(--s5);flex-wrap:wrap">' +
      '<button class="btn btn-primary" data-ir="#/pratica">Iniciar sessão de prática</button>' +
      '<button class="btn" data-ir="#/materias">Ver as matérias</button></div></div>' +

      '<div class="split-aside">' +
      '<span class="kicker">O que a prova pede</span>' +
      '<div style="margin-top:var(--s3)">' +
      D.areas.slice(0, 4).map(function (a, i) {
        return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--s3);padding:var(--s2) 0;border-bottom:1px solid var(--rule)">' +
          '<span><span style="display:block;font-family:var(--font-heading);font-size:17px;color:var(--ink-strong)">' + esc(a.nome) + "</span>" +
          '<span class="meta italic">' + esc(a.subtitulo) + "</span></span>" +
          '<b class="num" style="font-family:var(--font-heading);font-weight:300;font-size:30px;color:' +
          (i === 0 ? "var(--accent-400)" : "rgba(243,242,242,.5)") + '">' + a.peso + "</b></div>";
      }).join("") +
      '<p class="meta italic" style="margin-top:var(--s3)">Questões esperadas em 80, pela análise de padrões 2021–2026.</p>' +
      "</div></div></section>" +

      '<section class="statstrip" style="margin-top:var(--s7)">' +
      stat("Questões respondidas", respondidas, TOTAL.questoes + " no banco", respondidas > 0) +
      stat("Taxa de acerto", respondidas ? taxa + "%" : "—", respondidas ? "em " + respondidas + " questões" : "responda para medir", taxa >= 70) +
      stat("Aulas lidas", lidas, "de " + TOTAL.aulas + " do ebook", lidas > 0) +
      stat("Cartões devidos", devidos, devidos ? "prontos para revisar agora" : "nada vencido hoje", devidos > 0) +
      "</section>" +

      '<section class="split split-b" style="margin-top:var(--s7)">' +
      "<div>" +
      '<div class="section-head"><h2>Matérias essenciais</h2>' +
      '<button class="btn-ghost" style="background:none;border:0;cursor:pointer;font-size:12.5px" data-ir="#/materias">' +
      TOTAL.areas + " matérias · ver a grade completa</button></div>" +
      '<div class="tiles tiles-3">' + recomendados.map(function (a) {
        return ladrilho({
          href: "#/materia/" + a.slug, img: a.img, titulo: a.nome,
          legenda: plural(a.temas.length, "tema", "temas"),
          progresso: progressoArea(a), glifo: GLIFO_AREA[a.slug]
        });
      }).join("") + "</div></div>" +

      '<div><div class="section-head"><h3>Mapa de lacunas</h3></div>' +
      lacunas.map(function (l, i) {
        var pct = l.pct === null ? Math.round(l.pr * 100) : l.pct;
        return '<button class="rank" data-ir="#/materia/' + l.a.slug + '">' +
          '<span class="rank-idx num">' + ("0" + (i + 1)) + "</span>" +
          '<span style="flex:1;min-width:0"><span class="rank-nome">' + esc(l.a.nome) + "</span>" +
          '<span class="meta italic" style="display:block">' +
          (l.pct === null ? "ainda sem questões respondidas — " + Math.round(l.pr * 100) + "% do material visto"
            : l.n + " questões respondidas") + "</span>" +
          '<span class="bar"><i style="width:' + pct + '%"></i></span></span>' +
          '<b class="rank-pct num" style="color:' + (l.pct === null ? "var(--ink-meta)" : "var(--accent-400)") + '">' + pct + "%</b></button>";
      }).join("") +
      '<button class="btn btn-primary btn-block" style="margin-top:var(--s4)" data-ir="#/pratica?area=' + lacunas[0].a.slug + '">Praticar a maior lacuna</button>' +
      "</div></section>" +

      '<section style="margin-top:var(--s7)">' +
      '<div class="section-head"><h3>Mapa de calor por matéria</h3>' +
      '<span class="meta italic">cada quadrado é um tema</span></div>' +
      D.areas.map(function (a) {
        return '<div class="heat-row"><span class="heat-nome">' + esc(a.nome) + "</span>" +
          '<span class="heat-cells">' + a.temas.map(function (id) {
            var t = porTema[id], p = progressoTema(t);
            var cor = p >= .9 ? "transparent" : p >= .6 ? "var(--tint-1)" : p >= .3 ? "var(--tint-2)" : p > 0 ? "var(--tint-3)" : "var(--tint-4)";
            return '<button class="heat-cell" style="background:' + cor + '" data-ir="#/tema/' + esc(t.id) +
              '" title="' + esc(t.nome + " — " + Math.round(p * 100) + "% visto") + '"></button>';
          }).join("") + "</span></div>";
      }).join("") +
      '<div class="heat-legend"><span>Domínio</span>' +
      ["transparent", "var(--tint-1)", "var(--tint-2)", "var(--tint-3)", "var(--tint-4)"].map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join("") + "<span>Lacuna</span></div></section>" +

      '<section style="margin-top:var(--s7)">' +
      '<div class="section-head"><h3>Retomar de onde parou</h3></div>' +
      '<div class="grid-cards">' + proximosPassos().map(function (c) {
        return '<button class="card" style="text-align:left;cursor:pointer;padding:0;overflow:hidden" data-ir="' + esc(c.href) + '">' +
          '<img src="' + esc(c.img) + '" alt="" style="height:104px;width:100%;object-fit:cover;opacity:.8" loading="lazy">' +
          '<span style="display:block;padding:var(--s3) var(--s4) var(--s4)">' +
          '<span class="kicker kicker-gold">' + esc(c.kicker) + "</span>" +
          '<span style="display:block;font-family:var(--font-heading);font-size:20px;color:var(--ink-strong);margin:2px 0 4px">' + esc(c.titulo) + "</span>" +
          '<span style="display:block;font-size:13px;color:var(--ink-soft)">' + esc(c.corpo) + "</span></span></button>";
      }).join("") + "</div></section>";

    return html;
  }

  function stat(rotulo, valor, nota, dourado) {
    return "<div><span class=\"kicker\">" + esc(rotulo) + "</span>" +
      '<div class="stat-n num' + (dourado ? " gold" : "") + '">' + esc(valor) + "</div>" +
      '<span class="meta italic">' + esc(nota) + "</span></div>";
  }

  function proximosPassos() {
    var out = [];
    var devidos = cardsDevidos();
    if (devidos.length) {
      var a1 = porArea[devidos[0].areaSlug];
      out.push({
        href: "#/cartoes", img: a1 ? a1.img : D.areas[0].img, kicker: "Repetição espaçada",
        titulo: plural(devidos.length, "cartão devido", "cartões devidos"),
        corpo: "A fila de revisão usa as cinco caixas de Leitner: 1, 3, 7, 16 e 35 dias."
      });
    }
    var naoLida = D.aulas.filter(function (a) { return !P.aulas[a.id]; })[0];
    if (naoLida) {
      var ta = porTema[naoLida.temaId];
      out.push({
        href: "#/aula/" + naoLida.id, img: ta ? ta.img : D.areas[0].img, kicker: "Continuar a leitura",
        titulo: naoLida.titulo, corpo: rotuloFormato(naoLida) + " — " + (porArea[naoLida.areaSlug] || {}).nome
      });
    }
    var naoResp = D.questoes.filter(function (q) { return !P.questoes[q.id]; })[0];
    if (naoResp) {
      var t2 = porTema[naoResp.temaId];
      out.push({
        href: "#/pratica?q=" + encodeURIComponent(naoResp.id), img: t2 ? t2.img : D.areas[0].img,
        kicker: naoResp.colecao || "Questões comentadas",
        titulo: "Questão " + naoResp.n + " — " + rotuloQuestao(naoResp),
        corpo: "Gabarito comentado, análise dos distratores e a lacuna que a questão testa."
      });
    }
    return out.slice(0, 3);
  }

  /* ── matérias ────────────────────────────────────────────────────────── */
  var filtroMateria = "todas";
  function telaMaterias() {
    secaoAtual = "materias";
    var grupos = {
      todas: function () { return true; },
      nucleo: function (a) { return a.peso >= 4; },
      baratos: function (a) { return a.peso >= 2 && a.peso < 4; },
      cauda: function (a) { return a.peso < 2; }
    };
    var rotulos = { todas: "Todas", nucleo: "Camada 1 · Núcleo", baratos: "Camada 2 · Baratos", cauda: "Camada 3 · Cauda" };
    var lista = D.areas.filter(grupos[filtroMateria] || grupos.todas);

    return '<div class="section-head"><div>' +
      '<span class="kicker">O acervo, matéria por matéria</span>' +
      '<h2 style="margin-top:4px">Escolha uma matéria</h2></div>' +
      '<span class="meta num">' + lista.length + " de " + TOTAL.areas + "</span></div>" +
      '<p class="prose" style="margin-bottom:var(--s5)">As camadas são as do seu plano de ataque: a Camada 1 concentra cerca de 59% das questões, ' +
      "a Camada 2 é o material de alto retorno por hora estudada, e a Camada 3 é a cauda longa, onde basta o padrão-ouro de cada tema.</p>" +
      '<div class="chips" style="margin-bottom:var(--s5)">' +
      Object.keys(rotulos).map(function (k) {
        return '<button class="chip" data-filtro="' + k + '" aria-pressed="' + (filtroMateria === k) + '">' + rotulos[k] + "</button>";
      }).join("") + "</div>" +
      '<div class="tiles tiles-6">' + lista.map(function (a) {
        return ladrilho({
          href: "#/materia/" + a.slug, img: a.img, titulo: a.nome,
          legenda: plural(a.temas.length, "tema", "temas"),
          progresso: progressoArea(a), glifo: GLIFO_AREA[a.slug]
        });
      }).join("") + "</div>";
  }

  function telaMateria(slug) {
    secaoAtual = "materias";
    var a = porArea[slug];
    if (!a) return vazio("Matéria não encontrada.");
    var temas = a.temas.map(function (id) { return porTema[id]; });
    var ac = acertoArea(a);
    lembrar("#/materia/" + a.slug, a.nome, plural(a.temas.length, "tema", "temas"), a.img);

    return voltar("#/materias", "Todas as matérias") +
      '<div class="section-head" style="margin-top:var(--s4)"><div>' +
      '<span class="kicker">' + esc(a.sigla) + " · " + esc(a.subtitulo) + "</span>" +
      '<h2 style="margin-top:4px;font-size:36px">' + esc(a.nome) + "</h2></div></div>" +
      '<div class="statstrip" style="margin-bottom:var(--s6)">' +
      stat("Temas", a.temas.length, "nesta matéria", false) +
      stat("Aulas", a.nAulas, "do ebook", false) +
      stat("Questões", a.nQuestoes, "com gabarito comentado", false) +
      stat("Acerto", ac ? ac.pct + "%" : "—", ac ? "em " + ac.n + " respondidas" : "ainda não praticado", !!ac) +
      "</div>" +
      '<div class="section-head"><h3>Temas e aulas</h3>' +
      '<button class="btn btn-sm" data-ir="#/pratica?area=' + a.slug + '"' + (a.nQuestoes ? "" : " disabled") + ">Praticar esta matéria</button></div>" +
      '<div class="tiles tiles-4">' + temas.map(function (t) {
        return ladrilho({
          href: "#/tema/" + t.id, img: t.img, titulo: t.nome,
          legenda: legendaTema(t), dica: contagemTema(t), progresso: progressoTema(t),
          glifo: t.aulas.length ? "livro" : t.questoes.length ? "pratica" : "cartoes"
        });
      }).join("") + "</div>";
  }

  /* ── tema ────────────────────────────────────────────────────────────── */
  function telaTema(id) {
    secaoAtual = "materias";
    var t = porTema[id];
    if (!t) return vazio("Tema não encontrado.");
    var a = porArea[t.areaSlug];
    lembrar("#/tema/" + t.id, t.nome, a.nome, t.img);

    var html = voltar("#/materia/" + a.slug, a.nome) +
      '<div class="section-head" style="margin-top:var(--s4)"><div>' +
      '<span class="kicker">' + esc(a.nome) + "</span>" +
      '<h2 style="margin-top:4px;font-size:34px">' + esc(t.nome) + "</h2>" +
      '<span class="meta italic">' + esc(contagemTema(t) || "sem material vinculado") + "</span></div>" +
      (t.questoes.length ? '<button class="btn btn-sm btn-primary" data-ir="#/pratica?tema=' + esc(t.id) + '">Praticar o tema</button>' : "") +
      "</div>";

    if (t.aulas.length) {
      html += '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Aulas</h3><div class="grid-cards">' +
        t.aulas.map(function (aid) {
          var au = aulaPorId[aid];
          return '<button class="card" style="text-align:left;cursor:pointer" data-ir="#/aula/' + esc(au.id) + '">' +
            '<span class="kicker kicker-gold">' + esc(rotuloFormato(au)) + "</span>" +
            '<span style="display:block;font-family:var(--font-heading);font-size:21px;color:var(--ink-strong);margin:4px 0 6px">' + esc(au.titulo) + "</span>" +
            '<span class="meta italic">' + (P.aulas[au.id] ? "lida" : "não lida") + "</span></button>";
        }).join("") + "</div>";
    }
    if (t.cards.length) {
      html += '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Cartões de memória ' +
        '<span class="meta">(' + t.cards.length + ")</span></h3>" +
        '<button class="btn btn-sm" style="margin-bottom:var(--s4)" data-ir="#/cartoes?tema=' + esc(t.id) + '">Revisar estes cartões</button>' +
        t.cards.map(function (cid) {
          var c = cardPorId[cid], e = P.cards[cid];
          return '<details class="card" style="margin-bottom:var(--s2)"><summary style="cursor:pointer;font-family:var(--font-heading);font-size:19px;color:var(--ink-strong)">' +
            esc(c.frente) + (e ? ' <span class="meta num" style="font-family:var(--font-body)">· caixa ' + e.caixa + "</span>" : "") +
            '</summary><p style="color:var(--ink-body);margin:var(--s2) 0 0">' + esc(c.verso) + "</p>" +
            '<p class="meta italic" style="margin:var(--s2) 0 0">Deck de origem: ' + esc(c.deck) + "</p></details>";
        }).join("");
    }
    if (t.questoes.length) {
      html += '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Questões comentadas ' +
        '<span class="meta">(' + t.questoes.length + ")</span></h3>" +
        t.questoes.map(function (id) {
          var q = qPorId[id], r = P.questoes[id];
          return '<button class="hit" data-ir="#/pratica?q=' + encodeURIComponent(id) + '">' +
            '<span class="kicker kicker-gold">Questão ' + q.n + " · " + esc(rotuloQuestao(q)) + "</span>" +
            '<span class="hit-t" style="font-size:16px;font-family:var(--font-body);margin-top:3px">' + esc(q.enunciado.slice(0, 190)) + "…</span>" +
            '<span class="meta italic">' + (r ? (r.ok ? "respondida — acerto" : "respondida — erro") : "não respondida") + "</span></button>";
        }).join("");
    }
    if (!t.aulas.length && !t.cards.length && !t.questoes.length) {
      html += '<p class="prose">Este tema ainda não tem material vinculado no acervo.</p>';
    }
    return html;
  }

  /* ── aula ────────────────────────────────────────────────────────────── */
  function telaAula(id) {
    secaoAtual = "materias";
    var au = aulaPorId[id];
    if (!au) return vazio("Aula não encontrada.");
    var t = porTema[au.temaId], a = porArea[au.areaSlug];
    P.aulas[au.id] = Date.now(); marcarDia(); salvar();
    lembrar("#/aula/" + au.id, au.titulo, "Ebook · Módulo " + au.modulo, t ? t.img : a.img);

    var corpo = au.blocos.map(function (b) {
      if (b.tipo === "caixa")
        return '<div class="caixa" data-e="' + esc(b.estilo) + '">' +
          (b.rotulo ? '<span class="rot">' + esc(b.rotulo) + "</span>" : "") +
          '<div class="txt">' + b.html + "</div></div>";
      if (b.tipo === "tabela")
        return '<div class="tbl-wrap"><table><thead><tr>' +
          b.cabecalho.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
          "</tr></thead><tbody>" + b.linhas.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
      if (b.tipo === "subtitulo") return "<h3>" + b.html + "</h3>";
      return "<p>" + b.html + "</p>";
    }).join("");

    if (au.formato === "interativa") corpo =
      '<p class="meta italic">' + esc(au.secoes.join(" · ")) + "</p>" +
      '<div class="embed"><iframe src="' + esc(au.src) + '" title="' + esc(au.titulo) +
      '" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe></div>' +
      '<div style="display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s3)">' +
      '<a class="btn btn-sm" href="' + esc(au.src) + '" target="_blank" rel="noopener">Abrir em tela cheia</a></div>';

    var idx = D.aulas.indexOf(au);
    var prox = D.aulas[idx + 1];

    return voltar(t ? "#/tema/" + t.id : "#/materia/" + a.slug, t ? t.nome : a.nome) +
      '<article class="reader" style="margin-top:var(--s4)">' +
      '<span class="kicker">' + esc(a.nome) + " · " + esc(rotuloFormato(au)) + "</span>" +
      '<h1 class="display" style="font-size:44px;margin:var(--s2) 0 var(--s2)">' + esc(au.titulo) + "</h1>" +
      (au.origem ? '<p class="meta italic">' + esc(au.origem) + "</p>" : "") +
      (au.autor ? '<p class="meta italic">' + esc(au.autor) + "</p>" : "") +
      (au.parteDe ? '<p class="meta italic">Parte de: ' + esc(au.parteDe) + "</p>" : "") +
      '<hr class="hairline">' + corpo +
      '<hr class="hairline">' +
      '<div style="display:flex;gap:var(--s3);flex-wrap:wrap">' +
      (t && t.questoes.length ? '<button class="btn btn-primary" data-ir="#/pratica?tema=' + esc(t.id) + '">Praticar este tema</button>' : "") +
      (t && t.cards.length ? '<button class="btn" data-ir="#/cartoes?tema=' + esc(t.id) + '">Revisar os cartões</button>' : "") +
      (prox ? '<button class="btn" data-ir="#/aula/' + esc(prox.id) + '">Próxima aula: ' + esc(prox.titulo) + "</button>" : "") +
      "</div></article>";
  }

  /* ── prática ─────────────────────────────────────────────────────────── */
  var S = null; /* sessão corrente */
  function iniciarSessao(par) {
    var lista;
    if (par.q) lista = [par.q];
    else if (par.tema) lista = (porTema[par.tema] || { questoes: [] }).questoes.slice();
    else if (par.area) {
      lista = [];
      (porArea[par.area] || { temas: [] }).temas.forEach(function (id) {
        lista = lista.concat(porTema[id].questoes);
      });
    } else if (par.colecao) {
      lista = D.questoes.filter(function (q) { return q.colecao === par.colecao; }).map(function (q) { return q.id; });
    } else if (par.modo === "erradas") {
      lista = D.questoes.filter(function (q) { return P.questoes[q.id] && !P.questoes[q.id].ok; }).map(function (q) { return q.id; });
    } else if (par.modo === "novas") {
      lista = D.questoes.filter(function (q) { return !P.questoes[q.id]; }).map(function (q) { return q.id; });
    } else {
      lista = D.questoes.map(function (q) { return q.id; });
    }
    lista = lista.filter(function (id) { return qPorId[id]; });
    if (par.embaralhar) lista = embaralhar(lista);
    var rotulo = "Banco completo";
    if (par.tema && porTema[par.tema]) rotulo = porTema[par.tema].nome;
    else if (par.area && porArea[par.area]) rotulo = porArea[par.area].nome;
    else if (par.colecao) rotulo = par.colecao;
    else if (par.q) rotulo = "Questão avulsa";
    else if (par.modo === "erradas") rotulo = "Só as que errei";
    else if (par.modo === "novas") rotulo = "Campo cego";
    S = { lista: lista, i: 0, sel: null, revelado: false, acertos: 0, erros: 0, rotulo: rotulo };
  }

  function telaPratica(par) {
    secaoAtual = "pratica";
    var assinatura = JSON.stringify(par);
    if (!S || S.assinatura !== assinatura) { iniciarSessao(par); if (S) S.assinatura = assinatura; }
    if (!S.lista.length) return telaConfigPratica("Nenhuma questão corresponde a esse recorte. Escolha outro conjunto — nada de devolver questão aleatória.");
    if (S.i >= S.lista.length) return telaFimSessao();

    var q = qPorId[S.lista[S.i]];
    var t = porTema[q.temaId], a = porArea[q.areaSlug];
    lembrar("#/pratica?q=" + encodeURIComponent(q.id), "Questão " + q.n + " — " + rotuloQuestao(q),
      q.colecao || "Questões comentadas", t ? t.img : a.img);

    var opcoes = q.alternativas.map(function (o) {
      var st = "";
      if (S.revelado) st = o.k === q.correta ? "certa" : (o.k === S.sel ? "errada" : "");
      else if (o.k === S.sel) st = "pick";
      var marca = S.revelado ? (o.k === q.correta ? icone("check", 18) : (o.k === S.sel ? icone("x", 18) : "")) : "";
      return '<button class="opt" data-op="' + o.k + '"' + (S.revelado ? " disabled" : "") + (st ? ' data-st="' + st + '"' : "") + ">" +
        '<span class="k">' + o.k + "</span><span>" + esc(o.texto) + '</span><span class="mark">' + marca + "</span></button>";
    }).join("");

    var revelacao = "";
    if (S.revelado) {
      var certo = S.sel === q.correta;
      revelacao = '<hr class="hairline">' +
        '<h3 style="font-size:26px;color:' + (certo ? "var(--accent-300)" : "var(--ink-strong)") + '">' +
        (certo ? "Correto." : "Vamos rever.") + ' <span class="meta num" style="font-family:var(--font-body)">Gabarito: ' + q.correta + "</span></h3>" +
        campo("O gatilho da questão", q.gatilho) +
        campo("Comentário", q.comentario) +
        campo("Por que as demais erram", q.distratores) +
        campo("A fisiologia por trás", q.fisio) +
        campo("Pérola", q.perola) +
        campo("O que foi alterado em relação à questão-fonte", q.alterado) +
        campo("Lacuna testada", q.lacuna, true) +
        campo("Questão-fonte", q.fonte, true) +
        campo("Bibliografia identificada", q.bibliografia, true) +
        '<div class="srs">' +
        [["Errei", "10 min", 0], ["Difícil", "1 dia", 1], ["Bom", "4 dias", 2], ["Fácil", "9 dias", 3]].map(function (r) {
          return '<button class="btn" data-srs="' + r[2] + '">' + r[0] + "<small>" + r[1] + "</small></button>";
        }).join("") + "</div>";
    } else {
      revelacao = '<p class="meta italic" style="margin-top:var(--s4)">Formule a resposta mentalmente antes de marcar — a banca constrói o distrator sobre a conduta plausível porém prematura.</p>' +
        '<button class="btn btn-primary" id="confirmar"' + (S.sel ? "" : " disabled") + ">Confirmar resposta</button>";
    }

    var media = (S.acertos + S.erros) ? Math.round(S.acertos * 100 / (S.acertos + S.erros)) : 0;

    return '<div class="pratica">' +
      "<div>" +
      '<div style="display:flex;justify-content:space-between;gap:var(--s3);align-items:baseline;flex-wrap:wrap">' +
      '<span class="kicker">' + esc(q.colecao || "Questões comentadas") +
      (S.lista.length > 1 ? " · " + esc(S.rotulo) : "") + "</span>" +
      '<span class="meta num">Questão ' + (S.i + 1) + " de " + S.lista.length + "</span></div>" +
      '<div style="margin-top:var(--s4)"><span class="kicker kicker-gold" style="cursor:pointer" data-ir="#/tema/' + esc(q.temaId) + '">' +
      esc(rotuloQuestao(q)) + (t ? " · " + esc(t.nome) : "") + "</span>" +
      (q.subtema ? '<span class="meta italic" style="display:block;margin-top:2px">' + esc(q.subtema) + "</span>" : "") +
      "</div>" +
      '<p class="prose" style="font-size:17px;max-width:66ch;margin:var(--s3) 0 var(--s5)">' + esc(q.enunciado) + "</p>" +
      opcoes + revelacao +
      "</div>" +

      '<aside class="rail">' +
      '<div class="tally"><div><span class="kicker">Acertos</span><b class="num" style="color:var(--accent-400)">' + S.acertos + "</b></div>" +
      '<div><span class="kicker">Erros</span><b class="num">' + S.erros + "</b></div>" +
      '<div><span class="kicker">Média</span><b class="num">' + media + "%</b></div></div>" +
      '<div><span class="kicker">Mapa da sessão</span><div class="qmap" style="margin-top:var(--s2)">' +
      S.lista.map(function (id, i) {
        var r = P.questoes[id], s = i === S.i ? "now" : r ? (r.ok ? "ok" : "x") : "";
        return '<button data-q="' + i + '"' + (s ? ' data-s="' + s + '"' : "") + ">" + (i + 1) + "</button>";
      }).join("") + "</div></div>" +
      '<div><span class="kicker">Nota de recall</span>' +
      '<textarea id="nota" placeholder="O que você quer lembrar deste item?">' + esc(P.notas[q.temaId] || "") + "</textarea>" +
      '<span class="meta italic">Salva no caderno do tema ' + esc(t ? t.nome : "") + ", neste navegador.</span></div>" +
      '<button class="btn btn-sm" data-ir="#/pratica">Trocar de sessão</button>' +
      "</aside></div>";
  }

  function campo(rotulo, valor, discreto) {
    if (!valor) return "";
    return '<div style="margin-top:var(--s4)"><span class="kicker">' + esc(rotulo) + "</span>" +
      '<p class="prose" style="max-width:66ch;margin-top:2px' + (discreto ? ";font-size:13.5px;color:var(--ink-meta)" : "") + '">' +
      esc(valor) + "</p></div>";
  }

  function telaFimSessao() {
    var n = S.acertos + S.erros, pct = n ? Math.round(S.acertos * 100 / n) : 0;
    return '<h1 class="display">Sessão encerrada.</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Você respondeu ' + plural(n, "questão", "questões") +
      " nesta sessão, com " + S.acertos + " acertos.</p>" +
      '<div class="statstrip" style="margin:var(--s5) 0">' +
      stat("Acertos", S.acertos, "nesta sessão", true) +
      stat("Erros", S.erros, "vão para a fila de revisão", false) +
      stat("Aproveitamento", pct + "%", "na sessão", pct >= 70) +
      stat("Banco", TOTAL.questoes, "questões no total", false) + "</div>" +
      '<div style="display:flex;gap:var(--s3);flex-wrap:wrap">' +
      '<button class="btn btn-primary" data-ir="#/pratica?modo=erradas">Refazer o que errei</button>' +
      '<button class="btn" data-ir="#/pratica">Nova sessão</button>' +
      '<button class="btn" data-ir="#/">Voltar ao painel</button></div>';
  }

  function telaConfigPratica(aviso) {
    secaoAtual = "pratica";
    var erradas = D.questoes.filter(function (q) { return P.questoes[q.id] && !P.questoes[q.id].ok; }).length;
    var novas = D.questoes.filter(function (q) { return !P.questoes[q.id]; }).length;
    return '<span class="kicker">Prática</span><h1 class="display" style="margin-top:4px">Como você quer estudar?</h1>' +
      (aviso ? '<p class="prose" style="color:var(--accent-300);margin-top:var(--s3)">' + esc(aviso) + "</p>" : "") +
      '<p class="prose" style="margin-top:var(--s4)">As ' + TOTAL.questoes + " questões vêm das suas cinco coleções, e cada uma abre o comentário completo do arquivo de origem: " +
      "o gatilho da vinheta, a análise dos distratores, a fisiologia por trás, a pérola, a questão-fonte, a bibliografia identificada e a lacuna testada — conforme o que a fonte traz.</p>" +
      '<div class="grid-cards" style="margin-top:var(--s5)">' +
      [
        { h: "#/pratica?modo=novas&embaralhar=1", t: "Campo cego", m: novas + " questões ainda não vistas", d: "Sorteio entre todos os temas, sem saber de qual matéria a questão veio." },
        { h: "#/pratica?modo=erradas", t: "Só as que errei", m: erradas + " questões", d: "A fila mais rentável: refazer o erro até ele virar conceito." },
        { h: "#/pratica?modo=todas", t: "Prova completa", m: TOTAL.questoes + " questões", d: "Na ordem do caderno original, 4 horas em condições de prova." }
      ].map(function (o) {
        return '<button class="card" style="text-align:left;cursor:pointer" data-ir="' + o.h + '">' +
          '<span class="kicker kicker-gold">' + esc(o.m) + "</span>" +
          '<span style="display:block;font-family:var(--font-heading);font-size:23px;color:var(--ink-strong);margin:4px 0 6px">' + esc(o.t) + "</span>" +
          '<span style="display:block;font-size:13.5px;color:var(--ink-soft)">' + esc(o.d) + "</span></button>";
      }).join("") + "</div>" +
      '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Por coleção</h3>' +
      '<div class="chips" style="flex-wrap:wrap;margin-bottom:var(--s5)">' + colecoes().map(function (c) {
        return '<button class="chip" data-ir="#/pratica?colecao=' + encodeURIComponent(c.nome) + '">' +
          esc(c.nome) + ' <span class="num" style="color:var(--ink-meta)">' + c.n + "</span></button>";
      }).join("") + "</div>" +
      '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Por matéria</h3>' +
      '<div class="chips" style="flex-wrap:wrap">' + D.areas.filter(function (a) { return a.nQuestoes; }).map(function (a) {
        return '<button class="chip" data-ir="#/pratica?area=' + a.slug + '">' + esc(a.nome) + ' <span class="num" style="color:var(--ink-meta)">' + a.nQuestoes + "</span></button>";
      }).join("") + "</div>";
  }

  function colecoes() {
    var m = {};
    D.questoes.forEach(function (q) { if (q.colecao) m[q.colecao] = (m[q.colecao] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { nome: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  /* ── cartões ─────────────────────────────────────────────────────────── */
  var FC = null;
  function telaCartoes(par) {
    secaoAtual = "cartoes";
    var assinatura = JSON.stringify(par);
    if (!FC || FC.assinatura !== assinatura) {
      var lista;
      if (par.tema) lista = (porTema[par.tema] || { cards: [] }).cards.slice();
      else if (par.area) {
        lista = [];
        (porArea[par.area] || { temas: [] }).temas.forEach(function (id) { lista = lista.concat(porTema[id].cards); });
      } else lista = cardsDevidos().map(function (c) { return c.id; });
      FC = { assinatura: assinatura, lista: lista, i: 0, virado: false, vistos: 0, rotulo: par.tema ? porTema[par.tema].nome : par.area ? porArea[par.area].nome : "Fila de revisão" };
    }
    if (!FC.lista.length) return telaCartoesVazio();
    if (FC.i >= FC.lista.length) {
      return '<h1 class="display">Fila zerada.</h1><p class="prose" style="margin-top:var(--s4)">Você revisou ' +
        plural(FC.vistos, "cartão", "cartões") + '. Os que você errou voltam para a caixa 1 e vencem em um dia.</p>' +
        '<div style="display:flex;gap:var(--s3);margin-top:var(--s5);flex-wrap:wrap">' +
        '<button class="btn btn-primary" data-ir="#/cartoes">Ver a fila novamente</button>' +
        '<button class="btn" data-ir="#/">Voltar ao painel</button></div>';
    }
    var c = cardPorId[FC.lista[FC.i]];
    var t = porTema[c.temaId], a = porArea[c.areaSlug], e = estadoCard(c.id);
    return '<div style="max-width:760px;margin:0 auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3);flex-wrap:wrap">' +
      '<span class="kicker">Repetição espaçada · ' + esc(FC.rotulo) + "</span>" +
      '<span class="meta num">' + (FC.i + 1) + " de " + FC.lista.length + " · caixa " + (e.caixa || 1) + "</span></div>" +
      '<div class="fc" id="fc" style="margin-top:var(--s4)">' +
      '<div class="fc-frente">' + esc(c.frente) + "</div>" +
      (FC.virado ? '<div class="fc-verso">' + esc(c.verso) + "</div>"
        : '<p class="meta italic" style="text-align:center">Toque para virar</p>') + "</div>" +
      '<p class="meta italic" style="margin-top:var(--s2)">' + esc(a.nome) + " · " +
      '<span style="cursor:pointer;color:var(--accent-300)" data-ir="#/tema/' + esc(c.temaId) + '">' + esc(t ? t.nome : "") + "</span>" +
      " · deck " + esc(c.deck) + "</p>" +
      (FC.virado ? '<div class="srs" style="grid-template-columns:repeat(2,1fr);max-width:420px">' +
        '<button class="btn" data-fc="0">Errei<small>volta à caixa 1</small></button>' +
        '<button class="btn btn-primary" data-fc="1">Acertei<small>sobe uma caixa</small></button></div>'
        : "") + "</div>";
  }
  function telaCartoesVazio() {
    return '<h1 class="display">Nada vencido agora.</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Os ' + TOTAL.cards + " cartões do seu deck usam cinco caixas de Leitner (1, 3, 7, 16 e 35 dias). " +
      "Nenhum venceu ainda — você pode revisar por matéria mesmo assim.</p>" +
      '<div class="chips" style="flex-wrap:wrap;margin-top:var(--s5)">' +
      D.areas.filter(function (a) { return a.nCards; }).map(function (a) {
        return '<button class="chip" data-ir="#/cartoes?area=' + a.slug + '">' + esc(a.nome) + ' <span class="num" style="color:var(--ink-meta)">' + a.nCards + "</span></button>";
      }).join("") + "</div>";
  }

  /* ── busca ───────────────────────────────────────────────────────────── */
  var INDICE = null;
  function indice() {
    if (INDICE) return INDICE;
    INDICE = [];
    D.areas.forEach(function (a) {
      INDICE.push({ t: a.nome, s: "Matéria · " + a.subtitulo, h: "#/materia/" + a.slug, k: norm(a.nome + " " + a.subtitulo) });
    });
    D.temas.forEach(function (t) {
      INDICE.push({ t: t.nome, s: "Tema · " + porArea[t.areaSlug].nome, h: "#/tema/" + t.id, k: norm(t.nome) });
    });
    D.aulas.forEach(function (a) {
      var txt = a.blocos.map(function (b) { return b.html || (b.linhas || []).join(" "); }).join(" ");
      INDICE.push({ t: a.titulo, s: "Aula · Módulo " + a.modulo, h: "#/aula/" + a.id, k: norm(a.titulo + " " + txt.replace(/<[^>]+>/g, " ")) });
    });
    D.cards.forEach(function (c) {
      INDICE.push({ t: c.frente, s: "Cartão · " + porArea[c.areaSlug].nome, h: "#/tema/" + c.temaId, k: norm(c.frente + " " + c.verso), trecho: c.verso });
    });
    D.questoes.forEach(function (q) {
      INDICE.push({
        t: "Questão " + q.n + " — " + rotuloQuestao(q), s: q.colecao || "Questão comentada",
        h: "#/pratica?q=" + encodeURIComponent(q.id),
        k: norm([q.enunciado, q.comentario, q.lacuna, q.bibliografia, q.gatilho, q.perola, q.fisio].join(" ")),
        trecho: q.lacuna || q.perola || q.gatilho || q.enunciado
      });
    });
    return INDICE;
  }
  var termo = "";
  function telaBusca() {
    secaoAtual = "busca";
    var q = norm(termo.trim());
    var res = [];
    if (q.length >= 2) {
      res = indice().filter(function (it) { return it.k.indexOf(q) !== -1; }).slice(0, 60);
    }
    return '<span class="kicker">Buscar em todo o acervo</span>' +
      '<div class="search-field" style="margin:var(--s3) 0 var(--s5)">' + icone("busca", 22) +
      '<input id="q" type="search" placeholder="tríade, Hinchey, conduta, Tokyo…" value="' + esc(termo) + '" autocomplete="off"></div>' +
      (q.length < 2
        ? '<p class="prose">Procura ao mesmo tempo em ' + TOTAL.areas + " matérias, " + TOTAL.temas + " temas, " +
        TOTAL.aulas + " aulas, " + TOTAL.cards + " cartões e " + TOTAL.questoes + " questões comentadas.</p>"
        : res.length
          ? '<p class="meta" style="margin-bottom:var(--s3)">' + plural(res.length, "resultado", "resultados") + (res.length === 60 ? " (mostrando os 60 primeiros)" : "") + "</p>" +
          res.map(function (it) {
            return '<button class="hit" data-ir="' + esc(it.h) + '">' +
              '<span class="kicker kicker-gold">' + esc(it.s) + "</span>" +
              '<span class="hit-t">' + realce(it.t, termo) + "</span>" +
              (it.trecho ? '<span class="meta" style="display:block">' + realce(it.trecho.slice(0, 190), termo) + "</span>" : "") +
              "</button>";
          }).join("")
          : '<p class="prose">Nada encontrado para “' + esc(termo) + "”. O acervo tem só o que você produziu — se o tema não está aqui, ainda não foi escrito.</p>");
  }
  function realce(txt, t) {
    var e = esc(txt), n = norm(txt), a = norm(t.trim());
    if (!a) return e;
    var i = n.indexOf(a);
    if (i === -1) return e;
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + a.length)) + "</mark>" + esc(txt.slice(i + a.length));
  }

  /* ── acervo ──────────────────────────────────────────────────────────── */
  function telaAcervo() {
    secaoAtual = "acervo";
    return '<span class="kicker">Procedência do material</span>' +
      '<h1 class="display" style="margin-top:4px">O acervo</h1>' +
      '<p class="prose" style="margin-top:var(--s4)">Tudo nesta plataforma foi extraído do material que você já produziu: o ebook, as apresentações e reuniões científicas, ' +
      "as aulas-atlas interativas em HTML, os simulados e o deck de repetição espaçada. Nada foi reescrito, resumido, " +
      "corrigido ou completado na importação — enunciados, comentários, cartões e slides entram literalmente como estão nos arquivos de origem. " +
      "A organização em matérias e temas é o único acréscimo, e ela é apenas um índice: quando o assunto do enunciado diverge do rótulo do arquivo, " +
      "vale o enunciado, e o rótulo original continua visível na questão.</p>" +
      '<div class="statstrip" style="margin:var(--s6) 0">' +
      stat("Matérias", TOTAL.areas, "ordenadas pelo peso na prova", false) +
      stat("Temas", TOTAL.temas, "cada um com o material vinculado", false) +
      stat("Itens de conteúdo", TOTAL.aulas + TOTAL.questoes + TOTAL.cards, "aulas, questões e cartões", true) +
      stat("Em quarentena", D.quarentena.length, D.quarentena.length ? "itens que não puderam ser lidos" : "nenhuma perda na importação", false) +
      "</div>" +
      '<h3 style="font-size:20px;margin-bottom:var(--s3)">Fontes importadas</h3>' +
      D.fontes.map(function (f) {
        return '<div style="display:flex;justify-content:space-between;gap:var(--s3);align-items:baseline;padding:var(--s3) 0;border-bottom:1px solid var(--rule)">' +
          '<span><span style="display:block;font-family:var(--font-heading);font-size:19px;color:var(--ink-strong)">' + esc(f.titulo) + "</span>" +
          '<span class="meta italic">' + esc(f.tipo) + "</span></span>" +
          '<b class="num" style="font-family:var(--font-heading);font-weight:300;font-size:28px;color:var(--accent-400)">' + f.itens + "</b></div>";
      }).join("") +
      (D.quarentena.length
        ? '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Quarentena</h3>' +
        D.quarentena.map(function (q) {
          return '<p class="meta" style="border-bottom:1px solid var(--rule);padding:var(--s2) 0">' +
            esc(q.motivo) + ' <span class="italic">(' + esc(q.origem) + ")</span></p>";
        }).join("")
        : "") +
      '<h3 style="font-size:20px;margin:var(--s6) 0 var(--s3)">Seu progresso neste navegador</h3>' +
      '<p class="prose">O progresso (aulas lidas, respostas, caixas dos cartões e notas de recall) fica no armazenamento local deste navegador. ' +
      "Ele não sai daqui e não é sincronizado entre aparelhos.</p>" +
      '<button class="btn btn-sm" id="zerar" style="margin-top:var(--s3)">Apagar meu progresso</button>';
  }

  function vazio(msg) { return '<h1 class="display">' + esc(msg) + "</h1>" + voltar("#/", "Painel"); }
  function voltar(href, rotulo) {
    return '<button class="btn-ghost" style="background:none;border:0;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:0;font-size:12.5px" data-ir="' + esc(href) + '">' +
      icone("voltar", 16) + esc(rotulo) + "</button>";
  }

  /* ── roteador ────────────────────────────────────────────────────────── */
  function parseHash() {
    var h = location.hash.replace(/^#/, "") || "/";
    var partes = h.split("?");
    var caminho = partes[0].split("/").filter(Boolean);
    var par = {};
    (partes[1] || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      par[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    return { caminho: caminho, par: par };
  }

  function render() {
    var r = parseHash(), c = r.caminho, tela = document.getElementById("tela"), html;
    switch (c[0]) {
      case undefined: html = telaPainel(); break;
      case "materias": html = telaMaterias(); break;
      case "materia": html = telaMateria(c[1]); break;
      case "tema": html = telaTema(decodeURIComponent(c[1] || "")); break;
      case "aula": html = telaAula(decodeURIComponent(c[1] || "")); break;
      case "pratica":
        html = Object.keys(r.par).length ? telaPratica(r.par) : (S = null, telaConfigPratica()); break;
      case "cartoes": html = telaCartoes(r.par); break;
      case "busca": html = telaBusca(); break;
      case "acervo": html = telaAcervo(); break;
      default: html = vazio("Página não encontrada.");
    }
    tela.innerHTML = html;
    atualizarShell();
    window.scrollTo(0, 0);
    var q = document.getElementById("q");
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  /* ── interações delegadas ────────────────────────────────────────────── */
  function ligar() {
    document.body.addEventListener("click", function (ev) {
      var el;
      if ((el = ev.target.closest("[data-filtro]"))) { filtroMateria = el.getAttribute("data-filtro"); render(); return; }
      if ((el = ev.target.closest("[data-op]")) && S && !S.revelado) { S.sel = el.getAttribute("data-op"); render(); return; }
      if (ev.target.closest("#confirmar") && S && S.sel && !S.revelado) {
        var q = qPorId[S.lista[S.i]];
        S.revelado = true;
        if (S.sel === q.correta) S.acertos++; else S.erros++;
        registrarQuestao(q.id, S.sel, q.correta);
        render(); return;
      }
      if ((el = ev.target.closest("[data-srs]")) && S) {
        S.i++; S.sel = null; S.revelado = false; render(); return;
      }
      if ((el = ev.target.closest("[data-q]")) && S) {
        S.i = parseInt(el.getAttribute("data-q"), 10); S.sel = null; S.revelado = false; render(); return;
      }
      if (ev.target.closest("#fc") && FC && !FC.virado) { FC.virado = true; render(); return; }
      if ((el = ev.target.closest("[data-fc]")) && FC) {
        avaliarCard(FC.lista[FC.i], el.getAttribute("data-fc") === "1");
        FC.i++; FC.vistos++; FC.virado = false; render(); return;
      }
      if (ev.target.closest("#zerar")) {
        if (confirm("Apagar todo o progresso salvo neste navegador?")) {
          P = { aulas: {}, questoes: {}, cards: {}, notas: {}, ultimo: null, streak: 0, dias: [] };
          try { localStorage.removeItem(CHAVE); } catch (e) { }
          render();
        }
        return;
      }
    });

    document.body.addEventListener("input", function (ev) {
      if (ev.target.id === "q") { termo = ev.target.value; render(); }
      if (ev.target.id === "nota" && S) {
        P.notas[qPorId[S.lista[S.i]].temaId] = ev.target.value; salvar();
      }
    });

    document.addEventListener("keydown", function (ev) {
      if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
      if (!S || location.hash.indexOf("#/pratica") !== 0) return;
      var q = qPorId[S.lista[S.i]];
      if (!q) return;
      if (/^[1-5]$/.test(ev.key) && !S.revelado) {
        var o = q.alternativas[parseInt(ev.key, 10) - 1];
        if (o) { S.sel = o.k; render(); }
      } else if (ev.key === "Enter" && S.sel && !S.revelado) {
        S.revelado = true;
        if (S.sel === q.correta) S.acertos++; else S.erros++;
        registrarQuestao(q.id, S.sel, q.correta); render();
      } else if (ev.key === "ArrowRight" && S.revelado) {
        S.i++; S.sel = null; S.revelado = false; render();
      }
    });

    window.addEventListener("hashchange", render);
  }

  montarShell();
  ligar();
  render();
})();
