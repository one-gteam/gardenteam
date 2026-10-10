/* Totem demo: attesa → catalogo al tocco → ritorno per inattività; oppure ciclo dei prodotti con banner. */
(function () {
  var INATTIVITA = 40; // secondi senza tocchi prima di tornare all'inizio
  var modo = "attesa", timerAttesa = null, timerInatt = null, restano = INATTIVITA, timerProd = null;
  var $ = function (id) { return document.getElementById(id); };
  var mostra = function (id) { ["attesa", "tcat", "tprod"].forEach(function (x) { $(x).classList.toggle("nascosto", x !== id); }); };

  window.avvia = function (m) {
    modo = m; $("scelta").style.display = "none";
    try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {}); } catch (e) {}
    if (m === "attesa") iniziaAttesa(); else iniziaProdotti();
  };

  /* ---- attesa: foto in ciclo ---- */
  var foto, barre, k = 0;
  function iniziaAttesa() {
    mostra("attesa");
    foto = $("attesa").querySelectorAll(".foto"); barre = $("barre-attesa").children; k = 0;
    for (var i = 0; i < foto.length; i++) { foto[i].classList.toggle("on", i === 0); barre[i].className = i === 0 ? "on" : ""; }
    clearTimeout(timerAttesa); timerAttesa = setTimeout(passoAttesa, 8000);
    orologio();
  }
  function passoAttesa() {
    foto[k].classList.remove("on"); barre[k].className = "fatta";
    k = (k + 1) % foto.length;
    if (k === 0) for (var i = 0; i < barre.length; i++) barre[i].className = "";
    foto[k].classList.add("on"); barre[k].className = "on";
    timerAttesa = setTimeout(passoAttesa, 8000);
  }
  function orologio() {
    var d = new Date(); $("ora").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }) + " · " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  setInterval(orologio, 30000);

  /* ---- catalogo al tocco ---- */
  var cat = "Tutti";
  window.apriCatalogo = function () {
    clearTimeout(timerAttesa); mostra("tcat"); disegnaCat(); armaInattivita();
  };
  window.tornaAttesa = function () { clearInterval(timerInatt); iniziaAttesa(); };
  function armaInattivita() {
    restano = INATTIVITA; clearInterval(timerInatt);
    timerInatt = setInterval(function () { restano--; $("conto-attesa").textContent = "torna all'inizio fra " + restano + " s"; if (restano <= 0) window.tornaAttesa(); }, 1000);
    $("conto-attesa").textContent = "torna all'inizio fra " + restano + " s";
  }
  ["pointerdown", "touchstart", "wheel", "scroll"].forEach(function (ev) { document.addEventListener(ev, function () { if (!$("tcat").classList.contains("nascosto")) restano = INATTIVITA; }, true); });
  window.scegliCat = function (c) { cat = c; disegnaCat(); };
  function disegnaCat() {
    var lista = PRODOTTI.filter(function (p) { return cat === "Tutti" || p.cat === cat; });
    var html = ""; lista.forEach(function (p, i) { html += tessera(p, true); if (i === 3) html += '</div><div class="banner" style="background-image:url(img/em_giardino.jpg)"><span class="occhiello">SOLO IN NEGOZIO</span><strong>Prova i lounge nell\'area esterna, corsia 7</strong></div><div class="griglia">'; });
    $("tcat-griglia").innerHTML = html;
    $("tcat-cat").innerHTML = CATEGORIE.map(function (c) { return '<button type="button" class="' + (c === cat ? "on" : "") + '" onclick="scegliCat(\'' + c + '\')">' + c + "</button>"; }).join("");
    $("tcat-sotto").textContent = "Il Germoglio Venezia · " + lista.length + " prodotti";
    $("tcat-scorri").scrollTop = 0;
  }

  /* ---- sempre prodotti ---- */
  var lista = [], idx = 0, fotoIdx = 0, fermo = false;
  function iniziaProdotti() {
    mostra("tprod");
    lista = PRODOTTI.filter(function (p) { return p.cat === "Lounge"; });
    idx = 0; fotoIdx = 0; fermo = false; disegnaProdotto(); clearTimeout(timerProd); timerProd = setTimeout(passoProdotto, 10000);
  }
  function disegnaProdotto() {
    var banner = idx > 0 && idx % 4 === 0 && fotoIdx === 0 && !lista[idx].bannerFatto;
    var p = lista[idx % lista.length];
    var immagini = [p.foto].concat(p.amb);
    var f = immagini[fotoIdx % immagini.length];
    var s = $("scena");
    if (banner) {
      s.className = "scena banner-scena";
      s.innerHTML = '<div class="foto on" style="background-image:url(img/em_piscina.jpg)"></div><div class="velo"></div><span class="occhiello">ESTATE 2026</span><h1>Il giardino è la stanza più grande.</h1><p>Lounge e divani fino al -30%, fino a domenica.</p>';
      p.bannerFatto = true;
    } else {
      s.className = "scena";
      s.innerHTML = '<div class="foto on" style="background-image:url(' + f + ')"></div><div class="velo"></div>' +
        (p.promo ? '<span class="pill">' + p.promo + "</span>" : p.novita ? '<span class="pill nero">NOVITÀ</span>' : "") +
        '<div class="punti">' + immagini.map(function (_, j) { return "<span" + (j === fotoIdx % immagini.length ? ' class="on"' : "") + "></span>"; }).join("") + "</div>" +
        '<span class="occhiello">' + p.marca + " · " + (fotoIdx % immagini.length === 0 ? "FOTO DI CATALOGO" : "FOTO AMBIENTATA " + (fotoIdx % immagini.length) + " DI " + (immagini.length - 1)) + "</span>" +
        "<h1>" + p.nome + "</h1><p>" + p.descr + "</p>";
    }
    $("prezzo-riga").innerHTML = '<div style="display:flex;flex-direction:column;line-height:1.1">' + (p.listino ? '<span class="barrato" style="font-size:15px">' + p.listino + "</span>" : "") + '<span class="prezzo grande">' + p.prezzo + '</span></div><div class="destra"><span class="ok">' + STATI[p.stato][0] + (p.stato === "ok" ? " qui" : "") + '</span><span class="hint">cod. AR-30' + (200 + p.id) + " · corsia 7</span></div>";
    $("tprod-conto").textContent = (idx % lista.length + 1) + " / " + lista.length;
    var pros = ""; for (var j = 1; j <= 5; j++) { var q = lista[(idx + j) % lista.length]; pros += (idx + j) % 4 === 0 ? '<span class="b">banner<br>stagione</span>' : '<img src="' + q.foto + '" alt="">'; }
    $("prossimi").innerHTML = pros;
  }
  function passoProdotto() {
    if (fermo) return;
    var p = lista[idx % lista.length]; var nImm = 1 + p.amb.length;
    fotoIdx++;
    if (fotoIdx >= nImm) { fotoIdx = 0; idx++; }
    disegnaProdotto();
    timerProd = setTimeout(passoProdotto, 10000);
  }
  window.fermaProdotti = function () {
    fermo = !fermo; clearTimeout(timerProd);
    document.querySelector(".tprod .piede").innerHTML = fermo ? "<span><b>Fermo</b>: tocca «Tocca per i dettagli» per ripartire (sul totem vero si apre la scheda)</span>" : "<span>Cambia prodotto ogni <b>10 s</b> · banner ogni <b>4</b> prodotti</span><span><b>Tocca</b> per fermare</span>";
    if (!fermo) timerProd = setTimeout(passoProdotto, 10000);
  };
})();
