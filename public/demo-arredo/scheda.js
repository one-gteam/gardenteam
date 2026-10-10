/* Scheda demo: apertura emozionale (una volta per visita), galleria a scorrimento, condivisione. */
(function () {
  var intro = document.getElementById("intro");
  var foto = intro.querySelectorAll(".foto");
  var barre = document.getElementById("barre").children;
  var i = 0, timer = null;
  function passo() {
    foto[i].classList.remove("on"); barre[i].classList.remove("on"); barre[i].classList.add("fatta");
    i++;
    if (i >= foto.length) return chiudiIntro();
    foto[i].classList.add("on"); barre[i].classList.add("on");
    timer = setTimeout(passo, 3000);
  }
  window.chiudiIntro = function () {
    clearTimeout(timer);
    intro.classList.add("via");
    setTimeout(function () { intro.style.display = "none"; }, 520);
    try { sessionStorage.setItem("intro-vista", "1"); } catch (e) {}
  };
  var vista = false;
  try { vista = sessionStorage.getItem("intro-vista") === "1"; } catch (e) {}
  if (vista) { intro.style.display = "none"; } else { timer = setTimeout(passo, 3000); }

  // galleria
  var scorri = document.getElementById("scorri");
  var punti = document.getElementById("punti").children;
  var mini = document.getElementById("mini").querySelectorAll("img");
  var conta = document.getElementById("conta");
  var n = scorri.children.length;
  function aggiorna() {
    var k = Math.round(scorri.scrollLeft / scorri.clientWidth);
    for (var j = 0; j < n; j++) { punti[j].classList.toggle("on", j === k); if (mini[j]) mini[j].classList.toggle("on", j === k); }
    conta.textContent = (k + 1) + " / " + n;
  }
  scorri.addEventListener("scroll", function () { window.requestAnimationFrame(aggiorna); });
  window.vai = function (k) { scorri.scrollTo({ left: k * scorri.clientWidth, behavior: "smooth" }); };

  window.condividi = function () {
    var dati = { title: document.title, text: "Tavolo Rio 210 con 6 sedie Net · Il Germoglio", url: location.href };
    if (navigator.share) navigator.share(dati).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { alert("Indirizzo copiato."); });
  };
})();
