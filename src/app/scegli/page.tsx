import { redirect } from "next/navigation";
import { GraduationCap, Armchair, PawPrint, Flower2, Users, HardDrive, ArrowRight, Newspaper } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { userSites, postLoginPath, SITE_NAME, isAcademyAdmin, ruoloEsteso, RUOLO_PRINCIPALE, SITE_LABELS_BREVI } from "@/lib/types";
import { canManageUsers } from "@/lib/logic";
import { puoVedereArchivio } from "@/lib/storage-audit";
import { logout, scegliRuolo } from "@/lib/actions";
import CambiaFotoArea from "@/components/CambiaFotoArea";
import { getArticoliDb, vedeArticoli, articoliVisibili } from "@/lib/articoli";

/** Schede delle macroaree, con fotografia di copertina in stile My Rosaflor. */
export default async function ScegliPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const sites = userSites(user);

  // più ruoli: prima si sceglie con quale operare, poi le aree di quel ruolo
  const base = db.users.find((u) => u.id === user.id) ?? user;
  const insegna = db.tenants.find((t) => t.id === base.tenantId)?.name;
  const pv = db.stores.find((x) => x.id === base.storeId)?.name;
  const dove = pv ?? insegna ?? "Consorzio";
  const ruoli = (base.ruoliExtra?.length ?? 0) > 0
    ? [
        { id: RUOLO_PRINCIPALE, etichetta: ruoloEsteso(base), aree: userSites(base), attivo: user.ruoloScelto && !user.ruoloAttivo },
        ...(base.ruoliExtra ?? []).map((p) => {
          const come = { ...base, role: p.role, sites: p.sites ?? [], manages: p.manages };
          return { id: p.id, etichetta: ruoloEsteso(come), aree: userSites(come), attivo: user.ruoloAttivo === p.id };
        }),
      ]
    : [];
  const daScegliere = ruoli.length > 0 && !user.ruoloScelto;

  // la Gestione Ruoli è un'area a sé: sistema e insegna sempre; PV solo se delegato
  const showRuoli = canManageUsers(db, user);

  const showArchivio = puoVedereArchivio(user);
  // gli articoli informativi: chi rientra nei destinatari dell'area, chi pubblica, chi gestisce
  const articoliDb = await getArticoliDb();
  const showArticoli = vedeArticoli(user, articoliDb);
  const articoliDaLeggere = showArticoli ? articoliVisibili(user, articoliDb).filter((a) => !a.letture[user.id]).length : 0;
  // con una sola area si entra dritti, ma non se la sua destinazione è questa pagina
  // (è il caso di "piante", ancora in preparazione): si finirebbe in un rimbalzo infinito
  const casa = postLoginPath(user);
  if (!daScegliere && sites.length === 1 && !showRuoli && !showArchivio && !showArticoli && casa !== "/scegli") redirect(casa);

  // chi non gestisce la formazione entra dalla parte del corsista, non dal pannello
  const academyHome = isAcademyAdmin(user) ? "/admin" : "/studente";
  // la foto scelta dall'amministratore, se c'è, altrimenti quella di serie
  const foto = (chiave: string, diSerie: string) => db.settings.fotoAree?.[chiave] || diSerie;
  const amministratore = user.role === "system_admin";

  const aree = daScegliere ? [] : [
    ...(sites.includes("academy")
      ? [{
          chiave: "academy", href: academyHome, foto: foto("academy", "/immagini/aree/formazione.jpg"), icona: <GraduationCap size={18} />,
          titolo: "Academy", desc: "Formazione del personale", attiva: true,
        }]
      : []),
    ...(sites.includes("arredo")
      ? [{
          chiave: "arredo", href: "/stampe/arredo/dati", foto: foto("arredo", "/immagini/aree/arredo.jpg"), icona: <Armchair size={18} />,
          titolo: "Cartelli Arredo", desc: "Cartelli arredo giardino", attiva: true,
        }]
      : []),
    ...(sites.includes("zoo")
      ? [{
          chiave: "zoo", href: "/stampe/zoo/prodotti", foto: foto("zoo", "/immagini/aree/zoo.jpg"), icona: <PawPrint size={18} />,
          titolo: "Offerte Zoo", desc: "Volantino e cartelli promo", attiva: true,
        }]
      : []),
    ...(sites.includes("piante")
      ? [{
          chiave: "piante", href: "#", foto: foto("piante", "/immagini/aree/piante.jpg"), icona: <Flower2 size={18} />,
          titolo: "Cartelli Piante", desc: "In preparazione", attiva: false,
        }]
      : []),
    ...(showArticoli
      ? [{
          chiave: "articoli", href: "/articoli", foto: foto("articoli", "/immagini/aree/formazione.jpg"), icona: <Newspaper size={18} />,
          titolo: "Articoli", desc: articoliDaLeggere > 0 ? `${articoliDaLeggere} da leggere` : "Comunicazioni, schede e novità", attiva: true,
        }]
      : []),
    ...(showRuoli
      ? [{
          chiave: "ruoli", href: "/ruoli", foto: foto("ruoli", "/immagini/aree/ruoli.jpg"), icona: <Users size={18} />,
          titolo: "Gestione Ruoli", desc: "Utenti, ruoli e accessi alle aree", attiva: true,
        }]
      : []),
    ...(showArchivio
      ? [{
          chiave: "archivio", href: "/file", foto: foto("archivio", "/immagini/aree/archivio.jpg"), icona: <HardDrive size={18} />,
          titolo: "Archivio file", desc: "Spazio occupato e pulizia dei file non più usati", attiva: true,
        }]
      : []),
  ];

  const { settings } = db;

  return (
    <div>
      <div className="login-hero" style={{ paddingBottom: 130 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, padding: "10px 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt={SITE_NAME} style={{ height: 44 }} />
          <span style={{ color: "var(--green-700)", fontWeight: 800, fontSize: 24 }}>{SITE_NAME}</span>
        </div>
        <p>
          {daScegliere
            ? `Ciao ${user.firstName}! Con che ruolo lavori oggi?`
            : aree.length > 0
              ? `Ciao ${user.firstName}! Dove vuoi andare oggi?`
              : `Ciao ${user.firstName}! Non hai ancora nessuna area abilitata.`}
        </p>
      </div>
      <div className="login-cards" style={{ maxWidth: 1180 }}>
        {ruoli.length > 0 && (
          <div className="card scelta-ruolo">
            <strong>{daScegliere ? "Scegli il ruolo" : "Stai lavorando come"}</strong>
            <span className="hint">{dove} · puoi cambiarlo quando vuoi da «Cambia ruolo o area», in alto in ogni pagina</span>
            <div className="scelta-ruolo-opzioni">
              {ruoli.map((r) => (
                <form key={r.id} action={scegliRuolo.bind(null, r.id)}>
                  <button type="submit" className={`scelta-ruolo-btn${r.attivo ? " attivo" : ""}`}>
                    <span className="scelta-ruolo-nome">{r.attivo ? "✓ " : ""}{r.etichetta}</span>
                    <span className="hint">{r.aree.length ? r.aree.map((a) => SITE_LABELS_BREVI[a]).join(" · ") : "nessuna area"}</span>
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}
        {/*
          * Nessuna area assegnata: si dice cosa fare, invece di lasciare una
          * pagina vuota. Capita a chi è appena stato creato senza spuntare le
          * aree, che per sicurezza non entra da nessuna parte.
          */}
        {aree.length === 0 && !daScegliere && (
          <div className="card" style={{ padding: 18 }}>
            <strong>Il tuo accesso non è ancora abilitato</strong>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "6px 0 0" }}>
              Chiedi a chi gestisce gli utenti della tua insegna, o al Consorzio, di assegnarti le aree
              che ti servono (Academy, Cartelli Arredo, Offerte Zoo). Si fa da <strong>Utenti e ruoli</strong>,
              spuntando le caselle sulla tua riga.
              {db.settings.supportEmail && <> Per aiuto: {db.settings.supportEmail}.</>}
            </p>
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {aree.map((a) => (
            <div key={a.titolo} className="area-card-box">
            {amministratore && <CambiaFotoArea chiave={a.chiave} personalizzata={!!db.settings.fotoAree?.[a.chiave]} />}
            {a.attiva ? (
              <a className="area-card" href={a.href}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.foto} alt="" className="area-photo" />
                <span className="area-body">
                  <span className="area-title">{a.icona} {a.titolo}</span>
                  <span className="area-desc">{a.desc}</span>
                  <span className="area-cta">Entra <ArrowRight size={14} /></span>
                </span>
              </a>
            ) : (
              <div className="area-card disabled">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.foto} alt="" className="area-photo" />
                <span className="area-body">
                  <span className="area-title">{a.icona} {a.titolo}</span>
                  <span className="area-desc">{a.desc}</span>
                  <span className="pill pill-gray" style={{ alignSelf: "flex-start" }}>Presto</span>
                </span>
              </div>
            )}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <form action={logout} style={{ display: "inline" }}>
            <button className="btn btn-outline btn-sm" type="submit">Esci</button>
          </form>
        </div>
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 18 }}>
          In produzione: questa scelta vive su <strong>one.gardenteam.biz</strong>; chi arriva direttamente da
          academy.gardenteam.biz o stampe.gardenteam.biz entra senza passare di qui.
        </p>
      </div>
    </div>
  );
}
